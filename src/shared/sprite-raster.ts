/**
 * 最小软件光栅化器：只覆盖 `DrawOp` 除 `text` 外的图元，为的是构建期产位图资产。
 * 桌面猫运行时仍走 `paintOps`（浏览器 canvas）——两条路径不合并（Task 11 Step 1 的裁决）。
 * 像素尺只认质心/覆盖度/尺寸，所以抗锯齿与 Chromium 的差别不进验收面（spec §5-3）。
 *
 * 累积缓冲区存的是**预乘**色（r·a, g·a, b·a, a）：降采样时直接平均，出口再除回 alpha。
 * 如果改存直通色，半透边缘会被除以两次 alpha（`withAlpha` 满仓都是半透色，一次就全歪）。
 */
import type { DrawOp, Point2 } from "./draw-ops";
import { parse } from "./pet-tokens";

export interface Raster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface RenderOpts {
  mask?: "none" | "disc";
  ss?: number;
}

type Span = [number, number]; // 行内 [x0, x1)，像素下标，已夹进行宽
type Rgb = [number, number, number, number]; // r/g/b ∈ 0..255，a ∈ 0..1

const MAX_SS = 4;

export function renderOps(ops: DrawOp[], width: number, height: number, opts: RenderOpts = {}): Raster {
  const ss = Math.max(1, Math.min(MAX_SS, Math.round(opts.ss ?? 2)));
  const w = width * ss;
  const h = height * ss;
  const buf = new Float64Array(w * h * 4);
  const mask = opts.mask ?? "none";

  for (const op of ops) paintOp(buf, w, h, op, mask, ss);

  const rgba = new Uint8Array(width * height * 4);
  const n = ss * ss;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let pr = 0, pg = 0, pb = 0, a = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        for (let dx = 0; dx < ss; dx += 1) {
          const i = ((y * ss + dy) * w + (x * ss + dx)) * 4;
          pr += buf[i]; pg += buf[i + 1]; pb += buf[i + 2]; a += buf[i + 3];
        }
      }
      const alpha = a / n;
      const o = (y * width + x) * 4;
      rgba[o + 3] = Math.round(alpha * 255);
      if (alpha > 1e-6) {
        // 加权：透明格子的颜色不该把边缘往黑里拉
        rgba[o] = clamp255(pr / n / alpha);
        rgba[o + 1] = clamp255(pg / n / alpha);
        rgba[o + 2] = clamp255(pb / n / alpha);
      }
    }
  }
  return { width, height, rgba };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function paintOp(buf: Float64Array, w: number, h: number, op: DrawOp, mask: "none" | "disc", ss: number): void {
  if (op.kind === "text") throw new RangeError("位图管线不支持 text 图元（R-D10）");
  const spans = spansOf(op, w, h, ss);
  const solid = op.kind === "gradPath" ? null : toRgba(colorOfRaw(op));
  const grad = op.kind === "gradPath" ? prepareGradient(op) : null;

  for (const [y, list] of spans) {
    const yc = y + 0.5;
    for (const [x0, x1] of list) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) {
        if (mask === "disc") {
          const dx = x + 0.5 - w / 2;
          const dy = yc - h / 2;
          const rr = Math.min(w, h) / 2;
          if (dx * dx + dy * dy > rr * rr) continue;
        }
        const [r, g, b, a] = solid ?? gradientAt(grad!, (x + 0.5) / ss, yc / ss);
        const i = (y * w + x) * 4;
        buf[i] = r * a + buf[i] * (1 - a);
        buf[i + 1] = g * a + buf[i + 1] * (1 - a);
        buf[i + 2] = b * a + buf[i + 2] * (1 - a);
        buf[i + 3] = a + buf[i + 3] * (1 - a);
      }
    }
  }
}

function colorOfRaw(op: DrawOp): string {
  switch (op.kind) {
    case "strokePath": return op.stroke;
    case "strokeEllipse": return op.stroke;
    case "strokeRoundRect": return op.stroke;
    case "gradPath": return op.stops[0]?.color ?? "#000000"; // 只为类型闭合；真正取色走 gradientAt
    case "text": return op.color;
    default: return op.fill;
  }
}

/** `#rrggbb` 与 `rgba(r,g,b,a)` 两种写法都会从 art.ts 里出来（`withAlpha` 产后者）。 */
export function toRgba(color: string): Rgb {
  const m = /^rgba\(([^)]+)\)$/.exec(color);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((s) => Number.parseFloat(s.trim()));
    if ([r, g, b, a].some((v) => Number.isNaN(v))) throw new RangeError(`颜色解析失败：${color}`);
    return [r, g, b, Math.max(0, Math.min(1, a))];
  }
  const p = parse(color);
  return [p.r, p.g, p.b, 1];
}

interface Gradient {
  from: Point2;
  to: Point2;
  stops: Array<{ at: number; color: Rgb }>;
}

function prepareGradient(op: Extract<DrawOp, { kind: "gradPath" }>): Gradient {
  const stops = op.stops
    .map((s) => ({ at: s.at, color: toRgba(s.color) }))
    .sort((a, b) => a.at - b.at);
  return { from: op.from, to: op.to, stops };
}

function gradientAt(g: Gradient, x: number, y: number): Rgb {
  const dx = g.to[0] - g.from[0];
  const dy = g.to[1] - g.from[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((x - g.from[0]) * dx + (y - g.from[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  if (g.stops.length === 0) return [0, 0, 0, 0];
  if (t <= g.stops[0].at) return g.stops[0].color;
  for (let i = 1; i < g.stops.length; i += 1) {
    const b = g.stops[i];
    if (t <= b.at) {
      const a = g.stops[i - 1];
      const span = b.at - a.at;
      const k = span > 0 ? (t - a.at) / span : 0;
      return [
        a.color[0] + (b.color[0] - a.color[0]) * k,
        a.color[1] + (b.color[1] - a.color[1]) * k,
        a.color[2] + (b.color[2] - a.color[2]) * k,
        a.color[3] + (b.color[3] - a.color[3]) * k,
      ];
    }
  }
  return g.stops[g.stops.length - 1].color;
}

/**
 * 所有图元先乘 `s` 进超采样坐标系。plan 的示例漏了这一步：缓冲区是 `width*ss` 宽，
 * 但 op 坐标仍是输出像素，形状会缩在左上角 1/ss 里，`disc` 那条的质心判据当场红。
 */
function spansOf(op: DrawOp, w: number, h: number, s: number): Map<number, Span[]> {
  switch (op.kind) {
    case "fillPath":
    case "gradPath":
      return polySpans(op.points, w, h, s);
    case "strokePath":
      return strokeSpans(op.points, op.width * s, op.close ?? false, w, h, s);
    case "fillEllipse":
      assertNoRot(op.rot);
      return ellipseSpans(op.cx * s, op.cy * s, op.rx * s, op.ry * s, w, h);
    case "strokeEllipse": {
      const cx = op.cx * s, cy = op.cy * s, rx = op.rx * s, ry = op.ry * s, t = (op.width * s) / 2;
      return subtractMaps(
        ellipseSpans(cx, cy, rx + t, ry + t, w, h),
        ellipseSpans(cx, cy, Math.max(0, rx - t), Math.max(0, ry - t), w, h),
      );
    }
    case "fillRoundRect":
      return roundRectSpans(op.x * s, op.y * s, op.w * s, op.h * s, op.r * s, w, h);
    case "strokeRoundRect": {
      const t = (op.width * s) / 2;
      return subtractMaps(
        roundRectSpans((op.x - op.width / 2) * s, (op.y - op.width / 2) * s, (op.w + op.width) * s, (op.h + op.width) * s, (op.r + op.width / 2) * s, w, h),
        roundRectSpans((op.x + op.width / 2) * s, (op.y + op.width / 2) * s, (op.w - op.width) * s, (op.h - op.width) * s, Math.max(0, op.r - op.width / 2) * s, w, h),
      );
    }
    case "crescent":
      // 外圆裁域内的「两圆差集」：内圆伸出外圆的那一截一行都不填（native #69 / ops.ts 同口径）。
      return subtractMaps(
        ellipseSpans(op.cx * s, op.cy * s, op.r * s, op.r * s, w, h),
        ellipseSpans((op.cx + op.dx) * s, (op.cy + op.dy) * s, op.cut * s, op.cut * s, w, h),
      );
    case "text":
      throw new RangeError("位图管线不支持 text 图元（R-D10）");
  }
}

function assertNoRot(rot: number | undefined): void {
  if (rot === undefined) return;
  const turn = Math.abs(rot) % (Math.PI * 2);
  if (turn > 1e-9 && Math.PI * 2 - turn > 1e-9) throw new RangeError("本期不支持旋转椭圆");
}

/** 多边形：非零环绕。点列已经过 `Xf`，这里是纯像素空间。 */
function polySpans(poly: Point2[], w: number, h: number, s: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  if (poly.length < 3) return out;
  const pts = poly.map(([x, y]): Point2 => [x * s, y * s]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(h, Math.ceil(maxY)); y += 1) {
    const yc = y + 0.5;
    const xs: Array<{ x: number; dir: number }> = [];
    for (let i = 0; i < pts.length; i += 1) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) {
        xs.push({ x: x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0), dir: y1 > y0 ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    const spans: Span[] = [];
    let wind = 0;
    let open: Span | null = null;
    for (const seg of xs) {
      const before = wind;
      wind += seg.dir;
      if (before === 0 && wind !== 0) open = [Math.floor(seg.x), 0];
      else if (before !== 0 && wind === 0 && open) {
        open[1] = Math.ceil(seg.x);
        if (open[1] > open[0]) spans.push(open);
        open = null;
      }
    }
    if (spans.length) out.set(y, clampRow(spans, w));
  }
  return out;
}

function clampRow(spans: Span[], w: number): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans) {
    const x0 = Math.max(0, a);
    const x1 = Math.min(w, b);
    if (x1 > x0) out.push([x0, x1]);
  }
  return out;
}

/** 轴对齐椭圆：逐行解半宽。`rot` 由 `assertNoRot` 先行拦截。 */
function ellipseSpans(cx: number, cy: number, rx: number, ry: number, w: number, h: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  if (rx <= 0 || ry <= 0) return out;
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y += 1) {
    const t = 1 - ((y + 0.5 - cy) / ry) ** 2;
    if (t <= 0) continue;
    const hw = rx * Math.sqrt(t);
    out.set(y, clampRow([[Math.floor(cx - hw), Math.ceil(cx + hw)]], w));
  }
  return out;
}

/** 圆角矩形：中段满宽，上下两条用「到最近圆心的竖直距离」解内缩。 */
function roundRectSpans(x: number, y: number, rw: number, rh: number, radius: number, w: number, h: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  if (rw <= 0 || rh <= 0) return out;
  const r = Math.max(0, Math.min(radius, rw / 2, rh / 2));
  const cy = y + rh / 2;
  const straight = rh / 2 - r;
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(h, Math.ceil(y + rh)); py += 1) {
    const d = Math.abs(py + 0.5 - cy);
    if (d > rh / 2) continue;
    const beyond = Math.max(0, d - straight);
    const inset = r - Math.sqrt(Math.max(0, r * r - beyond * beyond));
    out.set(py, clampRow([[Math.round(x + inset), Math.round(x + rw - inset)]], w));
  }
  return out;
}

/**
 * 描边：到折线每段的距离 ≤ width/2 即落墨——等价于「每段一个等宽四边形 + 顶点圆盘」，
 * 但不用求法线，退化段（零长度、共线折返）也不会炸。`close === true` 时补末段。
 * 浏览器 canvas 的描边是**以路径为中心**的，这里同口径（Task 22 对 plan 的修正之一）。
 */
function strokeSpans(poly: Point2[], width: number, close: boolean, w: number, h: number, s: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  const r = width / 2;
  if (r <= 0 || poly.length === 0) return out;
  const pts = poly.map(([x, y]): Point2 => [x * s, y * s]);
  const segs: Array<[Point2, Point2]> = [];
  for (let i = 0; i + 1 < pts.length; i += 1) segs.push([pts[i], pts[i + 1]]);
  if (close && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  if (segs.length === 0) return out;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [a, b] of segs) {
    minX = Math.min(minX, a[0], b[0]); maxX = Math.max(maxX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
  }
  const r2 = r * r;
  const y0 = Math.max(0, Math.floor(minY - r));
  const y1 = Math.min(h, Math.ceil(maxY + r));
  const x0 = Math.max(0, Math.floor(minX - r));
  const x1 = Math.min(w, Math.ceil(maxX + r));

  for (let y = y0; y < y1; y += 1) {
    const py = y + 0.5;
    const spans: Span[] = [];
    let run = -1;
    for (let x = x0; x < x1; x += 1) {
      const px = x + 0.5;
      let hit = false;
      for (const [a, b] of segs) {
        if (segDist2(px, py, a, b) <= r2) { hit = true; break; }
      }
      if (hit && run < 0) run = x;
      else if (!hit && run >= 0) { spans.push([run, x]); run = -1; }
    }
    if (run >= 0) spans.push([run, x1]);
    if (spans.length) out.set(y, spans);
  }
  return out;
}

function segDist2(px: number, py: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx - px;
  const qy = a[1] + t * dy - py;
  return qx * qx + qy * qy;
}

function subtractMaps(a: Map<number, Span[]>, b: Map<number, Span[]>): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  for (const [y, spans] of a) {
    const diff = subtractSpans(spans, b.get(y) ?? []);
    if (diff.length) out.set(y, diff);
  }
  return out;
}

/** 同行两个 span 列表的差集（都按 x0 升序、互不重叠）。 */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  for (const [s, e] of a) {
    let cur = s;
    for (const [bs, be] of b) {
      if (be <= cur) continue;
      if (bs >= e) break;
      if (bs > cur) out.push([cur, Math.min(bs, e)]);
      cur = Math.max(cur, be);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out.filter(([x0, x1]) => x1 > x0);
}

export function alphaCoverage(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] > 8) n += 1;
  return n / (r.width * r.height);
}

export function inkCentroid(r: Raster): { x: number; y: number } {
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      const a = r.rgba[(y * r.width + x) * 4 + 3];
      // 用像素中心而不是下标：偶数宽的对称形状下标均值是 31.5，会平白欠半格。
      sx += (x + 0.5) * a; sy += (y + 0.5) * a; sw += a;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: r.width / 2, y: r.height / 2 };
}

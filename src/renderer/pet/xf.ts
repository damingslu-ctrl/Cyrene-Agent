import type { Point2 } from "./ops";

/**
 * 变换原语。移植自 ui.rs::Xf (lines 95-119)。
 * 所有旋转与缩放以脚部支点 (60, 100) 为心。
 */
export class Xf {
  s: number = 1;   // 整体缩放
  ox: number = 0;  // x 偏移
  oy: number = 0;  // y 偏移
  sx: number = 1;  // x 缩放
  sy: number = 1;  // y 缩放
  dy: number = 0;  // y 差分
  rot: number = 0; // 旋转弧度
  px: number = 60; // 缩放心点 x（必须取 60，否则伸懒腰读成平移）
  py: number = 100; // 缩放心点 y

  /** 照抄 ui.rs::Xf::map (110-118)：绕支点旋转 → 绕支点横向缩放 → y 绕 100 缩放 → 整体缩放 + 偏移。 */
  map(p: Point2): Point2 {
    const cos = Math.cos(this.rot), sin = Math.sin(this.rot);
    const dx = p[0] - this.px, dy2 = p[1] - this.py;
    const xr = this.px + dx * cos - dy2 * sin;
    const yr = this.py + dx * sin + dy2 * cos;
    const xx = this.px + (xr - this.px) * this.sx;
    const yy = 100 + (yr - 100) * this.sy + this.dy;
    return [this.ox + xx * this.s, this.oy + yy * this.s];
  }
}

/**
 * 丝带：沿路径 points 生成宽度从 w0 到 w1 的闭合多边形（含圆头端帽）。
 * 移植自 ui.rs::ribbon (lines 221-255)。
 */
export function ribbon(points: Point2[], w0: number, w1: number): Point2[] {
  const n = points.length;
  if (n < 2) return [];
  const left: Point2[] = [];
  const right: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1e-3;
    const nx = dy / len, ny = -dx / len;
    const h = (w0 + (w1 - w0) * (i / (n - 1))) * 0.5;
    left.push([p[0] + nx * h, p[1] + ny * h]);
    right.push([p[0] - nx * h, p[1] - ny * h]);
  }
  // 圆头：从 +法线 扫到 −法线（θ = 90° → −90°）
  const end = points[n - 1];
  const prev = points[n - 2];
  const edx = end[0] - prev[0], edy = end[1] - prev[1];
  const elen = Math.sqrt(edx * edx + edy * edy) || 1e-3;
  const ux = edx / elen, uy = edy / elen;
  const h = w1 * 0.5;
  for (let k = 1; k <= 3; k++) {
    const th = (Math.PI / 2) * (1 - k / 2);
    left.push([end[0] + h * (Math.cos(th) * ux + Math.sin(th) * uy), end[1] + h * (Math.cos(th) * uy - Math.sin(th) * ux)]);
  }
  return [...left, ...right.reverse()];
}

/** 三次贝塞尔采样。移植自 ui.rs::cubic_to。 */
export function cubicTo(pts: Point2[], n = 12): Point2[] {
  if (pts.length < 4) return pts;
  const [p0, p1, p2, p3] = pts;
  const result: Point2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    result.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return result;
}

/** 二次贝塞尔采样。移植自 ui.rs::quad_to。 */
export function quadTo(pts: Point2[], n = 10): Point2[] {
  if (pts.length < 3) return pts;
  const [p0, p1, p2] = pts;
  const result: Point2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    result.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
    ]);
  }
  return result;
}

/** 圆弧采样（嘴 / 闭眼 / 开心眼）：二次贝塞尔描边。移植自 ui.rs::arc。 */
export function arc(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, n = 12): Point2[] {
  const v: Point2[] = [[x0, y0]];
  const pts = quadTo([[x0, y0], [cx, cy], [x1, y1]], n);
  v.push(...pts.slice(1));
  return v;
}

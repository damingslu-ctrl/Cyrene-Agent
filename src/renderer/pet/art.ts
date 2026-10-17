/**
 * 美术移植层：把 native ui.rs::draw_cat 完整复制为 TypeScript DrawOp 生成器。
 *
 * 移植纪律：
 * - 所有数值照抄 ui.rs，不许改。
 * - 层序照抄 ui.rs::draw_cat，不许改。
 * - 变换以脚部支点 (60, 100) 为心（ui.rs:95-119 的教训）。
 * - 不用 scanline 叠色（native #68 的亚像素叠加坑），直接渐变填充。
 */
import type { DrawOp, Point2 } from "./ops";
import {
  ACCENT, BG_SOLID, BREAK_EAR, BREAK_FILL, BREAK_SOFT, DIM, EYE,
  GREEN, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, SHADOW, WARN,
} from "./tokens";
import { ribbon, cubicTo, quadTo, arc, Xf } from "./xf";

// ===========================================================================
// 类型别名（对应 ui.rs）
// ===========================================================================

export type Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep";

export interface Pose {
  paw: number;
  yawn: number;
  stretch: number;
  tilt: number;
  engagement: number;
}

export interface CatInput {
  center: { x: number; y: number };  // 宠物视觉中心（屏幕坐标）
  u: number;       // 尺度（viewBox 映射到 2u 宽）
  mood: Mood;
  t: number;       // 时间（秒）
  energy: number;  // 流量强度 0..1
  mouse: Point2 | null;
  blink: number;   // 0 睁..1 闭
  jumpY: number;   // 点击跳跃像素偏移（负=向上）
  pet: number;     // 摸头亲密度 0..1
  pose: Pose;
  quiet: boolean;  // 免打扰
  unreadCount: number;
}

// ===========================================================================
// viewBox 常量（ui.rs 里的定值）
// ===========================================================================

const VB = 120; // viewBox 宽（native ui.rs:622）
const TILT_DEG = 13.0;

const BODY_TOP = (mood: Mood) => mood === "grumpy" ? BREAK_FILL : INK;
const BODY_BOT = (mood: Mood) => mood === "grumpy" ? BREAK_SOFT : INK_SOFT;
const BODY_COL = (mood: Mood) => mood === "grumpy" ? BREAK_FILL : INK;
const INNER_EAR = (mood: Mood) => mood === "grumpy" ? BREAK_EAR : ROSE_DEEP;
const SHADOW_ALPHA = (mood: Mood) => mood === "grumpy" ? 0.10 : 0.20;

// ===========================================================================
// 部件路径（viewBox 坐标，忠实移植自 ui.rs:197-310）
// ===========================================================================

/** 身体轮廓（闭合贝塞尔团子）。ui.rs:198 */
function bodyPath(): Point2[] {
  const v: Point2[] = [[60, 34]];
  const cb = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => {
    const pts = cubicTo([p0, p1, p2, p3], 12);
    return pts.slice(1);
  };
  v.push(...cb([60, 34], [84, 34], [96, 56], [94, 76]));
  v.push(...cb([94, 76], [92, 96], [78, 106], [60, 106]));
  v.push(...cb([60, 106], [42, 106], [28, 96], [26, 76]));
  v.push(...cb([26, 76], [24, 56], [36, 34], [60, 34]));
  return v;
}

/** 尾巴中心线。ui.rs:210 */
function tailSpine(): Point2[] {
  const v: Point2[] = [[90, 88]];
  const cb = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => {
    const pts = cubicTo([p0, p1, p2, p3], 12);
    return pts.slice(1);
  };
  v.push(...cb([90, 88], [105, 89], [114, 82], [116, 72]));
  v.push(...cb([116, 72], [118, 62], [113, 55], [105, 52]));
  return v;
}

/** 左耳外缘三角。ui.rs:258 */
function earLOuter(): Point2[] { return [[34, 40], [28, 16], [52, 30]]; }
/** 左耳内（玫瑰色）三角。ui.rs:264 */
function earLInner(): Point2[] { return [[38, 36.5], [34.5, 26], [47, 31.5]]; }
/** 右耳外缘三角。ui.rs:268 */
function earROuter(): Point2[] { return [[86, 40], [92, 16], [68, 30]]; }
/** 右耳内（玫瑰色）三角。ui.rs:272 */
function earRInner(): Point2[] { return [[82, 36.5], [85.5, 26], [73, 31.5]]; }

/** 鼻头。ui.rs:277 */
function nosePath(): Point2[] {
  const v: Point2[] = [[60, 64.5]];
  const cb = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => {
    const pts = cubicTo([p0, p1, p2, p3], 12);
    return pts.slice(1);
  };
  v.push(...cb([60, 64.5], [64.5, 64.5], [65.5, 67.8], [62.8, 69.4]));
  v.push(...cb([62.8, 69.4], [61.2, 70.4], [58.8, 70.4], [57.2, 69.4]));
  v.push(...cb([57.2, 69.4], [54.5, 67.8], [55.5, 64.5], [60, 64.5]));
  return v;
}

/** 围兜（奶油色，上窄下宽）。ui.rs:291 */
function bibPath(): Point2[] {
  const v: Point2[] = [[60, 61]];
  const cb = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => {
    const pts = cubicTo([p0, p1, p2, p3], 12);
    return pts.slice(1);
  };
  v.push(...cb([60, 61], [68.5, 61.5], [70, 72], [73, 84]));
  v.push(...cb([73, 84], [76.5, 95], [70, 104], [60, 104]));
  v.push(...cb([60, 104], [50, 104], [43.5, 95], [47, 84]));
  v.push(...cb([47, 84], [50, 72], [51.5, 61.5], [60, 61]));
  return v;
}

/** 耳朵抽动角（度）。ui.rs:301 */
function earTwitch(t: number, mood: Mood): number {
  const period = mood === "thinking" ? 2.0 : 3.5;
  const ph = t % period;
  if (ph < 0.2) {
    const amp = mood === "thinking" ? 10.0 : 6.0;
    return Math.sin((ph / 0.2) * (Math.PI / 2)) * amp;
  }
  return 0;
}

/** 绕 (cx, cy) 旋转 deg 度。ui.rs:122 */
function rotDeg(x: number, y: number, cx: number, cy: number, deg: number): Point2 {
  if (Math.abs(deg) < 1e-4) return [x, y];
  const r = deg * (Math.PI / 180);
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = x - cx, dy2 = y - cy;
  return [cx + dx * cos - dy2 * sin, cy + dx * sin + dy2 * cos];
}

/** 对多边形施加绕 (cx,cy) 旋转 + 平移。ui.rs:135 */
function bendPoly(poly: Point2[], dx: number, dy: number, deg: number, cx: number, cy: number): Point2[] {
  return poly.map(p => {
    const [x, y] = rotDeg(p[0], p[1], cx, cy, deg);
    return [x + dx, y + dy] as Point2;
  });
}

/** 顶光弧线（arc 函数）。ui.rs:187 */
function arcPath(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): Point2[] {
  return arc(x0, y0, cx, cy, x1, y1, 12);
}

// ===========================================================================
// 工具函数
// ===========================================================================

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function withAlpha(color: string, alpha: number): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

// ===========================================================================
// 主绘制函数（ui.rs:588-1159）
// 按 ui.rs::draw_cat 的层序收集 ops，最后统一 emit
// ===========================================================================

export function buildCatOps(input: CatInput): DrawOp[] {
  const { center, u, mood, t, energy, mouse, blink, jumpY, pet, pose, quiet } = input;
  const sleep = mood === "sleep" ? 1 : 0;
  const s = (u * 2.0) / VB;

  // 呼吸
  const settle = 1.0 - 0.9 * Math.max(pose.paw, pose.yawn, pose.stretch, Math.min(Math.abs(pose.tilt) / TILT_DEG, 1));
  const breathe = (0.02 + 0.035 * sleep) * Math.sin(t * (1.5 - 0.7 * sleep)) * settle;
  const sy_body = 1.0 + breathe;
  const dy_total = jumpY + breathe * 6.0;
  const rot_deg = Math.sin(t * 0.4) * 3.0 * (1.0 - sleep) * settle;
  const sx_all = 1.0 + 0.055 * pose.stretch;
  const sy_all = sy_body * (1.0 - 0.075 * pose.stretch);

  // 身体变换 xf（整只猫）
  const xf = new Xf();
  xf.s = s; xf.ox = center.x - 60 * s; xf.oy = center.y - 70 * s;
  xf.sx = sx_all; xf.sy = sy_all; xf.dy = dy_total;
  xf.rot = rot_deg * (Math.PI / 180); xf.px = 60; xf.py = 100;

  // 影子变换 sh
  const sh = new Xf();
  sh.s = s; sh.ox = xf.ox + 3 * s; sh.oy = xf.oy + 5 * s;
  sh.sx = sx_all; sh.sy = sy_all; sh.dy = dy_total; sh.rot = xf.rot; sh.px = 60; sh.py = 100;

  // 脸部变换 fx（歪头）
  const fx = new Xf();
  fx.s = xf.s; fx.ox = xf.ox; fx.oy = xf.oy; fx.sx = xf.sx; fx.sy = xf.sy; fx.dy = xf.dy;
  fx.rot = xf.rot + pose.tilt * (Math.PI / 180); fx.px = 60; fx.py = 66;

  // 按层收集 ops（ui.rs::draw_cat 层序）
  const byLayer: Record<string, DrawOp[]> = {
    ground_shadow: [], tail: [], tail_tip: [], ears: [],
    body: [], body_light: [], body_stroke: [],
    bib: [], bib_ao: [], paws: [],
    eyes: [], nose: [], mouth: [], blush: [],
    zzz: [], quiet_mark: [], heart: [], stars: [], badge: [],
  };

  // 投影（ground_shadow）
  const lift = Math.max(0, Math.min(1, -jumpY / 26.0));
  const fade = 1.0 - 0.55 * lift;
  const RINGS: Array<[number, number]> = [[1.00, 0.016], [0.86, 0.018], [0.70, 0.020], [0.52, 0.023], [0.30, 0.027]];
  for (const [f, a] of RINGS) {
    const [mx, my] = sh.map([60, 106]);
    const rx = 27 * (1 - 0.25 * lift) * f * s, ry = 5.2 * (1 - 0.30 * lift) * f * s;
    byLayer.ground_shadow.push({
      kind: "fillEllipse", fill: withAlpha(SHADOW, a * fade),
      cx: mx, cy: my, rx, ry,
      layer: "ground_shadow",
    });
  }

  // 尾巴（tail + tail_tip）
  const sway = (sleep > 0.5 ? 1.0 : mood === "happy" ? 8.0 : energy * 6.0) + pet * 7.0;
  const wag = sway * settle * Math.sin(t * 3.0) + 11.0 * pose.stretch;
  const spine = tailSpine();
  const tailRibbon = ribbon(spine, 12.0, 7.5);
  const tail = bendPoly(tailRibbon, 0, 0, wag, 90, 88);
  byLayer.tail.push({
    kind: "gradPath",
    from: xf.map([60, 34]), to: xf.map([60, 106]),
    stops: [{ at: 0, color: BODY_TOP(mood) }, { at: 1, color: BODY_BOT(mood) }],
    points: tail.map(xf.map.bind(xf)),
    layer: "tail",
  });
  // 白尾尖
  const cut = Math.max(0, spine.length - 6);
  const tip = bendPoly(ribbon(spine.slice(cut), 8.4, 7.6), 0, 0, wag, 90, 88);
  byLayer.tail_tip.push({ kind: "fillPath", fill: PAPER, points: tip.map(xf.map.bind(xf)), layer: "tail_tip" });

  // 耳朵（ears）
  const twitch = earTwitch(t, mood);
  const l_ear = bendPoly(earLOuter(), 0, 0, twitch, 42, 38);
  const l_in = bendPoly(earLInner(), 0, 0, twitch, 42, 38);
  const r_ear = bendPoly(earROuter(), 0, 0, -twitch, 78, 38);
  const r_in = bendPoly(earRInner(), 0, 0, -twitch, 78, 38);
  for (const poly of [l_ear, r_ear]) byLayer.ears.push({ kind: "fillPath", fill: BODY_COL(mood), points: poly.map(fx.map.bind(fx)), layer: "ears" });
  for (const poly of [l_in, r_in]) byLayer.ears.push({ kind: "fillPath", fill: INNER_EAR(mood), points: poly.map(fx.map.bind(fx)), layer: "ears" });

  // 身体（body + body_light + body_stroke）
  const bodyPts = bodyPath().map(xf.map.bind(xf));
  byLayer.body.push({ kind: "gradPath", from: xf.map([60, 34]), to: xf.map([60, 106]), stops: [{ at: 0, color: BODY_TOP(mood) }, { at: 1, color: BODY_BOT(mood) }], points: bodyPts, layer: "body" });
  // 底缘暗部（body_light）
  const [bx, by2] = xf.map([60, 101]);
  const brx = 25 * s, bry = 6.5 * s;
  byLayer.body_light.push({ kind: "fillEllipse", fill: withAlpha(SHADOW, SHADOW_ALPHA(mood)), cx: bx, cy: by2, rx: brx, ry: bry, layer: "body_light" });
  // 顶光（body_stroke）
  byLayer.body_stroke.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.22), width: 2.6 * s, points: arcPath(37.1, 47.4, 36.4, 44.75, 53.7, 37.5).map(xf.map.bind(xf)), layer: "body_stroke" });
  byLayer.body_stroke.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.18), width: 2.2 * s, points: arcPath(31.0, 58.0, 27.5, 49.0, 33.0, 43.5).map(xf.map.bind(xf)), layer: "body_stroke" });

  // 围兜（bib + bib_ao）
  byLayer.bib.push({ kind: "gradPath", from: xf.map([60, 61]), to: xf.map([60, 104]), stops: [{ at: 0, color: PAPER }, { at: 1, color: PAPER_SHADE }], points: bibPath().map(xf.map.bind(xf)), layer: "bib" });
  const [aox, aoy] = xf.map([60, 63.5]);
  const arx = 10 * s, ary = 3.2 * s;
  byLayer.bib_ao.push({ kind: "fillEllipse", fill: withAlpha(INK, 0.10), cx: aox, cy: aoy, rx: arx, ry: ary, layer: "bib_ao" });

  // 前爪（paws）
  const push = pose.stretch;
  for (const [px_base, raised] of [[43, pose.paw > 0.02], [77, false]] as [number, boolean][]) {
    if (raised) continue;
    const cx = px_base + (px_base - 60) * 0.12 * push;
    const cy2 = 99 + 3.4 * push;
    const [pcx, pcy] = xf.map([cx, cy2]);
    const prx = (7.4 + 1.2 * push) * s, pry = (5.6 - 1.6 * push) * s;
    byLayer.paws.push({ kind: "fillEllipse", fill: PAPER, cx: pcx, cy: pcy, rx: prx, ry: pry, layer: "paws" });
    byLayer.paws.push({ kind: "strokePath", stroke: withAlpha(PAPER_SHADE, 0.95), width: 2.2 * s, points: arcPath(pcx - 5.5 * s, pcy + 1.5 * s, pcx, pcy + 5.5 * s, pcx + 5.5 * s, pcy + 1.5 * s), layer: "paws" });
  }
  // 洗脸左爪（paws）
  if (pose.paw > 0.02) {
    const k = pose.paw;
    const rub = Math.sin(t * 5.2) * 2.2 * k;
    const tx = 51.0 + rub, ty = 67.0 - 1.6 * rub;
    const sleevePts: Point2[] = [];
    for (let i = 0; i <= 6; i++) {
      const q = i / 12;
      const a0 = (1 - q) * (1 - q), b0 = 2 * (1 - q) * q, c0 = q * q;
      sleevePts.push([a0 * 43 + b0 * 32 + c0 * tx, a0 * 99 + b0 * 84 + c0 * ty]);
    }
    byLayer.paws.push({ kind: "strokePath", stroke: withAlpha(INK, 0.95 * k), width: 6.2 * (0.4 + 0.6 * k) * s, points: sleevePts.map(fx.map.bind(fx)), layer: "paws" });
    const [ptx, pty] = fx.map([tx, ty]);
    const ptrx = 6.6 * s, ptry2 = 5.4 * s;
    byLayer.paws.push({ kind: "fillEllipse", fill: PAPER, cx: ptx, cy: pty, rx: ptrx, ry: ptry2, layer: "paws" });
    byLayer.paws.push({ kind: "strokePath", stroke: withAlpha(PAPER_SHADE, 0.95), width: 2.0 * s, points: arcPath(ptx - 4.8 * s, pty + 1.6 * s, ptx, pty + 4.8 * s, ptx + 4.8 * s, pty + 1.6 * s), layer: "paws" });
  }

  // 眼睛（eyes）
  const [headX, headY] = fx.map([60, 50]);
  let pupil: Point2;
  if (mouse) {
    const dx = mouse[0] - headX, dy = mouse[1] - headY;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    pupil = [dx / d * 1.4, dy / d * 1.4];
  } else {
    pupil = [Math.sin(t * 0.6) * 0.9, Math.cos(t * 0.3) * 0.5];
  }
  const blinkEff = Math.max(blink, sleep, 0.62 * pet, 0.92 * pose.yawn, quiet ? 0.82 : 0);
  const lid_a = Math.max(0, Math.min(1, (blinkEff - 0.55) / 0.45));
  const open = Math.max(0.08, 1.0 - 0.92 * blinkEff);
  const eyes: Point2[] = [[47, 54], [73, 54]];
  if (mood === "happy") {
    for (const [ex, ey] of eyes) {
      const [mx, my] = fx.map([ex, ey]);
      byLayer.eyes.push({ kind: "strokePath", stroke: PAPER, width: 3.6 * s, points: arcPath(mx - 6.2 * s, my + 1.5 * s, mx, my - 7.5 * s, mx + 6.2 * s, my + 1.5 * s), layer: "eyes" });
    }
  } else {
    for (const [ex, ey] of eyes) {
      const [mx, my] = fx.map([ex, ey]);
      const rx = Math.max(0.7, 5.9 * open) * s, ry = Math.max(0.6, 6.6 * open) * s;
      byLayer.eyes.push({ kind: "fillEllipse", fill: PAPER, cx: mx, cy: my, rx, ry, layer: "eyes" });
      const px2 = mx + pupil[0] * s, py2 = my + pupil[1] * 0.8 * s;
      const prx = rx * 0.80, pry = ry * 0.84;
      byLayer.eyes.push({ kind: "fillEllipse", fill: EYE, cx: px2, cy: py2, rx: prx, ry: pry, layer: "eyes" });
      const h1rx = rx * 0.30, h1ry = ry * 0.30;
      byLayer.eyes.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.96), cx: px2 - rx * 0.30, cy: py2 - ry * 0.34, rx: h1rx, ry: h1ry, layer: "eyes" });
      const h2rx = rx * 0.15, h2ry = ry * 0.15;
      byLayer.eyes.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.72), cx: px2 + rx * 0.34, cy: py2 + ry * 0.30, rx: h2rx, ry: h2ry, layer: "eyes" });
      if (lid_a > 0.01) {
        byLayer.eyes.push({ kind: "strokePath", stroke: withAlpha(PAPER, lid_a), width: 2.6 * s, points: arcPath(mx - 5.2 * s, my, mx, my + 5.0 * s, mx + 5.2 * s, my), layer: "eyes" });
      }
    }
  }

  // 鼻子（nose）
  byLayer.nose.push({ kind: "fillPath", fill: ROSE_DEEP, points: nosePath().map(fx.map.bind(fx)), layer: "nose" });

  // 嘴（mouth）
  const mouth_ink = withAlpha(INK, 0.88);
  const stemPts = (y1: number): Point2[] => [fx.map([60, 70.5]), fx.map([60, y1])];
  if (quiet) {
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.2 * s, points: stemPts(73.5), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(52.5, 75.4, 60, 76.3, 67.5, 75.4).map(fx.map.bind(fx)), layer: "mouth" });
  } else if (mood === "happy") {
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.2 * s, points: stemPts(73.0), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(60, 73.0, 55, 79.5, 50, 74.0).map(fx.map.bind(fx)), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(60, 73.0, 65, 79.5, 70, 74.0).map(fx.map.bind(fx)), layer: "mouth" });
  } else if (mood === "thinking") {
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.2 * s, points: stemPts(74.2), layer: "mouth" });
    const [mx, my] = fx.map([60, 76.2]);
    const mrx = 3.2 * s, mry = 3.2 * s;
    byLayer.mouth.push({ kind: "fillEllipse", fill: mouth_ink, cx: mx, cy: my, rx: mrx, ry: mry, layer: "mouth" });
  } else if (mood === "grumpy") {
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.2 * s, points: stemPts(73.5), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(53.5, 78.0, 60, 73.5, 66.5, 78.0).map(fx.map.bind(fx)), layer: "mouth" });
  } else {
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.2 * s, points: stemPts(73.5), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(60, 73.5, 56, 77.8, 52.5, 74.5).map(fx.map.bind(fx)), layer: "mouth" });
    byLayer.mouth.push({ kind: "strokePath", stroke: mouth_ink, width: 2.4 * s, points: arcPath(60, 73.5, 64, 77.8, 67.5, 74.5).map(fx.map.bind(fx)), layer: "mouth" });
  }
  // 哈欠
  if (pose.yawn > 0.02 && !quiet) {
    const y = pose.yawn;
    const [yx, yy] = fx.map([60, 78.0 + y]);
    const yrx = (2.6 + 2.6 * y) * s, yry = (3.0 + 5.4 * y) * s;
    byLayer.mouth.push({ kind: "fillEllipse", fill: mouth_ink, cx: yx, cy: yy, rx: yrx, ry: yry, layer: "mouth" });
    const [yx2, yy2] = fx.map([60, 78.6 + y]);
    const y2rx = (1.2 + 1.3 * y) * s, y2ry = (1.4 + 3.0 * y) * s;
    byLayer.mouth.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.85 * y), cx: yx2, cy: yy2, rx: y2rx, ry: y2ry, layer: "mouth" });
  }
  // 睡着小圆嘴
  if (sleep > 0.35) {
    const k = Math.abs(Math.sin(t * 1.1));
    const [mx, my] = fx.map([60, 76]);
    const srx = (1.8 + 1.6 * k) * s, sry = (2.0 + 2.0 * k) * s;
    byLayer.mouth.push({ kind: "fillEllipse", fill: withAlpha(INK, 0.55 + 0.35 * sleep), cx: mx, cy: my, rx: srx, ry: sry, layer: "mouth" });
  }

  // 腮红 + 胡须（blush）
  if (mood !== "grumpy") {
    for (const [bx, by3] of [[35.5, 76], [84.5, 76]] as [number, number][]) {
      const [mbx, mby] = fx.map([bx, by3]);
      const brx = 6.4 * s, bry = 4.0 * s;
      byLayer.blush.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.70), cx: mbx, cy: mby, rx: brx, ry: bry, layer: "blush" });
    }
  }
  const whisk_c = withAlpha(PAPER, 0.42);
  for (const w of [[50, 64, 39, 58.5, 29, 58], [50, 69, 38, 69.5, 28, 72], [70, 64, 81, 58.5, 91, 58], [70, 69, 82, 69.5, 92, 72]] as [number, number, number, number, number, number][]) {
    byLayer.blush.push({ kind: "strokePath", stroke: whisk_c, width: 1.7 * s, points: arcPath(w[0], w[1], w[2], w[3], w[4], w[5]).map(fx.map.bind(fx)), layer: "blush" });
  }

  // Zzz（zzz）
  if (sleep > 0.5 && !quiet) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.45 + i / 3) % 1.0;
      const zx = center.x + (26 + 16 * ph) * s;
      const zy = center.y - (52 + 30 * ph) * s;
      const a = Math.max(0, Math.min(1, (1 - ph) * (sleep - 0.5) * 2));
      const fs = (9 + 7 * ph) * s * 1.6;
      byLayer.zzz.push({ kind: "text", text: "Z", x: zx, y: zy, size: fs, color: withAlpha(INK_SOFT, a * 0.9), layer: "zzz" });
    }
  }

  // 免打扰月牙（quiet_mark）
  if (quiet) {
    const mc: Point2 = [center.x + 6.5 * s, center.y - 51.5 * s];
    const rr = 1.28 * 9 * s;
    byLayer.quiet_mark.push({ kind: "crescent", fill: INK, cx: mc[0], cy: mc[1], r: rr, dx: 0.42 * rr, dy: -0.30 * rr, cut: 0.92 * rr, layer: "quiet_mark" });
    const r2 = 9 * s;
    byLayer.quiet_mark.push({ kind: "crescent", fill: PAPER, cx: mc[0], cy: mc[1], r: r2, dx: 0.42 * r2, dy: -0.30 * r2, cut: 0.92 * r2, layer: "quiet_mark" });
  }

  // 爱心（heart）
  if (pet > 0.12) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.55 + i / 3) % 1.0;
      const hx = center.x + (14 + 11 * ph) * s + Math.sin(ph * 6 + i) * 3 * s;
      const hy = center.y - (41 + 18 * ph) * s;
      const a = Math.max(0, Math.min(1, (1 - ph) * (pet - 0.12) / 0.88));
      const r = (3 + 2.4 * ph) * s * 1.7;
      const col = withAlpha(ROSE, a * 0.92);
      for (const sx of [-0.52, 0.52]) {
        const hcx = hx + r * sx, hcy = hy - r * 0.42;
        const hrx = r * 0.56, hry = r * 0.56;
        byLayer.heart.push({ kind: "fillEllipse", fill: col, cx: hcx, cy: hcy, rx: hrx, ry: hry, layer: "heart" });
      }
      byLayer.heart.push({ kind: "fillPath", fill: col, points: [[hx - r * 0.95, hy - r * 0.12], [hx + r * 0.95, hy - r * 0.12], [hx, hy + r]], layer: "heart" });
    }
  }

  // 星星（stars）
  if (mood === "happy" && sleep < 0.3) {
    for (let i = 0; i < 2; i++) {
      const ox = i === 0 ? -54 : 58, oy = i === 0 ? -46 : -58;
      const ph = Math.max(0, Math.sin(t * 1.6 + i * 1.9));
      if (ph < 0.05) continue;
      const sx2 = center.x + ox * s, sy2 = center.y + oy * s - 8 * ph * s;
      const rr = (2 + 2.2 * ph) * s * 1.6;
      const col = withAlpha(PAPER, ph * 0.7);
      byLayer.stars.push({ kind: "strokePath", stroke: col, width: 1.2, points: [[sx2 - rr, sy2], [sx2 + rr, sy2]], layer: "stars" });
      byLayer.stars.push({ kind: "strokePath", stroke: col, width: 1.2, points: [[sx2, sy2 - rr], [sx2, sy2 + rr]], layer: "stars" });
    }
  }

  // 角标（badge）
  if (mood !== "idle" && mood !== "sleep") {
    const BADGE_VB: Point2 = [103, 28];
    const [fill, sc] = (() => {
      switch (mood) {
        case "grumpy": return [WARN, 1.0 + 0.06 * Math.max(0, Math.sin(t * 2.5))] as const;
        case "thinking": return [ACCENT, 1.0 + 0.08 * Math.max(0, Math.sin(t * 3.0))] as const;
        case "happy": return [GREEN, 1.0 + 0.10 * Math.max(0, Math.sin(t * 3.5))] as const;
        default: return [WARN, 1.0] as const;
      }
    })();
    const xfn = new Xf();
    xfn.s = xf.s; xfn.ox = xf.ox; xfn.oy = xf.oy; xfn.sx = xf.sx; xfn.sy = xf.sy; xfn.dy = xf.dy;
    xfn.rot = 0; xfn.px = xf.px; xfn.py = xf.py;
    const bp = (dx: number, dy: number): Point2 => xfn.map([BADGE_VB[0] + dx * sc, BADGE_VB[1] + dy * sc]);
    const bg = (dx: number, dy: number): Point2 => [BADGE_VB[0] + dx * sc, BADGE_VB[1] + dy * sc];
    const brx = 11 * xfn.s, bry = 11 * xfn.s;
    byLayer.badge.push({ kind: "fillEllipse", fill, cx: bp(0, 0)[0], cy: bp(0, 0)[1], rx: brx, ry: bry, layer: "badge" });
    switch (mood) {
      case "grumpy":
        byLayer.badge.push({ kind: "strokePath", stroke: "#ffffff", width: 2.4 * xfn.s, points: [bg(0, -6), bg(0, 1)].map(xfn.map.bind(xfn)), layer: "badge" });
        const b1rx = 1.5 * xfn.s, b1ry = 1.5 * xfn.s;
        byLayer.badge.push({ kind: "fillEllipse", fill: "#ffffff", cx: bp(0, 5)[0], cy: bp(0, 5)[1], rx: b1rx, ry: b1ry, layer: "badge" });
        break;
      case "thinking":
        byLayer.badge.push({ kind: "strokePath", stroke: "#ffffff", width: 2.0 * xfn.s, points: arcPath(BADGE_VB[0] - 3, BADGE_VB[1], BADGE_VB[0], BADGE_VB[1] - 3, BADGE_VB[0] + 3, BADGE_VB[1]).map(xfn.map.bind(xfn)), layer: "badge" });
        const b2rx = 1.2 * xfn.s, b2ry = 1.2 * xfn.s;
        byLayer.badge.push({ kind: "fillEllipse", fill: "#ffffff", cx: bp(0, 4.5)[0], cy: bp(0, 4.5)[1], rx: b2rx, ry: b2ry, layer: "badge" });
        break;
      case "happy":
        byLayer.badge.push({ kind: "strokePath", stroke: "#ffffff", width: 2.4 * xfn.s, points: [bg(-5, 0), bg(-1, 4), bg(5, -4)].map(xfn.map.bind(xfn)), layer: "badge" });
        break;
    }
  }

  // 按层序 emit
  const ORDER = ["ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke", "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush", "zzz", "quiet_mark", "heart", "stars", "badge"];
  const ops: DrawOp[] = [];
  for (const layer of ORDER) {
    if (byLayer[layer]) ops.push(...byLayer[layer]);
  }
  return ops;
}

// ===========================================================================
// 胶囊绘制（ui.rs:4979-5018 的 CAP_ON/CAP_OFF 色阶）
// ===========================================================================

export interface CapsuleInput {
  rectWidth: number;
  rectHeight: number;
  e: number;
  growLeft: boolean;
  up: number;
  down: number;
  pinX: number;
}

const CAP_FILL_OFF = "#14161d";
const CAP_STROKE_OFF = "#2c303c";

export function buildCapsuleOps(input: CapsuleInput): DrawOp[] {
  const { rectWidth, rectHeight, e, growLeft, pinX } = input;
  if (e >= 0.5) return [];
  const cy = rectHeight - 32 / 2 - 4;
  const cx = growLeft ? rectWidth - pinX : pinX;
  const rx = 35, ry = 16;
  return [
    { kind: "fillEllipse", fill: CAP_FILL_OFF, cx, cy, rx, ry, layer: "capsule_fill" },
    { kind: "strokeEllipse", stroke: CAP_STROKE_OFF, width: 2, cx, cy, rx, ry, layer: "capsule_stroke" },
  ];
}

// ===========================================================================
// 测试辅助
// ===========================================================================

export function layerKinds(ops: DrawOp[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const op of ops) {
    const layer = op.layer ?? "";
    if (layer && !seen.has(layer)) {
      seen.add(layer);
      result.push(layer);
    }
  }
  return result;
}

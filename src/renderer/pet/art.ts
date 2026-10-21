/**
 * 美术移植层：把 native `ui.rs::draw_cat` 与 `main.rs` 的胶囊/未读记号复制为
 * TypeScript DrawOp 生成器。
 *
 * 移植纪律：
 * - 所有数值照抄 ui.rs / main.rs，不许改（采样密度也是数值，见 `xf.ts::arc`）。
 * - 层序照抄 ui.rs::draw_cat，不许改。洗脸爪排在整张脸**之后**（ui.rs:1027-1064）。
 * - 变换以脚部支点 (60, 100) 为心（ui.rs:95-119 的教训）。
 * - 椭圆与弧线一律走 `xfEllipse`/`xfArc`：native 的 `ellipse()` 半径带 `sx/sy`
 *   （呼吸、伸懒腰要把它压扁），`stroke_poly` 吃的是**未映射的 viewBox 点**且
 *   **不闭合**。任何"先在屏幕空间围绕已映射锚点构造"的写法在姿态档都会和身体脱开。
 * - 不用 scanline 叠色（native #68 的亚像素叠加坑），渐变直接交给 Chromium 填充。
 * - 「画在猫身外（＝用户桌布上）的记号必须双色」（native #69）：月牙与 Zzz 都是两色。
 */
import type { DrawOp, PetLayer, Point2 } from "./ops";
import {
  ACCENT, BREAK_EAR, BREAK_FILL, BREAK_SOFT, EYE, GREEN, INK, INK_SOFT,
  PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, SHADOW, WARN, withAlpha, PET_PRIVATE,
} from "../../shared/pet-tokens";
import { ribbon, cubicTo, arc, Xf } from "./xf";

// ===========================================================================
// 类型别名（对应 ui.rs）
// ===========================================================================

export type Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep";

export interface Pose {
  paw: number;
  yawn: number;
  stretch: number;
  tilt: number;
  /** 日程/告警的「在意程度」0..1，供调度器用；draw_cat 本身不消费（native 同理）。 */
  engagement: number;
}

export interface CatInput {
  center: { x: number; y: number };  // 宠物视觉中心（窗口内容坐标）
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
}

// ===========================================================================
// viewBox 常量（ui.rs 里的定值）
// ===========================================================================

const VB = 120; // viewBox 宽（native ui.rs:622）
const TILT_DEG = 13.0;

const BODY_TOP = (mood: Mood) => (mood === "grumpy" ? BREAK_FILL : INK);
const BODY_BOT = (mood: Mood) => (mood === "grumpy" ? BREAK_SOFT : INK_SOFT);
const BODY_COL = (mood: Mood) => (mood === "grumpy" ? BREAK_FILL : INK);
const INNER_EAR = (mood: Mood) => (mood === "grumpy" ? BREAK_EAR : ROSE_DEEP);
const SHADOW_ALPHA = (mood: Mood) => (mood === "grumpy" ? 0.10 : 0.20);

/** 徽章里的白色笔画：只在 `badge` 这一段用，已收编进 `PET_PRIVATE`，仍不算板内色。 */
const BADGE_INK = PET_PRIVATE.BADGE_INK; // ui.rs:1205 Color32::WHITE

// ===========================================================================
// native 助手对位（ui.rs:396-509）
// ===========================================================================

/** 对 `fill_solid`：viewBox 点列 → 过 xf → 闭合填充。 */
function xfFill(xf: Xf, layer: PetLayer, fill: string, poly: Point2[]): DrawOp {
  return { kind: "fillPath", fill, points: poly.map((p) => xf.map(p)), layer };
}

/**
 * 对 `fill_grad`：native 按 viewBox 的 y 逐扫描线取色（光源全局，锚在 y0..y1），
 * 再把每条弦过 xf。这里用同一条轴线的线性渐变近似——**不搬 scanline**（#68），
 * 轴取 viewBox 的 x=60 那条竖线，映射后与 native 的染色方向一致。
 */
function xfGrad(xf: Xf, layer: PetLayer, cTop: string, cBot: string, y0: number, y1: number, poly: Point2[]): DrawOp {
  return {
    kind: "gradPath",
    from: xf.map([60, y0]),
    to: xf.map([60, y1]),
    stops: [{ at: 0, color: cTop }, { at: 1, color: cBot }],
    points: poly.map((p) => xf.map(p)),
    layer,
  };
}

/** 对 `ellipse`（ui.rs:468-474）：半径带 `xf.s * xf.sx/sy`，中心过 xf。 */
function xfEllipse(xf: Xf, layer: PetLayer, fill: string, cx: number, cy: number, rx: number, ry: number): DrawOp {
  const [x, y] = xf.map([cx, cy]);
  return { kind: "fillEllipse", fill, cx: x, cy: y, rx: rx * xf.s * xf.sx, ry: ry * xf.s * xf.sy, layer };
}

/** 对 `circle`（ui.rs:476-478）：双轴同半径的高光用这个，不要拿 ry 当半径。 */
function xfCircle(xf: Xf, layer: PetLayer, fill: string, cx: number, cy: number, r: number): DrawOp {
  return xfEllipse(xf, layer, fill, cx, cy, r, r);
}

/** 对 `stroke_poly(&arc(...), xf, w, c)`：viewBox 弧线，宽度乘 `xf.s`，**不闭合**。 */
function xfArc(xf: Xf, layer: PetLayer, stroke: string, width: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): DrawOp {
  return xfPoly(xf, layer, stroke, width, arc(x0, y0, cx, cy, x1, y1));
}

/** 对 `stroke_poly(poly, xf, w, c)`：poly 必须是**未映射**的 viewBox 点（ui.rs:1185-1190 的教训）。 */
function xfPoly(xf: Xf, layer: PetLayer, stroke: string, width: number, poly: Point2[]): DrawOp {
  return { kind: "strokePath", stroke, width: width * xf.s, points: poly.map((p) => xf.map(p)), layer };
}

// ===========================================================================
// 部件路径（viewBox 坐标，忠实移植自 ui.rs:197-310）
// ===========================================================================

/** 三次贝塞尔一段：native `cubic_to` 自己就不含段起点，这里不许再 slice 掉一个。 */
const cb = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => cubicTo([p0, p1, p2, p3]);

/** 身体轮廓（闭合贝塞尔团子）。ui.rs:198 → 1 + 4×12 = 49 点 */
function bodyPath(): Point2[] {
  const v: Point2[] = [[60, 34]];
  v.push(...cb([60, 34], [84, 34], [96, 56], [94, 76]));
  v.push(...cb([94, 76], [92, 96], [78, 106], [60, 106]));
  v.push(...cb([60, 106], [42, 106], [28, 96], [26, 76]));
  v.push(...cb([26, 76], [24, 56], [36, 34], [60, 34]));
  return v;
}

/** 尾巴中心线。ui.rs:210 → 1 + 2×12 = 25 点（尾尖按 `length-6` 截，点数错了那段就错位） */
function tailSpine(): Point2[] {
  const v: Point2[] = [[90, 88]];
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
  v.push(...cb([60, 64.5], [64.5, 64.5], [65.5, 67.8], [62.8, 69.4]));
  v.push(...cb([62.8, 69.4], [61.2, 70.4], [58.8, 70.4], [57.2, 69.4]));
  v.push(...cb([57.2, 69.4], [54.5, 67.8], [55.5, 64.5], [60, 64.5]));
  return v;
}

/** 围兜（奶油色，上窄下宽）。ui.rs:291 */
function bibPath(): Point2[] {
  const v: Point2[] = [[60, 61]];
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
  return poly.map((p) => {
    const [x, y] = rotDeg(p[0], p[1], cx, cy, deg);
    return [x + dx, y + dy] as Point2;
  });
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

  // 影子变换 sh（比身体右下各偏 3s/5s）
  const sh = new Xf();
  sh.s = s; sh.ox = xf.ox + 3 * s; sh.oy = xf.oy + 5 * s;
  sh.sx = sx_all; sh.sy = sy_all; sh.dy = dy_total; sh.rot = xf.rot; sh.px = 60; sh.py = 100;

  // 脸部变换 fx（歪头）
  const fx = new Xf();
  fx.s = xf.s; fx.ox = xf.ox; fx.oy = xf.oy; fx.sx = xf.sx; fx.sy = xf.sy; fx.dy = xf.dy;
  fx.rot = xf.rot + pose.tilt * (Math.PI / 180); fx.px = 60; fx.py = 66;

  // 按层收集 ops（ui.rs::draw_cat 层序）
  const byLayer = {} as Record<PetLayer, DrawOp[]>;
  const LAYERS: PetLayer[] = [
    "ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke",
    "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush", "paws_up",
    "zzz", "quiet_mark", "heart", "stars", "badge",
  ];
  for (const l of LAYERS) byLayer[l] = [];

  // —— 投影（多环伪高斯；跳起时离地越高影越小越淡）ui.rs:671-682 ——
  const lift = Math.max(0, Math.min(1, -jumpY / 26.0));
  const fade = 1.0 - 0.55 * lift;
  const RINGS: Array<[number, number]> = [[1.00, 0.016], [0.86, 0.018], [0.70, 0.020], [0.52, 0.023], [0.30, 0.027]];
  for (const [f, a] of RINGS) {
    byLayer.ground_shadow.push(xfEllipse(sh, "ground_shadow", withAlpha(SHADOW, a * fade), 60, 106,
      27.0 * (1 - 0.25 * lift) * f, 5.2 * (1 - 0.3 * lift) * f));
  }

  // —— 尾巴（绕尾根 90,88 摆动）ui.rs:684-712 ——
  const sway = (sleep > 0.5 ? 1.0 : mood === "happy" ? 8.0 : energy * 6.0) + pet * 7.0;
  const wag = sway * settle * Math.sin(t * 3.0) + 11.0 * pose.stretch;
  const spine = tailSpine();
  const tail = bendPoly(ribbon(spine, 12.0, 7.5), 0, 0, wag, 90, 88);
  // 渐变范围必须和身体同一条（34..106）：光源是全局的，不是每条尾巴自己打一遍。
  byLayer.tail.push(xfGrad(xf, "tail", BODY_TOP(mood), BODY_BOT(mood), 34, 106, tail));
  // 白尾尖：染在尾巴**末端那一段**上，不是端点上一颗圆。
  const cut = Math.max(0, spine.length - 6);
  const tip = bendPoly(ribbon(spine.slice(cut), 8.4, 7.6), 0, 0, wag, 90, 88);
  byLayer.tail_tip.push(xfFill(xf, "tail_tip", PAPER, tip));

  // —— 耳朵（跟脸一起歪）ui.rs:714-724 ——
  const twitch = earTwitch(t, mood);
  const l_ear = bendPoly(earLOuter(), 0, 0, twitch, 42, 38);
  const l_in = bendPoly(earLInner(), 0, 0, twitch, 42, 38);
  const r_ear = bendPoly(earROuter(), 0, 0, -twitch, 78, 38);
  const r_in = bendPoly(earRInner(), 0, 0, -twitch, 78, 38);
  byLayer.ears.push(xfFill(fx, "ears", BODY_COL(mood), l_ear));
  byLayer.ears.push(xfFill(fx, "ears", BODY_COL(mood), r_ear));
  byLayer.ears.push(xfFill(fx, "ears", INNER_EAR(mood), l_in));
  byLayer.ears.push(xfFill(fx, "ears", INNER_EAR(mood), r_in));

  // —— 身体（渐变 + 底缘暗部 + 左半顶光）ui.rs:726-755 ——
  byLayer.body.push(xfGrad(xf, "body", BODY_TOP(mood), BODY_BOT(mood), 34, 106, bodyPath()));
  byLayer.body_light.push(xfEllipse(xf, "body_light", withAlpha(SHADOW, SHADOW_ALPHA(mood)), 60, 101, 25, 6.5));
  byLayer.body_stroke.push(xfArc(xf, "body_stroke", withAlpha(PAPER, 0.22), 2.6, 37.1, 47.4, 36.4, 44.75, 53.7, 37.5));
  byLayer.body_stroke.push(xfArc(xf, "body_stroke", withAlpha(PAPER, 0.18), 2.2, 31.0, 58.0, 27.5, 49.0, 33.0, 43.5));

  // —— 围兜 + 下巴 AO ui.rs:757-759 ——
  byLayer.bib.push(xfGrad(xf, "bib", PAPER, PAPER_SHADE, 61, 104, bibPath()));
  byLayer.bib_ao.push(xfEllipse(xf, "bib_ao", withAlpha(INK, 0.10), 60, 63.5, 10, 3.2));

  // —— 前爪（白手套）ui.rs:761-781 ——
  const push = pose.stretch;
  for (const [pxBase, raised] of [[43, pose.paw > 0.02], [77, false]] as [number, boolean][]) {
    if (raised) continue;
    const cx = pxBase + (pxBase - 60) * 0.12 * push;
    const cy = 99 + 3.4 * push;
    byLayer.paws.push(xfEllipse(xf, "paws", PAPER, cx, cy, 7.4 + 1.2 * push, 5.6 - 1.6 * push));
    byLayer.paws.push(xfArc(xf, "paws", withAlpha(PAPER_SHADE, 0.95), 2.2, cx - 5.5, cy + 1.5, cx, cy + 5.5, cx + 5.5, cy + 1.5));
  }

  // —— 眼睛 ui.rs:783-873 ——
  const [headX, headY] = fx.map([60, 50]);
  let pupil: Point2;
  if (mouse) {
    const dx = mouse[0] - headX, dy = mouse[1] - headY;
    // native：`.sqrt().max(1.0)`——距离小于 1px 时偏移要按比例缩短，不是取整到 1 就满幅。
    const d = Math.max(1.0, Math.sqrt(dx * dx + dy * dy));
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
      byLayer.eyes.push(xfArc(fx, "eyes", PAPER, 3.6, ex - 6.2, ey + 1.5, ex, ey - 7.5, ex + 6.2, ey + 1.5));
    }
  } else {
    for (const [ex, ey] of eyes) {
      const rx = Math.max(0.7, 5.9 * open);
      const ry = Math.max(0.6, 6.6 * open);
      byLayer.eyes.push(xfEllipse(fx, "eyes", PAPER, ex, ey, rx, ry));
      const px = ex + pupil[0];
      const py = ey + pupil[1] * 0.8;
      byLayer.eyes.push(xfEllipse(fx, "eyes", EYE, px, py, rx * 0.80, ry * 0.84));
      // 两枚高光在 native 都是 `circle`（双轴同半径）：r = rx*0.30 / rx*0.15。
      byLayer.eyes.push(xfCircle(fx, "eyes", withAlpha(PAPER, 0.96), px - rx * 0.30, py - ry * 0.34, rx * 0.30));
      byLayer.eyes.push(xfCircle(fx, "eyes", withAlpha(PAPER, 0.72), px + rx * 0.34, py + ry * 0.30, rx * 0.15));
      if (lid_a > 0.01) {
        byLayer.eyes.push(xfArc(fx, "eyes", withAlpha(PAPER, lid_a), 2.6, ex - 5.2, ey, ex, ey + 5.0, ex + 5.2, ey));
      }
    }
  }

  // —— 鼻子 ui.rs:877 ——
  byLayer.nose.push(xfFill(fx, "nose", ROSE_DEEP, nosePath()));

  // —— 嘴 ui.rs:878-984 ——
  const mouth_ink = withAlpha(INK, 0.88);
  const stem = (y1: number): Point2[] => [[60, 70.5], [60, y1]];
  const moodFace = quiet ? null : mood;
  if (moodFace === null) {
    byLayer.mouth.push(xfPoly(fx, "mouth", mouth_ink, 2.2, stem(73.5)));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 52.5, 75.4, 60, 76.3, 67.5, 75.4));
  } else if (moodFace === "happy") {
    byLayer.mouth.push(xfPoly(fx, "mouth", mouth_ink, 2.2, stem(73.0)));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 60, 73.0, 55, 79.5, 50, 74.0));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 60, 73.0, 65, 79.5, 70, 74.0));
  } else if (moodFace === "thinking") {
    byLayer.mouth.push(xfPoly(fx, "mouth", mouth_ink, 2.2, stem(74.2)));
    byLayer.mouth.push(xfEllipse(fx, "mouth", mouth_ink, 60, 76.2, 3.2, 3.2));
  } else if (moodFace === "grumpy") {
    byLayer.mouth.push(xfPoly(fx, "mouth", mouth_ink, 2.2, stem(73.5)));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 53.5, 78.0, 60, 73.5, 66.5, 78.0));
  } else {
    byLayer.mouth.push(xfPoly(fx, "mouth", mouth_ink, 2.2, stem(73.5)));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 60, 73.5, 56, 77.8, 52.5, 74.5));
    byLayer.mouth.push(xfArc(fx, "mouth", mouth_ink, 2.4, 60, 73.5, 64, 77.8, 67.5, 74.5));
  }
  // 哈欠：嘴张开成一颗会呼吸的竖椭圆，里面点一口玫瑰色（跟脸一起歪，用 fx）。
  if (pose.yawn > 0.02 && !quiet) {
    const y = pose.yawn;
    byLayer.mouth.push(xfEllipse(fx, "mouth", mouth_ink, 60, 78.0 + 1.0 * y, 2.6 + 2.6 * y, 3.0 + 5.4 * y));
    byLayer.mouth.push(xfEllipse(fx, "mouth", withAlpha(ROSE, 0.85 * y), 60, 78.6 + 1.0 * y, 1.2 + 1.3 * y, 1.4 + 3.0 * y));
  }
  // 睡着时换成随呼吸起伏的小圆嘴（盖过上面的常态嘴）
  if (sleep > 0.35) {
    const k = Math.abs(Math.sin(t * 1.1));
    byLayer.mouth.push(xfEllipse(fx, "mouth", withAlpha(INK, 0.55 + 0.35 * sleep), 60, 76, 1.8 + 1.6 * k, 2.0 + 2.0 * k));
  }

  // —— 腮红 + 胡须 ui.rs:986-1025 ——
  if (mood !== "grumpy") {
    for (const bx of [35.5, 84.5]) {
      byLayer.blush.push(xfEllipse(fx, "blush", withAlpha(ROSE, 0.70), bx, 76, 6.4, 4.0));
    }
  }
  const whisk_c = withAlpha(PAPER, 0.42);
  for (const w of [[50, 64, 39, 58.5, 29, 58], [50, 69, 38, 69.5, 28, 72], [70, 64, 81, 58.5, 91, 58], [70, 69, 82, 69.5, 92, 72]] as [number, number, number, number, number, number][]) {
    byLayer.blush.push(xfArc(fx, "blush", whisk_c, 1.7, w[0], w[1], w[2], w[3], w[4], w[5]));
  }

  // —— 洗脸的左爪：抬起后**压在整张脸之上** ui.rs:1027-1064 ——
  // 单独一层排在 blush 之后：白手套只有盖住墨脸才读得出「它在擦脸」，
  // 画在五官之前会被眼/嘴重新盖回去（native 原注释就是这条）。
  if (pose.paw > 0.02) {
    const k = pose.paw;
    const rub = Math.sin(t * 5.2) * 2.2 * k;
    const tx = 51.0 + rub, ty = 67.0 - 1.6 * rub;
    const arm: Point2[] = [];
    for (let i = 0; i <= 12; i++) {
      const q = i / 12;
      arm.push([
        (1 - q) * (1 - q) * 43 + 2 * (1 - q) * q * 32 + q * q * tx,
        (1 - q) * (1 - q) * 99 + 2 * (1 - q) * q * 84 + q * q * ty,
      ]);
    }
    // 墨袖只取手臂靠身体那半段（native `arm[..7]`）；用差量 alpha，实色会在渐变身体上糊出死黑。
    byLayer.paws_up.push(xfPoly(fx, "paws_up", withAlpha(INK, 0.95 * k), 6.2 * (0.4 + 0.6 * k), arm.slice(0, 7)));
    byLayer.paws_up.push(xfEllipse(fx, "paws_up", PAPER, tx, ty, 6.6, 5.4));
    byLayer.paws_up.push(xfArc(fx, "paws_up", withAlpha(PAPER_SHADE, 0.95), 2.0, tx - 4.8, ty + 1.6, tx, ty + 4.8, tx + 4.8, ty + 1.6));
  }

  // —— 睡觉 Zzz：三枚错相上浮、渐隐、渐大 ui.rs:1066-1092 ——
  // ⚠️ 双色：先四向描一圈奶油光边再压墨字。Zzz 落在**透明窗外**，背景是别人的桌布；
  // 旧版只有一笔软墨，混出来 ≈(68,76,88)，而深绿桌布自己就在 66~78 之间晃——
  // 「它睡着了」在那张桌布上等于没画（native #69）。
  if (sleep > 0.5 && !quiet) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.45 + i / 3) % 1.0;
      const zx = center.x + (26 + 16 * ph) * s;
      const zy = center.y - (52 + 30 * ph) * s;
      const a = Math.max(0, Math.min(1, (1 - ph) * (sleep - 0.5) * 2));
      const fs = (9 + 7 * ph) * s * 1.6;
      const rim = fs * 0.13;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
        byLayer.zzz.push({ kind: "text", text: "Z", x: zx + dx * rim, y: zy + dy * rim, size: fs, color: withAlpha(PAPER, a * 0.8), align: "center", layer: "zzz" });
      }
      byLayer.zzz.push({ kind: "text", text: "Z", x: zx, y: zy, size: fs, color: withAlpha(INK_SOFT, a * 0.9), align: "center", layer: "zzz" });
    }
  }

  // —— 免打扰月牙：两耳中间的空档挂一弯 ui.rs:1094-1114（屏幕坐标，不走 Xf）——
  if (quiet) {
    const mc: Point2 = [center.x + 6.5 * s, center.y - 51.5 * s];
    const rr = 1.28 * 9 * s;
    byLayer.quiet_mark.push({ kind: "crescent", fill: INK, cx: mc[0], cy: mc[1], r: rr, dx: 0.42 * rr, dy: -0.30 * rr, cut: 0.92 * rr, layer: "quiet_mark" });
    const r2 = 9 * s;
    byLayer.quiet_mark.push({ kind: "crescent", fill: PAPER, cx: mc[0], cy: mc[1], r: r2, dx: 0.42 * r2, dy: -0.30 * r2, cut: 0.92 * r2, layer: "quiet_mark" });
  }

  // —— 摸头爱心：三枚错相上浮 ui.rs:1116-1133（屏幕坐标）——
  if (pet > 0.12) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.55 + i / 3) % 1.0;
      const hx = center.x + (14 + 11 * ph) * s + Math.sin(ph * 6 + i) * 3 * s;
      const hy = center.y - (41 + 18 * ph) * s;
      const a = Math.max(0, Math.min(1, (1 - ph) * (pet - 0.12) / 0.88));
      const r = (3 + 2.4 * ph) * s * 1.7;
      const col = withAlpha(ROSE, a * 0.92);
      for (const sx of [-0.52, 0.52]) {
        byLayer.heart.push({ kind: "fillEllipse", fill: col, cx: hx + r * sx, cy: hy - r * 0.42, rx: r * 0.56, ry: r * 0.56, layer: "heart" });
      }
      byLayer.heart.push({ kind: "fillPath", fill: col, points: [[hx - r * 0.95, hy - r * 0.12], [hx + r * 0.95, hy - r * 0.12], [hx, hy + r]], layer: "heart" });
    }
  }

  // —— 开心小星星：两枚十字星光错相闪烁 ui.rs:1135-1155（屏幕线宽固定 1.2，不乘 s）——
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

  // —— 状态徽章 ui.rs:1161-1250 ——
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
    // 底盘圆在 native 里直接 `EllipseShape::filled(vec2(11*xfn.s, 11*xfn.s))`，
    // 绕过 `ellipse()` 助手 → **不吃 sx/sy**，这里保持同一口径。
    const [bcx, bcy] = bp(0, 0);
    byLayer.badge.push({ kind: "fillEllipse", fill, cx: bcx, cy: bcy, rx: 11 * xfn.s, ry: 11 * xfn.s, layer: "badge" });
    switch (mood) {
      case "grumpy": {
        byLayer.badge.push(xfPoly(xfn, "badge", BADGE_INK, 2.4, [bg(0, -6), bg(0, 1)]));
        const [b1x, b1y] = bp(0, 5);
        byLayer.badge.push({ kind: "fillEllipse", fill: BADGE_INK, cx: b1x, cy: b1y, rx: 1.5 * xfn.s, ry: 1.5 * xfn.s, layer: "badge" });
        break;
      }
      case "thinking": {
        byLayer.badge.push(xfArc(xfn, "badge", BADGE_INK, 2.0, BADGE_VB[0] - 3, BADGE_VB[1], BADGE_VB[0], BADGE_VB[1] - 3, BADGE_VB[0] + 3, BADGE_VB[1]));
        const [b2x, b2y] = bp(0, 4.5);
        byLayer.badge.push({ kind: "fillEllipse", fill: BADGE_INK, cx: b2x, cy: b2y, rx: 1.2 * xfn.s, ry: 1.2 * xfn.s, layer: "badge" });
        break;
      }
      case "happy": {
        byLayer.badge.push(xfPoly(xfn, "badge", BADGE_INK, 2.4, [bg(-5, 0), bg(-1, 4), bg(5, -4)]));
        break;
      }
    }
  }

  // 按层序 emit
  const ops: DrawOp[] = [];
  for (const layer of LAYERS) ops.push(...byLayer[layer]);
  return ops;
}

// ===========================================================================
// 流量胶囊 + 未读记号（main.rs:2988-3016 色表、4976-5136 绘制）
// ===========================================================================

/**
 * 以下全是 main.rs 单侧专用的色，本期已收编进 `pet-tokens.ts` 的 `PET_PRIVATE`
 * 台账，仍**不算板内色**（不进 `CAT_PALETTE`，派生器不认它们）——
 * 「只放两个以上模块在同一件事上用的颜色」这条规矩没变，收编只是让锁能按名字排除。
 */
const HUD_BOX = PET_PRIVATE.HUD_BOX; // rgb(26,29,38)：气泡盒与胶囊共用的墨底
const HUD_INK = PET_PRIVATE.HUD_INK; // rgb(232,234,240)：读数墨白
const HUD_UP = PET_PRIVATE.HUD_UP; // rgb(125,205,160)：上行绿
/** 五槽依次是 `(底, 描边, 读数, 上行, 下行)`。 */
const CAP_ON = [HUD_BOX, PET_PRIVATE.CAP_BORDER_ON, HUD_INK, HUD_UP, PET_PRIVATE.CAP_DOWN_ON];
const CAP_OFF = [PET_PRIVATE.CAP_BOX_OFF, PET_PRIVATE.CAP_BORDER_OFF, PET_PRIVATE.CAP_INK_OFF, PET_PRIVATE.CAP_UP_OFF, PET_PRIVATE.CAP_DOWN_OFF];
/** 两档各自的 alpha（底与描边在静默时再退 15，读数/上行/下行不动）。 */
const CAP_A_ON = [205, 205, 255, 255, 255];
const CAP_A_OFF = [190, 190, 255, 255, 255];

const CAP_W = 70.0;
const CAP_H = 32.0;
const CAP_R = 9.0;
const CAP_STROKE_W = 1.0;
const CAP_FONT = 8.0;
const UNREAD_R = 6.0;
const UNREAD_FONT = 9.0;
const PIN_X = 41.0; // native PIN = vec2(41, 39)，胶囊只取 x 分量（y 与 up/down 一样被丢弃）

/**
 * 播报环形账本的容量（`main.rs` 的 `SPOKEN_CAP`）。
 * ⚠️ 它是「未读永远是一位数、塞得进 r=6 的墨底」的**结构性**上限：
 * 牌子写的是条数，超过一位数这块牌子就从「有账」退化成警示灯。
 */
export const SPOKEN_CAP = 7;

export interface CapsuleInput {
  /** 窗口内容尺寸（native 的 `rect`；rect.min 即画布原点 (0,0)）。 */
  rectWidth: number;
  rectHeight: number;
  /** 展开动画进度 0..1（e≥0.5 不画，0..0.5 线性淡出）。 */
  e: number;
  growLeft: boolean;
  /** 上行字节/秒；null = 没连上内核，显示 "--"。 */
  up: number | null;
  down: number | null;
  unreadCount: number;
  /** native 的 `self.bubble.is_none()`：有气泡时牌子让位，同一格不长两个东西。 */
  bubbleVisible: boolean;
  /** hover：描边从 95 提到 165（native 的 `hot`）。 */
  badgeHot?: boolean;
}

export function fmtSpeed(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB/s`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB/s`;
  return `${Math.trunc(b)} B/s`;
}

/** 未连接时胶囊显示 "--"，不是 "0 B/s"——「没连上」和「连着但没流量」是两件事。 */
export function fmtSpeedOpt(b: number | null): string {
  return b === null ? "--" : fmtSpeed(b);
}

export function buildCapsuleOps(input: CapsuleInput): DrawOp[] {
  const { rectWidth, rectHeight, e, growLeft, up, down } = input;
  if (e >= 0.5) return [];
  const capOp = Math.max(0, Math.min(1, 1.0 - e / 0.5));
  // native 的锚是**窗口矩形**而不是猫变换：cx = rect.min.x + PIN.x（贴右缘时 rect.max.x − PIN.x）。
  const cx = growLeft ? rectWidth - PIN_X : PIN_X;
  const cy = rectHeight - CAP_H / 2 - 4;
  const x = cx - CAP_W / 2;
  const y = cy - CAP_H / 2;
  // 静默（上下行都是 0，或没连上内核）时整颗胶囊退到背景里：
  // ⚠️ 降的是 **RGB**（换一张色表），不是 alpha——alpha 压不动它天天挂在眼前的存在感。
  const silent = (up ?? 0) + (down ?? 0) === 0;
  const ramp = silent ? CAP_OFF : CAP_ON;
  const aps = silent ? CAP_A_OFF : CAP_A_ON;
  // native `al(v) = (v as f32 * cap_op) as u8`：截断到 u8 再除 255，口径原样保留。
  const al = (v: number) => Math.trunc(v * capOp) / 255;
  const col = (i: number) => withAlpha(ramp[i], al(aps[i]));
  const lx = x + 7.0;
  // 数值**右**对齐：左对齐时 "0 B/s"→"1.2 MB/s" 的宽度差会把整列推得左右跳。
  const vx = x + CAP_W - 8.0;
  const y1 = cy - 8.0;
  const y2 = cy + 8.0;
  const ops: DrawOp[] = [
    { kind: "fillRoundRect", fill: col(0), x, y, w: CAP_W, h: CAP_H, r: CAP_R, layer: "capsule" },
    // 一圈比填充亮一档的描边：胶囊原先是一块没有边的深色，压在浅色桌面上边缘糊成一团。
    { kind: "strokeRoundRect", stroke: col(1), width: CAP_STROKE_W, x, y, w: CAP_W, h: CAP_H, r: CAP_R, layer: "capsule" },
    { kind: "text", text: "↑", x: lx, y: y1, size: CAP_FONT, color: col(3), align: "left", layer: "capsule" },
    { kind: "text", text: fmtSpeedOpt(up), x: vx, y: y1, size: CAP_FONT, color: col(2), align: "right", layer: "capsule" },
    { kind: "text", text: "↓", x: lx, y: y2, size: CAP_FONT, color: col(4), align: "left", layer: "capsule" },
    { kind: "text", text: fmtSpeedOpt(down), x: vx, y: y2, size: CAP_FONT, color: col(2), align: "right", layer: "capsule" },
  ];

  // —— 未读播报的记号（#61/#63）——
  // 一句话只停几秒，说完就蒸发；错过的恰恰是掉线、切节点失败这类**只在出事那一刻露头**的话。
  // ⚠️ x 按猫轴 cx 推、不按窗口边推：贴边藏身时窗口只滑到「窗边 = 屏幕边」为止（#38），
  // 跟着猫体一起滑出去就白钉了，而猫睡着时正是最容易攒下未读的时候。
  if (input.unreadCount > 0 && !input.bubbleVisible) {
    const dir = growLeft ? -1 : 1;
    const bcx = cx + dir * 30.0;
    const bcy = 26.0;
    ops.push({ kind: "fillEllipse", fill: withAlpha(HUD_BOX, al(235)), cx: bcx, cy: bcy, rx: UNREAD_R, ry: UNREAD_R, layer: "unread" });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(HUD_INK, al(input.badgeHot ? 165 : 95)), width: 1.0, cx: bcx, cy: bcy, rx: UNREAD_R, ry: UNREAD_R, layer: "unread" });
    ops.push({ kind: "text", text: String(input.unreadCount), x: bcx, y: bcy, size: UNREAD_FONT, color: withAlpha(ACCENT, al(255)), align: "center", layer: "unread" });
  }
  return ops;
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

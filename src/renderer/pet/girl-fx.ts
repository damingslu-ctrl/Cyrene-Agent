import type { DrawOp } from "./ops";
import type { Mood } from "../../shared/cat-types";
import {
  ACCENT, INK_SOFT, PAPER, ROSE, ROSE_DEEP, SHADOW, WARN, withAlpha,
} from "../../shared/pet-tokens";
import { girlFaceBox, girlInkBox, type GirlAnimBody, type GirlFaceBox } from "./girl-sprite";
import type { GirlPresencePose } from "./girl-presence";
import { STARTLE_MS, type CompanionActivity } from "./companion";
import { BOND_UP_MS } from "./girl-bond";
import { MILESTONE_MS } from "./girl-milestone";

/**
 * 猫娘的「屏幕记号」层：画在**她身上和桌布上的小东西**。
 *
 * 和 `art.ts::buildOverlayOps`（Zzz/月牙/爱心/徽章）分工：
 * - 那边是「状态」记号，四足与猫娘共用；这边是**她自己的存在感**——地面投影、
 *   脸红、被叫到时的「！」、连点晕圈、开心音符、生气蒸汽、落地扬尘；
 * - 落点来自 `GIRL_FACE`/`GIRL_INK_BOX` 逐帧实测（girl-face-meta.ts），
 *   跟着帧一起动，不按固定比例猜脸在哪。
 *
 * 双色纪律（native #69）：凡画在**她身外**（＝用户桌布上）的一笔，先铺奶油光边再压深色。
 * 桌布颜色不可知，单色软墨在深色桌布上等于没画。脸红在脸皮上，可以用单色柔光。
 */

export interface GirlFxInput {
  body: GirlAnimBody;
  /** 当前帧号（图集坐标）：脸框/墨框都按这一帧取。 */
  frame: number;
  nowSec: number;
  nowMs: number;
  mood: Mood;
  /** 摸头爱心强度 0..1（与四足同一条 `pet` 口径）。 */
  pet: number;
  presence: GirlPresencePose;
  /** 脸红强度 0..1（渲染器做包络，这里只画）。 */
  blush: number;
  /** 「！」已经出现多久（ms）；<0 = 没有。 */
  noticeAgeMs: number;
  /** 眩晕剩余 0..1（1 = 刚中招，0 = 结束）。 */
  dizzyLeft: number;
  /** 落地压扁 0..1：>0 时脚边扬尘。 */
  squash: number;
  activity: CompanionActivity;
  /** 走路相位（弧度）。 */
  step: number;
  /** 离地量 0..1：跳得越高影子越小越淡。 */
  lift: number;
  /** 脚线（屏幕 y，不含跳跃）。 */
  groundY: number;
  /**
   * 当前显示的是姿态图（真坐/真蜷）时，脸框/墨框由 `girlPoseFaceBox` / `girlPoseInkBox` 给出。
   * 缺省按帧号从 `GIRL_FACE` / `GIRL_INK_BOX` 取——帧动画与姿态图共用这一层记号。
   */
  face?: GirlFaceBox;
  ink?: GirlFaceBox;
  /** 开心到会哼歌的档：happy mood 或 wave/peace/happy 片。 */
  notes: boolean;
  quiet: boolean;
  /** 坐垫包络 0..1：坐下时垫子从她身下展开，起身收回。 */
  cushion: number;
  /** 刚升档的记号剩余毫秒（BOND_UP_MS 起算）；0＝没有升档。 */
  bondUpLeft: number;
  /** 摸头连击数（0/1＝无连击，2..5 才有记号）。 */
  patCombo: number;
  /** 睡梦中被碰醒的惊跳剩余毫秒。 */
  startleLeft: number;
  /** 纪念日庆典剩余毫秒；0＝没有庆典。 */
  milestoneLeft: number;
  /** 正在庆祝的是第几天（7/30/100/365）。 */
  milestoneDays: number;
}

export interface GirlFxOps {
  /** 画在人物**之前**：地面投影。 */
  below: DrawOp[];
  /** 画在人物**之后**：脸红与各种记号。 */
  above: DrawOp[];
}

/** 「！」停留时长；与 girl-notice 的文案寿命同量级。 */
export const NOTICE_FX_MS = 1_800;
/** 眩晕记号的视觉时长（渲染器用同一个数做星星剩余量）。 */
export const DIZZY_FX_MS = 3_200;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function smoothFade(p: number, inAt = 0, outAt = 0.65): number {
  if (p <= 0 || p >= 1) return 0;
  const rise = inAt <= 0 ? 1 : clamp01(p / inAt);
  const fall = p <= outAt ? 1 : 1 - clamp01((p - outAt) / (1 - outAt));
  return Math.min(rise, fall);
}

/** 位姿可能来自帧动画或姿态图：有显式框就用，否则按帧号从逐帧元数据取。 */
const faceOf = (input: GirlFxInput): GirlFaceBox => input.face ?? girlFaceBox(input.body, input.frame);
const inkOf = (input: GirlFxInput): GirlFaceBox => input.ink ?? girlInkBox(input.body, input.frame);

/**
 * 地面投影：多环伪高斯（与四足 `buildCatOps` 同一手法），外加一笔 3% 的奶油底光。
 * 奶油底光不是装饰——桌布可能是深色，纯黑影在深色桌布上等于「她浮在空中」；
 * 先铺一层极淡的亮面，影子才有「接触」可言。
 */
function groundShadow(input: GirlFxInput): DrawOp[] {
  const { body, lift, groundY, nowMs } = input;
  const ink = inkOf(input);
  const shrink = 1 - 0.28 * clamp01(lift);
  const fade = 1 - 0.55 * clamp01(lift);
  const rx = Math.max(8, ink.w * 0.47) * shrink;
  const ry = Math.max(1.6, rx * 0.16);
  const x = ink.cx;
  const y = groundY + 1.0;
  const ops: DrawOp[] = [];
  ops.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.035 * fade),
    cx: x, cy: y + 0.9, rx: rx * 1.12, ry: ry * 1.55, layer: "ground_shadow",
  });
  const rings: Array<[number, number]> = [[1.0, 0.020], [0.84, 0.023], [0.66, 0.026], [0.48, 0.030], [0.30, 0.034]];
  for (const [f, a] of rings) {
    ops.push({
      kind: "fillEllipse", fill: withAlpha(SHADOW, a * fade),
      cx: x, cy: y, rx: rx * f, ry: ry * f, layer: "ground_shadow",
    });
  }
  // 呼吸/待机时影子极轻微地随相位「呼吸」，静止画面才不像贴纸。
  if (input.activity === "idle" && input.presence.attention > 0.2) {
    const a = 0.012 * input.presence.attention;
    ops.push({
      kind: "fillEllipse", fill: withAlpha(SHADOW, a),
      cx: x, cy: y, rx: rx * 1.18, ry: ry * 1.35, layer: "ground_shadow",
    });
  }
  void nowMs;
  return ops;
}

function blushOps(input: GirlFxInput): DrawOp[] {
  const a = clamp01(input.blush);
  if (a <= 0.01 || input.mood === "sleep") return [];
  const face = faceOf(input);
  const rx = Math.max(1.6, face.w * 0.17);
  const ry = Math.max(0.9, face.h * 0.075);
  const dx = face.w * 0.30;
  const dy = face.h * 0.16;
  const ops: DrawOp[] = [];
  for (const side of [-1, 1]) {
    const cx = face.cx + side * dx;
    const cy = face.cy + dy;
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.28 * a), cx, cy, rx: rx * 1.45, ry: ry * 1.5, layer: "blush" });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.46 * a), cx, cy, rx, ry, layer: "blush" });
  }
  return ops;
}

/** 「！」本体：从脸侧上方弹出、上浮、淡出。奶油在外、强调色在内；`scale` 给受惊用。 */
function exclamationOps(input: GirlFxInput, ageMs: number, totalMs: number, scale = 1): DrawOp[] {
  const p = clamp01(ageMs / totalMs);
  const alpha = smoothFade(p, 0.08, 0.62);
  if (alpha <= 0.01) return [];
  const face = faceOf(input);
  const popIn = Math.min(1, ageMs / 180);
  const over = 1 + 0.28 * Math.sin(popIn * Math.PI);
  const bob = Math.sin(p * Math.PI) * 2.2;
  const x = face.cx + input.body.facing * face.w * 0.62;
  const y = face.top - face.h * 0.30 - bob;
  const h = Math.max(4.4, face.h * 0.40) * over * scale;
  const w = Math.max(1.5, h * 0.24);
  const dotR = Math.max(1.1, w * 0.62);
  const gap = h * 0.32;
  const ops: DrawOp[] = [];
  const bar = (sx: number, sy: number, sw: number, sh: number, color: string) => {
    ops.push({ kind: "fillRoundRect", fill: color, x: sx - sw / 2, y: sy, w: sw, h: sh, r: sw / 2, layer: "stars" });
  };
  // 奶油光边：整支「!」放大 1.35 倍垫底（桌布上的记号必须双色）。
  bar(x, y - h, w * 2.05, h * 1.06, withAlpha(PAPER, 0.92 * alpha));
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.92 * alpha), cx: x, cy: y + gap + dotR * 2.0, rx: dotR * 2.0, ry: dotR * 2.0, layer: "stars" });
  bar(x, y - h, w, h * 0.78, withAlpha(ACCENT, alpha));
  ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, alpha), cx: x, cy: y + gap + dotR * 0.7, rx: dotR, ry: dotR, layer: "stars" });
  return ops;
}

/** 「注意到你」的「！」：受惊/眩晕时让位（同一位置不叠两支）。 */
function noticeOps(input: GirlFxInput): DrawOp[] {
  if (input.noticeAgeMs < 0 || input.noticeAgeMs > NOTICE_FX_MS) return [];
  if (input.dizzyLeft > 0.05 || input.startleLeft > 0) return [];
  return exclamationOps(input, input.noticeAgeMs, NOTICE_FX_MS);
}

/** 连点晕圈：三颗双色小星绕头顶转，越到尾巴越淡。 */
function dizzyOps(input: GirlFxInput): DrawOp[] {
  const left = clamp01(input.dizzyLeft);
  if (left <= 0.02) return [];
  const face = faceOf(input);
  const cx = face.cx;
  const cy = face.top - face.h * 0.26;
  const rx = Math.max(9, face.w * 0.95);
  const ry = Math.max(2.4, face.h * 0.18);
  const size = Math.max(2.0, face.w * 0.15);
  const alpha = clamp01(left * 2.6);
  const ops: DrawOp[] = [];
  for (let i = 0; i < 3; i += 1) {
    const ang = input.nowSec * 5.4 + (i * TAU) / 3;
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry;
    const tw = 0.65 + 0.35 * Math.max(0, Math.sin(input.nowSec * 9 + i * 2));
    const r = size * tw;
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 2.6, points: [[x - r, y], [x + r, y]], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 2.6, points: [[x, y - r], [x, y + r]], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: withAlpha(ACCENT, alpha), width: 1.3, points: [[x - r, y], [x + r, y]], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: withAlpha(ACCENT, alpha), width: 1.3, points: [[x, y - r], [x, y + r]], layer: "stars" });
  }
  return ops;
}

/** 开心音符：两枚错相上浮；符头/符干/符尾都是双色。 */
function noteOps(input: GirlFxInput): DrawOp[] {
  if (!input.notes || input.quiet || input.mood === "sleep") return [];
  const face = faceOf(input);
  const r = Math.max(1.3, face.w * 0.115);
  const ops: DrawOp[] = [];
  for (let i = 0; i < 2; i += 1) {
    const ph = ((input.nowSec * 0.55 + i * 0.5) % 1 + 1) % 1;
    if (ph > 0.92) continue;
    const a = smoothFade(ph, 0.08, 0.6);
    if (a <= 0.02) continue;
    const side = i === 0 ? 1 : -1;
    const x = face.cx + side * (face.w * 0.85 + 2.4 + ph * 3.2);
    const y = face.top + face.h * 0.08 - ph * face.h * 0.55;
    const stem = r * 3.6;
    const fill = withAlpha(ACCENT, 0.9 * a);
    const halo = withAlpha(PAPER, 0.8 * a);
    ops.push({ kind: "fillEllipse", fill: halo, cx: x, cy: y, rx: r + 0.9, ry: r * 0.8 + 0.9, layer: "stars" });
    ops.push({ kind: "strokePath", stroke: halo, width: 2.6, points: [[x, y - r * 0.4], [x, y - stem]], layer: "stars" });
    ops.push({ kind: "fillEllipse", fill, cx: x, cy: y, rx: r, ry: r * 0.8, layer: "stars" });
    ops.push({ kind: "strokePath", stroke: fill, width: 1.3, points: [[x, y - r * 0.4], [x, y - stem]], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: fill, width: 1.3, points: [[x, y - stem], [x + r * 1.1, y - stem + r * 0.7]], layer: "stars" });
  }
  return ops;
}

/** 生气蒸汽：脸侧两团往上冒的小云，奶油外圈 + 警示色内芯。 */
function angerOps(input: GirlFxInput): DrawOp[] {
  if (input.mood !== "grumpy" || input.quiet) return [];
  const face = faceOf(input);
  const r = Math.max(1.6, face.w * 0.14);
  const ops: DrawOp[] = [];
  for (let i = 0; i < 2; i += 1) {
    const ph = ((input.nowSec * 0.9 + i * 0.42) % 1 + 1) % 1;
    const a = smoothFade(ph, 0.1, 0.6) * 0.9;
    if (a <= 0.02) continue;
    const side = input.body.facing * (i === 0 ? 1 : -1);
    const x = face.cx + side * face.w * 0.55;
    const y = face.top + face.h * 0.12 - ph * face.h * 0.5;
    const rr = r * (1 + ph * 0.5);
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.75 * a), cx: x, cy: y - rr * 0.5, rx: rr * 1.25, ry: rr, layer: "stars" });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.75 * a), cx: x + side * rr * 0.9, cy: y, rx: rr * 0.9, ry: rr * 0.8, layer: "stars" });
    ops.push({ kind: "fillEllipse", fill: withAlpha(WARN, a), cx: x, cy: y - rr * 0.45, rx: rr * 0.6, ry: rr * 0.5, layer: "stars" });
    ops.push({ kind: "fillEllipse", fill: withAlpha(WARN, a * 0.85), cx: x + side * rr * 0.75, cy: y + rr * 0.05, rx: rr * 0.4, ry: rr * 0.38, layer: "stars" });
  }
  return ops;
}

/** 一枚双色爱心：奶油外圈 + 玫瑰芯（两瓣椭圆 + 一个三角）。 */
function heartOps(x: number, y: number, r: number, fill: string, halo: string, alpha: number): DrawOp[] {
  const out: DrawOp[] = [];
  const a = clamp01(alpha);
  for (const [rr, color] of [[r * 1.22, withAlpha(halo, 0.92 * a)], [r, withAlpha(fill, a)]] as const) {
    for (const side of [-0.52, 0.52]) {
      out.push({
        kind: "fillEllipse", fill: color,
        cx: x + rr * side, cy: y - rr * 0.42, rx: rr * 0.56, ry: rr * 0.56, layer: "stars",
      });
    }
    out.push({
      kind: "fillPath", fill: color,
      points: [[x - rr * 0.95, y - rr * 0.12], [x + rr * 0.95, y - rr * 0.12], [x, y + rr]],
      layer: "stars",
    });
  }
  return out;
}

/** 坐垫：她身下的椭圆软垫，奶油外圈先铺再压玫瑰面；起身时跟着包络收回。 */
function cushionOps(input: GirlFxInput): DrawOp[] {
  const a = clamp01(input.cushion);
  if (a <= 0.01) return [];
  const ink = inkOf(input);
  const x = ink.cx;
  const y = input.groundY + 1.2;
  const grow = 0.82 + 0.18 * a;
  const rx = Math.max(20, Math.min(34, ink.w * 0.62)) * grow;
  const ry = Math.max(4.6, rx * 0.30);
  const ops: DrawOp[] = [
    { kind: "fillEllipse", fill: withAlpha(PAPER, 0.10 * a), cx: x, cy: y + 1.2, rx: rx * 1.14, ry: ry * 1.5, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * a), cx: x, cy: y, rx: rx * 1.06, ry: ry * 1.18, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(ROSE, 0.90 * a), cx: x, cy: y, rx, ry, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.30 * a), cx: x, cy: y + ry * 0.34, rx: rx * 0.9, ry: ry * 0.5, layer: "stars" },
    {
      kind: "fillRoundRect", fill: withAlpha(PAPER, 0.52 * a),
      x: x - rx * 0.52, y: y - Math.max(0.7, ry * 0.16),
      w: rx * 1.04, h: Math.max(1.4, ry * 0.2), r: Math.max(0.7, ry * 0.1), layer: "stars",
    },
  ];
  for (const side of [-1, 1]) {
    ops.push({
      kind: "fillEllipse", fill: withAlpha(PAPER, 0.78 * a),
      cx: x + side * rx * 0.82, cy: y - ry * 0.1,
      rx: Math.max(1.1, ry * 0.3), ry: Math.max(0.8, ry * 0.22), layer: "stars",
    });
  }
  return ops;
}

/**
 * 睡毯：睡着的她身上盖一条小被子，从腰际铺到脚边。
 * 只在真的睡着（mood === "sleep"）且没在免打扰里铺——免打扰是「她陪着但不吵」，
 * 不是「她睡了」，铺毯子会把两件事说成一件（native #67 同一条规矩）。
 * 毯子是画在**她身上**的，但下缘压在桌布上，所以外圈仍走奶油光边。
 */
function blanketOps(input: GirlFxInput): DrawOp[] {
  if (input.mood !== "sleep" || input.quiet) return [];
  const ink = inkOf(input);
  const w = Math.max(16, Math.min(34, ink.w * 0.92));
  const top = ink.cy + ink.h * 0.02;
  const bottom = Math.min(input.groundY + 1.5, ink.bottom + 2);
  const h = Math.max(8, bottom - top);
  const cx = ink.cx;
  const r = Math.max(2.6, w * 0.16);
  const ops: DrawOp[] = [];
  // 奶油光边先铺（毯子下缘落在桌布上）。
  ops.push({
    kind: "fillRoundRect", fill: withAlpha(PAPER, 0.92),
    x: cx - w / 2 - 1.2, y: top - 1.2, w: w + 2.4, h: h + 2.4, r: r + 1.2, layer: "stars",
  });
  ops.push({
    kind: "fillRoundRect", fill: withAlpha(ROSE, 0.88),
    x: cx - w / 2, y: top, w, h, r, layer: "stars",
  });
  // 翻边：一道奶油折线压住毯口，读起来是「被子拉到身上」而不是「地上多了一块布」。
  ops.push({
    kind: "fillRoundRect", fill: withAlpha(PAPER, 0.96),
    x: cx - w / 2 - 0.4, y: top - 1.6, w: w + 0.8, h: Math.max(2.2, h * 0.16), r: 1.1, layer: "stars",
  });
  ops.push({
    kind: "fillRoundRect", fill: withAlpha(ROSE_DEEP, 0.34),
    x: cx - w / 2 + 1.2, y: top + Math.max(1.4, h * 0.2), w: w - 2.4, h: Math.max(1, h * 0.07), r: 0.5, layer: "stars",
  });
  // 两道缝线：让毯面不是一块纯色矩形。
  for (const side of [-1, 1]) {
    const lx = cx + side * w * 0.26;
    ops.push({
      kind: "strokePath", stroke: withAlpha(PAPER, 0.55), width: 1,
      points: [[lx, top + h * 0.32], [lx, bottom - h * 0.18]], layer: "stars",
    });
  }
  return ops;
}

/** 纪念日彩带：十枚双色纸片绕着头顶转着落下；越到尾巴越淡。 */
function milestoneOps(input: GirlFxInput): DrawOp[] {
  if (input.milestoneLeft <= 0) return [];
  const p = clamp01(1 - input.milestoneLeft / MILESTONE_MS);
  if (p >= 1) return [];
  const head = faceOf(input);
  const palette = [ACCENT, ROSE_DEEP, ROSE, WARN];
  const ops: DrawOp[] = [];
  for (let i = 0; i < 10; i += 1) {
    const seed = (i * 0.618 + 0.13) % 1;
    const ph = (p * 1.35 + i * 0.09) % 1;
    const a = (1 - ph) * 0.92;
    if (a <= 0.02) continue;
    const x = head.cx
      + Math.sin(seed * Math.PI * 2 + p * 5.2) * head.w * (0.55 + 0.5 * seed)
      + Math.cos(ph * 9 + seed * 7) * head.w * 0.08;
    const y = head.top - head.h * 0.38 + ph * head.h * 1.85;
    const r = Math.max(1.2, head.w * (0.05 + 0.02 * seed));
    const spin = seed * Math.PI * 2 + p * 7;
    const color = palette[i % palette.length];
    for (const [rr, fill] of [[r * 1.55, withAlpha(PAPER, 0.9 * a)], [r, withAlpha(color, a)]] as const) {
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      const pts: Array<[number, number]> = [
        [x + c * rr, y + s * rr * 0.6],
        [x - c * rr, y - s * rr * 0.6],
        [x - s * rr * 0.8, y + c * rr * 0.8],
      ];
      ops.push({ kind: "fillPath", fill, points: pts, layer: "stars" });
    }
  }
  return ops;
}

/** 升档爆发：一圈光环 + 五枚错相上浮的爱心；持续 2.6s。 */
function bondUpOps(input: GirlFxInput): DrawOp[] {
  if (input.bondUpLeft <= 0) return [];
  const p = clamp01(1 - input.bondUpLeft / BOND_UP_MS);
  if (p >= 1) return [];
  const face = faceOf(input);
  const alpha = Math.min(1, smoothFade(p, 0.04, 0.62) * 1.05);
  if (alpha <= 0.01) return [];
  const ops: DrawOp[] = [];
  if (p < 0.42) {
    const ring = face.w * (0.55 + p * 1.7);
    const a = (1 - p / 0.42) * 0.8;
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.9 * a), width: 2.6, cx: face.cx, cy: face.cy, rx: ring, ry: ring * 0.8, layer: "stars" });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ACCENT, a), width: 1.2, cx: face.cx, cy: face.cy, rx: ring, ry: ring * 0.8, layer: "stars" });
  }
  const baseR = Math.max(1.8, face.w * 0.075);
  for (let i = 0; i < 5; i += 1) {
    const ph = (p * 1.25 + i * 0.18) % 1;
    const a = smoothFade(ph, 0.03, 0.6) * alpha;
    if (a <= 0.015) continue;
    const side = i % 2 === 0 ? 1 : -1;
    const x = face.cx + side * face.w * (0.22 + ph * 0.5) + Math.sin(ph * 7 + i) * 1.2;
    const y = face.cy - face.h * 0.08 - ph * face.h * 1.05;
    const r = baseR * (0.85 + ph * 0.45);
    ops.push(...heartOps(x, y, r, ROSE_DEEP, PAPER, a));
  }
  return ops;
}

/** 连击记号：头顶一圈小爱心，数量＝连击−1，右下角再压一个「xN」。 */
function comboOps(input: GirlFxInput): DrawOp[] {
  if (input.patCombo < 2 || input.startleLeft > 0 || input.mood === "sleep") return [];
  const face = faceOf(input);
  const n = Math.min(4, input.patCombo - 1);
  const pulse = 0.82 + 0.18 * Math.sin(input.nowSec * 8.5);
  const r = Math.max(1.5, face.w * 0.065) * pulse;
  const ops: DrawOp[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = -Math.PI / 2 + (t - 0.5) * 1.25;
    const x = face.cx + Math.cos(ang) * face.w * 0.72;
    const y = face.cy + Math.sin(ang) * face.h * 0.62 - face.h * 0.12;
    ops.push(...heartOps(x, y, r, ROSE_DEEP, PAPER, 0.92));
  }
  const label = `x${input.patCombo}`;
  const tx = face.cx - input.body.facing * face.w * 0.55;
  const ty = face.top - face.h * 0.12;
  const size = Math.max(4.6, face.w * 0.155);
  ops.push({ kind: "text", text: label, x: tx + 0.35, y: ty + 0.35, size, color: withAlpha(PAPER, 0.92), align: "center", layer: "stars" });
  ops.push({ kind: "text", text: label, x: tx, y: ty, size, color: withAlpha(ACCENT, 0.95), align: "center", layer: "stars" });
  return ops;
}

/** 睡中被碰醒：头顶一个更大的「！」+ 两侧惊跳线 + 一颗冷汗。 */
function startleOps(input: GirlFxInput): DrawOp[] {
  if (input.startleLeft <= 0) return [];
  const age = STARTLE_MS - input.startleLeft;
  const p = clamp01(1 - input.startleLeft / STARTLE_MS);
  const a = smoothFade(p, 0.02, 0.58);
  if (a <= 0.01) return [];
  const face = faceOf(input);
  const ops: DrawOp[] = exclamationOps(input, age, STARTLE_MS, 1.18);
  const reach = face.w * (0.48 + p * 0.22);
  for (const side of [-1, 1]) {
    const x0 = face.cx + side * face.w * 0.34;
    const y0 = face.cy - face.h * 0.22;
    const x1 = face.cx + side * (face.w * 0.34 + reach * 0.5);
    const y1 = y0 - face.h * 0.28;
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.92 * a), width: 2.4, points: [[x0, y0], [x1, y1]], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: withAlpha(ACCENT, a), width: 1.1, points: [[x0, y0], [x1, y1]], layer: "stars" });
  }
  const dx = face.cx + input.body.facing * face.w * 0.42;
  const dy = face.cy - face.h * 0.05;
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * a), cx: dx, cy: dy, rx: 2.0, ry: 2.8, layer: "stars" });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.9 * a), cx: dx, cy: dy, rx: 1.1, ry: 1.8, layer: "stars" });
  return ops;
}

/** 走路/落地的脚边尘埃：小团双色，不描边而是「亮底 + 灰芯」，两档桌布都看得见。 */
function dustOps(input: GirlFxInput): DrawOp[] {
  const ops: DrawOp[] = [];
  const ink = inkOf(input);
  const baseX = ink.cx;
  const baseY = input.groundY + 0.6;
  const walking = input.activity === "walk";
  const landing = clamp01(input.squash);
  if (!walking && landing <= 0.02) return ops;

  if (landing > 0.02) {
    for (let i = 0; i < 3; i += 1) {
      const side = i - 1;
      const spread = Math.max(3.5, ink.w * 0.22) * (1 + landing * 0.8);
      const x = baseX + side * spread;
      const y = baseY - Math.abs(side) * 0.8;
      const r = Math.max(1.2, ink.w * 0.045) * (1 + (1 - landing) * 1.6);
      const a = 0.55 * landing;
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, a * 0.8), cx: x, cy: y, rx: r * 1.5, ry: r * 1.2, layer: "stars" });
      ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, a * 0.55), cx: x, cy: y, rx: r, ry: r * 0.8, layer: "stars" });
    }
  }

  if (walking) {
    for (const side of [-1, 1]) {
      const phase = input.step + (side > 0 ? Math.PI : 0);
      const push = Math.max(0, Math.sin(phase));
      if (push < 0.15) continue;
      const x = baseX + side * Math.max(3, ink.w * 0.2) + side * push * 2.4;
      const y = baseY;
      const r = Math.max(1.1, ink.w * 0.035) * (0.7 + push * 0.6);
      const a = 0.30 * push;
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, a * 0.9), cx: x, cy: y, rx: r * 1.6, ry: r * 1.25, layer: "stars" });
      ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, a * 0.5), cx: x, cy: y, rx: r, ry: r * 0.85, layer: "stars" });
    }
  }
  return ops;
}

/**
 * 全部记号：`below` = 坐垫 + 投影（垫子先铺，影子压在上面，她才「坐在垫子里」）；
 * 其余都在 `above`。顺序即叠放顺序：贴脸的在前，头顶的记号在后，尘埃最后。
 */
export function buildGirlFxOps(input: GirlFxInput): GirlFxOps {
  return {
    below: [...cushionOps(input), ...groundShadow(input)],
    above: [
      ...blanketOps(input),
      ...blushOps(input),
      ...comboOps(input),
      ...bondUpOps(input),
      ...noteOps(input),
      ...angerOps(input),
      ...noticeOps(input),
      ...startleOps(input),
      ...dizzyOps(input),
      ...milestoneOps(input),
      ...dustOps(input),
    ],
  };
}

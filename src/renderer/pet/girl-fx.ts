import type { DrawOp } from "./ops";
import type { Mood } from "../../shared/cat-types";
import {
  ACCENT, INK_SOFT, PAPER, ROSE, ROSE_DEEP, SHADOW, WARN, withAlpha,
} from "../../shared/pet-tokens";
import { girlFaceBox, girlInkBox, type GirlAnimBody } from "./girl-sprite";
import type { GirlPresencePose } from "./girl-presence";
import type { CompanionActivity } from "./companion";

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
  /** 开心到会哼歌的档：happy mood 或 wave/peace/happy 片。 */
  notes: boolean;
  quiet: boolean;
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

/**
 * 地面投影：多环伪高斯（与四足 `buildCatOps` 同一手法），外加一笔 3% 的奶油底光。
 * 奶油底光不是装饰——桌布可能是深色，纯黑影在深色桌布上等于「她浮在空中」；
 * 先铺一层极淡的亮面，影子才有「接触」可言。
 */
function groundShadow(input: GirlFxInput): DrawOp[] {
  const { body, lift, groundY, nowMs } = input;
  const ink = girlInkBox(body, input.frame);
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
  const face = girlFaceBox(input.body, input.frame);
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

/** 「！」：从脸侧上方弹出、上浮、淡出。两笔同形，奶油在外、强调色在内。 */
function noticeOps(input: GirlFxInput): DrawOp[] {
  if (input.noticeAgeMs < 0 || input.noticeAgeMs > NOTICE_FX_MS) return [];
  if (input.dizzyLeft > 0.05) return [];
  const p = clamp01(input.noticeAgeMs / NOTICE_FX_MS);
  const alpha = smoothFade(p, 0.08, 0.62);
  if (alpha <= 0.01) return [];
  const face = girlFaceBox(input.body, input.frame);
  const popIn = Math.min(1, input.noticeAgeMs / 180);
  const over = 1 + 0.28 * Math.sin(popIn * Math.PI);
  const bob = Math.sin(p * Math.PI) * 2.2;
  const x = face.cx + input.body.facing * face.w * 0.62;
  const y = face.top - face.h * 0.30 - bob;
  const h = Math.max(4.4, face.h * 0.40) * over;
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

/** 连点晕圈：三颗双色小星绕头顶转，越到尾巴越淡。 */
function dizzyOps(input: GirlFxInput): DrawOp[] {
  const left = clamp01(input.dizzyLeft);
  if (left <= 0.02) return [];
  const face = girlFaceBox(input.body, input.frame);
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
  const face = girlFaceBox(input.body, input.frame);
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
  const face = girlFaceBox(input.body, input.frame);
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

/** 走路/落地的脚边尘埃：小团双色，不描边而是「亮底 + 灰芯」，两档桌布都看得见。 */
function dustOps(input: GirlFxInput): DrawOp[] {
  const ops: DrawOp[] = [];
  const ink = girlInkBox(input.body, input.frame);
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

/** 全部记号：`below` 只有投影，其余都在 `above`。顺序即叠放顺序。 */
export function buildGirlFxOps(input: GirlFxInput): GirlFxOps {
  return {
    below: groundShadow(input),
    above: [
      ...blushOps(input),
      ...noteOps(input),
      ...angerOps(input),
      ...noticeOps(input),
      ...dizzyOps(input),
      ...dustOps(input),
    ],
  };
}

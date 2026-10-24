import type { Mood } from "../../shared/cat-types";

/**
 * 16 档表情差分表（v1.5.0 P2 Task 9，spec §3.2）。
 *
 * 表驱动：每档只写与 `FACE_REST` 不同的通道，其余兜底。判据是尺 #72
 * （成对像素差 ≥ MIN_PIXEL_DIFF）与单位层的「两档至少差 3 个通道」——
 * 调任何一档都要想清楚它跟谁撞了。
 *
 * 纯度（R-D9）：`faceOf` 不读时钟。`ctx.t` 只作为「相位归 clip」的占位存在，
 * **不参与任何通道计算**（测试里有一条专门钉这个）。
 */
export type Expression =
  | "neutral" | "happy" | "wink" | "love" | "shy" | "surprised" | "angry" | "sad"
  | "sleepy" | "thinking" | "smug" | "pout" | "worried" | "excited" | "cry" | "confused";

export interface FaceParams {
  /** 上眼睑闭合度 0..1（1＝全闭）。 */
  lidL: number;
  lidR: number;
  /** 眼睛整体放大系数（惊讶 >1、眯眼 <1）。 */
  eyeOpen: number;
  /** 瞳孔偏移 −1..1。 */
  pupil: [number, number];
  /** 眉毛上下位置 −1..1。 */
  brow: number;
  /** 眉毛倾角 −1..1（正＝外端下垂＝困扰/难过）。 */
  browTilt: number;
  /** 嘴的曲率 −1（撇）..1（笑）。 */
  mouth: number;
  /** 嘴的宽度 0..1。 */
  mouthWide: number;
  blush: number;
  tear: number;
  sweat: number;
  star: number;
}

export interface FaceCtx {
  /** 绝对时钟秒。**不参与**任何通道：相位归 clip（Task 12）。 */
  t: number;
  blink: number;
  mouse: [number, number] | null;
  energy: number;
  speaking: boolean;
}

export const FACE_REST: FaceParams = {
  lidL: 0, lidR: 0, eyeOpen: 1, pupil: [0, 0], brow: 0, browTilt: 0,
  mouth: 0.35, mouthWide: 0.55, blush: 0, tear: 0, sweat: 0, star: 0,
};

const TABLE: Record<Expression, Partial<FaceParams>> = {
  neutral: {},
  happy: { mouth: 0.85, mouthWide: 0.75, blush: 0.35, brow: 0.12 },
  wink: { lidR: 1, mouth: 0.7, mouthWide: 0.6, blush: 0.2, brow: 0.1 },
  love: { mouth: 0.9, mouthWide: 0.5, blush: 0.8, brow: 0.2, eyeOpen: 1.05, pupil: [0, -0.3] },
  shy: { lidL: 0.35, lidR: 0.35, mouth: 0.1, mouthWide: 0.4, blush: 1, brow: -0.15, browTilt: 0.4, pupil: [-0.8, 0.5] },
  surprised: { eyeOpen: 1.35, mouth: -0.35, mouthWide: 0.35, brow: 0.55, lidL: 0.05, lidR: 0.05 },
  angry: { eyeOpen: 0.75, brow: -0.5, browTilt: -0.85, mouth: -0.25, mouthWide: 0.45, blush: 0.15 },
  sad: { eyeOpen: 0.85, brow: 0.3, browTilt: 0.6, mouth: -0.45, mouthWide: 0.4, pupil: [0, 0.6], tear: 0.35 },
  sleepy: { lidL: 0.92, lidR: 0.92, eyeOpen: 0.5, mouth: 0.15, mouthWide: 0.3, brow: -0.1, pupil: [0, 0.8] },
  thinking: { pupil: [0.75, -0.55], lidL: 0.2, mouth: 0.1, mouthWide: 0.3, brow: 0.25, browTilt: -0.3, star: 0 },
  smug: { mouth: 0.6, mouthWide: 0.7, lidL: 0.25, brow: 0.2, browTilt: -0.45, blush: 0.25, eyeOpen: 0.9 },
  pout: { mouth: -0.7, mouthWide: 0.3, brow: 0.4, browTilt: 0.5, blush: 0.4, eyeOpen: 0.9, lidL: 0.15, lidR: 0.15 },
  worried: { brow: 0.5, browTilt: 0.75, mouth: -0.15, mouthWide: 0.35, sweat: 1, eyeOpen: 1.05, pupil: [0, -0.4] },
  excited: { eyeOpen: 1.25, mouth: 0.95, mouthWide: 0.85, brow: 0.45, blush: 0.5, star: 0.6, pupil: [0, -0.2] },
  cry: { lidL: 0.55, lidR: 0.55, brow: 0.6, browTilt: 0.8, mouth: -0.6, mouthWide: 0.5, tear: 1, blush: 0.5 },
  confused: { pupil: [-0.6, 0.2], brow: 0.35, browTilt: -0.7, mouth: 0.05, mouthWide: 0.3, sweat: 0.45, lidR: 0.3 },
};

export const EXPRESSIONS: readonly Expression[] = [
  "neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
  "sleepy", "thinking", "smug", "pout", "worried", "excited", "cry", "confused",
];

/** Mood → 表情的一条多（§6 六档表）：四足那套 five moods 各有归属。 */
export const MOOD_TO_EXPRESSION: Record<Mood, Expression> = {
  idle: "neutral",
  happy: "happy",
  thinking: "thinking",
  grumpy: "angry",
  sleep: "sleepy",
};

/** 把任意数值折回 ±0.9（瞳孔偏移的可见余量）。 */
const clampUnit = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-0.9, Math.min(0.9, v));
};

export function faceOf(expr: Expression, ctx: FaceCtx): FaceParams {
  const row = TABLE[expr];
  const fp: FaceParams = {
    ...FACE_REST,
    ...row,
    pupil: [...(row.pupil ?? FACE_REST.pupil)] as [number, number],
  };
  // blink 只压 lid：这是原 CatInput.blink 的语义，不许顺手改嘴。
  fp.lidL = Math.max(fp.lidL, ctx.blink);
  fp.lidR = Math.max(fp.lidR, ctx.blink);
  // gaze 只在睁着的时候追；闭眼时给余量而不是抢通道。
  if (ctx.mouse && fp.lidL < 0.6) {
    fp.pupil = [clampUnit(ctx.mouse[0]), clampUnit(ctx.mouse[1])];
  }
  return fp;
}

// ===========================================================================
// buildFaceOps：把差分表画成图元
// ===========================================================================

import { GIRL_PROPORTION } from "./girl";
import { arc, quadTo } from "./xf";
import type { Map2 } from "./rig";
import type { CatCoat } from "../../shared/cat-coats";
import { INK, PAPER, WARN, wash, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";

const ell = (m: Map2, layer: PetLayer, fill: string, cx: number, cy: number, rx: number, ry: number): DrawOp => {
  const [x, y] = m.map([cx, cy]);
  return { kind: "fillEllipse", fill, cx: x, cy: y, rx: rx * m.scaleX(), ry: ry * m.scaleY(), layer };
};

const stroke = (m: Map2, layer: PetLayer, color: string, width: number, pts: Point2[]): DrawOp =>
  ({ kind: "strokePath", stroke: color, width: width * m.k(), points: pts.map((p) => m.map(p)), layer });

const fill = (m: Map2, layer: PetLayer, color: string, pts: Point2[]): DrawOp =>
  ({ kind: "fillPath", fill: color, points: pts.map((p) => m.map(p)), layer });

/**
 * 猫娘的脸（16 档差分 → 图元）。眼本体与四足 `art.ts:478-494` **同形**：
 * 眼白 5.9×6.6、瞳孔 0.80/0.84、高光 0.30/0.15，只是锚点换成 GIRL_PROPORTION 的眼位。
 * `eyeOpen` 只拉纵轴（横轴不动）——否则惊讶会读成斗鸡眼。
 */
export function buildFaceOps(
  fp: FaceParams,
  head: Map2,
  s: number,
  coat: CatCoat,
  u: number,
): DrawOp[] {
  void s; void u;
  const P = GIRL_PROPORTION;
  const out: DrawOp[] = [];
  const open = Math.max(0.05, fp.eyeOpen);

  // —— 眉：两条弧，纵向随 brow、外侧端随 browTilt 摆 ——
  for (const side of [-1, 1] as const) {
    const cx = side < 0 ? P.eyeLx : P.eyeRx;
    const y0 = P.eyeY - 9.0 - fp.brow * 3.2;
    const yMid = y0 - 1.2 + fp.browTilt * side * 1.6;
    out.push(stroke(head, "brows", coat.furEdge, 1.25, arc(cx - 4, y0, cx, yMid, cx + 4, y0)));
  }

  // —— 眼：白 → 瞳 → 两枚高光 → 上睫 → 闭眼线 ——
  for (const cx of [P.eyeLx, P.eyeRx] as const) {
    const lid = cx === P.eyeLx ? fp.lidL : fp.lidR;
    const rx = Math.max(0.7, P.eyeRr * open);
    const ry = Math.max(0.6, P.eyeRy * open * (1 - 0.92 * lid));
    out.push(ell(head, "eyes", PAPER, cx, P.eyeY, rx, ry));
    const px = cx + fp.pupil[0] * 1.6;
    const py = P.eyeY + fp.pupil[1] * 1.3;
    out.push(ell(head, "eyes", coat.eye, px, py, rx * 0.80, ry * 0.84));
    if (lid < 0.6) {
      out.push(ell(head, "eyes", withAlpha(PAPER, 0.96), px - rx * 0.30, py - ry * 0.34, rx * 0.30, rx * 0.30));
      out.push(ell(head, "eyes", withAlpha(PAPER, 0.72), px + rx * 0.34, py + ry * 0.30, rx * 0.15, rx * 0.15));
    }
    // 上睫线：一条弧压在眼白顶。
    out.push(stroke(head, "eyes", coat.eye, 1.5, arc(cx - P.eyeRr, P.eyeY - 1.5, cx, P.eyeY - P.eyeRy - 1.6, cx + P.eyeRr, P.eyeY - 1.5)));
    // 闭眼线：lid 深时横过眼位。
    if (lid > 0.5) {
      out.push(stroke(head, "eyes", coat.eye, 1.6, arc(cx - 4.4, P.eyeY, cx, P.eyeY + 1.8, cx + 4.4, P.eyeY)));
    }
  }

  // —— 星（开心眼）：四角星用两条十字描边，star 为 0 时不画 ——
  if (fp.star > 0.02) {
    const r = 4.2 * fp.star;
    for (const cx of [P.eyeLx, P.eyeRx] as const) {
      out.push(stroke(head, "eyes", withAlpha(coat.light, 0.9), 1.4, [[cx - r, P.eyeY], [cx + r, P.eyeY]]));
      out.push(stroke(head, "eyes", withAlpha(coat.light, 0.9), 1.4, [[cx, P.eyeY - r], [cx, P.eyeY + r]]));
    }
  }

  // —— 鼻 ——
  out.push(stroke(head, "nose", coat.nose, 1.2, [[59.4, P.eyeY + 7.2], [60.6, P.eyeY + 7.2]]));

  // —— 嘴：曲率决定向上/向下，宽度决定跨度 ——
  {
    const half = 1.6 + fp.mouthWide * 2.2;
    const curve = fp.mouth * 2.6;
    out.push(stroke(head, "mouth", coat.eye, 1.3,
      arc(60 - half, P.eyeY + 9.4 - curve * 0.3, 60, P.eyeY + 9.4 + curve, 60 + half, P.eyeY + 9.4 - curve * 0.3)));
  }

  // —— 腮红 ——
  if (fp.blush > 0.02) {
    for (const cx of [P.eyeLx - 3.6, P.eyeRx + 3.6] as const) {
      out.push(ell(head, "blush", withAlpha(coat.blush, 0.5 * fp.blush), cx, P.eyeY + 5.6, 3.4, 2.0));
    }
  }

  // —— 泪：双色（深芯 + 浅晕），画在脸上不是桌布上 ——
  if (fp.tear > 0.05) {
    for (const cx of [P.eyeLx + 1.6, P.eyeRx - 1.6] as const) {
      const y = P.eyeY + 6.6;
      out.push(ell(head, "tear", withAlpha(wash(coat.light, 120, PAPER), 0.55 * fp.tear), cx, y + 1.4, 2.2, 3.0));
      out.push(ell(head, "tear", withAlpha(wash(coat.eye, 170, PAPER), 0.85 * fp.tear), cx, y + 1.0, 1.1, 1.8));
    }
  }

  // —— 汗：额角一滴，双色 ——
  if (fp.sweat > 0.05) {
    const x = 60 + P.headRx + 2.5, y = P.crown + 5.5;
    out.push(fill(head, "tear", withAlpha(wash(coat.light, 140, PAPER), 0.6 * fp.sweat), [
      [x, y - 3.0], [x + 2.0, y + 0.6], [x, y + 2.2], [x - 2.0, y + 0.6],
    ]));
    out.push(fill(head, "tear", withAlpha(WARN, 0.85 * fp.sweat), [
      [x, y - 1.8], [x + 1.2, y + 0.5], [x, y + 1.4], [x - 1.2, y + 0.5],
    ]));
  }

  return out;
}

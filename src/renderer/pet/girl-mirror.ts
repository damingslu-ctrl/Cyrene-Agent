/**
 * 照镜子做鬼脸：镜子里的她轮流抽一张鬼脸（直接借生产的 16 档表情差分表），
 * 做脸那 1.4 秒里点镜子＝接得住，换脸的当口点＝没接上（连击清零），
 * 最后 1.2 秒她把镜子举正得意地照，那一段点也算数。
 *
 * 鬼脸表只写 `Expression` id，通道值一律从 `faceOf` 读——镜子里那张脸和猫娘本体
 * 是同一张差分表，不许在这里抄第二份「眨眼/嘟嘴」参数。
 */
import { ACCENT, EYE, INK, INK_SOFT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";
import { type Expression, faceOf } from "./face";

export const MIRROR_FACES: readonly Expression[] = ["wink", "surprised", "pout", "smug", "confused"];
/** 收尾那一段她自己的表情（也来自同一张差分表）。 */
export const MIRROR_FINAL_FACE: Expression = "happy";
export const MIRROR_FACE_MS = 1_400;
export const MIRROR_GAP_MS = 400;
export const MIRROR_AFTER_MS = 1_200;
export const MIRROR_CYCLE_MS = MIRROR_FACE_MS + MIRROR_GAP_MS;
export const MIRROR_MS = MIRROR_FACES.length * MIRROR_CYCLE_MS + MIRROR_AFTER_MS;
export const MIRROR_COOLDOWN_MS = 160;

export interface MirrorFaceContext {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface MirrorState {
  bornAt: number;
  seed: number;
  matched: number;
  streak: number;
  best: number;
  misses: number;
  lastMatchAt: number;
  lastCopyAt: number;
}

export type MirrorCopy = "match" | "wrong" | "miss";

export function createMirror(now: number, seed = Math.random()): MirrorState {
  return { bornAt: now, seed, matched: 0, streak: 0, best: 0, misses: 0, lastMatchAt: -1, lastCopyAt: -1 };
}

export function mirrorAge(state: MirrorState, now: number): number {
  // 帧起点可能早于出生那一拍：夹到 0 当「刚出生」，别判死。
  return Math.max(0, now - state.bornAt);
}

export function mirrorAlive(state: MirrorState, now: number): boolean {
  return mirrorAge(state, now) < MIRROR_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 镜子里正在做的那张鬼脸；换脸的当口给 null（ renderer 也可以拿它把本体表情一起带走）。
 */
export function mirrorFaceAt(
  state: MirrorState,
  now: number,
): { index: number; expression: Expression; localAge: number } | null {
  if (!mirrorAlive(state, now)) return null;
  const age = mirrorAge(state, now);
  if (age >= MIRROR_MS - MIRROR_AFTER_MS) return null;
  const index = Math.floor(age / MIRROR_CYCLE_MS);
  if (index >= MIRROR_FACES.length) return null;
  const localAge = age - index * MIRROR_CYCLE_MS;
  if (localAge >= MIRROR_FACE_MS) return null;
  return { index, expression: MIRROR_FACES[index], localAge };
}

/** 收尾段：她把镜子举正，自己得意。 */
export function mirrorProudAge(state: MirrorState, now: number): number | null {
  const age = mirrorAge(state, now);
  if (!mirrorAlive(state, now)) return null;
  if (age < MIRROR_MS - MIRROR_AFTER_MS) return null;
  return age - (MIRROR_MS - MIRROR_AFTER_MS);
}

export function mirrorRectAt(
  state: MirrorState,
  now: number,
  face: MirrorFaceContext,
  floorY: number,
): { x: number; y: number; w: number; h: number; tilt: number } {
  const age = mirrorAge(state, now);
  const w = clamp(face.w * 0.42, 14, 20);
  const h = w * 1.3;
  const tilt = Math.sin(age / 500 + state.seed * 4) * 0.8;
  return {
    x: clamp(face.cx - face.w * 0.44 - w / 2 + tilt, 1, 81 - w),
    y: floorY - h - 4,
    w,
    h,
    tilt,
  };
}

export function copyFace(
  state: MirrorState,
  now: number,
  face: MirrorFaceContext,
  floorY: number,
  x: number,
  y: number,
): MirrorCopy {
  if (!mirrorAlive(state, now)) return "miss";
  if (state.lastCopyAt >= 0 && now - state.lastCopyAt >= 0 && now - state.lastCopyAt < MIRROR_COOLDOWN_MS) return "miss";
  const rect = mirrorRectAt(state, now, face, floorY);
  if (x < rect.x - 3 || x > rect.x + rect.w + 3 || y < rect.y - 3 || y > rect.y + rect.h + 3) return "miss";
  state.lastCopyAt = now;
  const showing = mirrorFaceAt(state, now);
  if (showing) {
    state.matched += 1;
    state.streak += 1;
    state.best = Math.max(state.best, state.streak);
    state.lastMatchAt = now;
    return "match";
  }
  if (mirrorProudAge(state, now) !== null) {
    state.matched += 1;
    state.streak += 1;
    state.best = Math.max(state.best, state.streak);
    state.lastMatchAt = now;
    return "match";
  }
  state.misses += 1;
  state.streak = 0;
  return "wrong";
}

/** 把一张差分表的脸画进镜框里（比例按框宽走，不写绝对值）。 */
function reflectionOps(
  expression: Expression,
  rect: { x: number; y: number; w: number; h: number },
  seed: number,
  now: number,
  alpha: number,
): DrawOp[] {
  const ops: DrawOp[] = [];
  const fp = faceOf(expression, { t: 0, blink: 0, mouse: null, energy: 1, speaking: false });
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h * 0.46;
  const unit = rect.w / 10;
  const open = Math.max(0.06, fp.eyeOpen);
  const eyeDx = unit * 1.7;
  const eyeRy = unit * 0.62 * open;
  for (const side of [-1, 1] as const) {
    const lid = side < 0 ? fp.lidL : fp.lidR;
    const ex = cx + side * eyeDx;
    const ey = cy + fp.pupil[1] * unit * 0.1;
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx: ex, cy: ey, rx: unit * 0.8, ry: eyeRy * (1 - 0.9 * lid) });
    if (lid < 0.6) {
      ops.push({
        kind: "fillEllipse",
        fill: withAlpha(EYE, 0.95 * alpha),
        cx: ex + fp.pupil[0] * unit * 0.22,
        cy: ey + fp.pupil[1] * unit * 0.16,
        rx: unit * 0.34,
        ry: unit * 0.4,
      });
    } else {
      ops.push({ kind: "strokePath", stroke: withAlpha(INK, 0.9 * alpha), width: 1, points: [[ex - unit * 0.7, ey], [ex + unit * 0.7, ey]] });
    }
    // 眉：brow 抬，browTilt 压外端。
    const browY = ey - unit * 1.5 - fp.brow * unit * 0.5;
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(INK_SOFT, 0.8 * alpha),
      width: 0.8,
      points: [[ex - unit * 0.8, browY + fp.browTilt * side * unit * 0.3], [ex + unit * 0.8, browY - fp.browTilt * side * unit * 0.3]],
    });
  }
  // 嘴：曲率定开口，宽度定跨度（和脸本体同一套语义，只是缩在镜子里）。
  const half = unit * (0.6 + fp.mouthWide * 1.1);
  const mouthY = cy + unit * 1.9;
  const curve = fp.mouth * unit * 1.2;
  const lip: Array<[number, number]> = [];
  for (let i = 0; i <= 6; i += 1) {
    const p = i / 6;
    const px = cx - half + p * half * 2;
    const py = mouthY - curve * Math.sin(p * Math.PI) * (curve > 0 ? 1 : -1) * 0.6 - curve * 0.4;
    lip.push([px, py]);
  }
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.92 * alpha), width: 1, points: lip });
  if (fp.blush > 0.02) {
    for (const side of [-1, 1] as const) {
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, clamp(fp.blush, 0, 1) * 0.55 * alpha), cx: cx + side * unit * 2.6, cy: cy + unit * 1.2, rx: unit * 0.8, ry: unit * 0.45 });
    }
  }
  if (fp.tear > 0.02) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, clamp(fp.tear, 0, 1) * 0.85 * alpha), cx: cx + eyeDx, cy: cy + unit * 1.1, rx: unit * 0.24, ry: unit * 0.36 });
  }
  if (fp.sweat > 0.02) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, clamp(fp.sweat, 0, 1) * 0.9 * alpha), cx: rect.x + rect.w - unit * 1.1, cy: rect.y + unit * 1.4, rx: unit * 0.3, ry: unit * 0.44 });
  }
  if (fp.star > 0.02) {
    const r = unit * 0.7 * clamp(fp.star, 0, 1);
    for (const side of [-1, 1] as const) {
      const sx = cx + side * eyeDx;
      ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 0.9, points: [[sx - r, cy], [sx + r, cy]] });
      ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 0.9, points: [[sx, cy - r], [sx, cy + r]] });
    }
  }
  // 换脸的当口留一道「正在变」的抖痕：证明中间那 400ms 不是静止。
  if (expression === MIRROR_FINAL_FACE) {
    const shine = (now / 260 + seed * 3) % 1;
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.5 * alpha), cx: rect.x + rect.w * shine, cy: rect.y + rect.h * 0.2, rx: unit * 0.3, ry: unit * 0.3 });
  }
  return ops;
}

export function buildMirrorOps(
  state: MirrorState,
  now: number,
  face: MirrorFaceContext,
  floorY: number,
): DrawOp[] {
  if (!mirrorAlive(state, now)) return [];
  const age = mirrorAge(state, now);
  const alpha = Math.min(1, 0.42 + age / 300) * clamp((MIRROR_MS - age) / 620, 0, 1);
  const rect = mirrorRectAt(state, now, face, floorY);
  const ops: DrawOp[] = [];
  const showing = mirrorFaceAt(state, now);
  const proud = mirrorProudAge(state, now);
  const expression = showing?.expression ?? (proud !== null ? MIRROR_FINAL_FACE : MIRROR_FACES[MIRROR_FACES.length - 1]);

  // 镜架：墨框 + 奶油玻璃 + 一道斜反光（渐变）。
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.88 * alpha), x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: 3 });
  ops.push({
    kind: "gradPath",
    points: [[rect.x + 1, rect.y + 1], [rect.x + rect.w - 1, rect.y + 1], [rect.x + rect.w - 1, rect.y + rect.h * 0.55]],
    from: [rect.x, rect.y],
    to: [rect.x + rect.w, rect.y + rect.h],
    stops: [
      { at: 0, color: withAlpha(PAPER, 0.55 * alpha) },
      { at: 0.55, color: withAlpha(PAPER, 0.06 * alpha) },
      { at: 1, color: withAlpha(INK_SOFT, 0.18 * alpha) },
    ],
  });
  ops.push(...reflectionOps(expression, rect, state.seed, now, alpha));
  ops.push({ kind: "strokeRoundRect", stroke: withAlpha(INK, 0.85 * alpha), width: 1.2, x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: 3 });
  ops.push({ kind: "strokeRoundRect", stroke: withAlpha(ROSE, 0.5 * alpha), width: 0.6, x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2, r: 3.6 });
  // 镜座两条腿，站在地上而不是浮着。
  for (const side of [-1, 1] as const) {
    const px = rect.x + rect.w / 2 + side * rect.w * 0.3;
    ops.push({ kind: "strokePath", stroke: withAlpha(INK_SOFT, 0.85 * alpha), width: 1, points: [[px, rect.y + rect.h], [px + side * 1.6, floorY]] });
  }
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK, 0.16 * alpha), cx: rect.x + rect.w / 2, cy: floorY + 1.2, rx: rect.w * 0.6, ry: 1.8 });

  // 记分：每接住一张，在镜框右下角摞一颗；接歪了留一枚空心。
  for (let i = 0; i < Math.min(state.matched, 6); i += 1) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.9 * alpha), cx: rect.x + 2.4 + (i % 3) * 3.4, cy: rect.y + rect.h + 3.4 + Math.floor(i / 3) * 3.4, rx: 1.3, ry: 1.3 });
  }
  for (let i = 0; i < Math.min(state.misses, 3); i += 1) {
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE_DEEP, 0.7 * alpha), width: 0.7, cx: rect.x + rect.w - 2.4 - i * 3.2, cy: rect.y - 2.6, rx: 1.2, ry: 1.2 });
  }
  // 接住的那一下：镜框上方弹一颗双色素星。
  const since = state.lastMatchAt >= 0 ? now - state.lastMatchAt : -1;
  if (since >= 0 && since < 420) {
    const p = since / 420;
    const sx = rect.x + rect.w / 2;
    const sy = rect.y - 6 - p * 8;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const rad = (i % 2 === 0 ? 3.6 : 1.3) * (1 - p * 0.3);
      pts.push([sx + Math.cos(ang) * rad, sy + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, (1 - p) * 0.95 * alpha), points: pts });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, (1 - p) * 0.9 * alpha), points: pts.map(([px, py]) => [sx + (px - sx) * 0.55, sy + (py - sy) * 0.55]) });
  }
  return ops;
}

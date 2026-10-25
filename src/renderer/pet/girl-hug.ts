/**
 * 抱抱：她张开手把人抱住，胸口浮出一颗大爱心，点她可以再抱紧一点。
 * 这段只演 3.6 秒；爱心数量按点击次数长，不产生任何玩法状态。
 */
import { PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import { heartOp, heartWithHalo, sparkleOps } from "./girl-prop-art";
import type { DrawOp } from "./ops";

export const HUG_MS = 3_600;
export const HUG_TAP_COOLDOWN_MS = 450;
export const HUG_MAX_TAPS = 5;

export interface HugFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface HugState {
  bornAt: number;
  seed: number;
  taps: number;
  lastTapAt: number;
}

export function createHug(now: number, seed = Math.random()): HugState {
  return { bornAt: now, seed, taps: 0, lastTapAt: -1 };
}

export function hugAlive(state: HugState, now: number): boolean {
  const age = now - state.bornAt;
  return age >= 0 && age < HUG_MS;
}

/** 抱抱的命中区：整段上身（不是整只猫），避开脚边玩具。 */
export function hugAtPoint(face: HugFace, x: number, y: number): boolean {
  const cx = face.cx;
  const cy = face.bottom + face.h * 0.3;
  const rx = face.w * 1.05;
  const ry = face.h * 1.15;
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** 再抱紧一点：冷却外累加，最多五下。 */
export function tapHug(state: HugState, now: number): boolean {
  if (!hugAlive(state, now)) return false;
  if (state.lastTapAt >= 0 && now - state.lastTapAt < HUG_TAP_COOLDOWN_MS) return false;
  state.lastTapAt = now;
  if (state.taps < HUG_MAX_TAPS) state.taps += 1;
  return true;
}

export function buildHugOps(
  state: HugState,
  now: number,
  face: HugFace,
  floorY: number,
): DrawOp[] {
  if (!hugAlive(state, now)) return [];
  const age = now - state.bornAt;
  const fade = Math.min(1, Math.max(0, age / 260)) * Math.min(1, Math.max(0, (HUG_MS - age) / 420));
  const cx = face.cx;
  const chestY = face.bottom + face.h * 0.38;
  const ops: DrawOp[] = [];
  // 胸口的大爱心：奶油放大一圈垫底，玫瑰压上去（画在身体上，深桌布也读得出）。
  const beat = 1 + Math.sin(age / 160) * 0.06 + state.taps * 0.04;
  ops.push(...heartWithHalo(cx, chestY, Math.max(5, face.w * 0.14) * beat, withAlpha(ROSE, 0.92 * fade), withAlpha(PAPER, 0.85 * fade)));
  // 两侧的小爱心：像张开的手心。
  const armR = Math.max(3.4, face.w * 0.09);
  for (const side of [-1, 1] as const) {
    ops.push(...heartWithHalo(
      cx + side * face.w * 0.55,
      face.bottom + face.h * 0.22 + Math.sin(age / 220 + side) * 1.2,
      armR,
      withAlpha(side < 0 ? ROSE : ROSE_DEEP, 0.9 * fade),
      withAlpha(PAPER, 0.8 * fade),
    ));
  }
  // 点出来的心：每一下从胸口浮起来，左右错开。
  for (let i = 0; i < state.taps; i += 1) {
    const p = ((age / 900 + i * 0.35) % 1);
    const x = cx + Math.sin(i * 2.4 + state.seed * 6.28) * face.w * 0.42;
    const y = chestY - p * face.h * 0.9;
    ops.push(heartOp(x, y, Math.max(2, face.w * 0.055) * (1 - p * 0.35), withAlpha(PAPER, 0.9 * (1 - p) * fade)));
    ops.push(heartOp(x, y, Math.max(1.6, face.w * 0.04) * (1 - p * 0.3), withAlpha(i % 2 === 0 ? ROSE : ROSE_DEEP, 0.95 * (1 - p) * fade)));
  }
  // 头顶两颗星：抱抱是件值得庆祝的小事。
  ops.push(...sparkleOps(cx - face.w * 0.58, face.top + face.h * 0.1, Math.max(2, face.w * 0.06), withAlpha(PAPER, 0.85 * fade), withAlpha(ROSE, 0.95 * fade)));
  ops.push(...sparkleOps(cx + face.w * 0.6, face.top + face.h * 0.24, Math.max(1.6, face.w * 0.045), withAlpha(PAPER, 0.75 * fade), withAlpha(ROSE_DEEP, 0.9 * fade)));
  // 脚边一圈奶油光，把「抱住了」这件事兜住。
  if (age < 900) {
    const p = age / 900;
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.7 * (1 - p) * fade), width: 1.1, cx, cy: floorY + 1, rx: face.w * (0.5 + p * 0.5), ry: 3.2 + p * 1.6 });
  }
  return ops;
}

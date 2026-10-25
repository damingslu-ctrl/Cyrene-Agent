import type { Rect } from "../../shared/pet-geometry";

/**
 * 「陪她散散步」的落点：水平走 60–160px，脚线不动。
 * 贴边时自己掉头；连掉头的空间都没有（窗口和工作区一样宽）就不动，返回 null。
 */
export const WANDER_MIN_PX = 60;
export const WANDER_MAX_PX = 160;

export interface WanderInput {
  origin: { x: number; y: number };
  size: { width: number; height: number };
  workArea: Rect;
  facing: 1 | -1;
  /** 0..1：只决定这一步走多远，落点完全可复现。 */
  random: number;
}

export function wanderTarget(input: WanderInput): { x: number; y: number } | null {
  const { origin, size, workArea } = input;
  const rnd = Number.isFinite(input.random) ? Math.max(0, Math.min(1, input.random)) : 0.5;
  const dist = WANDER_MIN_PX + (WANDER_MAX_PX - WANDER_MIN_PX) * rnd;
  const lo = workArea.x;
  const hi = workArea.x + workArea.width - size.width;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo + 0.5) return null;
  const clampX = (x: number) => Math.min(Math.max(x, lo), hi);
  const facing = input.facing === -1 ? -1 : 1;

  const preferred = clampX(origin.x + facing * dist);
  if (Math.abs(preferred - origin.x) >= 1) return { x: preferred, y: origin.y };
  const flipped = clampX(origin.x - facing * dist);
  if (Math.abs(flipped - origin.x) >= 1) return { x: flipped, y: origin.y };
  return null;
}

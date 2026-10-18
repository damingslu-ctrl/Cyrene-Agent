export interface PetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsDelta {
  move: boolean;
  size: boolean;
}

const DRIFT_EPSILON = 0.5;

/**
 * 位移与尺寸是**两条独立的 2 维门**，逐字对应 native `main.rs:4308-4315`
 * （`(win_size - cur_size).length() > 0.5` 与 `(cur_pos - applied_pos).length() > 0.5`）。
 * 不许合成一条 4 维距离：Windows 的落位按 DPI 量化，位移与尺寸各自留 0.35 的残差时，
 * 合式会得到 0.70 > 0.5，于是每帧都发一条 native 根本不会发的指令——
 * 而那条指令是无条件同时改位置和尺寸的。
 */
export function shouldApplyBounds(current: PetBounds, next: PetBounds): BoundsDelta {
  return {
    move: Math.hypot(next.x - current.x, next.y - current.y) > DRIFT_EPSILON,
    size: Math.hypot(next.width - current.width, next.height - current.height) > DRIFT_EPSILON,
  };
}

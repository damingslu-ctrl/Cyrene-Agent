export interface PetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PET_RESIZE 的完整载荷。bounds 四数是**位置/尺寸门的依据**，必须取整（渲染端
 * Math.round 后发）；后四列是**猫模型的取证量**，只喂 GEOM 探针，不取整——
 * native `main.rs:4379-4396` 的 pin/center/peek/e 都是小数，屏幕尺要拿它们对账。
 * 缺省（旧载荷/测试直发四数）时探针打 `-`：宁可让屏幕尺看见"这一列没有证据"，
 * 也不许用常量冒充真值（geom-probe.ts 头部同一条纪律）。
 */
export interface PetResizePayload extends PetBounds {
  /** native pin_in_win = pet + PIN + peek_off − applied_pos（main.rs:4379）。 */
  pinInWin?: { x: number; y: number };
  /** native center = pin_in_win + (−17s, +4.5s)（main.rs:4380-4383）。 */
  center?: { x: number; y: number };
  /** 当前藏身位移（px，窗口右为正）。 */
  peekDx?: number;
  /** 当前展开进度 e。 */
  e?: number;
  /**
   * 当前形态×档位的收起态基址（未乘 zoom）。窗口层拿它当 applyPetWindowZoom 的
   * 放大基线——没有这一列，切到「大」之后再调缩放会按 82×108 把窗缩回去。
   */
  base?: { width: number; height: number };
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

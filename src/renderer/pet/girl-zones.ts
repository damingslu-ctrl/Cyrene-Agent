/**
 * 猫娘命中框里的三块可点区：头 / 身 / 脚。
 *
 * 立绘的脸是画死的，摸头不会有独立表情；但「点哪里」仍然要分得出来——
 * 摸头是害羞、戳肚子是普通反应、挠脚是怕痒，三者台词与手势不同。
 * 分界按**命中框**的比例算，而不是按墨框：命中框是唯一在真窗里可复现的尺
 * （`getHitRect()`），墨框会随帧图集换图漂。
 *
 * 头 0..36%：墨框顶到 35% 是脸（girl-sprite.test 有锁），留 1% 余量给发顶。
 * 脚 76..100%：脚线在命中框 91% 处，膝下全部算「脚」。
 */
export type GirlTapZone = "head" | "body" | "feet";

export const GIRL_ZONES = {
  /** 头部区下沿（占命中框高度）。 */
  headEnd: 0.36,
  /** 脚部区上沿。 */
  feetStart: 0.76,
} as const;

export interface GirlTapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 点击落点 → 区域；落在命中框外返回 null（透明处根本收不到事件，这里是兜底）。 */
export function classifyGirlTap(x: number, y: number, rect: GirlTapRect): GirlTapZone | null {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  if (x < rect.x || x > rect.x + w || y < rect.y || y > rect.y + h) return null;
  const f = (y - rect.y) / h;
  if (f < GIRL_ZONES.headEnd) return "head";
  if (f >= GIRL_ZONES.feetStart) return "feet";
  return "body";
}

/**
 * 连点阈值：2.4s 内第 4 下 → 晕。4 下是「逗她」与「手滑」的分界，
 * 2.4s 比触摸合并窗（2.5s）略短，保证三下合并掉的连点仍能在第四下凑齐一笔。
 */
export const RAPID_TAP = {
  windowMs: 2_400,
  taps: 4,
  /** 晕完的冷却：这段时间内继续点不会重新晕，避免按住不放刷成永动机。 */
  cooldownMs: 6_000,
} as const;

export interface TapResult {
  /** 窗口内已累计的点击数（触发眩晕时归零）。 */
  count: number;
  /** 这一下是否刚好凑满阈值。 */
  dizzy: boolean;
}

/**
 * 连点计数器。纯时钟驱动，不知道猫长什么样，也不知道点在哪——
 * 区域只决定每一下的反应，是否晕只跟「点多快」有关。
 */
export class GirlTapTracker {
  private stamps: number[] = [];
  private blockedUntil = 0;

  tap(now: number): TapResult {
    if (now < this.blockedUntil) return { count: 0, dizzy: false };
    this.stamps = this.stamps.filter((at) => now - at < RAPID_TAP.windowMs);
    this.stamps.push(now);
    if (this.stamps.length >= RAPID_TAP.taps) {
      this.stamps = [];
      this.blockedUntil = now + RAPID_TAP.cooldownMs;
      return { count: 0, dizzy: true };
    }
    return { count: this.stamps.length, dizzy: false };
  }

  reset(): void {
    this.stamps = [];
    this.blockedUntil = 0;
  }
}

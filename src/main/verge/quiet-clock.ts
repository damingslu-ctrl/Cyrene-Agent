/**
 * 免打扰的纯时钟判据。
 *
 * 对位 native `main.rs:5175 QUIET_SECS = 30.0 * 60.0`、`main.rs:2498 quiet_on`
 * （`u > now`：到点那一帧就该放开）、`main.rs:2503 quiet_toggle`（开着就关、
 * 关着开到 `now + QUIET_SECS`——再点一次是取消，不是续期）、
 * `main.rs:2534 quiet_chip`（分钟向上取整且至少 1：剩 12 秒写「0 分」会让人
 * 以为牌子马上就消失，而它还得再等 12 秒）。
 */

/** 半小时档时长，照抄 native QUIET_SECS（main.rs:5175）。单位 ms。 */
export const QUIET_DURATION_MS = 30 * 60 * 1000;

/** `quietUntil` 还在未来就是安静中；到点那一帧即失效（native quiet_on，main.rs:2498）。 */
export function isQuietNow(quietUntil: number | null, now: number): boolean {
  return quietUntil !== null && now < quietUntil;
}

/**
 * 剩余分钟向上取整、且至少给 1（native quiet_chip，main.rs:2534 的口径）。
 * 剩 10 秒也得说「剩 1 分」：写 0 会让人以为牌子马上就该消失。
 */
export function quietRemainingMinutes(quietUntil: number, now: number): number {
  return Math.max(1, Math.ceil((quietUntil - now) / 60_000));
}

/** 已在安静期 → 取消（返回 null）；不在 → 续半小时（native quiet_toggle，main.rs:2503）。 */
export function armQuiet(input: { current: number | null; now: number }): number | null {
  return isQuietNow(input.current, input.now) ? null : input.now + QUIET_DURATION_MS;
}

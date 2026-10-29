import { GIRL_ACTION_ROWS, type GirlActionId } from "./girl-actions-meta";

/**
 * 野性三式的专属动画播放器：只做时间 → 帧号，不碰 canvas。
 *
 * 与 `girl-anim.ts` 同一条时钟口径——帧号由「经过时间 × 本行的 fps」算，绝对时钟，
 * 不随重绘帧率走；区别只有一条：每一式播的是**自己那一行**。
 * - 冲刺 12fps 循环、潜行 6fps 循环、扑击 7fps 一次性（演完停在她站起来的最后一格）。
 *
 * 2026-10-29 量过接缝：zoom 65.4 / stalk 52.1 都小于段内最大步进（105 / 96），
 * 尾帧接回首帧看不出跳，所以循环两式用 wrap 而不是往返；hunt 的接缝 98.5 ≈ 段内最大步进
 * （最后一帧是站起收势），它本来就是一次性动作。
 */
export function girlActionFrameCount(id: GirlActionId): number {
  return GIRL_ACTION_ROWS[id].frames;
}

export function girlActionDurationMs(id: GirlActionId): number {
  return (girlActionFrameCount(id) * 1000) / GIRL_ACTION_ROWS[id].fps;
}

/** 一次性动作越过末帧后保持末帧并报 done；循环动作永远不 done。 */
export function girlActionFrameAt(
  id: GirlActionId, elapsedMs: number,
): { index: number; done: boolean } {
  const row = GIRL_ACTION_ROWS[id];
  const per = 1000 / row.fps;
  const frames = Math.floor(Math.max(0, elapsedMs) / per);
  if (!row.loop) return { index: Math.min(row.frames - 1, frames), done: frames >= row.frames };
  return { index: frames % row.frames, done: false };
}

/** 重绘下限与帧动画同一条公式：片段帧率的两倍，封顶 30、保底 24（淡化期不许一格一格地淡）。 */
export function girlActionRedrawFloor(id: GirlActionId): number {
  return Math.min(30, Math.max(24, Math.ceil(GIRL_ACTION_ROWS[id].fps * 2)));
}

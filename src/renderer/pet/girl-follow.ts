/**
 * 「跟我来」的纯几何：把光标在窗内的横向落点翻译成她该走到哪。
 *
 * 只往左右走（猫娘没有爬墙的骨架），并以出发点为圆心限幅 160px——
 * 她想跟，但不是一颗追着光标满屏跑的导弹。
 */
export const FOLLOW_MS = 12_000;
export const FOLLOW_RANGE_PX = 160;
export const FOLLOW_ARRIVE_PX = 14;
export const FOLLOW_STEP_PX = 42;

export interface FollowBounds {
  minX: number;
  maxX: number;
}

/** 目标屏幕 X：光标在她中心右侧就往右跟，最多离出发点多 160px，且不出 workArea。 */
export function followTargetX(
  startX: number,
  cursorLocalX: number,
  windowWidth: number,
  bounds: FollowBounds,
): number {
  const offset = Math.max(-FOLLOW_RANGE_PX, Math.min(FOLLOW_RANGE_PX, cursorLocalX - windowWidth / 2));
  const lo = Math.max(startX - FOLLOW_RANGE_PX, bounds.minX);
  const hi = Math.min(startX + FOLLOW_RANGE_PX, bounds.maxX);
  return Math.max(lo, Math.min(hi, startX + offset));
}

/** 只差一步就算了：贴脸还继续走会把「跟随」变成「蹭腿」。 */
export function followArrived(targetX: number, currentX: number): boolean {
  return Math.abs(targetX - currentX) <= FOLLOW_ARRIVE_PX;
}

/** 光标目标挪得够远才重发漫游：每帧重发会把她的速度不断归零。 */
export function followNeedsStep(targetX: number, lastTargetX: number): boolean {
  return Math.abs(targetX - lastTargetX) >= FOLLOW_STEP_PX;
}

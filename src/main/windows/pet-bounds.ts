export interface PetBounds { x: number; y: number; width: number; height: number }

const DRIFT_EPSILON = 0.5;

/** 位移与尺寸合起来的欧氏距离过阈才发指令，防止每帧空转 DWM。 */
export function shouldApplyBounds(current: PetBounds, next: PetBounds): boolean {
  const d = Math.hypot(next.x - current.x, next.y - current.y, next.width - current.width, next.height - current.height);
  return d > DRIFT_EPSILON;
}

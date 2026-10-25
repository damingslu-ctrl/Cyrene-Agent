/**
 * 桌宠登场动画的窗口几何。
 *
 * 源片是 304×248 的横画幅（角色脚底在 y≈238），按 1.5 倍放在桌宠脚边；
 * 位置规则：脚底与桌宠窗底对齐、水平居中对准桌宠窗，超出工作区就整窗夹回。
 * 夹取必须用**猫所在显示器**的 workArea（和 create-pet-window 同一个理由：
 * 拿主屏判会把它从副屏拽回来）。
 */
export const PET_INTRO_FRAME_WIDTH = 304;
export const PET_INTRO_FRAME_HEIGHT = 248;
export const PET_INTRO_SCALE = 1.5;
export const PET_INTRO_WINDOW_WIDTH = Math.round(PET_INTRO_FRAME_WIDTH * PET_INTRO_SCALE);
export const PET_INTRO_WINDOW_HEIGHT = Math.round(PET_INTRO_FRAME_HEIGHT * PET_INTRO_SCALE);

export interface PetIntroRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, low: number, high: number): number {
  // 工作区比动画窗还小时 high < low：先让 low 赢，再把窗钉在工作区左上角。
  return Math.min(Math.max(value, low), Math.max(low, high));
}

export function computePetIntroBounds(pet: PetIntroRect, workArea: PetIntroRect): PetIntroRect {
  const x = clamp(
    pet.x + Math.round((pet.width - PET_INTRO_WINDOW_WIDTH) / 2),
    workArea.x,
    workArea.x + workArea.width - PET_INTRO_WINDOW_WIDTH,
  );
  const y = clamp(
    pet.y + pet.height - PET_INTRO_WINDOW_HEIGHT,
    workArea.y,
    workArea.y + workArea.height - PET_INTRO_WINDOW_HEIGHT,
  );
  return { x: Math.round(x), y: Math.round(y), width: PET_INTRO_WINDOW_WIDTH, height: PET_INTRO_WINDOW_HEIGHT };
}

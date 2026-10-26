// 由 scripts/assets/build-girl-pet-poses2.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/poses2/*.png（8 张 1280×1024 高清立绘，浅粉纯底）。
// 全表共用一个 scale（由 `wave` 站姿定尺）：趴着就是又矮又宽，不会被撑成站姿那么高。
export const GIRL_PET_POSES2 = {
  src: "./pet/girl-poses2.webp",
  cellW: 400,
  cellH: 248,
  cols: 8,
  rows: 1,
  count: 8,
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: 0.500000,
  anchorY: 0.959677,
  /** `wave` 的墨高（图集像素）→ 与图集 I / 静态立绘同一条 91vb 的尺。 */
  inkRefPx: 229.0,
  inkVb: 91,
} as const;

/** 姿态名 → 格号。 */
export const GIRL_PET_POSE2_CELLS = {
  prone: 0,
  yawn: 1,
  wash: 2,
  tilt: 3,
  wave: 4,
  bow: 5,
  peace: 6,
  kneel: 7,
} as const;

export type GirlPose2Id = keyof typeof GIRL_PET_POSE2_CELLS;

/** 每格的墨框（格子像素 [x0, y0, x1, y1] 边缘坐标），alpha 实测。 */
export const GIRL_PET_POSE2_INK: Record<GirlPose2Id, readonly [number, number, number, number]> = {
  prone: [65, 52, 316, 241],
  yawn: [144, 8, 276, 241],
  wash: [98, 4, 272, 241],
  tilt: [141, 10, 280, 240],
  wave: [134, 6, 275, 240],
  bow: [105, 21, 272, 240],
  peace: [145, 6, 281, 241],
  kneel: [116, 14, 267, 241],
};

/** 每格的脸框（格子像素 [cx, cy, w, h]），20px 网格逐格手工量；只含白脸，不含耳朵。 */
export const GIRL_PET_POSE2_FACE: Record<GirlPose2Id, readonly [number, number, number, number]> = {
  prone: [172, 154, 85, 72],
  yawn: [200, 96, 100, 68],
  wash: [197, 101, 95, 67],
  tilt: [195, 98, 86, 60],
  wave: [195, 82, 74, 60],
  bow: [182, 110, 66, 50],
  peace: [202, 90, 75, 56],
  kneel: [185, 120, 74, 56],
};

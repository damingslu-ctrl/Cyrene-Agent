// 由 scripts/assets/build-girl-pet-poses.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/generated/girl-poses.png（7 张高清立绘，1136×912，浅粉纯底）。
// `stand` 是把 `heart` 胸前那颗心 inpaint 掉后的合爪站姿；`love` 保留原图。
export const GIRL_PET_POSES = {
  src: "./pet/girl-poses.webp",
  cellW: 340,
  cellH: 248,
  cols: 8,
  rows: 1,
  count: 8,
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: 0.500000,
  anchorY: 0.959677,
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: 229.0,
  inkVb: 91,
} as const;

/** 姿态名 → 格号。 */
export const GIRL_PET_POSE_CELLS = {
  stand: 0,
  sit: 1,
  curl: 2,
  look: 3,
  stretch: 4,
  run: 5,
  joy: 6,
  love: 7,
} as const;

export type GirlPoseId = keyof typeof GIRL_PET_POSE_CELLS;

/** 每格的墨框（格子像素 [x0, y0, x1, y1] 边缘坐标），alpha 实测。 */
export const GIRL_PET_POSE_INK: Record<GirlPoseId, readonly [number, number, number, number]> = {
  stand: [97, 9, 257, 239],
  sit: [85, 8, 254, 238],
  curl: [75, 9, 268, 238],
  look: [101, 8, 259, 238],
  stretch: [96, 8, 257, 238],
  run: [88, 9, 269, 239],
  joy: [69, 8, 250, 238],
  love: [97, 9, 257, 239],
};

/** 每格的脸框（格子像素 [cx, cy, w, h]），2× 网格逐格手工量；只含白脸，不含耳朵。 */
export const GIRL_PET_POSE_FACE: Record<GirlPoseId, readonly [number, number, number, number]> = {
  stand: [170, 102, 100, 78],
  sit: [167, 104, 100, 78],
  curl: [158, 122, 108, 80],
  look: [148, 104, 96, 80],
  stretch: [156, 108, 98, 80],
  run: [160, 109, 98, 80],
  joy: [160, 108, 98, 80],
  love: [170, 102, 100, 78],
};

// 由 scripts/assets/build-girl-poses.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/poses/*.jpg（用户给的 7 张高清立绘，1136×912，浅粉纯底）。
export const GIRL_HIRES = {
  src: "./pet/girl-poses",
  cellW: 340,
  cellH: 248,
  cols: 7,
  rows: 1,
  count: 7,
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: 0.500000,
  anchorY: 0.959677,
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: 229.0,
  inkVb: 91,
} as const;

/** 姿态名 → 格号。 */
export const GIRL_POSE_CELLS = {
  sitwave: 0,
  heart: 1,
  jump: 2,
  run: 3,
  stretch: 4,
  lookback: 5,
  curl: 6,
} as const;

export type GirlPoseName = keyof typeof GIRL_POSE_CELLS;

/**
 * 姿势名 → 高清姿态格名（只列有对应参考图的；其余仍取 30 格静帧表）。
 *
 * 7 张参考图对上 7 个姿势，含 `run`（奔跑）。剩下 lie / prone / wash / yawn / sleep
 * 五种是「躺着/趴着/舔爪/打哈欠/睡着」，参考图里没有同类姿态，继续走静帧表。
 */
export const GIRL_POSE_FROM_HIRES: Partial<Record<string, GirlPoseName>> = {
  sit: "sitwave",
  happy: "jump",
  stretch: "stretch",
  peek: "lookback",
  pout: "heart",
  tilt: "curl",
  run: "run",
};

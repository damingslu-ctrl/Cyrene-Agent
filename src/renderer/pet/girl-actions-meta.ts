// 由 scripts/assets/build-girl-actions.py 生成；改动作帧请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/actions/*-sheet.png（每个动作一张横向 6 帧 AI 出帧表）。
// 每个动作一条专属动画：行=动作、列=帧；同一行共用一条地线，腾空帧自然高于基线。
export const GIRL_ACTIONS = {
  src: "./pet/girl-actions.webp",
  cellW: 300,
  cellH: 400,
  cols: 6,
  rows: 3,
  count: 18,
  /** 每行的横向打包各宽各的，躯干轴（anchorX）因此逐行不同，放在 GIRL_ACTION_ROWS 里。 */
  anchorY: 0.930000,
  inkVb: 91,
} as const;

/** 动作 → 行号 / 帧数 / 播放参数 / 本行的尺与躯干轴（脸高对齐姿态图集）。 */
export const GIRL_ACTION_ROWS = {
  zoom: { row: 0, frames: 6, fps: 12, loop: true, inkRefPx: 261.1, anchorX: 0.306142 },
  stalk: { row: 1, frames: 6, fps: 6, loop: true, inkRefPx: 326.9, anchorX: 0.322956 },
  hunt: { row: 2, frames: 6, fps: 7, loop: false, inkRefPx: 275.8, anchorX: 0.439672 },
} as const;

export type GirlActionId = keyof typeof GIRL_ACTION_ROWS;

/** 每帧墨框（格子像素 [x0, y0, x1, y1]）。 */
export const GIRL_ACTION_INK: Record<GirlActionId, readonly (readonly [number, number, number, number])[]> = {
  zoom: [
    [12, 113, 206, 332],
    [17, 137, 291, 372],
    [9, 101, 253, 372],
    [9, 114, 261, 368],
    [13, 109, 278, 372],
    [9, 113, 227, 347],
  ],
  stalk: [
    [15, 189, 271, 369],
    [15, 189, 296, 372],
    [15, 188, 275, 372],
    [15, 188, 291, 358],
    [29, 163, 265, 372],
    [14, 182, 276, 372],
  ],
  hunt: [
    [14, 134, 244, 357],
    [9, 135, 226, 361],
    [14, 116, 288, 372],
    [13, 123, 291, 372],
    [13, 140, 254, 350],
    [9, 68, 223, 372],
  ],
};

/** 每帧脸框（格子像素 [cx, cy, w, h]，只含白脸与眼、不含耳朵）。 */
export const GIRL_ACTION_FACE: Record<GirlActionId, readonly (readonly [number, number, number, number])[]> = {
  zoom: [
    [71, 202, 114, 89],
    [100, 226, 114, 89],
    [86, 202, 114, 89],
    [103, 209, 114, 89],
    [119, 199, 114, 89],
    [71, 207, 114, 89],
  ],
  stalk: [
    [107, 269, 143, 111],
    [98, 274, 143, 111],
    [93, 268, 143, 111],
    [99, 267, 143, 111],
    [178, 252, 143, 111],
    [98, 271, 143, 111],
  ],
  hunt: [
    [161, 238, 120, 94],
    [164, 233, 120, 94],
    [204, 223, 120, 94],
    [113, 228, 120, 94],
    [80, 241, 120, 94],
    [85, 191, 120, 94],
  ],
};

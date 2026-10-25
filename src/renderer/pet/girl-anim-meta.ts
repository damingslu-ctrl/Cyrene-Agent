// 由 scripts/assets/build-girl-anim.py 生成；改动作区间请改那边再重跑，不要手改本文件。
// 源帧来自 src/renderer/public/pet-intro/atlas.webp（同一段开场视频的 146 帧 / 24fps）。
export const GIRL_ANIM = {
  src: "./pet/girl-anim.webp",
  cellW: 170,
  cellH: 124,
  cols: 10,
  rows: 15,
  count: 146,
  /** 躯干轴在格子里的位置（0..1）：每段动作都按它对齐过。 */
  anchorX: 0.5,
  anchorY: 0.959677,
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: 114.5,
  inkVb: 91,
} as const;

/** 帧区间闭区间 [首, 末]；16 段恰好铺满 0..145。播放参数（fps/循环）在 girl-anim.ts。 */
export const GIRL_ANIM_RANGES = {
  idle: [0, 22],
  shy: [23, 31],
  peek: [32, 39],
  sit: [40, 50],
  sitShy: [51, 63],
  walk: [64, 71],
  wink: [72, 80],
  drowse: [81, 87],
  yawn: [88, 92],
  stretch: [93, 98],
  happy: [99, 106],
  sleep: [107, 111],
  wave: [112, 128],
  peace: [129, 135],
  bow: [136, 141],
  stand: [142, 145],
} as const;

export type GirlAnimRawId = keyof typeof GIRL_ANIM_RANGES;

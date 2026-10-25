// 由 scripts/assets/build-girl-anim.py 生成；改帧号请改那边再重跑，不要手改本文件。
// 30 帧全尺寸静帧（6×5），每格 340×248；躯干轴 x=170.0、脚线 y=238。
export const GIRL_STILLS = {
  src: "girl-stills",
  cellW: 340,
  cellH: 248,
  cols: 6,
  rows: 5,
  anchorX: 0.5,
  anchorY: 0.959677,
  /** 站立帧墨高（全尺寸像素）：与桌宠图集同一条 91vb 的尺。 */
  inkRefPx: 229.0,
  inkVb: 91,
} as const;

/** 25 档散点情绪 → 静帧格号（键与 cat-sprite-manifest.ts 的 MOOD_TO_VARIANT 锁死）。 */
export const GIRL_STILL_FRAMES = {
  mood: {
    "元气": 0,
    "原生": 1,
    "学习": 2,
    "害羞": 3,
    "工作中": 4,
    "已中断": 5,
    "已处理": 6,
    "平静": 7,
    "开心": 8,
    "思考中": 9,
    "思考强度": 10,
    "感动": 11,
    "担心": 12,
    "提醒": 13,
    "撒娇": 14,
    "治愈": 15,
    "温柔": 16,
    "激动": 17,
    "知性": 18,
    "离线": 19,
    "聆听中": 20,
    "自定义": 21,
    "连接中": 22,
    "陪伴中": 23,
    "难过": 24,
  },
  /** 12 姿态 → 静帧格号。 */
  pose: {
    "sit": 2,
    "lie": 24,
    "prone": 25,
    "peek": 26,
    "stretch": 21,
    "wash": 14,
    "yawn": 27,
    "tilt": 16,
    "sleep": 28,
    "puff": 29,
    "pout": 7,
    "happy": 8,
  },
} as const;

export type GirlMoodName = keyof typeof GIRL_STILL_FRAMES.mood;
export type GirlPoseFrameName = keyof typeof GIRL_STILL_FRAMES.pose;
/** 客户端立绘的帧选择：按情绪 / 按姿态 / 参考图母版（仅欢迎页横幅）。 */
export type GirlFrame = { mood: GirlMoodName } | { pose: GirlPoseFrameName } | "master";

/** 参考图母版（唯一 1024×1536 高通量档）：墨框与脚心都在源图像素坐标里。 */
export const GIRL_MASTER = {
  src: "girl-master",
  width: 1024,
  height: 1536,
  inkX: 136,
  inkY: 80,
  inkW: 798,
  inkH: 1301,
  feetX: 492.50,
  /** 画到 viewBox 里时，全身墨高按照 91vb 摆。 */
  inkVb: 91,
} as const;

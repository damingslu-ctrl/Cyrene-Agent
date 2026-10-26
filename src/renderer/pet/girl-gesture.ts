import type { GirlPoseName } from "./girl-pose-atlas";

/**
 * v1.15.0：手势不再一律借跳舞帧。
 *
 * v1.14 给待机换上了真姿态，但「招招手/鞠躬/剪刀手/歪头/洗脸/哈欠」还是从舞蹈片段里
 * 剪出来的一小段——招手是整支舞的一个片段，读起来仍在跳舞。图集 II 画好了这些动作的
 * 单帧，这里把「手势 id → 那张画 + 举多久」表化；没有对应画的（点头/摇头/打字/发抖/
 * 跳/拍手/捂脸/喝一口）继续走帧动画，不硬套一张不像的姿态。
 */
export interface GirlGesturePose {
  pose: GirlPoseName;
  /** 这张画举多久。手势是「回你一下」，不是新待机，所以都在 1~2 秒之间。 */
  holdMs: number;
}

export const GIRL_GESTURE_POSE: Record<string, GirlGesturePose> = {
  wave: { pose: "wave", holdMs: 1_600 },
  bow: { pose: "bow", holdMs: 1_400 },
  curtsy: { pose: "bow", holdMs: 1_400 },
  point: { pose: "peace", holdMs: 1_200 },
  tilt: { pose: "tilt", holdMs: 1_600 },
  groom: { pose: "wash", holdMs: 1_800 },
  yawn: { pose: "yawn", holdMs: 1_800 },
  stretch: { pose: "stretch", holdMs: 1_400 },
};

export function gesturePoseFor(id: string): GirlGesturePose | null {
  return GIRL_GESTURE_POSE[id] ?? null;
}

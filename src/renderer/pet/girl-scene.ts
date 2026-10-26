import {
  GIRL_ANIM_FADE_MS,
  GIRL_CLIP_PLAY,
  baseClipFor,
  frameAt,
  redrawFloorFor,
  type GirlActivity,
  type GirlClipId,
} from "./girl-anim";
import { girlIdlePose, type GirlLifePhase } from "./girl-idle";
import type { GirlPoseId } from "./girl-pet-poses-meta";

/**
 * 猫娘的「这一幕」：一段帧动画，或一张真姿态静帧。
 *
 * v1.13 及以前只有帧动画，坐/趴是同一支舞压扁后的样子。v1.14 把真姿态接进来之后，
 * 待机底子变成姿态、走路/手势仍是动画，两者要共用一条交叉淡化：
 * - 切走时把**屏幕上那一格**冻住当底板（动画就冻当前帧，姿态就冻那张图），
 *   新的一幕从自己的第 0 帧开始；
 * - 淡化 160ms 与旧播放器同一个常量，画面不会出现整体透明度塌陷；
 * - 纯状态机，时间由调用方给，单测不碰 canvas。
 */

export type GirlVisual =
  | { kind: "clip"; id: GirlClipId; loop?: boolean }
  | { kind: "pose"; id: GirlPoseId };

export type GirlShown =
  | { kind: "clip"; id: GirlClipId; index: number }
  | { kind: "pose"; id: GirlPoseId };

export interface GirlSceneSample {
  current: GirlShown;
  prev: GirlShown | null;
  /** 0..1：0 时全是上一幕，1 时全是当前幕。 */
  fade: number;
}

/** 姿态是静帧，只叠很慢的呼吸；12fps 重绘就够，不必按动画片段的 24fps 烧。 */
export const GIRL_POSE_REDRAW_FPS = 12;

/** 姿态图集未就绪/损坏时的替身：回到帧动画里最接近的一段，按循环播。 */
export const GIRL_POSE_FALLBACK_CLIP: Record<GirlPoseId, GirlClipId> = {
  stand: "idle",
  sit: "sit",
  curl: "sleep",
  look: "peek",
  stretch: "stretch",
  run: "walk",
  joy: "happy",
  love: "happy",
};

/**
 * 活动 → 待机姿态。null＝这件事只能靠帧动画演（走路/梳毛/被拖…）。
 * 睡着的蜷与免打扰的站是两条硬规矩：月牙（安静）与 Zzz/睡脸（睡着）屏幕互斥。
 */
export function girlBasePoseFor(
  activity: GirlActivity,
  phase: GirlLifePhase,
  quiet: boolean,
): GirlPoseId | null {
  if (activity === "idle") return girlIdlePose(phase);
  if (activity === "rest") return "sit";
  if (activity === "sleep") return quiet ? "stand" : "curl";
  return null;
}

export interface GirlBaseVisualInput {
  activity: GirlActivity;
  phase: GirlLifePhase;
  quiet: boolean;
  posesReady: boolean;
}

/** 当前活动该以什么打底：真姿态优先，姿态图缺席时退回最接近的循环帧段。 */
export function girlBaseVisualFor(input: GirlBaseVisualInput): GirlVisual {
  const pose = girlBasePoseFor(input.activity, input.phase, input.quiet);
  if (pose) {
    return input.posesReady
      ? { kind: "pose", id: pose }
      : { kind: "clip", id: GIRL_POSE_FALLBACK_CLIP[pose], loop: true };
  }
  return { kind: "clip", id: baseClipFor(input.activity, input.quiet), loop: true };
}

type Run =
  | { kind: "clip"; id: GirlClipId; loop: boolean; startedAt: number }
  | { kind: "pose"; id: GirlPoseId; startedAt: number };

function normalize(visual: GirlVisual): Run {
  if (visual.kind === "pose") return { kind: "pose", id: visual.id, startedAt: 0 };
  return {
    kind: "clip",
    id: visual.id,
    loop: visual.loop ?? GIRL_CLIP_PLAY[visual.id].loop,
    startedAt: 0,
  };
}

export class GirlScenePlayer {
  private run: Run;
  private prev: GirlShown | null = null;

  constructor(visual: GirlVisual, nowMs: number) {
    this.run = { ...normalize(visual), startedAt: nowMs };
  }

  get visual(): GirlVisual {
    return this.run.kind === "clip"
      ? { kind: "clip", id: this.run.id, loop: this.run.loop }
      : { kind: "pose", id: this.run.id };
  }

  clipId(): GirlClipId | null {
    return this.run.kind === "clip" ? this.run.id : null;
  }

  poseId(): GirlPoseId | null {
    return this.run.kind === "pose" ? this.run.id : null;
  }

  /** 同一幕重复调用是空操作；返回 false 表示没有重启。 */
  setVisual(next: GirlVisual, nowMs: number): boolean {
    const n = normalize(next);
    let same = false;
    if (n.kind === "pose" && this.run.kind === "pose") {
      same = n.id === this.run.id;
    } else if (n.kind === "clip" && this.run.kind === "clip") {
      same = n.id === this.run.id && n.loop === this.run.loop;
    }
    if (same) return false;
    this.prev = this.shownAt(nowMs);
    this.run = { ...n, startedAt: nowMs };
    return true;
  }

  isFading(nowMs: number): boolean {
    return nowMs - this.run.startedAt < GIRL_ANIM_FADE_MS;
  }

  isDone(nowMs: number): boolean {
    if (this.run.kind !== "clip" || this.run.loop) return false;
    return frameAt(this.run.id, nowMs - this.run.startedAt, false).done;
  }

  redrawFloor(): number {
    return this.run.kind === "clip" ? redrawFloorFor(this.run.id) : GIRL_POSE_REDRAW_FPS;
  }

  sample(nowMs: number): GirlSceneSample {
    const fade = Math.max(0, Math.min(1, (nowMs - this.run.startedAt) / GIRL_ANIM_FADE_MS));
    return {
      current: this.shownAt(nowMs),
      prev: fade >= 1 ? null : this.prev,
      fade,
    };
  }

  private shownAt(nowMs: number): GirlShown {
    if (this.run.kind === "pose") return { kind: "pose", id: this.run.id };
    const f = frameAt(this.run.id, nowMs - this.run.startedAt, this.run.loop);
    return { kind: "clip", id: this.run.id, index: f.index };
  }
}

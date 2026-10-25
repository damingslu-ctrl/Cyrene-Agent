import { GIRL_ANIM, GIRL_ANIM_RANGES, type GirlAnimRawId } from "./girl-anim-meta";

/**
 * 桌宠猫娘的帧动画播放器（只做时间 → 帧号，不碰 canvas）。
 *
 * 动作设计参考 dsh-pet（MIT）：动作是一段段预渲染帧，互相之间按权重/状态切换、
 * 切换时两段交叉淡化；这里把「视频 webm」换成了同一段开场视频切出来的帧图集，
 * 因为桌宠窗只有 82×108，多帧位图比 100+ 个视频便宜得多。
 *
 * 三段时钟口径：
 * - `startedAt` 是绝对时钟（performance.now 毫秒），帧号由「经过时间 × fps」算，
 *   **不随重绘帧率走**——4fps 档只是采样稀，不会把动作播成慢动作。
 * - 一次性动作播到最后一帧就 `done`，由 renderer 切回基础动作（同样走交叉淡化）。
 * - 淡化只记「上一段当时停在哪一帧」，整段切换不重播上一段。
 */

export type GirlClipId = GirlAnimRawId;

/** 循环段怎么回头：`wrap` 从尾直接跳回首（原片是单向剪辑），`pingpong` 正放再倒放。 */
export type GirlClipLoopMode = "wrap" | "pingpong";

export interface GirlClipPlay {
  fps: number;
  /** 基础动作是否循环；手势调用会显式覆盖成一次性。 */
  loop: boolean;
  /**
   * 循环回头的方式。原片每一段的最后一帧和第一帧差得比段内任何一步都多
   * （2026-10-25 实测：接缝 53–100，段内步进 19–36），直接 wrap 会看见一次「回跳」；
   * 逐帧手绘的循环动作都用往返播放消掉这一跳，所以默认 pingpong。
   */
  loopMode?: GirlClipLoopMode;
}

/**
 * 播放节奏就是设计。
 *
 * 2026-10-25 提帧前，同一批画面按 3–10fps 播，每张画撑 100–333ms，动作就是幻灯片——
 * 那不是帧少，是时钟慢。现在按原片节拍分两档：
 * - **24fps（原速）**：一次性手势与走路。手势短、要利落；走路必须跟地面速度一致，
 *   放慢会变成原地滑步。
 * - **12fps（一拍两格）**：静息类循环（待机/坐/打盹/睡/站）。2D 手绘的常规节拍，
 *   呼吸这种幅度本来就慢，再快只是多烧重绘。
 */
export const GIRL_CLIP_PLAY: Record<GirlClipId, GirlClipPlay> = {
  idle: { fps: 12, loop: true },
  shy: { fps: 24, loop: false },
  peek: { fps: 24, loop: false },
  sit: { fps: 12, loop: true },
  sitShy: { fps: 12, loop: true },
  walk: { fps: 24, loop: true },
  wink: { fps: 24, loop: false },
  drowse: { fps: 12, loop: true },
  yawn: { fps: 24, loop: false },
  stretch: { fps: 24, loop: false },
  happy: { fps: 24, loop: false },
  sleep: { fps: 12, loop: true },
  wave: { fps: 24, loop: false },
  peace: { fps: 24, loop: false },
  bow: { fps: 24, loop: false },
  stand: { fps: 12, loop: true },
};

/**
 * 重绘下限：片段帧率的两倍，否则重绘与片段凑成拍频，看起来一顿一顿。
 *
 * 上限 30（`FPS_ACTIVE`）是产品档位：24fps 的片段已能被 30fps 重绘完整覆盖，
 * 再往上提只是烧 CPU 而没有可见收益（桌宠是常驻窗口）。
 */
export function redrawFloorFor(id: GirlClipId): number {
  return Math.min(30, Math.max(24, Math.ceil(GIRL_CLIP_PLAY[id].fps * 2)));
}

/** 交叉淡化时长：dsh-pet 的 180ms 同量级；再长会把两个姿势叠出重影。 */
export const GIRL_ANIM_FADE_MS = 160;

export function frameCount(id: GirlClipId): number {
  const [lo, hi] = GIRL_ANIM_RANGES[id];
  return hi - lo + 1;
}

export function clipDurationMs(id: GirlClipId): number {
  return (frameCount(id) * 1000) / GIRL_CLIP_PLAY[id].fps;
}

/** 帧号与动作内的时间：一次性片越过末帧后保持末帧并报 done。 */
export function frameAt(
  id: GirlClipId,
  elapsedMs: number,
  loop = GIRL_CLIP_PLAY[id].loop,
  loopMode: GirlClipLoopMode = GIRL_CLIP_PLAY[id].loopMode ?? "pingpong",
): { index: number; done: boolean } {
  const n = frameCount(id);
  const per = 1000 / GIRL_CLIP_PLAY[id].fps;
  const frames = Math.floor(Math.max(0, elapsedMs) / per);
  if (!loop) return { index: Math.min(n - 1, frames), done: frames >= n };
  if (loopMode === "wrap" || n < 2) return { index: frames % n, done: false };
  // 往返：一趟 n 帧、来回 2(n−1) 帧；端点不重复停两拍。
  const period = 2 * (n - 1);
  const phase = frames % period;
  return { index: phase < n ? phase : period - phase, done: false };
}

export interface GirlAnimFrame {
  clipId: GirlClipId;
  index: number;
}

export interface GirlAnimSample {
  clipId: GirlClipId;
  index: number;
  /** 0..1：0 时全是上一段，1 时全是当前段。 */
  fade: number;
  prev: GirlAnimFrame | null;
}

interface Run {
  clipId: GirlClipId;
  startedAt: number;
  loop: boolean;
}

/** 纯状态机：所有时间由调用方给，单测可以在 node 里跑。 */
export class GirlClipPlayer {
  private run: Run;
  private prev: GirlAnimFrame | null = null;

  constructor(clipId: GirlClipId = "idle", nowMs = 0, loop = GIRL_CLIP_PLAY[clipId].loop) {
    this.run = { clipId, startedAt: nowMs, loop };
  }

  get clipId(): GirlClipId {
    return this.run.clipId;
  }

  get looping(): boolean {
    return this.run.loop;
  }

  /** 硬重置（切形态/重开时用）：不冻上一帧，下一帧直接就是新段的第一帧。 */
  reset(clipId: GirlClipId = "idle", nowMs = 0, loop = GIRL_CLIP_PLAY[clipId].loop): void {
    this.prev = null;
    this.run = { clipId, startedAt: nowMs, loop };
  }

  /** 切段：把上一段**当前那一帧**冻住当淡化底板；同一段重复调用是空操作。 */
  setClip(clipId: GirlClipId, nowMs: number, loop = GIRL_CLIP_PLAY[clipId].loop): boolean {
    if (this.run.clipId === clipId && this.run.loop === loop) return false;
    const frozen = frameAt(this.run.clipId, nowMs - this.run.startedAt, this.run.loop);
    this.prev = { clipId: this.run.clipId, index: frozen.index };
    this.run = { clipId, startedAt: nowMs, loop };
    return true;
  }

  isDone(nowMs: number): boolean {
    return frameAt(this.run.clipId, nowMs - this.run.startedAt, this.run.loop).done;
  }

  isFading(nowMs: number): boolean {
    return nowMs - this.run.startedAt < GIRL_ANIM_FADE_MS;
  }

  sample(nowMs: number): GirlAnimSample {
    const f = frameAt(this.run.clipId, nowMs - this.run.startedAt, this.run.loop);
    const fade = Math.max(0, Math.min(1, (nowMs - this.run.startedAt) / GIRL_ANIM_FADE_MS));
    return { clipId: this.run.clipId, index: f.index, fade, prev: fade >= 1 ? null : this.prev };
  }
}

// ===========================================================================
// 状态映射：companion 的活动/手势 → 帧动作段
// ===========================================================================

export type GirlActivity =
  | "idle" | "walk" | "groom" | "yawn" | "stretch" | "tilt"
  | "sleep" | "pet" | "eat" | "play" | "rest" | "drag" | "thrown";

/**
 * 基础动作（一遍一遍循环）。groom/yawn/stretch/tilt 在帧图集里各有一整段，
 * 不再靠通道摆姿势；drag/thrown 用「双手举高」那段，配 renderer 的刚体倾斜。
 */
export const ACTIVITY_CLIP: Record<GirlActivity, GirlClipId> = {
  idle: "idle",
  walk: "walk",
  groom: "wink",
  yawn: "yawn",
  stretch: "stretch",
  tilt: "peek",
  sleep: "sleep",
  pet: "happy",
  eat: "happy",
  play: "wave",
  rest: "sit",
  drag: "stretch",
  thrown: "stretch",
};

export function baseClipFor(activity: GirlActivity, quiet: boolean): GirlClipId {
  // 免打扰时月牙是唯一记号，不许用闭眼睡觉的帧冒充（native #67 同一条规矩）。
  if (quiet && activity === "sleep") return "idle";
  return ACTIVITY_CLIP[activity] ?? "idle";
}

/**
 * 18 个手势 → 段。没有对应动作的（点头/摇头）借「凑近看」那段：
 * 帧图集里没有头部独立的帧，任何硬凑都比「整身靠过去」更像在回应。
 */
export const GESTURE_CLIP: Record<string, GirlClipId> = {
  wave: "wave",
  bow: "bow",
  nod: "peek",
  shake: "peek",
  hop: "stretch",
  tilt: "peek",
  typeCode: "wink",
  peek: "peek",
  shiver: "wink",
  stretch: "stretch",
  yawn: "yawn",
  groom: "wink",
  curtsy: "bow",
  clap: "happy",
  coverFace: "shy",
  point: "peace",
  sip: "yawn",
  turnAway: "peek",
};

export function gestureClipFor(id: string): GirlClipId | null {
  return GESTURE_CLIP[id] ?? null;
}

/** 图集帧号 → 图集源矩形。 */
export function frameSourceRect(index: number): { sx: number; sy: number; sw: number; sh: number } {
  const i = Math.max(0, Math.min(GIRL_ANIM.count - 1, Math.floor(index)));
  return {
    sx: (i % GIRL_ANIM.cols) * GIRL_ANIM.cellW,
    sy: Math.floor(i / GIRL_ANIM.cols) * GIRL_ANIM.cellH,
    sw: GIRL_ANIM.cellW,
    sh: GIRL_ANIM.cellH,
  };
}

import type { Expression } from "./face";

/**
 * 分层演出内核（v1.5.0 P2 Task 12）。
 *
 * 姿态不再由「活动名 if 链」逐个字段给值，而是每层采样一条 clip 轨道：
 * body / gesture / face 三层各写各的通道，`mixPose` 按 priority 合并。
 *
 * 纯度（R-D9）：本文件不读时钟。`p` 由调用方用绝对时钟算好再传进来，
 * 所有形状算子（`Env`）只把 `p` 变成数。
 */

export type MotionLayer = "body" | "gesture" | "face";

/** 15 条通道。单位见下方注释——两套口径不许在同一个数上混用。 */
export type Channel =
  | "armL" | "armR" | "legL" | "legR"
  | "headYaw" | "headPitch" | "headBob"
  | "lean" | "hop" | "squash" | "hem" | "tail"
  | "earL" | "earR" | "hand";

export const CHANNELS: readonly Channel[] = [
  "armL", "armR", "legL", "legR", "headYaw", "headPitch", "headBob",
  "lean", "hop", "squash", "hem", "tail", "earL", "earR", "hand",
];

export type Channels = Partial<Record<Channel, number>>;

export interface Env {
  /** smoothstep p²(3−2p)：端点 0/1、中点 0.5、单调。 */
  ease(p: number): number;
  /** 起落包络 |sin(π·p·cycles)|：两头 0，每个 cycle 一个峰。 */
  pulse(p: number, cycles?: number): number;
  /** 硬边开关：p >= at 返回 1。 */
  step(p: number, at: number): number;
}

const clampP = (p: number, who: string): number => {
  if (!Number.isFinite(p)) throw new RangeError(`${who} 的 p 必须是有限数，收到：${p}`);
  return p < 0 ? 0 : p > 1 ? 1 : p;
};

export const ENV: Env = {
  ease: (p) => {
    const q = clampP(p, "ease");
    return q * q * (3 - 2 * q);
  },
  pulse: (p, cycles = 1) => {
    if (!Number.isInteger(cycles) || cycles < 1) {
      throw new RangeError(`pulse 的 cycles 是正整数，收到：${cycles}`);
    }
    return Math.abs(Math.sin(Math.PI * clampP(p, "pulse") * cycles));
  },
  step: (p, at) => {
    if (!Number.isFinite(at) || at < 0 || at > 1) {
      throw new RangeError(`step 的 at 必须在 0..1，收到：${at}`);
    }
    return clampP(p, "step") >= at ? 1 : 0;
  },
};

export interface Clip {
  id: string;
  layer: MotionLayer;
  /** 周期或时长（ms）。lasting 片读作周期，一次性片读作时长。 */
  ms: number;
  lasting?: boolean;
  priority: 0 | 1 | 2 | 3;
  /** 出片后回到的姿态：**键集必须等于 tracks 键集**（尺 #73 的前提）。 */
  rest: Channels;
  tracks: Partial<Record<Channel, (p: number, env: Env) => number>>;
  face?: Expression;
}

export function sampleClip(clip: Clip, p: number): Channels {
  const q = clampP(p, `sampleClip(${clip.id})`);
  const out: Channels = {};
  for (const [ch, fn] of Object.entries(clip.tracks) as Array<[Channel, (p: number, env: Env) => number]>) {
    const v = fn(q, ENV);
    if (!Number.isFinite(v)) throw new RangeError(`clip ${clip.id} 的 ${ch} 在 p=${q} 产出非有限值：${v}`);
    out[ch] = v;
  }
  return out;
}

/** 合并语义：注册一条就加一条，同名覆盖；测试 fixture 不许擦掉运行时真表。 */
const REGISTRY = new Map<string, Clip>();

export function registerClips(clips: readonly Clip[]): void {
  for (const c of clips) REGISTRY.set(c.id, c);
}

export function clipById(id: string): Clip {
  const c = REGISTRY.get(id);
  if (!c) throw new Error(`未知 clip：${id}`);
  return c;
}

export function allClips(): Clip[] {
  return [...REGISTRY.values()];
}

/** 同一 id、不同 priority 的副本（层内仲裁用）。 */
export function withPriority(clip: Clip, p: Clip["priority"]): Clip {
  return { ...clip, priority: p };
}

export type Slots = Partial<Record<MotionLayer, { clip: Clip; p: number }>>;

/**
 * 按层合并：**同通道高 priority 赢**；同 priority 时后写的层赢（body → gesture → face 的声明序）。
 * 不校验 track 键集——那是尺 #73 的事，这里只做合并。
 */
export function mixPose(slots: Slots): Channels {
  const out: Channels = {};
  const owner: Partial<Record<Channel, number>> = {};
  const order: MotionLayer[] = ["body", "gesture", "face"];
  order.forEach((layer, layerIndex) => {
    const slot = slots[layer];
    if (!slot) return;
    const chans = sampleClip(slot.clip, slot.p);
    for (const [ch, v] of Object.entries(chans) as Array<[Channel, number]>) {
      const pri = slot.clip.priority;
      const prev = owner[ch];
      if (prev === undefined || pri > prev || (pri === prev && layerIndex >= 0)) {
        out[ch] = v;
        owner[ch] = pri;
      }
    }
  });
  return out;
}

/** 50 ms 的帧距上限：只用在缓动状态变量上，**不准**用来推 clip 进度。 */
export const DT_CAP_MS = 50;

export function capDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs < 0) return 0;
  return Math.min(dtMs, DT_CAP_MS);
}

/** 指数逼近：单调、不超调（`1 - e^{-rate·dt}` 的线性化）。 */
export function springStep(current: number, target: number, rate: number, dtMs: number): number {
  const dt = capDt(dtMs) / 1000;
  if (dt <= 0) return current;
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

export const BLINK_PERIOD_S = 4.2;
export const BLINK_MS = 260;

/** 眨眼的包络：周期 4.2s，每次 260ms 闭合再睁开。返回 0..1。 */
export function blinkAt(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const phase = ((t % BLINK_PERIOD_S) + BLINK_PERIOD_S) % BLINK_PERIOD_S;
  const half = BLINK_MS / 2000;
  if (phase >= half * 2) return 0;
  return Math.sin((Math.PI * phase) / (half * 2));
}

// ===========================================================================
// CLIPS 表（Task 13）：body 12 + 手势种子 9
// 数值就是设计：改一个数＝改观感。每条 p=0 / p=1 必须落回 rest（尺 #73）。
// ===========================================================================

const BODY: Clip[] = [
  { id: "stand", layer: "body", ms: 4200, lasting: true, priority: 0,
    rest: { lean: 0.015, headBob: 0, hem: 0, armL: 0.05, armR: -0.05, tail: 0 },
    tracks: {
      lean: () => 0.015,
      headBob: (p, e) => -1.1 * e.pulse(p),
      hem: (p, e) => 0.05 * e.pulse(p),
      armL: () => 0.05, armR: () => -0.05,
      tail: (p, e) => 0.12 * e.pulse(p),
    }, face: "neutral" },
  { id: "walk", layer: "body", ms: 640, lasting: true, priority: 0,
    rest: { legL: 0, legR: 0, armL: 0, armR: 0, headBob: 0, lean: 0.03, hem: 0 },
    tracks: {
      legL: (p) => 0.42 * Math.sin(2 * Math.PI * p),
      legR: (p) => -0.42 * Math.sin(2 * Math.PI * p),
      armL: (p) => -0.26 * Math.sin(2 * Math.PI * p),
      armR: (p) => 0.26 * Math.sin(2 * Math.PI * p),
      headBob: (p, e) => -1.6 * e.pulse(p, 2),
      lean: () => 0.03,
      hem: (p, e) => 0.14 * e.pulse(p, 2),
    } },
  { id: "run", layer: "body", ms: 380, lasting: true, priority: 0,
    rest: { legL: 0, legR: 0, armL: 0, armR: 0, headBob: 0, lean: 0.10, hem: 0, squash: 0 },
    tracks: {
      legL: (p) => 0.62 * Math.sin(2 * Math.PI * p),
      legR: (p) => -0.62 * Math.sin(2 * Math.PI * p),
      armL: (p) => -0.45 * Math.sin(2 * Math.PI * p),
      armR: (p) => 0.45 * Math.sin(2 * Math.PI * p),
      headBob: (p, e) => -2.4 * e.pulse(p, 2),
      lean: () => 0.10,
      hem: (p, e) => 0.24 * e.pulse(p, 2),
      squash: (p, e) => 0.10 * e.pulse(p, 2),
    } },
  { id: "sit", layer: "body", ms: 3000, lasting: true, priority: 0,
    rest: { legL: 1.15, legR: 1.15, headBob: 0, hem: 0.10, lean: 0.02, armL: 0.04, armR: -0.04 },
    tracks: {
      legL: () => 1.15, legR: () => 1.15,
      headBob: (p, e) => -0.8 * e.pulse(p),
      hem: () => 0.10, lean: () => 0.02, armL: () => 0.04, armR: () => -0.04,
    }, face: "neutral" },
  { id: "kneel", layer: "body", ms: 2600, lasting: true, priority: 0,
    rest: { legL: 1.45, legR: 1.52, headPitch: 0.10, hem: 0.16, lean: 0.06, armL: 0.30, armR: 0.30 },
    tracks: {
      legL: () => 1.45, legR: () => 1.52,
      headPitch: (p, e) => 0.10 + 0.03 * e.pulse(p),
      hem: () => 0.16, lean: () => 0.06, armL: () => 0.30, armR: () => 0.30,
    }, face: "shy" },
  { id: "drowse", layer: "body", ms: 3000, lasting: true, priority: 0,
    rest: { headPitch: 0.14, headBob: 0, legL: 1.15, legR: 1.15, earL: -0.12, earR: -0.12, hem: 0.08, lean: 0.05 },
    tracks: {
      headPitch: (p, e) => 0.14 + 0.10 * e.pulse(p, 2),
      headBob: (p, e) => -1.0 * e.pulse(p),
      legL: () => 1.15, legR: () => 1.15, earL: () => -0.12, earR: () => -0.12,
      hem: () => 0.08, lean: () => 0.05,
    }, face: "sleepy" },
  { id: "sleep", layer: "body", ms: 4800, lasting: true, priority: 0,
    rest: { headPitch: 0.30, lean: 0.16, headBob: 0, legL: 0.95, legR: 0.95, earL: -0.20, earR: -0.20, hem: 0.06, tail: 0 },
    tracks: {
      headPitch: () => 0.30, lean: () => 0.16,
      headBob: (p, e) => -1.6 * e.pulse(p),
      legL: () => 0.95, legR: () => 0.95, earL: () => -0.20, earR: () => -0.20,
      hem: () => 0.06, tail: (p, e) => 0.06 * e.pulse(p),
    }, face: "sleepy" },
  { id: "crouch", layer: "body", ms: 420, priority: 2,
    rest: { squash: 0, hem: 0, headBob: 0, legL: 0, legR: 0, lean: 0 },
    tracks: {
      squash: (p, e) => 0.55 * e.pulse(p),
      hem: (p, e) => -0.18 * e.pulse(p),
      headBob: (p, e) => 2.2 * e.pulse(p),
      legL: (p, e) => 0.50 * e.pulse(p), legR: (p, e) => 0.50 * e.pulse(p),
      lean: (p, e) => 0.08 * e.pulse(p),
    }, face: "surprised" },
  { id: "drag", layer: "body", ms: 900, lasting: true, priority: 3,
    rest: { armL: -0.90, armR: -0.90, legL: 0.50, legR: 0.50, lean: 0, hem: 0.35, headPitch: 0.12 },
    tracks: {
      armL: () => -0.90, armR: () => -0.90,
      legL: (p, e) => 0.50 + 0.10 * e.pulse(p, 2),
      legR: (p, e) => 0.50 - 0.10 * e.pulse(p, 2),
      lean: () => 0, hem: (p, e) => 0.35 + 0.12 * e.pulse(p, 3), headPitch: () => 0.12,
    }, face: "worried" },
  { id: "thrown", layer: "body", ms: 700, lasting: true, priority: 3,
    rest: { lean: -0.25, armL: -1.20, armR: -1.20, legL: -0.30, legR: -0.30, hem: 0.50, headPitch: -0.10 },
    tracks: {
      lean: (p, e) => -0.25 + 0.06 * e.pulse(p, 2),
      armL: () => -1.20, armR: () => -1.20,
      legL: (p, e) => -0.30 + 0.12 * e.pulse(p, 2),
      legR: (p, e) => -0.30 - 0.12 * e.pulse(p, 2),
      hem: (p, e) => 0.50 + 0.20 * e.pulse(p, 2), headPitch: () => -0.10,
    }, face: "surprised" },
  { id: "air", layer: "body", ms: 260, priority: 3,
    rest: { hop: 0, squash: 0, hem: 0, legL: 0, legR: 0, lean: 0 },
    tracks: {
      hop: (p, e) => -12 * e.pulse(p),
      squash: (p, e) => 0.12 * e.pulse(p),
      hem: (p, e) => 0.45 * e.pulse(p),
      legL: (p, e) => -0.30 * e.pulse(p), legR: (p, e) => -0.30 * e.pulse(p),
      lean: (p, e) => -0.10 * e.pulse(p),
    } },
  { id: "land", layer: "body", ms: 320, priority: 3,
    rest: { hop: 0, squash: 0, hem: 0, headBob: 0, legL: 0, legR: 0 },
    tracks: {
      hop: () => 0,
      squash: (p, e) => 0.62 * e.pulse(p),
      hem: (p, e) => -0.25 * e.pulse(p),
      headBob: (p, e) => 2.0 * e.pulse(p),
      legL: (p, e) => 0.34 * e.pulse(p), legR: (p, e) => 0.34 * e.pulse(p),
    } },
];

/** Task 13 先落 9 条；typeCode/peek/shiver 是 Task 14/18 的依赖，缺一条就当场抛。 */
const GESTURE: Clip[] = [
  { id: "wave", layer: "gesture", ms: 2000, priority: 0,
    rest: { armR: -1.15, hand: 0.60, headYaw: 0 },
    tracks: {
      armR: (p) => -1.15 + 0.28 * Math.sin(2 * Math.PI * 3 * p),
      hand: (p, e) => 0.60 + 0.30 * e.pulse(p, 3),
      headYaw: (p, e) => 0.08 * e.pulse(p),
    }, face: "happy" },
  { id: "bow", layer: "gesture", ms: 2200, priority: 0,
    rest: { lean: 0, headPitch: 0, hem: 0, armL: 0, armR: 0 },
    tracks: {
      lean: (p, e) => 0.32 * e.pulse(p),
      headPitch: (p, e) => 0.18 * e.pulse(p),
      hem: (p, e) => 0.20 * e.pulse(p),
      armL: (p, e) => -0.15 * e.pulse(p), armR: (p, e) => -0.15 * e.pulse(p),
    }, face: "happy" },
  { id: "nod", layer: "gesture", ms: 1800, priority: 0,
    rest: { headPitch: 0, headBob: 0 },
    tracks: { headPitch: (p, e) => 0.16 * e.pulse(p, 2), headBob: (p, e) => -0.6 * e.pulse(p, 2) },
    face: "neutral" },
  { id: "shake", layer: "gesture", ms: 1800, priority: 0,
    rest: { headYaw: 0, lean: 0 },
    tracks: { headYaw: (p) => 0.24 * Math.sin(2 * Math.PI * 4 * p), lean: (p) => 0.02 * Math.sin(2 * Math.PI * 2 * p) },
    face: "angry" },
  { id: "hop", layer: "gesture", ms: 1800, priority: 2,
    rest: { hop: 0, squash: 0, hem: 0, legL: 0, legR: 0 },
    tracks: {
      hop: (p, e) => -14 * e.pulse(p),
      squash: (p, e) => 0.22 * e.pulse(p, 2),
      hem: (p, e) => 0.30 * e.pulse(p),
      legL: (p, e) => -0.36 * e.pulse(p), legR: (p, e) => -0.36 * e.pulse(p),
    }, face: "excited" },
  { id: "tilt", layer: "gesture", ms: 2000, priority: 0,
    rest: { headYaw: 0, lean: 0, earL: 0, earR: 0, hem: 0 },
    tracks: {
      headYaw: (p, e) => 0.20 * e.pulse(p),
      lean: (p, e) => 0.06 * e.pulse(p),
      earL: (p, e) => 0.15 * e.pulse(p), earR: (p, e) => -0.10 * e.pulse(p),
      hem: (p, e) => 0.06 * e.pulse(p),
    }, face: "confused" },
  { id: "typeCode", layer: "gesture", ms: 900, priority: 1, lasting: true,
    rest: { armL: -0.52, armR: -0.52, headPitch: 0.12, hand: 0, headBob: 0 },
    tracks: {
      armL: () => -0.52, armR: () => -0.52, headPitch: () => 0.12,
      hand: (p) => 0.5 * Math.abs(Math.sin(2 * Math.PI * 2 * p)),
      headBob: (p, e) => -0.8 * e.pulse(p, 2),
    }, face: "smug" },
  { id: "peek", layer: "gesture", ms: 2600, priority: 1, lasting: true,
    rest: { lean: 0, headYaw: 0, hand: 0.0, earL: 0, earR: 0 },
    tracks: {
      lean: (p, e) => 0.10 * e.pulse(p),
      headYaw: (p, e) => 0.24 * e.pulse(p),
      hand: (p, e) => 0.30 * e.pulse(p, 2),
      earL: (p, e) => 0.18 * e.pulse(p), earR: (p, e) => -0.12 * e.pulse(p),
    }, face: "surprised" },
  { id: "shiver", layer: "gesture", ms: 1800, priority: 0,
    rest: { lean: -0.05, headYaw: 0, hem: 0, earL: 0, earR: 0 },
    tracks: {
      lean: (p) => -0.05 + 0.03 * Math.sin(2 * Math.PI * 6 * p),
      headYaw: (p) => 0.07 * Math.sin(2 * Math.PI * 8 * p),
      hem: (p) => 0.05 * Math.sin(2 * Math.PI * 8 * p),
      earL: (p) => 0.20 * Math.sin(2 * Math.PI * 7 * p), earR: (p) => -0.20 * Math.sin(2 * Math.PI * 7 * p),
    }, face: "sad" },
];

export const CLIPS: readonly Clip[] = [...BODY, ...GESTURE];

/** spec §5/§6 的 18 个手势名，一次钉全；本任务落地其中 9 条 clip。 */
export const GESTURE_IDS = [
  "nod", "shake", "wave", "bow", "hop", "shiver", "stretch", "yawn", "groom", "tilt",
  "curtsy", "clap", "coverFace", "peek", "point", "sip", "typeCode", "turnAway",
] as const;

registerClips(CLIPS);

function clipInLayer(layer: MotionLayer, id: string): Clip {
  const c = clipById(id);
  if (c.layer !== layer) throw new Error(`clip ${id} 不在 ${layer} 层（它属于 ${c.layer}）`);
  return c;
}
export function bodyClip(id: string): Clip { return clipInLayer("body", id); }
export function gestureClip(id: string): Clip { return clipInLayer("gesture", id); }

/** 已注册的 gesture clip id，**字典序**（抽取要可复现，不能跟着 Set 的插入序漂）。 */
export function gestureIds(): string[] {
  return allClips().filter((c) => c.layer === "gesture").map((c) => c.id).sort();
}

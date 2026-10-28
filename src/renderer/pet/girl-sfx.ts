/**
 * 合成音层档位：桌宠不出声音则由这一层给出「该响什么、几音、多响」的谱，
 * 渲染器只管按谱发声。这里没有 Web Audio，也没有 DOM——单测能穷举所有事件。
 *
 * 三条硬规矩：
 * 1) 静音或零音量必须给空谱（不许「音量 0 但仍在排音」，那是白烧 CPU）；
 * 2) 音高按半音走，连击升调有封顶（第 8 档以后不许再尖）；
 * 3) 出声要过节流：同类事件有各自窗口，同一拍全局最多三声，多余的直接咽掉。
 */
export type SfxVoice = "sine" | "triangle" | "square" | "sawtooth";
export const SFX_VOICES: readonly SfxVoice[] = ["sine", "triangle", "square", "sawtooth"];

export type SfxEvent =
  | "bounce" | "pat-off"
  | "cast" | "nibble" | "catch" | "empty" | "escape"
  | "flare" | "moth"
  | "combo-step" | "combo-final"
  | "match" | "wrong";

export const SFX_EVENTS: readonly SfxEvent[] = [
  "bounce", "pat-off",
  "cast", "nibble", "catch", "empty", "escape",
  "flare", "moth",
  "combo-step", "combo-final",
  "match", "wrong",
];

/** 归一化前的峰值增益：渲染器再乘一次总输出即可。 */
export const SFX_MAX_GAIN = 0.5;
/** 连击升调封顶在第几档。 */
export const SFX_STEP_CAP = 8;
/** 全局同窗最多几出声。 */
export const SFX_VOICE_CAP = 3;
export const SFX_GLOBAL_WINDOW_MS = 200;

export interface SfxNote {
  /** 相对发声起点的偏移（毫秒），单调不减。 */
  at: number;
  freq: number;
  /** 音长（毫秒）。 */
  dur: number;
  gain: number;
  voice: SfxVoice;
}

export interface SfxOptions {
  volume: number;
  muted: boolean;
  /** 连击档位：越大越亮，封顶 SFX_STEP_CAP。 */
  step?: number;
}

interface SfxRecipe {
  /** 基准半音（A4=0）。 */
  semi: number;
  /** 每档连击升多少半音。 */
  stepShift: number;
  notes: ReadonlyArray<{ at: number; dur: number; gain: number; voice: SfxVoice; offset: number }>;
}

const RECIPES: Record<SfxEvent, SfxRecipe> = {
  bounce: {
    semi: -5,
    stepShift: 2,
    notes: [{ at: 0, dur: 90, gain: 0.34, voice: "triangle", offset: 0 }],
  },
  "pat-off": {
    semi: -17,
    stepShift: 0,
    notes: [{ at: 0, dur: 150, gain: 0.2, voice: "sawtooth", offset: 0 }],
  },
  cast: {
    semi: -12,
    stepShift: 0,
    notes: [
      { at: 0, dur: 120, gain: 0.18, voice: "triangle", offset: 7 },
      { at: 90, dur: 150, gain: 0.22, voice: "sine", offset: 0 },
    ],
  },
  nibble: {
    semi: -3,
    stepShift: 0,
    notes: [{ at: 0, dur: 50, gain: 0.16, voice: "square", offset: 0 }],
  },
  catch: {
    semi: -5,
    stepShift: 1,
    notes: [
      { at: 0, dur: 90, gain: 0.26, voice: "triangle", offset: 0 },
      { at: 70, dur: 90, gain: 0.24, voice: "triangle", offset: 4 },
      { at: 140, dur: 220, gain: 0.3, voice: "sine", offset: 7 },
    ],
  },
  empty: {
    semi: -8,
    stepShift: 0,
    notes: [
      { at: 0, dur: 120, gain: 0.2, voice: "sine", offset: 0 },
      { at: 110, dur: 200, gain: 0.16, voice: "sine", offset: -5 },
    ],
  },
  escape: {
    semi: -10,
    stepShift: 0,
    notes: [
      { at: 0, dur: 80, gain: 0.22, voice: "triangle", offset: 0 },
      { at: 60, dur: 180, gain: 0.18, voice: "sawtooth", offset: 9 },
    ],
  },
  flare: {
    semi: 4,
    stepShift: 0,
    notes: [{ at: 0, dur: 260, gain: 0.24, voice: "sine", offset: 0 }],
  },
  moth: {
    semi: 16,
    stepShift: 0,
    notes: [{ at: 0, dur: 40, gain: 0.1, voice: "square", offset: 0 }],
  },
  "combo-step": {
    semi: 0,
    stepShift: 2,
    notes: [{ at: 0, dur: 110, gain: 0.22, voice: "triangle", offset: 0 }],
  },
  "combo-final": {
    semi: -5,
    stepShift: 0,
    notes: [
      { at: 0, dur: 100, gain: 0.22, voice: "triangle", offset: 0 },
      { at: 80, dur: 100, gain: 0.22, voice: "triangle", offset: 4 },
      { at: 160, dur: 100, gain: 0.24, voice: "triangle", offset: 7 },
      { at: 240, dur: 340, gain: 0.3, voice: "sine", offset: 12 },
      { at: 300, dur: 260, gain: 0.16, voice: "sine", offset: 16 },
    ],
  },
  match: {
    semi: 2,
    stepShift: 1,
    notes: [
      { at: 0, dur: 80, gain: 0.2, voice: "sine", offset: 0 },
      { at: 60, dur: 140, gain: 0.24, voice: "sine", offset: 5 },
    ],
  },
  wrong: {
    semi: -14,
    stepShift: 0,
    notes: [{ at: 0, dur: 180, gain: 0.14, voice: "square", offset: 0 }],
  },
};

/** 同类事件各自的窗口：越琐碎的事越要压得狠。 */
export const SFX_COOLDOWN_MS: Partial<Record<SfxEvent, number>> = {
  bounce: 180,
  "pat-off": 260,
  cast: 500,
  nibble: 120,
  catch: 220,
  empty: 400,
  escape: 400,
  flare: 240,
  moth: 200,
  "combo-step": 120,
  "combo-final": 900,
  match: 140,
  wrong: 220,
};

function hz(semi: number): number {
  return 440 * Math.pow(2, semi / 12);
}

/**
 * 按谱出音。任何一处输入不干净（NaN/负音量/未知事件）都给空谱：
 * 声音是锦上添花，不许因为它把渲染器带崩。
 */
export function planSfx(event: SfxEvent, opts: SfxOptions): SfxNote[] {
  const recipe = RECIPES[event];
  if (!recipe) return [];
  if (opts.muted) return [];
  if (!Number.isFinite(opts.volume) || opts.volume <= 0) return [];
  const stepRaw = opts.step ?? 0;
  if (!Number.isFinite(stepRaw)) return [];
  const step = Math.max(0, Math.min(SFX_STEP_CAP, Math.floor(stepRaw)));
  const shift = step * recipe.stepShift;
  const notes: SfxNote[] = [];
  for (const row of recipe.notes) {
    const freq = hz(recipe.semi + shift + row.offset);
    const gain = Math.min(SFX_MAX_GAIN, row.gain * opts.volume);
    if (!Number.isFinite(freq) || freq <= 60 || freq >= 6_000) continue;
    if (gain <= 0) continue;
    notes.push({ at: row.at, freq, dur: row.dur, gain, voice: row.voice });
  }
  return notes.sort((a, b) => a.at - b.at);
}

export interface SfxBudget {
  /** 每个事件上次出声的时刻。 */
  lastAt: Partial<Record<SfxEvent, number>>;
  /** 最近出声的时间戳（用于全局同窗限流）。 */
  recent: number[];
}

export function createSfxBudget(now: number): SfxBudget {
  void now;
  return { lastAt: {}, recent: [] };
}

/**
 * 该不该出声。时间倒流（换段、探针重放、系统改钟）不许把闸门锁死：
 * 只算「正向流逝」的间隔，倒退一律放行。
 */
export function sfxAllow(budget: SfxBudget, event: SfxEvent, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const cooldown = SFX_COOLDOWN_MS[event] ?? 180;
  const last = budget.lastAt[event];
  if (last !== undefined && now >= last && now - last < cooldown) return false;
  budget.recent = budget.recent.filter((at) => now - at >= 0 && now - at <= SFX_GLOBAL_WINDOW_MS);
  if (budget.recent.length >= SFX_VOICE_CAP) return false;
  budget.lastAt[event] = now;
  budget.recent.push(now);
  return true;
}

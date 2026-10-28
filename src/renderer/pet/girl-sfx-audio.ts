/**
 * 声音输出层：把 `girl-sfx` 排好的谱交给 Web Audio 真的响出来。
 *
 * 这一层只做三件事：按 `at` 排起跳时刻、给一颗从 0 起再回 0 的包络（免爆音）、
 * 以及**任何一处不干净就整条咽下**。声音是锦上添花，不许因为它把渲染器带崩——
 * 建不出上下文（本机没有 Web Audio）与上下文挂起（还没收到可信手势）都只哑不掉。
 */
import type { SfxEvent, SfxNote } from "./girl-sfx";

/** 从静音爬到峰值要这么久：直接给满值就是一声咔。 */
const ATTACK_S = 0.012;
/** 收尾留出的释放段（拿不到就把峰值后一毫秒当释放点）。 */
const RELEASE_S = 0.04;

export interface GainLike {
  gain: {
    value: number;
    setValueAtTime(value: number, at: number): void;
    linearRampToValueAtTime(value: number, at: number): void;
  };
  connect(dest: unknown): void;
}

export interface OscillatorLike {
  type: string;
  frequency: { value: number };
  connect(dest: unknown): void;
  start(at: number): void;
  stop(at: number): void;
}

/** 用得上的那几列：测试的假货只实现这些，生产传 Web Audio 的原生上下文进来。 */
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): void;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

/** 渲染器的出声口：带上事件名是为了让「该响什么」在测试与探针里可核对。 */
export interface SfxSink {
  play(event: SfxEvent, notes: readonly SfxNote[]): void;
}

export interface SfxAudioOutput extends SfxSink {
  /** 首次可信手势里调一次：把挂起的上下文唤回来。哑着的音不会补放。 */
  unlock(): void;
}

/** 浏览器里的建法：没有 AudioContext（老内核/隐私档）就给 null，上层一律哑掉。 */
export function browserAudioContext(): AudioContextLike | null {
  const Ctor = (globalThis as { AudioContext?: unknown }).AudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    return new (Ctor as new () => AudioContextLike)();
  } catch {
    return null;
  }
}

function usable(note: SfxNote): boolean {
  if (!Number.isFinite(note.at) || note.at < 0) return false;
  if (!Number.isFinite(note.dur) || note.dur <= 0) return false;
  if (!Number.isFinite(note.freq) || note.freq <= 0) return false;
  if (!Number.isFinite(note.gain) || note.gain <= 0) return false;
  return true;
}

/**
 * 建一个出声口。`makeContext` 只调一次就记住结果（含 null）：
 * 每颗音都重试建上下文，等于在没有音频的内核上每帧白烧一次。
 */
export function createSfxAudioOutput(makeContext: () => AudioContextLike | null): SfxAudioOutput {
  let cached: AudioContextLike | null | undefined;
  const ensure = (): AudioContextLike | null => {
    if (cached === undefined) cached = makeContext();
    return cached;
  };
  return {
    play(event, notes) {
      void event;
      if (notes.length === 0) return;
      const ctx = ensure();
      if (!ctx || ctx.state !== "running") return;
      for (const note of notes) {
        if (!usable(note)) continue;
        const start = ctx.currentTime + note.at / 1000;
        const end = start + note.dur / 1000;
        const peak = Math.min(start + ATTACK_S, end);
        const release = Math.min(Math.max(peak + 0.001, end - RELEASE_S), end);
        try {
          const gain = ctx.createGain();
          const osc = ctx.createOscillator();
          osc.type = note.voice;
          osc.frequency.value = note.freq;
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(note.gain, peak);
          gain.gain.linearRampToValueAtTime(0, release);
          osc.start(start);
          osc.stop(end);
        } catch {
          // 一颗音建崩了就跳过它：下一颗照响，渲染器一概不知。
        }
      }
    },
    unlock() {
      const ctx = ensure();
      if (ctx && ctx.state !== "running") ctx.resume();
    },
  };
}

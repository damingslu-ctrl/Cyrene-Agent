// v1.18 声音输出层：把 girl-sfx 的谱变成真的振荡器。这里没有渲染器，只验「按谱出音」这一件事。
import { describe, expect, it } from "vitest";
import { planSfx, type SfxEvent, type SfxNote } from "./girl-sfx";
import { createSfxAudioOutput, type AudioContextLike, type GainLike, type OscillatorLike } from "./girl-sfx-audio";

class FakeGain implements GainLike {
  /** 排进去的包络点（值 + 时刻），按调用先后记。 */
  steps: Array<{ value: number; at: number }> = [];
  ramps: Array<{ value: number; at: number }> = [];
  connected: unknown = null;
  gain = {
    value: 1,
    setValueAtTime: (value: number, at: number) => {
      this.steps.push({ value, at });
    },
    linearRampToValueAtTime: (value: number, at: number) => {
      this.ramps.push({ value, at });
    },
  };
  connect(dest: unknown): void {
    this.connected = dest;
  }
}

class FakeOsc implements OscillatorLike {
  type = "sine";
  frequency = { value: 0 };
  started: number | null = null;
  stopped: number | null = null;
  connected: unknown = null;
  connect(dest: unknown): void {
    this.connected = dest;
  }
  start(at: number): void {
    this.started = at;
  }
  stop(at: number): void {
    this.stopped = at;
  }
}

class FakeContext implements AudioContextLike {
  readonly destination = { id: "destination" };
  currentTime = 5;
  state = "running";
  resumes = 0;
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  resume(): void {
    this.resumes += 1;
    this.state = "running";
  }
  createOscillator(): OscillatorLike {
    const osc = new FakeOsc();
    this.oscs.push(osc);
    return osc;
  }
  createGain(): GainLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

describe("v1.18 声音输出", () => {
  it("一颗音＝一台振荡器一条包络：起跳按谱里的 at 排，音长收在 dur 之后", () => {
    const ctx = new FakeContext();
    const sink = createSfxAudioOutput(() => ctx);
    const note: SfxNote = { at: 70, freq: 660, dur: 150, gain: 0.22, voice: "sine" };
    sink.play("cast", [note]);
    expect(ctx.oscs).toHaveLength(1);
    const osc = ctx.oscs[0];
    expect(osc.type).toBe("sine");
    expect(osc.frequency.value).toBeCloseTo(660, 6);
    expect(osc.started).toBeCloseTo(ctx.currentTime + 0.07, 6);
    expect(osc.stopped! - osc.started!).toBeCloseTo(0.15, 6);
    const gain = ctx.gains[0];
    expect(gain.connected).toBe(ctx.destination);
    expect(osc.connected).toBe(gain);
    // 从静音起、爬到谱上的峰值、再回落到 0：不做「一上来就满格」的爆音。
    expect(gain.steps[0]).toEqual({ value: 0, at: osc.started });
    const peak = gain.ramps.find((row) => Math.abs(row.value - 0.22) < 1e-6);
    expect(peak).toBeDefined();
    expect(peak!.at).toBeGreaterThan(osc.started!);
    expect(peak!.at).toBeLessThan(osc.stopped!);
    expect(gain.ramps[gain.ramps.length - 1].value).toBe(0);
    expect(gain.ramps[gain.ramps.length - 1].at).toBeLessThanOrEqual(osc.stopped!);
  });

  it("三音的谱排三台，各自的音色与音高都不串味", () => {
    const ctx = new FakeContext();
    const sink = createSfxAudioOutput(() => ctx);
    const notes = planSfx("catch", { volume: 1, muted: false });
    expect(notes.length).toBeGreaterThan(1);
    sink.play("catch", notes);
    expect(ctx.oscs).toHaveLength(notes.length);
    expect(ctx.oscs.map((o) => o.type)).toEqual(notes.map((n) => n.voice));
    expect(ctx.oscs.map((o) => o.frequency.value)).toEqual(notes.map((n) => n.freq));
    expect(ctx.oscs.map((o) => o.started)).toEqual(notes.map((n) => ctx.currentTime + n.at / 1000));
  });

  it("挂起时一台都不起；unlock 唤过之后同一份谱就能响", () => {
    const ctx = new FakeContext();
    ctx.state = "suspended";
    const sink = createSfxAudioOutput(() => ctx);
    sink.play("bounce", planSfx("bounce", { volume: 1, muted: false }));
    expect(ctx.oscs).toHaveLength(0);
    sink.unlock();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe("running");
    sink.play("bounce", planSfx("bounce", { volume: 1, muted: false }));
    expect(ctx.oscs).toHaveLength(1);
  });

  it("本机没有 Web Audio：出声与解锁都不许抛，也绝不每次出声重试建上下文", () => {
    let calls = 0;
    const sink = createSfxAudioOutput(() => {
      calls += 1;
      return null;
    });
    expect(() => sink.play("flare", planSfx("flare", { volume: 1, muted: false }))).not.toThrow();
    expect(() => sink.unlock()).not.toThrow();
    expect(calls).toBe(1);
    sink.play("moth", planSfx("moth", { volume: 1, muted: false }));
    expect(calls).toBe(1);
  });

  it("空谱不占资源：一颗音都没有时一台振荡器都不许起", () => {
    const ctx = new FakeContext();
    const sink = createSfxAudioOutput(() => ctx);
    sink.play("wrong", []);
    expect(ctx.oscs).toHaveLength(0);
    expect(ctx.gains).toHaveLength(0);
  });

  it("脏输入（NaN 频率/负时长/零音量）整条咽下：宁可哑掉也不让 Web Audio 抛", () => {
    const ctx = new FakeContext();
    const sink = createSfxAudioOutput(() => ctx);
    const bad: SfxNote[] = [
      { at: 0, freq: Number.NaN, dur: 100, gain: 0.2, voice: "sine" },
      { at: 0, freq: 440, dur: -100, gain: 0.2, voice: "sine" },
      { at: 0, freq: 440, dur: 100, gain: 0, voice: "sine" },
    ];
    for (const event of ["bounce", "catch"] as SfxEvent[]) sink.play(event, bad);
    expect(ctx.oscs).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  SFX_EVENTS,
  SFX_MAX_GAIN,
  SFX_VOICES,
  createSfxBudget,
  planSfx,
  sfxAllow,
  type SfxEvent,
} from "./girl-sfx";

function sane(event: SfxEvent): void {
  const notes = planSfx(event, { volume: 0.7, muted: false, step: 2 });
  expect(notes.length).toBeGreaterThan(0);
  let prev = -1;
  for (const n of notes) {
    expect(Number.isFinite(n.freq)).toBe(true);
    expect(n.freq).toBeGreaterThan(60);
    expect(n.freq).toBeLessThan(6_000);
    expect(n.dur).toBeGreaterThan(0);
    expect(n.dur).toBeLessThan(900);
    expect(n.gain).toBeGreaterThan(0);
    expect(n.gain).toBeLessThanOrEqual(SFX_MAX_GAIN);
    expect(SFX_VOICES).toContain(n.voice);
    expect(n.at).toBeGreaterThanOrEqual(prev);
    prev = n.at;
  }
}

describe("合成音层档位", () => {
  it("每个事件都有谱，且谱出的音都落在能听的范围内", () => {
    expect(SFX_EVENTS.length).toBeGreaterThanOrEqual(8);
    for (const event of SFX_EVENTS) sane(event);
  });

  it("静音与零音量不许出声；音量线性缩放", () => {
    for (const event of SFX_EVENTS) {
      expect(planSfx(event, { volume: 0.8, muted: true })).toEqual([]);
      expect(planSfx(event, { volume: 0, muted: false })).toEqual([]);
    }
    const quiet = planSfx("catch", { volume: 0.3, muted: false });
    const loud = planSfx("catch", { volume: 0.9, muted: false });
    expect(loud.length).toBe(quiet.length);
    for (let i = 0; i < loud.length; i += 1) {
      expect(loud[i].gain).toBeGreaterThan(quiet[i].gain);
      expect(loud[i].freq).toBeCloseTo(quiet[i].freq, 6);
    }
  });

  it("连击升调：step 越大音越高，但封顶不许刺耳", () => {
    const low = planSfx("bounce", { volume: 0.6, muted: false, step: 0 });
    const mid = planSfx("bounce", { volume: 0.6, muted: false, step: 3 });
    const high = planSfx("bounce", { volume: 0.6, muted: false, step: 8 });
    const top = planSfx("bounce", { volume: 0.6, muted: false, step: 99 });
    expect(mid[0].freq).toBeGreaterThan(low[0].freq);
    expect(high[0].freq).toBeGreaterThan(mid[0].freq);
    expect(top[0].freq).toBe(high[0].freq);
    for (const n of top) expect(n.freq).toBeLessThan(3_000);
  });

  it("谢幕与上鱼是琶音（≥2 个音），单击类只有一个音", () => {
    expect(planSfx("combo-final", { volume: 0.6, muted: false }).length).toBeGreaterThanOrEqual(3);
    expect(planSfx("catch", { volume: 0.6, muted: false }).length).toBeGreaterThanOrEqual(2);
    expect(planSfx("bounce", { volume: 0.6, muted: false }).length).toBe(1);
    expect(planSfx("flare", { volume: 0.6, muted: false }).length).toBe(1);
  });

  it("未知事件不许炸：给空谱，渲染器自己跳过", () => {
    expect(planSfx("nope" as SfxEvent, { volume: 0.6, muted: false })).toEqual([]);
    expect(planSfx("bounce", { volume: Number.NaN, muted: false })).toEqual([]);
    expect(planSfx("bounce", { volume: 0.6, muted: false, step: Number.NaN })).toEqual([]);
  });

  it("节流：同类事件在一个窗口内只许出声一次，异类不受牵连", () => {
    const budget = createSfxBudget(10_000);
    expect(sfxAllow(budget, "bounce", 10_000)).toBe(true);
    expect(sfxAllow(budget, "bounce", 10_050)).toBe(false);
    expect(sfxAllow(budget, "catch", 10_050)).toBe(true);
    expect(sfxAllow(budget, "bounce", 10_000 + 1_000)).toBe(true);
    // 时间倒流（换段/重启）不许把闸门锁死。
    expect(sfxAllow(budget, "bounce", 4_000)).toBe(true);
  });

  it("全局同拍限流：一次最多三声，多余的直接咽掉", () => {
    const budget = createSfxBudget(0);
    expect(sfxAllow(budget, "bounce", 10)).toBe(true);
    expect(sfxAllow(budget, "flare", 12)).toBe(true);
    expect(sfxAllow(budget, "match", 14)).toBe(true);
    expect(sfxAllow(budget, "catch", 16)).toBe(false);
    expect(sfxAllow(budget, "catch", 16 + 220)).toBe(true);
  });
});

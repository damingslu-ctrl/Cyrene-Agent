import { describe, expect, it } from "vitest";
import {
  BLINK_MS, BLINK_PERIOD_S, CHANNELS, DT_CAP_MS, ENV,
  allClips, blinkAt, capDt, clipById, mixPose, registerClips, sampleClip, springStep, withPriority,
  type Clip,
} from "./motion";

const WAVE: Clip = {
  id: "wfixture", layer: "gesture", ms: 2000, priority: 2,
  rest: { armR: -1.15, hand: 0.6 },
  tracks: {
    armR: (p) => -1.15 + 0.28 * Math.sin(2 * Math.PI * 3 * p),
    hand: (p, e) => 0.6 + 0.3 * e.pulse(p, 3),
  },
  face: "happy",
};
const SIT: Clip = {
  id: "sfixture", layer: "body", ms: 2600, lasting: true, priority: 0,
  rest: { legL: 1.15, legR: 1.15, headBob: 0 },
  tracks: { legL: () => 1.15, legR: () => 1.15, headBob: (p, e) => -0.8 * e.pulse(p) },
};

describe("通道表", () => {
  it("恰好 15 条，顺序钉死（girl.ts 与尺 #73 都按它读）", () => {
    expect(CHANNELS).toHaveLength(15);
    expect([...CHANNELS]).toEqual([
      "armL", "armR", "legL", "legR", "headYaw", "headPitch", "headBob",
      "lean", "hop", "squash", "hem", "tail", "earL", "earR", "hand",
    ]);
  });
});

describe("Env 三个算子", () => {
  it("ease 端点 0/1、中点 0.5、单调", () => {
    expect(ENV.ease(0)).toBe(0);
    expect(ENV.ease(1)).toBe(1);
    expect(ENV.ease(0.5)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = ENV.ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("pulse 两头零、中点一；cycles=2 得到两个包且不出现负值", () => {
    expect(ENV.pulse(0)).toBeCloseTo(0, 12);
    expect(ENV.pulse(1)).toBeCloseTo(0, 12);
    expect(ENV.pulse(0.5)).toBeCloseTo(1, 12);
    let peaks = 0;
    for (let i = 1; i < 100; i++) {
      const v = ENV.pulse(i / 100, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      if (v > 0.999) peaks++;
    }
    expect(peaks).toBe(2);
    expect(() => ENV.pulse(0.5, 0)).toThrow(/cycles/);
    expect(() => ENV.pulse(0.5, 1.5)).toThrow(/cycles/);
  });

  it("step 在 at 处翻转，at 越界抛错", () => {
    expect(ENV.step(0.4, 0.5)).toBe(0);
    expect(ENV.step(0.5, 0.5)).toBe(1);
    expect(() => ENV.step(0.5, 1.2)).toThrow(/at/);
  });
});

describe("摆律与帧距", () => {
  it("dt=0 不动；正向逼近且永不超调", () => {
    expect(springStep(0.3, 1, 8, 0)).toBe(0.3);
    let v = 0;
    for (let i = 0; i < 400; i++) {
      v = springStep(v, 1, 8, 16);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(v).toBeCloseTo(1, 3);
  });

  it("capDt 只砍正数：120ms→50ms，负数与 NaN→0", () => {
    expect(capDt(16)).toBe(16);
    expect(capDt(120)).toBe(DT_CAP_MS);
    expect(capDt(-5)).toBe(0);
    expect(capDt(Number.NaN)).toBe(0);
  });

  it("同一 rate 下 120ms 与 50ms 结果相同（封顶真的生效）", () => {
    expect(springStep(0, 1, 8, 120)).toBeCloseTo(springStep(0, 1, 8, 50), 12);
  });
});

describe("sampleClip", () => {
  it("只产 tracks 声明的通道，且是绝对值（p=0 落在 rest 上）", () => {
    expect(sampleClip(WAVE, 0)).toEqual({ armR: -1.15, hand: 0.6 });
    expect(Object.keys(sampleClip(WAVE, 0.5)).sort()).toEqual(["armR", "hand"]);
  });

  it("p 越界夹回 0..1；NaN 抛 RangeError", () => {
    expect(sampleClip(WAVE, -0.4)).toEqual(sampleClip(WAVE, 0));
    expect(sampleClip(WAVE, 1.6)).toEqual(sampleClip(WAVE, 1));
    expect(() => sampleClip(WAVE, Number.NaN)).toThrow(RangeError);
  });

  it("轨道产出非有限值 → 抛错并点名 clip 与通道", () => {
    const bad: Clip = { ...WAVE, id: "badfixture", tracks: { armR: () => Number.NaN }, rest: { armR: 0 } };
    expect(() => sampleClip(bad, 0.5)).toThrow(/badfixture.*armR|armR.*badfixture/);
  });

  it("纯函数：同输入两次调用逐字段相等", () => {
    expect(sampleClip(WAVE, 0.37)).toEqual(sampleClip(WAVE, 0.37));
  });
});

describe("注册表与合并", () => {
  it("注册是合并语义：fixture 不会擦掉已注册的表", () => {
    registerClips([WAVE, SIT]);
    expect(clipById("wfixture")).toBe(WAVE);
    expect(allClips().length).toBeGreaterThanOrEqual(2);
  });

  it("查不到抛错，消息里带 id", () => {
    expect(() => clipById("nope-not-registered")).toThrow(/nope-not-registered/);
  });

  it("mixPose：高 priority 赢；同 priority 时后声明的层赢", () => {
    const low: Clip = { id: "lowfix", layer: "body", ms: 1000, priority: 0, rest: { hop: 0 }, tracks: { hop: () => 1 } };
    const high: Clip = { id: "highfix", layer: "gesture", ms: 1000, priority: 2, rest: { hop: 0 }, tracks: { hop: () => 5 } };
    expect(mixPose({ body: { clip: low, p: 0 }, gesture: { clip: high, p: 0 } }).hop).toBe(5);
    expect(mixPose({ gesture: { clip: high, p: 0 }, body: { clip: low, p: 0 } }).hop).toBe(5);
    // 低层声明在后也压不过：priority 是唯一裁决
    expect(mixPose({ body: { clip: low, p: 0.5 }, gesture: { clip: high, p: 0.5 } }).hop).toBe(5);
  });

  it("withPriority 只换 priority，其余字段不变（副本）", () => {
    const p3 = withPriority(WAVE, 3);
    expect(p3.priority).toBe(3);
    expect(p3.tracks).toBe(WAVE.tracks);
    expect(WAVE.priority).toBe(2);
  });
});

describe("眨眼", () => {
  it("周期与时长常量钉死；每个周期只闭一次", () => {
    expect(BLINK_PERIOD_S).toBe(4.2);
    expect(BLINK_MS).toBe(260);
    let peaks = 0;
    for (let i = 0; i <= 420; i++) {
      const t = (i / 100) * 1;
      if (blinkAt(t) > 0.98) peaks++;
    }
    expect(peaks).toBeGreaterThanOrEqual(1);
    // 周期末尾必须回到 0（否则眼睛会永远半闭）
    expect(blinkAt(4.2)).toBe(0);
    expect(blinkAt(0)).toBe(0);
  });

  it("非有限时间给 0，不抛", () => {
    expect(blinkAt(Number.NaN)).toBe(0);
    expect(blinkAt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

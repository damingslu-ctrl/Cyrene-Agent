import { describe, expect, it } from "vitest";
import { GirlTapTracker, GIRL_ZONES, RAPID_TAP, classifyGirlTap } from "./girl-zones";

const rect = { x: 20, y: 30, width: 46, height: 64 };

describe("猫娘三区命中", () => {
  it("头 / 身 / 脚按高度切片，边界点是后一档", () => {
    expect(classifyGirlTap(40, 31, rect)).toBe("head");
    expect(classifyGirlTap(40, 30 + 64 * GIRL_ZONES.headEnd - 0.01, rect)).toBe("head");
    expect(classifyGirlTap(40, 30 + 64 * GIRL_ZONES.headEnd, rect)).toBe("body");
    expect(classifyGirlTap(40, 60, rect)).toBe("body");
    expect(classifyGirlTap(40, 30 + 64 * GIRL_ZONES.feetStart, rect)).toBe("feet");
    expect(classifyGirlTap(40, 93, rect)).toBe("feet");
  });

  it("横向左右边沿都算命中，框外四向都是 null", () => {
    expect(classifyGirlTap(20, 60, rect)).toBe("body");
    expect(classifyGirlTap(66, 60, rect)).toBe("body");
    expect(classifyGirlTap(19.9, 60, rect)).toBeNull();
    expect(classifyGirlTap(66.1, 60, rect)).toBeNull();
    expect(classifyGirlTap(40, 29.9, rect)).toBeNull();
    expect(classifyGirlTap(40, 94.1, rect)).toBeNull();
  });

  it("零尺寸的矩形不除以零", () => {
    expect(classifyGirlTap(10, 10, { x: 10, y: 10, width: 0, height: 0 })).toBe("head");
  });
});

describe("连点眩晕", () => {
  it("2.4s 内的第 4 下触发一次，计数随即归零", () => {
    const tracker = new GirlTapTracker();
    expect(tracker.tap(0)).toEqual({ count: 1, dizzy: false });
    expect(tracker.tap(600)).toEqual({ count: 2, dizzy: false });
    expect(tracker.tap(1_200)).toEqual({ count: 3, dizzy: false });
    expect(tracker.tap(1_800)).toEqual({ count: 0, dizzy: true });
  });

  it("窗口外的旧点不算；慢慢点永远不晕", () => {
    const tracker = new GirlTapTracker();
    for (let i = 0; i < 8; i += 1) {
      expect(tracker.tap(i * 900).dizzy, `t=${i * 900}`).toBe(false);
    }
  });

  it("第一下恰好在 2.4s 边界上（不在 < 窗口内），不参与累计", () => {
    const tracker = new GirlTapTracker();
    expect(tracker.tap(0).count).toBe(1);
    // 2.4s 整已不在窗口内：剩下三下从 2400 起算，第四下要等到 3300 才凑齐。
    expect(tracker.tap(RAPID_TAP.windowMs).count).toBe(1);
    expect(tracker.tap(RAPID_TAP.windowMs + 300).count).toBe(2);
    expect(tracker.tap(RAPID_TAP.windowMs + 600).count).toBe(3);
    expect(tracker.tap(RAPID_TAP.windowMs + 900).dizzy).toBe(true);
  });

  it("冷却期内继续点不晕、也不记账；冷却结束后可以再次晕", () => {
    const tracker = new GirlTapTracker();
    tracker.tap(0);
    tracker.tap(100);
    tracker.tap(200);
    expect(tracker.tap(300).dizzy).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      expect(tracker.tap(400 + i * 500).dizzy).toBe(false);
    }

    const after = 300 + RAPID_TAP.cooldownMs;
    expect(tracker.tap(after).count).toBe(1);
    expect(tracker.tap(after + 100).count).toBe(2);
    expect(tracker.tap(after + 200).count).toBe(3);
    expect(tracker.tap(after + 300).dizzy).toBe(true);
  });

  it("reset 清掉累计与冷却（切形态/重开时不该继承上一轮的晕）", () => {
    const tracker = new GirlTapTracker();
    tracker.tap(0);
    tracker.tap(100);
    tracker.tap(200);
    tracker.tap(300);
    tracker.reset();
    expect(tracker.tap(400).count).toBe(1);
  });
});

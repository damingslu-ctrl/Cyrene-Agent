import { describe, expect, it } from "vitest";
import { TEASE, TeaseTracker } from "./girl-tease";

describe("girl-tease 逗光标计数", () => {
  it("第一次采样只记基线；慢慢移动不算", () => {
    const tracker = new TeaseTracker();
    expect(tracker.feed(10, 10, 1000)).toBe(false);
    expect(tracker.feed(20, 10, 1100)).toBe(false); // 10px < movePx
    expect(tracker.feed(30, 10, 1250)).toBe(false); // 间隔 150ms 但只挪 10px
    expect(tracker.pending).toBe(0);
  });

  it("两次快速甩动（900ms 内）触发一次，然后清零", () => {
    const tracker = new TeaseTracker();
    tracker.feed(10, 10, 1000);
    expect(tracker.feed(50, 10, 1080)).toBe(false); // 第一笔
    expect(tracker.pending).toBe(1);
    expect(tracker.feed(90, 10, 1200)).toBe(true); // 第二笔
    expect(tracker.pending).toBe(0);
  });

  it("隔太久的两笔不算同一次；reset 清空", () => {
    const tracker = new TeaseTracker();
    tracker.feed(10, 10, 1000);
    tracker.feed(50, 10, 1080);
    expect(tracker.feed(90, 10, 1080 + TEASE.windowMs + 1)).toBe(false);
    expect(tracker.pending, "过期的那笔不许留着凑数").toBe(0);
    tracker.reset();
    expect(tracker.pending).toBe(0);
    expect(tracker.feed(10, 10, 5000)).toBe(false);
  });

  it("坏采样不抛错、不污染基线", () => {
    const tracker = new TeaseTracker();
    tracker.feed(10, 10, 1000);
    expect(tracker.feed(Number.NaN, 10, 1100)).toBe(false);
    expect(tracker.feed(50, 10, 1200)).toBe(false); // 距真实上一笔 200ms，仍是一笔
    expect(tracker.pending).toBe(1);
  });
});

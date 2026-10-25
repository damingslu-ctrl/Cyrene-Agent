import { describe, expect, it } from "vitest";
import { DREAM_DELAY_MS, buildDreamOps } from "./girl-dream";

const FACE = { cx: 41, top: 20, w: 46, h: 34 };

describe("梦话云", () => {
  it("睡熟 1.8 秒后才浮出来，越晚越完整", () => {
    expect(buildDreamOps(0, 0, FACE, false, "sleep")).toEqual([]);
    expect(buildDreamOps(DREAM_DELAY_MS - 1, 0, FACE, false, "sleep")).toEqual([]);
    const early = buildDreamOps(DREAM_DELAY_MS + 10, 0, FACE, false, "sleep");
    const settled = buildDreamOps(DREAM_DELAY_MS + 2_000, 0, FACE, false, "sleep");
    expect(early.length).toBeGreaterThan(0);
    expect(settled.length).toBeGreaterThan(0);
    // 云 + 鱼 + 尾巴 + 眼睛 + 两个泡泡：至少七八个图元。
    expect(settled.length).toBeGreaterThanOrEqual(8);
  });

  it("没睡着 / 免打扰 / 睡着了但还没开始计时都不出（正对照配齐）", () => {
    expect(buildDreamOps(10_000, 0, FACE, false, "idle")).toEqual([]);
    expect(buildDreamOps(10_000, 0, FACE, true, "sleep")).toEqual([]);
    expect(buildDreamOps(10_000, -1, FACE, false, "sleep")).toEqual([]);
    expect(buildDreamOps(10_000, 7_000, FACE, false, "sleep").length).toBeGreaterThan(0);
  });

  it("坐标全有限，云不会飘出窗顶", () => {
    const ops = buildDreamOps(DREAM_DELAY_MS + 5_000, 0, FACE, false, "sleep");
    for (const op of ops) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill" || key === "stroke") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        if (Array.isArray(value)) expect(value.every((p) => p.every((n: number) => Number.isFinite(n)))).toBe(true);
      }
    }
    const minY = Math.min(...ops.flatMap((op) => {
      if (op.kind === "fillEllipse" || op.kind === "strokeEllipse") return [op.cy - op.ry];
      if (op.points) return op.points.map(([, y]) => y);
      return [];
    }));
    expect(minY).toBeGreaterThan(-10);
  });
});

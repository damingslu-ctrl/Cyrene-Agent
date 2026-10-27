import { describe, expect, it } from "vitest";
import {
  GARDEN_STAGES,
  buildGardenOps,
  createGarden,
  gardenNextMs,
  gardenReport,
  gardenStage,
  harvestGarden,
  parseGarden,
  plantGarden,
} from "./girl-garden";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

describe("薄荷田", () => {
  it("空盆 → 播种 → 发芽 → 长叶 → 可以收；时间只往前推进", () => {
    const s = createGarden();
    expect(gardenStage(s, 0)).toBe("empty");
    expect(plantGarden(s, 0)).toBe(true);
    expect(gardenStage(s, 0)).toBe("seed");
    s.plantedAt = -1;
    expect(gardenStage(s, 0)).toBe("empty");
    expect(plantGarden(s, 1_000)).toBe(true);
    expect(plantGarden(s, 2_000)).toBe(false);
    expect(gardenStage(s, 1_000)).toBe("seed");
    expect(gardenStage(s, 1_000 + GARDEN_STAGES.sprout - 1)).toBe("seed");
    expect(gardenStage(s, 1_000 + GARDEN_STAGES.sprout)).toBe("sprout");
    expect(gardenStage(s, 1_000 + GARDEN_STAGES.leafy)).toBe("leafy");
    expect(gardenStage(s, 1_000 + GARDEN_STAGES.ready)).toBe("ready");
  });

  it("没收成不能摘；摘完清盆、收成 +1，可以再种", () => {
    const s = createGarden();
    plantGarden(s, 0);
    expect(harvestGarden(s, GARDEN_STAGES.ready - 1)).toBe(false);
    expect(harvestGarden(s, GARDEN_STAGES.ready)).toBe(true);
    expect(s.harvests).toBe(1);
    expect(gardenStage(s, GARDEN_STAGES.ready)).toBe("empty");
    expect(plantGarden(s, GARDEN_STAGES.ready)).toBe(true);
  });

  it("下一阶段倒计时：空盆为 0，成熟为 0，其余是正数且越来越短", () => {
    const s = createGarden();
    expect(gardenNextMs(s, 0)).toBe(0);
    plantGarden(s, 0);
    expect(gardenNextMs(s, 0)).toBe(GARDEN_STAGES.sprout);
    expect(gardenNextMs(s, GARDEN_STAGES.sprout)).toBe(GARDEN_STAGES.leafy - GARDEN_STAGES.sprout);
    expect(gardenNextMs(s, GARDEN_STAGES.ready)).toBe(0);
  });

  it("报告：阶段 + 收成数 + 下一阶段，最多四行", () => {
    const s = createGarden();
    expect(gardenReport(s, 0)[0]).toContain("空");
    plantGarden(s, 0);
    const r = gardenReport(s, 0);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.length).toBeLessThanOrEqual(4);
    expect(r.join("\n")).toContain("0");
    expect(r.join("\n")).toContain("芽");
  });

  it("画法：空盆不画；种下后有盆有苗，成熟时叶子最多；数值全有限", () => {
    const s = createGarden();
    expect(buildGardenOps(s, 0, FACE, FLOOR)).toEqual([]);
    plantGarden(s, 0);
    const seed = buildGardenOps(s, 0, FACE, FLOOR);
    const ready = buildGardenOps(s, GARDEN_STAGES.ready, FACE, FLOOR);
    expect(seed.length).toBeGreaterThanOrEqual(3);
    expect(ready.length).toBeGreaterThan(seed.length);
    for (const op of [...seed, ...ready]) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill" || key === "stroke") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
    const xs = ready
      .filter((op) => op.kind === "fillEllipse")
      .map((op) => (op as unknown as { cx: number }).cx);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(FACE.cx - FACE.w);
    expect(Math.max(...xs)).toBeLessThanOrEqual(FACE.cx + FACE.w);
  });

  it("读档：-1 是空盆；负数/非数清零；收成数夹到非负整数", () => {
    expect(parseGarden(null).plantedAt).toBe(-1);
    expect(parseGarden(null).harvests).toBe(0);
    const s = parseGarden({ plantedAt: -5, harvests: 2.8 });
    expect(s.plantedAt).toBe(-1);
    expect(s.harvests).toBe(2);
    expect(parseGarden({ plantedAt: 123, harvests: -2 })).toEqual({ plantedAt: 123, harvests: 0 });
  });
});

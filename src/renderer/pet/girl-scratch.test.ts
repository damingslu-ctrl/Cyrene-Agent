import { describe, expect, it } from "vitest";
import {
  SCRATCH_BONUS_COOLDOWN_MS,
  SCRATCH_ENTER_MS,
  SCRATCH_MAX_BOOSTS,
  SCRATCH_MAX_MARKS,
  SCRATCH_MS,
  boostScratch,
  buildScratchOps,
  createScratch,
  scratchAlive,
  scratchAtPoint,
  scratchMarks,
  scratchPhase,
  scratchRectFor,
} from "./girl-scratch";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildScratchOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("猫抓板", () => {
  it("时间表：升起来 → 磨爪 → 收走", () => {
    const s = createScratch(0, 0.3);
    expect(scratchPhase(s, 0)).toBe("enter");
    expect(scratchPhase(s, SCRATCH_ENTER_MS - 1)).toBe("enter");
    expect(scratchPhase(s, SCRATCH_ENTER_MS)).toBe("scratch");
    expect(scratchAlive(s, SCRATCH_MS - 1)).toBe(true);
    expect(scratchAlive(s, SCRATCH_MS)).toBe(false);
  });

  it("爪痕按时间表长到五道；点击补痕最多三道，合计封顶八道", () => {
    const s = createScratch(0, 0.2);
    expect(scratchMarks(s, 700)).toBe(0);
    expect(scratchMarks(s, 1_300)).toBe(1);
    expect(scratchMarks(s, 4_000)).toBe(Math.min(5, Math.floor((4_000 - 650) / 620)));
    for (let i = 0; i < 5; i += 1) boostScratch(s, 2_000 + i * (SCRATCH_BONUS_COOLDOWN_MS + 1));
    expect(s.boosts).toBe(SCRATCH_MAX_BOOSTS);
    expect(scratchMarks(s, 5_000)).toBe(SCRATCH_MAX_MARKS);
  });

  it("补痕只在磨爪段、且有 420ms 冷却", () => {
    const s = createScratch(0, 0.1);
    expect(boostScratch(s, 200)).toBe(false);
    expect(boostScratch(s, 1_000)).toBe(true);
    expect(boostScratch(s, 1_000 + SCRATCH_BONUS_COOLDOWN_MS - 1)).toBe(false);
    expect(boostScratch(s, 1_000 + SCRATCH_BONUS_COOLDOWN_MS)).toBe(true);
    expect(boostScratch(s, SCRATCH_MS)).toBe(false);
  });

  it("点板面命中：磨爪段板面可点，板外与收走之后都点不到", () => {
    const s = createScratch(0, 0.1);
    const rect = scratchRectFor(s, 2_000, FACE, FLOOR);
    expect(scratchAtPoint(s, 2_000, FACE, FLOOR, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(true);
    expect(scratchAtPoint(s, 2_000, FACE, FLOOR, rect.x - 20, rect.y)).toBe(false);
    expect(scratchAtPoint(s, SCRATCH_MS, FACE, FLOOR, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(false);
  });

  it("升起来时板子在下方且半透明；画法含板身、瓦楞、爪痕，坐标全有限", () => {
    const s = createScratch(0, 0.4);
    const enter = scratchRectFor(s, 300, FACE, FLOOR);
    const rest = scratchRectFor(s, 2_000, FACE, FLOOR);
    expect(enter.y).toBeGreaterThan(rest.y);
    expect(enter.alpha).toBeLessThan(1);

    boostScratch(s, 1_200);
    const ops = buildScratchOps(s, 2_000, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "fillRoundRect").length).toBeGreaterThanOrEqual(1);
    expect(ops.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(6);
    expect(finite(ops)).toBe(true);
    expect(buildScratchOps(s, SCRATCH_MS, FACE, FLOOR)).toEqual([]);
  });
});

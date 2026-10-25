import { describe, expect, it } from "vitest";
import { LEAF_COUNT, LEAVES_MS, buildLeafOps, createLeaves, leavesAlive, liveLeafCount } from "./girl-leaves";

const FACE = { cx: 41, top: 20, w: 46, h: 34 };
const FLOOR = 96;
const fixed = () => 0.5;

describe("落叶", () => {
  it("一把 7 片、两种色调交替，5.6 秒收场", () => {
    const state = createLeaves(0, FACE, fixed);
    expect(state.leaves).toHaveLength(LEAF_COUNT);
    expect(state.leaves.map((leaf) => leaf.tone)).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(leavesAlive(state, LEAVES_MS - 1)).toBe(true);
    expect(leavesAlive(state, LEAVES_MS)).toBe(false);
    expect(liveLeafCount(state, LEAVES_MS, FACE, FLOOR)).toBe(0);
  });

  it("叶子从头顶往脚边落：越晚越靠下；落地后不再计入", () => {
    const state = createLeaves(0, FACE, fixed);
    const early = liveLeafCount(state, 200, FACE, FLOOR);
    const mid = liveLeafCount(state, 2_000, FACE, FLOOR);
    expect(mid).toBeGreaterThan(0);
    expect(early).toBeLessThanOrEqual(mid);
    expect(liveLeafCount(state, 4_000, FACE, FLOOR)).toBeLessThanOrEqual(mid);

    const opsEarly = buildLeafOps(state, 1_500, FACE, FLOOR);
    const opsLate = buildLeafOps(state, 4_100, FACE, FLOOR);
    const lowest = (ops: ReturnType<typeof buildLeafOps>) => Math.max(
      ...ops.filter((op) => op.kind === "fillPath").flatMap((op) => op.points.map(([, y]) => y)),
    );
    expect(lowest(opsLate)).toBeGreaterThan(lowest(opsEarly));
  });

  it("画法：每片叶子有奶油光边 + 叶脉；快落地时多一圈投影；坐标全有限", () => {
    const state = createLeaves(0, FACE, fixed);
    const ops = buildLeafOps(state, 4_100, FACE, FLOOR);
    expect(ops.length).toBeGreaterThanOrEqual(LEAF_COUNT);
    expect(ops.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(2 * state.leaves.length);
    expect(ops.some((op) => op.kind === "strokePath")).toBe(true);
    expect(ops.some((op) => op.kind === "strokeEllipse")).toBe(true);
    for (const op of ops) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill" || key === "stroke") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        if (Array.isArray(value)) expect(value.every((p) => p.every((n: number) => Number.isFinite(n)))).toBe(true);
      }
    }
    expect(buildLeafOps(state, LEAVES_MS, FACE, FLOOR)).toEqual([]);
  });
});

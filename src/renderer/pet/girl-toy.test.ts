import { describe, expect, it } from "vitest";
import { TOY, buildToyOps, createToy, kickToy, stepToy, toyAt } from "./girl-toy";

const BOUNDS = { left: 6, right: 76, floorY: 100 };

function settle(state: ReturnType<typeof createToy>) {
  for (let i = 0; i < 600 && !state.rest; i += 1) stepToy(state, 1 / 60, BOUNDS);
  return state;
}

describe("girl-toy 物理", () => {
  it("出生即静止、贴着地面；点得中球心与边缘", () => {
    const toy = createToy(30, BOUNDS.floorY);
    expect(toy.rest).toBe(true);
    expect(toy.y).toBeCloseTo(BOUNDS.floorY - TOY.radius, 6);
    expect(toyAt(toy, 30, toy.y)).toBe(true);
    expect(toyAt(toy, 30 + TOY.radius + 2, toy.y)).toBe(true);
    expect(toyAt(toy, 30 + TOY.radius + 5, toy.y)).toBe(false);
  });

  it("踢出去会离地、滚、最终停在窗内；方向只认符号", () => {
    const toy = createToy(50, BOUNDS.floorY);
    kickToy(toy, -1);
    expect(toy.vx).toBeLessThan(0);
    expect(toy.vy).toBeLessThan(0);
    expect(toy.rest).toBe(false);

    settle(toy);
    expect(toy.rest).toBe(true);
    expect(toy.vx).toBe(0);
    expect(toy.vy).toBe(0);
    expect(toy.x).toBeGreaterThanOrEqual(BOUNDS.left + TOY.radius);
    expect(toy.x).toBeLessThanOrEqual(BOUNDS.right - TOY.radius);
    expect(toy.y).toBeCloseTo(BOUNDS.floorY - TOY.radius, 6);
    expect(toy.spin).not.toBe(0);
    expect(toy.trail).toEqual([]);
  });

  it("撞墙反弹，不会滚出边界", () => {
    const toy = createToy(70, BOUNDS.floorY);
    toy.rest = false;
    toy.vx = 400;
    toy.vy = 0;
    stepToy(toy, 0.02, BOUNDS);
    expect(toy.x).toBeLessThanOrEqual(BOUNDS.right - TOY.radius + 1e-6);
    expect(toy.vx).toBeLessThan(0);
  });

  it("拖尾有上限，静止时清空；坏 dt 不吃帧", () => {
    const toy = createToy(40, BOUNDS.floorY);
    kickToy(toy, 1);
    for (let i = 0; i < 20; i += 1) stepToy(toy, 1 / 60, BOUNDS);
    expect(toy.trail.length).toBeLessThanOrEqual(TOY.trailMax);
    const before = { ...toy };
    stepToy(toy, Number.NaN, BOUNDS);
    expect(toy.x).toBe(before.x);
    expect(toy.y).toBe(before.y);
  });
});

describe("girl-toy 画法", () => {
  it("静止也有投影、球体与线头；滚动时多出拖尾", () => {
    const toy = createToy(30, BOUNDS.floorY);
    const still = buildToyOps({ state: toy, floorY: BOUNDS.floorY });
    expect(still.below.length).toBeGreaterThanOrEqual(2);
    expect(still.above.some((op) => op.kind === "fillEllipse" && op.fill.includes("242"))).toBe(true);
    const stillStrokes = still.above.filter((op) => op.kind === "strokePath").length;
    expect(stillStrokes).toBeGreaterThanOrEqual(2);

    kickToy(toy, 1);
    for (let i = 0; i < 6; i += 1) stepToy(toy, 1 / 60, BOUNDS);
    const moving = buildToyOps({ state: toy, floorY: BOUNDS.floorY });
    expect(moving.above.length).toBeGreaterThan(still.above.length);
  });

  it("所有图元坐标都是有限数（NaN 会静默画到画布外）", () => {
    const toy = createToy(30, BOUNDS.floorY);
    kickToy(toy, -1);
    stepToy(toy, 1 / 60, BOUNDS);
    const ops = buildToyOps({ state: toy, floorY: BOUNDS.floorY });
    for (const op of [...ops.below, ...ops.above]) {
      const numbers = Object.entries(op)
        .filter(([key]) => key !== "kind" && key !== "layer" && key !== "fill" && key !== "stroke")
        .map(([, value]) => value);
      for (const value of numbers) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

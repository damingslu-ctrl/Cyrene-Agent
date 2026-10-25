import { describe, expect, it } from "vitest";
import { wanderTarget } from "./girl-wander";

const workArea = { x: 0, y: 0, width: 800, height: 600 };
const size = { width: 82, height: 108 };

describe("陪她散步", () => {
  it("往一侧走 60–160px，脚线不动", () => {
    const target = wanderTarget({ origin: { x: 300, y: 400 }, size, workArea, facing: 1, random: 0.5 })!;
    expect(target.y).toBe(400);
    expect(target.x - 300).toBeGreaterThanOrEqual(60);
    expect(target.x - 300).toBeLessThanOrEqual(160);
  });

  it("贴边时自己掉头，绝不走出工作区", () => {
    const right = wanderTarget({ origin: { x: 800 - 82, y: 400 }, size, workArea, facing: 1, random: 1 })!;
    expect(right.x).toBeLessThan(800 - 82);
    expect(right.x).toBeGreaterThanOrEqual(0);
    const left = wanderTarget({ origin: { x: 0, y: 400 }, size, workArea, facing: -1, random: 0 })!;
    expect(left.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThanOrEqual(800 - 82);
  });

  it("连掉头的空间都没有就原地不动（返回 null）", () => {
    expect(wanderTarget({ origin: { x: 0, y: 0 }, size: { width: 800, height: 600 }, workArea, random: 0.5 })).toBeNull();
  });

  it("同样的随机数给同样的落点", () => {
    const a = wanderTarget({ origin: { x: 300, y: 400 }, size, workArea, facing: -1, random: 0.37 });
    const b = wanderTarget({ origin: { x: 300, y: 400 }, size, workArea, facing: -1, random: 0.37 });
    expect(a).toEqual(b);
  });
});

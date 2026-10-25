import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import { girlAnimBodyFor, girlFaceBox, girlInkBox } from "./girl-sprite";
import {
  SNACK_MS,
  buildSnackOps,
  createSnack,
  snackAlive,
  snackProgress,
  stepSnack,
} from "./girl-snack";

function mkGeometry() {
  const cat: CatInput = {
    center: { x: 41, y: 88 },
    u: 37,
    mood: "idle",
    t: 0,
    energy: 1,
    mouse: null,
    blink: 0,
    jumpY: 0,
    pet: 0,
    quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
  };
  const body = girlAnimBodyFor(cat);
  return { body, face: girlFaceBox(body, 0), ink: girlInkBox(body, 0) };
}

describe("小鱼干道具", () => {
  it("从头顶落到手边：落点在地面之上、脸之下", () => {
    const { face, ink } = mkGeometry();
    const snack = createSnack(0, face, 88, 1);
    expect(snackAlive(snack, 0)).toBe(true);
    const start = { x: snack.x, y: snack.y };
    stepSnack(snack, 200, face, 88);
    expect(snack.y).toBeGreaterThan(start.y);
    stepSnack(snack, 900, face, 88);
    expect(snack.y).toBeGreaterThan(face.bottom);
    expect(snack.y).toBeLessThan(88);
    expect(snack.y).toBeGreaterThan(88 - ink.h * 0.72);
    expect(snack.x).toBeGreaterThan(face.cx);
  });

  it("捧住后有一小段星星；寿命到了就收走", () => {
    const { face } = mkGeometry();
    const snack = createSnack(0, face, 88, 1);
    expect(snackProgress(snack, 0)).toBe(0);
    expect(snackProgress(snack, SNACK_MS / 2)).toBeGreaterThan(0.3);
    expect(snackAlive(snack, SNACK_MS - 1)).toBe(true);
    expect(snackAlive(snack, SNACK_MS)).toBe(false);
    expect(buildSnackOps(snack, SNACK_MS, face).length).toBe(0);

    const falling = buildSnackOps(snack, 220, face);
    const held = buildSnackOps(snack, 1_100, face);
    expect(falling.length).toBeGreaterThanOrEqual(6);
    expect(held.length).toBeGreaterThanOrEqual(6);
    // 落下阶段与捧住阶段的图不是同一张（鱼身位置不同）。
    expect(JSON.stringify(falling)).not.toBe(JSON.stringify(held));
  });

  it("鱼身是双色的、坐标有限，朝向翻转换边", () => {
    const { face } = mkGeometry();
    const right = createSnack(0, face, 88, 1);
    const left = createSnack(0, face, 88, -1);
    for (const snack of [right, left]) {
      const ops = buildSnackOps(snack, 500, face);
      const fills = ops.map((op) => (op.kind === "fillEllipse" ? op.fill : op.kind === "fillPath" ? op.fill : ""));
      expect(fills.some((f) => f.startsWith("rgba(247, 244, 236"))).toBe(true);
      expect(fills.some((f) => f.includes("242"))).toBe(true);
      for (const op of ops) {
        const numbers = [
          ...("points" in op ? op.points.flat() : []),
          ...(op.kind === "fillEllipse" || op.kind === "strokeEllipse" ? [op.cx, op.cy, op.rx, op.ry] : []),
        ];
        for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      }
    }
    expect(right.x).toBeGreaterThan(face.cx);
    expect(left.x).toBeLessThan(face.cx);
  });

  it("坏时间戳不把鱼画到 NaN", () => {
    const { face } = mkGeometry();
    const snack = createSnack(0, face, 88, 1);
    stepSnack(snack, Number.NaN, face, 88);
    expect(Number.isFinite(snack.y)).toBe(true);
    const ops = buildSnackOps(snack, Number.NaN, face);
    expect(ops.length).toBeGreaterThan(0);
  });
});

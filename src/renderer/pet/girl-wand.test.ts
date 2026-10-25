import { describe, expect, it } from "vitest";
import {
  WAND_CATCH_MS, WAND_MS, buildWandOps, catchWand, createWand, wandAlive, wandAt, wandHitRadius, wandTip,
} from "./girl-wand";

const FACE = { cx: 41, top: 22, w: 46, h: 34 };

function allNumbersFinite(ops: ReturnType<typeof buildWandOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("逗猫棒", () => {
  it("7 秒寿命；点中后进入 520ms 收尾窗口", () => {
    const wand = createWand(1_000, 0.3);
    expect(wandAlive(wand, 1_000)).toBe(true);
    expect(wandAlive(wand, 1_000 + WAND_MS - 1)).toBe(true);
    expect(wandAlive(wand, 1_000 + WAND_MS)).toBe(false);

    catchWand(wand, 4_000);
    expect(wandAlive(wand, 4_000 + WAND_CATCH_MS)).toBe(true);
    expect(wandAlive(wand, 4_000 + WAND_CATCH_MS + 1)).toBe(false);
  });

  it("重复点中不刷新收尾时刻（第一下才算）", () => {
    const wand = createWand(0, 0.5);
    catchWand(wand, 900);
    catchWand(wand, 2_000);
    expect(wand.caughtAt).toBe(900);
  });

  it("羽毛尖端随种子/时间摆动，但始终留在窗内且不出脸宽范围", () => {
    for (const seed of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (let t = 0; t <= WAND_MS; t += 233) {
        const tip = wandTip(createWand(0, seed), t, FACE, 1);
        expect(tip.x).toBeGreaterThanOrEqual(FACE.cx - FACE.w * 0.95);
        expect(tip.x).toBeLessThanOrEqual(FACE.cx + FACE.w * 0.95);
        expect(tip.y).toBeGreaterThanOrEqual(2);
        expect(Number.isFinite(tip.x)).toBe(true);
        expect(Number.isFinite(tip.y)).toBe(true);
      }
    }
    // 同一时刻同一种子必须解析出同一落点（渲染/诊断/点击共用）。
    expect(wandTip(createWand(0, 0.4), 1_234, FACE, 1)).toEqual(wandTip(createWand(0, 0.4), 1_234, FACE, 1));
  });

  it("朝向只镜像横向：朝左时尖端整体偏左", () => {
    const wand = createWand(0, 0.5);
    const right = wandTip(wand, 2_000, FACE, 1);
    const left = wandTip(wand, 2_000, FACE, -1);
    expect(left.x).toBeLessThan(right.x);
    expect(left.y).toBeCloseTo(right.y, 6);
  });

  it("命中判定只认羽尖附近的圆，半径随脸宽有下限；点中一次后不再判定", () => {
    const wand = createWand(0, 0.6);
    const tip = wandTip(wand, 1_100, FACE, 1);
    const r = wandHitRadius(FACE);
    expect(r).toBeGreaterThanOrEqual(6);
    expect(wandAt(wand, 1_100, FACE, 1, tip.x, tip.y)).toBe(true);
    expect(wandAt(wand, 1_100, FACE, 1, tip.x + r + 4, tip.y)).toBe(false);
    expect(wandAt(wand, 1_100, FACE, 1, tip.x + r - 1, tip.y)).toBe(true);

    catchWand(wand, 1_100);
    expect(wandAt(wand, 1_100, FACE, 1, tip.x, tip.y)).toBe(false);
  });

  it("画法：线从窗顶垂入、双色羽毛；捉住后多出炸开的短线且坐标全有限", () => {
    const wand = createWand(0, 0.2);
    const idle = buildWandOps(wand, 500, FACE, 1);
    expect(idle.some((op) => op.kind === "strokePath" && op.points[0][1] < 0)).toBe(true);
    const strokes = idle.filter((op) => op.kind === "strokePath").length;
    expect(strokes).toBeGreaterThanOrEqual(2);
    expect(allNumbersFinite(idle)).toBe(true);

    catchWand(wand, 500);
    const caught = buildWandOps(wand, 500 + 100, FACE, 1);
    expect(caught.length).toBeGreaterThan(idle.length);
    expect(allNumbersFinite(caught)).toBe(true);
    // 收尾窗口过去后由渲染端停止调用（寿命判定是唯一闸门）。
    expect(wandAlive(wand, 500 + WAND_CATCH_MS + 1)).toBe(false);
  });
});

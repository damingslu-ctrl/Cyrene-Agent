import { describe, expect, it } from "vitest";
import {
  BRUSH_BOOST_MAX, BRUSH_MAX_STROKES, BRUSH_MS, BRUSH_STROKE_MS, boostBrush, brushAlive,
  brushAt, brushSweep, brushStrokes, buildBrushOps, createBrush,
} from "./girl-brush";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildBrushOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("梳毛", () => {
  it("6 秒寿命，里面正好刷四趟", () => {
    const brush = createBrush(0, 0.3);
    expect(brushAlive(brush, BRUSH_MS - 1)).toBe(true);
    expect(brushAlive(brush, BRUSH_MS)).toBe(false);
    expect(brushStrokes(brush, 0)).toBe(0);
    expect(brushStrokes(brush, BRUSH_STROKE_MS - 1)).toBe(0);
    expect(brushStrokes(brush, BRUSH_STROKE_MS)).toBe(1);
    expect(brushStrokes(brush, BRUSH_MS - 1)).toBe(BRUSH_MAX_STROKES);
  });

  it("梳子从发顶滑到后背再回来；横向有摆动，点始终在窗内", () => {
    const brush = createBrush(0, 0.4);
    const top = brushSweep(brush, 0, FACE, 1, FLOOR);
    const mid = brushSweep(brush, BRUSH_STROKE_MS / 2, FACE, 1, FLOOR);
    expect(mid.s).toBeGreaterThan(top.s);
    expect(mid.y).toBeGreaterThan(top.y);
    expect(mid.y).toBeLessThan(FLOOR);
    for (let t = 0; t < BRUSH_MS; t += 97) {
      const sweep = brushSweep(brush, t, FACE, 1, FLOOR);
      expect(sweep.x).toBeGreaterThan(4);
      expect(sweep.x).toBeLessThan(78);
      expect(Number.isFinite(sweep.x) && Number.isFinite(sweep.y)).toBe(true);
    }
  });

  it("朝左时梳子镜像到另一侧", () => {
    const brush = createBrush(0, 0.5);
    const right = brushSweep(brush, 300, FACE, 1, FLOOR);
    const left = brushSweep(brush, 300, FACE, -1, FLOOR);
    expect(left.x).toBeGreaterThan(right.x);
  });

  it("命中只认梳头附近；顺毛每局最多三下", () => {
    const brush = createBrush(0, 0.2);
    const sweep = brushSweep(brush, 400, FACE, 1, FLOOR);
    expect(brushAt(brush, 400, FACE, 1, FLOOR, sweep.x, sweep.y)).toBe(true);
    expect(brushAt(brush, 400, FACE, 1, FLOOR, sweep.x + 30, sweep.y)).toBe(false);

    expect(boostBrush(brush, 500, sweep.x, sweep.y)).toBe(true);
    expect(boostBrush(brush, 600, sweep.x, sweep.y)).toBe(true);
    expect(boostBrush(brush, 700, sweep.x, sweep.y)).toBe(true);
    expect(boostBrush(brush, 800, sweep.x, sweep.y)).toBe(false);
    expect(brush.boosts).toBe(BRUSH_BOOST_MAX);
  });

  it("画法：梳柄双色、五根梳齿、跟随的星；顺毛后多出爱心与炸线，坐标全有限", () => {
    const brush = createBrush(0, 0.15);
    const idle = buildBrushOps(brush, 700, FACE, 1, FLOOR);
    expect(idle.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(7);
    expect(idle.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(5);
    expect(finite(idle)).toBe(true);

    boostBrush(brush, 700, 40, 50);
    const boosted = buildBrushOps(brush, 800, FACE, 1, FLOOR);
    expect(boosted.length).toBeGreaterThan(idle.length);
    expect(finite(boosted)).toBe(true);
    expect(buildBrushOps(brush, BRUSH_MS, FACE, 1, FLOOR)).toEqual([]);
  });
});

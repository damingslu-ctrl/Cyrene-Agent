import { describe, expect, it } from "vitest";
import {
  MOUSE_CATCH_MS,
  MOUSE_MS,
  buildMouseOps,
  catchMouse,
  createMouse,
  mouseAlive,
  mouseAt,
  mouseAtPoint,
  mouseRadius,
} from "./girl-mouse";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildMouseOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("发条老鼠", () => {
  it("跑 6.4s；路径始终贴地，横向不出脸宽范围", () => {
    const s = createMouse(0, 0.3);
    expect(mouseAlive(s, 0)).toBe(true);
    expect(mouseAlive(s, MOUSE_MS - 1)).toBe(true);
    expect(mouseAlive(s, MOUSE_MS)).toBe(false);
    const range = Math.max(18, Math.min(34, FACE.w * 0.72));
    for (let t = 0; t < MOUSE_MS; t += 350) {
      const pos = mouseAt(s, t, FACE, FLOOR);
      expect(Math.abs(pos.x - FACE.cx)).toBeLessThanOrEqual(range + 0.01);
      expect(pos.y).toBeLessThan(FLOOR);
      expect(pos.y).toBeGreaterThan(FLOOR - 7);
    }
  });

  it("按住后停在原地并往上拎；800ms 后收走", () => {
    const s = createMouse(0, 0.2);
    const at = mouseAt(s, 1_200, FACE, FLOOR);
    expect(catchMouse(s, 1_200, FACE, FLOOR)).toBe(true);
    const caught = mouseAt(s, 1_200, FACE, FLOOR);
    expect(caught.x).toBeCloseTo(at.x, 6);
    expect(caught.y).toBeCloseTo(at.y, 6);
    const lifted = mouseAt(s, 1_500, FACE, FLOOR);
    expect(lifted.y).toBeLessThan(caught.y);
    expect(mouseAlive(s, 1_200 + MOUSE_CATCH_MS)).toBe(true);
    expect(mouseAlive(s, 1_200 + MOUSE_CATCH_MS + 1)).toBe(false);
    expect(catchMouse(s, 1_300, FACE, FLOOR)).toBe(false);
  });

  it("点中判定按当下位置；点空不抓", () => {
    const s = createMouse(0, 0.4);
    const pos = mouseAt(s, 2_000, FACE, FLOOR);
    expect(mouseAtPoint(s, 2_000, FACE, FLOOR, pos.x, pos.y)).toBe(true);
    expect(mouseAtPoint(s, 2_000, FACE, FLOOR, pos.x + mouseRadius(FACE) + 4, pos.y)).toBe(false);
    expect(catchMouse(s, MOUSE_MS, FACE, FLOOR)).toBe(false);
  });

  it("画法：身体、耳朵、发条、轮子与跑动线；抓住后多光环与星", () => {
    const s = createMouse(0, 0.1);
    const running = buildMouseOps(s, 1_000, FACE, FLOOR);
    expect(running.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(6);
    expect(running.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(finite(running)).toBe(true);

    catchMouse(s, 1_100, FACE, FLOOR);
    const caught = buildMouseOps(s, 1_200, FACE, FLOOR);
    expect(caught.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(caught.length).toBeGreaterThan(running.length - 2);
    expect(finite(caught)).toBe(true);
    expect(buildMouseOps(s, 1_100 + MOUSE_CATCH_MS + 1, FACE, FLOOR)).toEqual([]);
  });
});

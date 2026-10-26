import { describe, expect, it } from "vitest";
import {
  WISH_MS,
  WISH_RISE_MS,
  buildWishOps,
  createWish,
  makeWish,
  wishAlive,
  wishAtPoint,
  wishPhase,
  wishStarAt,
} from "./girl-wish";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildWishOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("许愿星", () => {
  it("时间表：升起 → 悬停 → 淡去 → 收走", () => {
    const s = createWish(0, 0.3);
    expect(wishPhase(s, 0)).toBe("rise");
    expect(wishPhase(s, WISH_RISE_MS - 1)).toBe("rise");
    expect(wishPhase(s, WISH_RISE_MS)).toBe("hover");
    expect(wishAlive(s, WISH_MS - 1)).toBe(true);
    expect(wishAlive(s, WISH_MS)).toBe(false);
  });

  it("星星悬在她头顶、在窗内，且会横向游走", () => {
    const s = createWish(0, 0.2);
    const a = wishStarAt(s, 1_000, FACE);
    const b = wishStarAt(s, 2_600, FACE);
    for (const star of [a, b]) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(82);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(FACE.top + 4);
      expect(star.r).toBeGreaterThan(2);
    }
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(4);
  });

  it("点星星许愿：升起段不认，只认一次", () => {
    const s = createWish(0, 0.1);
    expect(makeWish(s, WISH_RISE_MS - 1)).toBe(false);
    expect(makeWish(s, WISH_RISE_MS + 100)).toBe(true);
    expect(makeWish(s, WISH_RISE_MS + 900)).toBe(false);
    expect(s.wishedAt).toBe(WISH_RISE_MS + 100);
  });

  it("命中区跟着星星走；星星外点不到", () => {
    const s = createWish(0, 0.1);
    const star = wishStarAt(s, 1_500, FACE);
    expect(wishAtPoint(s, 1_500, FACE, star.x, star.y)).toBe(true);
    expect(wishAtPoint(s, 1_500, FACE, star.x - 40, FACE.bottom)).toBe(false);
    expect(wishAtPoint(s, 100, FACE, star.x, star.y)).toBe(false);
  });

  it("画法：星芒 + 光晕 + 许愿后的星屑；坐标全有限，收走后清空", () => {
    const s = createWish(0, 0.4);
    const before = buildWishOps(s, 1_500, FACE);
    makeWish(s, 1_600);
    const after = buildWishOps(s, 1_800, FACE);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(1);
    expect(finite(after)).toBe(true);
    expect(buildWishOps(s, WISH_MS, FACE)).toEqual([]);
  });
});

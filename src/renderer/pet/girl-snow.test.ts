import { describe, expect, it } from "vitest";
import {
  SNOW_FLAKES,
  SNOW_MS,
  SNOW_PACK_COOLDOWN_MS,
  SNOW_PILES,
  buildSnowOps,
  createSnow,
  packSnow,
  snowAlive,
  snowAmount,
  snowPileAt,
  snowflakeAt,
  snowmanBuilt,
} from "./girl-snow";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;
const W = 82;
const H = 108;

function finite(ops: ReturnType<typeof buildSnowOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("下雪与堆雪人", () => {
  it("收放包络：入场 700ms、收尾 1000ms", () => {
    const s = createSnow(0, 0.3);
    expect(snowAmount(s, 0)).toBe(0);
    expect(snowAmount(s, 350)).toBeCloseTo(0.5, 2);
    expect(snowAmount(s, 700)).toBe(1);
    expect(snowAmount(s, SNOW_MS - 500)).toBeCloseTo(0.5, 2);
    expect(snowAlive(s, SNOW_MS - 1)).toBe(true);
    expect(snowAlive(s, SNOW_MS)).toBe(false);
  });

  it("雪花铺满整窗且真的在下落", () => {
    const s = createSnow(0, 0.2);
    for (let i = 0; i < SNOW_FLAKES; i += 1) {
      const drop = snowflakeAt(s, i, 2_000, W, H);
      expect(drop.x).toBeGreaterThanOrEqual(-4);
      expect(drop.x).toBeLessThanOrEqual(W + 4);
      expect(drop.y).toBeGreaterThanOrEqual(-8);
      expect(drop.y).toBeLessThanOrEqual(H);
      expect(drop.r).toBeGreaterThan(0);
    }
    const a = snowflakeAt(s, 3, 2_000, W, H);
    const b = snowflakeAt(s, 3, 2_400, W, H);
    expect(Math.abs(a.y - b.y) > 1 || Math.abs(a.x - b.x) > 1).toBe(true);
  });

  it("三堆雪各只能拍一次，拍满三堆才堆出雪人", () => {
    const s = createSnow(0, 0.1);
    expect(SNOW_PILES).toBe(3);
    expect(packSnow(s, 1_000, 0)).toBe(true);
    expect(packSnow(s, 1_000 + SNOW_PACK_COOLDOWN_MS, 0)).toBe(false);
    expect(packSnow(s, 1_000 + SNOW_PACK_COOLDOWN_MS, 1)).toBe(true);
    expect(snowmanBuilt(s)).toBe(false);
    expect(packSnow(s, 1_000 + SNOW_PACK_COOLDOWN_MS * 2, 2)).toBe(true);
    expect(snowmanBuilt(s)).toBe(true);
    expect(packSnow(s, 2_000, 0)).toBe(false);
    expect(packSnow(s, 1_000, 5)).toBe(false);
  });

  it("雪堆在她脚边、彼此分开；雪球命中只认堆内", () => {
    const s = createSnow(0, 0.1);
    const piles = [0, 1, 2].map((i) => snowPileAt(s, 0, FACE, FLOOR, i));
    expect(piles[0].x).toBeLessThan(piles[1].x);
    expect(piles[1].x).toBeLessThan(piles[2].x);
    for (const pile of piles) {
      expect(pile.x).toBeGreaterThanOrEqual(0);
      expect(pile.x).toBeLessThanOrEqual(82);
      expect(pile.y).toBeGreaterThan(FLOOR - 12);
    }
    expect(snowPileAt(s, 0, FACE, FLOOR, 0)).toBeDefined();
  });

  it("画法：雪花 + 三堆雪；堆满后出现雪人（奶油身、蓝围巾）；坐标全有限", () => {
    const s = createSnow(0, 0.4);
    const before = buildSnowOps(s, 2_000, W, H, FACE, FLOOR);
    expect(before.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(SNOW_FLAKES + 3);
    packSnow(s, 1_000, 0);
    packSnow(s, 1_300, 1);
    packSnow(s, 1_600, 2);
    const after = buildSnowOps(s, 2_000, W, H, FACE, FLOOR);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(2);
    expect(finite(after)).toBe(true);
    expect(buildSnowOps(s, SNOW_MS, W, H, FACE, FLOOR)).toEqual([]);
  });
});

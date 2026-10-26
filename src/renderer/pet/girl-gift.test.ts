import { describe, expect, it } from "vitest";
import {
  GIFT_MS,
  GIFT_OPEN_MIN_MS,
  buildGiftOps,
  createGift,
  giftAlive,
  giftAtPoint,
  giftPhase,
  giftRectFor,
  giftRewardKind,
  openGift,
} from "./girl-gift";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildGiftOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("礼物盒", () => {
  it("时间表：摇一摇 → 拆开 → 收走", () => {
    const s = createGift(0, 0.3);
    expect(giftPhase(s, 0)).toBe("shake");
    expect(giftAlive(s, GIFT_MS - 1)).toBe(true);
    expect(giftAlive(s, GIFT_MS)).toBe(false);
    expect(openGift(s, 400)).toBe(true);
    expect(giftPhase(s, 400)).toBe("open");
  });

  it("拆得太早不认，拆过之后不能再拆", () => {
    const s = createGift(0, 0.1);
    expect(openGift(s, GIFT_OPEN_MIN_MS - 1)).toBe(false);
    expect(openGift(s, GIFT_OPEN_MIN_MS)).toBe(true);
    expect(openGift(s, GIFT_OPEN_MIN_MS + 500)).toBe(false);
    expect(openGift(s, GIFT_MS)).toBe(false);
  });

  it("盒子在她脚边，点盒身才算拆；盒子外点不到", () => {
    const s = createGift(0, 0.1);
    const rect = giftRectFor(s, 1_500, FACE, FLOOR);
    expect(rect.y + rect.h).toBeLessThanOrEqual(FLOOR + 2);
    expect(giftAtPoint(s, 1_500, FACE, FLOOR, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(true);
    expect(giftAtPoint(s, 1_500, FACE, FLOOR, rect.x - 30, rect.y)).toBe(false);
  });

  it("奖励按种子稳定落在小鱼干/心/星三选一", () => {
    expect(["fish", "heart", "star"]).toContain(giftRewardKind(0.1));
    expect(giftRewardKind(0.1)).toBe(giftRewardKind(0.1));
    expect(new Set([giftRewardKind(0.05), giftRewardKind(0.45), giftRewardKind(0.85)]).size).toBe(3);
  });

  it("画法：盒身、缎带、拆开后的彩纸与奖励；坐标全有限，收走后清空", () => {
    const s = createGift(0, 0.4);
    const shakeOps = buildGiftOps(s, 500, FACE, FLOOR);
    expect(shakeOps.filter((op) => op.kind === "fillRoundRect").length).toBeGreaterThanOrEqual(1);
    openGift(s, 800);
    const openOps = buildGiftOps(s, 1_000, FACE, FLOOR);
    expect(openOps.length).toBeGreaterThan(shakeOps.length);
    expect(openOps.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(6);
    expect(finite(openOps)).toBe(true);
    expect(buildGiftOps(s, GIFT_MS, FACE, FLOOR)).toEqual([]);
  });
});

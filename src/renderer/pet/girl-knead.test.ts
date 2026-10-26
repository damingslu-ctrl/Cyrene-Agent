import { describe, expect, it } from "vitest";
import {
  KNEAD_BEAT_COOLDOWN_MS,
  KNEAD_MAX_BEATS,
  KNEAD_MS,
  KNEAD_SETTLE_MS,
  buildKneadOps,
  createKnead,
  kneadAlive,
  kneadAtPoint,
  kneadPads,
  kneadPhase,
  pressKnead,
} from "./girl-knead";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildKneadOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("踩奶", () => {
  it("时间表：铺垫 → 踩 → 收走", () => {
    const s = createKnead(0, 0.3);
    expect(kneadPhase(s, 0)).toBe("settle");
    expect(kneadPhase(s, KNEAD_SETTLE_MS - 1)).toBe("settle");
    expect(kneadPhase(s, KNEAD_SETTLE_MS)).toBe("knead");
    expect(kneadAlive(s, KNEAD_MS - 1)).toBe(true);
    expect(kneadAlive(s, KNEAD_MS)).toBe(false);
  });

  it("两只前爪左右交替起落，落点在她脚前", () => {
    const s = createKnead(0, 0.2);
    const pads = kneadPads(s, 1_200, FACE, FLOOR);
    expect(pads).toHaveLength(2);
    expect(pads[0].x).toBeLessThan(pads[1].x);
    expect(pads[0].x).toBeLessThan(FACE.cx);
    expect(pads[1].x).toBeGreaterThan(FACE.cx);
    for (const pad of pads) {
      expect(pad.y).toBeGreaterThan(FLOOR - 12);
      expect(pad.y).toBeLessThanOrEqual(FLOOR);
      expect(pad.down).toBeGreaterThanOrEqual(0);
      expect(pad.down).toBeLessThanOrEqual(1);
    }
    const later = kneadPads(s, 1_200 + KNEAD_BEAT_COOLDOWN_MS, FACE, FLOOR);
    expect(later[0].down).not.toBe(pads[0].down);
  });

  it("点她胸口跟着踩一拍：铺垫期不认、有冷却、封顶六拍", () => {
    const s = createKnead(0, 0.1);
    expect(pressKnead(s, 200)).toBe(false);
    expect(pressKnead(s, 1_000)).toBe(true);
    expect(pressKnead(s, 1_000 + KNEAD_BEAT_COOLDOWN_MS - 1)).toBe(false);
    let now = 1_000 + KNEAD_BEAT_COOLDOWN_MS;
    while (s.beats < KNEAD_MAX_BEATS) {
      expect(pressKnead(s, now)).toBe(true);
      now += KNEAD_BEAT_COOLDOWN_MS;
    }
    expect(s.beats).toBe(KNEAD_MAX_BEATS);
    expect(pressKnead(s, now)).toBe(false);
  });

  it("命中区在她脚前的一小片垫子上；垫外点不到", () => {
    const s = createKnead(0, 0.1);
    expect(kneadAtPoint(s, 1_000, FACE, FLOOR, FACE.cx, FLOOR - 4)).toBe(true);
    expect(kneadAtPoint(s, 1_000, FACE, FLOOR, FACE.cx, FLOOR - 60)).toBe(false);
    expect(kneadAtPoint(s, 200, FACE, FLOOR, FACE.cx, FLOOR - 4)).toBe(false);
  });

  it("画法：软垫 + 两只爪垫 + 心，坐标全有限；收走后清空", () => {
    const s = createKnead(0, 0.4);
    const ops = buildKneadOps(s, 1_400, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(4);
    expect(finite(ops)).toBe(true);
    expect(buildKneadOps(s, KNEAD_MS, FACE, FLOOR)).toEqual([]);
  });
});

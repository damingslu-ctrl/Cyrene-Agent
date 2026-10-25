import { describe, expect, it } from "vitest";
import {
  BELL_MAX_RINGS,
  BELL_MS,
  BELL_RING_COOLDOWN_MS,
  BELL_RING_MS,
  bellAlive,
  bellAt,
  bellAtPoint,
  bellRadius,
  buildBellOps,
  createBell,
  ringBell,
} from "./girl-bell";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildBellOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("铃铛球", () => {
  it("寿命 5.6s；球在脚边范围内滚动，始终落在地面上方一颗球高处", () => {
    const s = createBell(0, 0.25);
    expect(bellAlive(s, 0)).toBe(true);
    expect(bellAlive(s, BELL_MS - 1)).toBe(true);
    expect(bellAlive(s, BELL_MS)).toBe(false);
    const r = bellRadius(FACE);
    for (let t = 0; t < BELL_MS; t += 400) {
      const pos = bellAt(s, t, FACE, FLOOR);
      expect(Math.abs(pos.x - FACE.cx)).toBeLessThanOrEqual(Math.max(12, Math.min(26, FACE.w * 0.42)) + 0.01);
      expect(pos.y).toBeLessThan(FLOOR);
      expect(pos.y).toBeGreaterThan(FLOOR - r - 5);
    }
  });

  it("摇铃有 360ms 冷却；最多记五声，冷却外继续响但不加计数", () => {
    const s = createBell(0, 0.1);
    expect(ringBell(s, 1_000)).toBe(true);
    expect(ringBell(s, 1_000 + BELL_RING_COOLDOWN_MS - 1)).toBe(false);
    expect(ringBell(s, 1_000 + BELL_RING_COOLDOWN_MS)).toBe(true);
    expect(s.rings).toBe(2);
    for (let i = 0; i < 6; i += 1) ringBell(s, 1_200 + i * (BELL_RING_COOLDOWN_MS + 1));
    expect(s.rings).toBe(BELL_MAX_RINGS);
    expect(ringBell(s, BELL_MS)).toBe(false);
  });

  it("点球命中：按球心现算，球外与收走后都点不到", () => {
    const s = createBell(0, 0.4);
    const pos = bellAt(s, 1_500, FACE, FLOOR);
    expect(bellAtPoint(s, 1_500, FACE, FLOOR, pos.x, pos.y)).toBe(true);
    expect(bellAtPoint(s, 1_500, FACE, FLOOR, pos.x + 20, pos.y)).toBe(false);
    expect(bellAtPoint(s, BELL_MS, FACE, FLOOR, pos.x, pos.y)).toBe(false);
  });

  it("画法：球身、铃铛、铃声环与星齐全；铃声只活 650ms", () => {
    const s = createBell(0, 0.2);
    const plain = buildBellOps(s, 1_000, FACE, FLOOR);
    expect(plain.some((op) => op.kind === "fillEllipse")).toBe(true);
    expect(plain.some((op) => op.kind === "fillPath")).toBe(true);
    expect(finite(plain)).toBe(true);

    ringBell(s, 1_100);
    const ringing = buildBellOps(s, 1_200, FACE, FLOOR);
    expect(ringing.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(ringing.length).toBeGreaterThan(plain.length);
    const after = buildBellOps(s, 1_100 + BELL_RING_MS + 1, FACE, FLOOR);
    expect(after.some((op) => op.kind === "strokeEllipse")).toBe(false);
    expect(buildBellOps(s, BELL_MS, FACE, FLOOR)).toEqual([]);
  });
});

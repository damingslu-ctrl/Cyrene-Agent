import { describe, expect, it } from "vitest";
import {
  LANTERN_COOLDOWN_MS,
  LANTERN_FLARE_MS,
  LANTERN_MS,
  buildLanternOps,
  createLantern,
  flareLantern,
  lanternAge,
  lanternAlive,
  lanternBodyAt,
  lanternFlameAt,
  lanternGlow,
  mothAt,
} from "./girl-lantern";

const FACE = { cx: 41, top: 20, bottom: 54, w: 44, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildLanternOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("入夜小灯笼", () => {
  it("帧时间戳早于出生那一拍时只当刚出生，不许判死", () => {
    const s = createLantern(1_000, 0.35);
    expect(lanternAge(s, 984)).toBe(0);
    expect(lanternAge(s, 1_000 + LANTERN_MS - 1)).toBe(LANTERN_MS - 1);
    expect(lanternAlive(s, 984)).toBe(true);
    expect(buildLanternOps(s, 984, FACE, FLOOR).length).toBeGreaterThan(0);
    expect(lanternAlive(s, 1_000 + LANTERN_MS - 1)).toBe(true);
    expect(lanternAlive(s, 1_000 + LANTERN_MS)).toBe(false);
  });

  it("火光：刚点着很暗，站稳后一直在 0..1 里呼吸，收走前淡到 0", () => {
    const s = createLantern(0, 0.2);
    expect(lanternGlow(s, 0)).toBeLessThan(0.3);
    let min = 1;
    let max = 0;
    let wobble = 0;
    let prev = lanternGlow(s, 1_200);
    for (let t = 1_200; t < LANTERN_MS - 900; t += 29) {
      const g = lanternGlow(s, t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      min = Math.min(min, g);
      max = Math.max(max, g);
      wobble += Math.abs(g - prev);
      prev = g;
    }
    // 「呼吸」要有实际幅度：全程不动的常数灯会被这条判死。
    expect(max - min).toBeGreaterThan(0.06);
    expect(wobble).toBeGreaterThan(1);
    expect(lanternGlow(s, LANTERN_MS - 1)).toBeLessThan(0.05);
  });

  it("风要吹得它晃：提梁与灯身一起摆，但摆幅有界且不出窗", () => {
    const s = createLantern(0, 0.6);
    const a = lanternBodyAt(s, 800, FACE, FLOOR);
    const b = lanternBodyAt(s, 2_400, FACE, FLOOR);
    expect(a.x).not.toBeCloseTo(b.x, 6);
    for (let t = 0; t < LANTERN_MS; t += 31) {
      const body = lanternBodyAt(s, t, FACE, FLOOR);
      expect(Math.abs(body.x - FACE.cx)).toBeLessThan(FACE.w * 0.9);
      expect(body.y + body.h).toBeLessThan(FLOOR + 4);
      const flame = lanternFlameAt(s, t, FACE, FLOOR);
      expect(flame.x).toBeGreaterThan(0);
      expect(flame.x).toBeLessThan(82);
      expect(flame.y).toBeGreaterThan(0);
    }
  });

  it("点一下火苗会炸亮：加光只在窗口内有效，冷却吞掉同拍连点", () => {
    const s = createLantern(0, 0.15);
    // 同 seed 的对照灯：所有亮度比较都在同一时刻做，才不是在比呼吸的相位。
    const ctrl = createLantern(0, 0.15);
    const flame = lanternFlameAt(s, 3_000, FACE, FLOOR);
    expect(flareLantern(s, 3_000, FACE, FLOOR, flame.x, flame.y)).toBe("flare");
    expect(s.flares).toBe(1);
    expect(lanternGlow(s, 3_040)).toBeGreaterThan(lanternGlow(ctrl, 3_040));
    expect(lanternGlow(s, 3_040)).toBeLessThanOrEqual(1);
    expect(flareLantern(s, 3_000 + LANTERN_COOLDOWN_MS - 20, FACE, FLOOR, flame.x, flame.y)).toBe("miss");
    expect(s.flares).toBe(1);
    // 窗口过后回到常态亮度（不许常驻全亮）。
    expect(lanternGlow(s, 3_000 + LANTERN_FLARE_MS + 200)).toBeCloseTo(lanternGlow(ctrl, 3_000 + LANTERN_FLARE_MS + 200), 6);
    // 点偏了不炸亮，过期的灯笼也不响。
    expect(flareLantern(s, 4_000, FACE, FLOOR, flame.x + 30, flame.y)).toBe("miss");
    expect(flareLantern(s, LANTERN_MS, FACE, FLOOR, flame.x, flame.y)).toBe("miss");
  });

  it("命中区就是火苗外扩一圈：贴着边点得到，再外 6px 算点空", () => {
    const s = createLantern(0, 0.9);
    const flame = lanternFlameAt(s, 3_000, FACE, FLOOR);
    expect(flareLantern(s, 3_000, FACE, FLOOR, flame.x, flame.y + flame.r + 2.4)).toBe("flare");
    const s2 = createLantern(0, 0.9);
    expect(flareLantern(s2, 3_000, FACE, FLOOR, flame.x, flame.y + flame.r + 8)).toBe("miss");
    expect(s2.flares).toBe(0);
  });

  it("飞蛾绕着灯火转：一直在火边，轨道闭合但位置随时间走", () => {
    const s = createLantern(0, 0.4);
    const seen = new Set<string>();
    for (let t = 1_000; t < 6_000; t += 137) {
      const moth = mothAt(s, t, FACE, FLOOR)!;
      const flame = lanternFlameAt(s, t, FACE, FLOOR);
      const d = Math.hypot(moth.x - flame.x, moth.y - flame.y);
      expect(d).toBeGreaterThan(4);
      expect(d).toBeLessThan(20);
      seen.add(`${Math.round(moth.x)}:${Math.round(moth.y)}`);
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("画法：灯身双色 + 火苗两层 + 光晕 + 飞蛾；收走为空且全程有限", () => {
    const s = createLantern(0, 0.5);
    const ops = buildLanternOps(s, 2_000, FACE, FLOOR);
    expect(ops.some((op) => op.kind === "strokeRoundRect")).toBe(true);
    expect(ops.some((op) => op.kind === "fillRoundRect")).toBe(true);
    expect(ops.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(ops.some((op) => op.kind === "crescent")).toBe(true);
    expect(finite(ops)).toBe(true);
    flareLantern(s, 2_000, FACE, FLOOR, lanternFlameAt(s, 2_000, FACE, FLOOR).x, lanternFlameAt(s, 2_000, FACE, FLOOR).y);
    const flared = buildLanternOps(s, 2_040, FACE, FLOOR);
    expect(flared.length).toBeGreaterThan(ops.length);
    expect(finite(flared)).toBe(true);
    expect(buildLanternOps(s, LANTERN_MS, FACE, FLOOR)).toEqual([]);
  });
});

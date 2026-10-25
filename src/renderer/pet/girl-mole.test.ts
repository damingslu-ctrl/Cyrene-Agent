import { describe, expect, it } from "vitest";
import {
  MOLE_MS,
  MOLE_POP_MS,
  MOLE_POPS,
  buildMoleOps,
  createMole,
  moleActive,
  moleAlive,
  moleAtPoint,
  moleHeadAt,
  moleHoleAt,
  moleHoleGap,
  whackMole,
} from "./girl-mole";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildMoleOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("打地鼠", () => {
  it("三个洞等距排开，洞心都在脚边", () => {
    const gap = moleHoleGap(FACE);
    const a = moleHoleAt(FACE, FLOOR, 0);
    const b = moleHoleAt(FACE, FLOOR, 1);
    const c = moleHoleAt(FACE, FLOOR, 2);
    expect(b.x).toBe(FACE.cx);
    expect(b.x - a.x).toBeCloseTo(gap, 6);
    expect(c.x - b.x).toBeCloseTo(gap, 6);
    for (const hole of [a, b, c]) expect(hole.y).toBeLessThan(FLOOR);
  });

  it("六次冒头按表走：每次 720ms，同一时刻最多一只", () => {
    const s = createMole(0, 0.3);
    for (const pop of MOLE_POPS) {
      expect(moleActive(s, pop.at - 1)).toBeNull();
      expect(moleActive(s, pop.at)?.slot).toBe(pop.slot);
      expect(moleActive(s, pop.at + MOLE_POP_MS - 1)?.slot).toBe(pop.slot);
      expect(moleActive(s, pop.at + MOLE_POP_MS)).toBeNull();
    }
    expect(moleAlive(s, MOLE_MS - 1)).toBe(true);
    expect(moleAlive(s, MOLE_MS)).toBe(false);
  });

  it("冒头高度：抬起 160ms、收回 180ms；点中判定跟着头部走", () => {
    const s = createMole(0, 0.1);
    const start = moleHeadAt(s, MOLE_POPS[0].at + 40, FACE, FLOOR)!;
    const full = moleHeadAt(s, MOLE_POPS[0].at + 300, FACE, FLOOR)!;
    expect(full.y).toBeLessThan(start.y);
    expect(moleAtPoint(s, MOLE_POPS[0].at + 300, FACE, FLOOR, full.x, full.y)).toBe(true);
    expect(moleAtPoint(s, MOLE_POPS[0].at + 300, FACE, FLOOR, full.x - 20, full.y)).toBe(false);
    expect(moleAtPoint(s, MOLE_POPS[0].at - 1, FACE, FLOOR, full.x, full.y)).toBe(false);
  });

  it("每只地鼠只认一次：敲中记星，重复点吞掉；下一只照常能敲", () => {
    const s = createMole(0, 0.2);
    const first = moleHeadAt(s, MOLE_POPS[0].at + 200, FACE, FLOOR)!;
    expect(whackMole(s, MOLE_POPS[0].at + 200, FACE, FLOOR)).toBe(true);
    expect(s.hits).toBe(1);
    expect(whackMole(s, MOLE_POPS[1].at + 200, FACE, FLOOR)).toBe(true);
    expect(s.hits).toBe(2);
    // 同一只（第 0 号）再点一次：表格里已经记过，不加。
    expect(moleHeadAt(s, MOLE_POPS[0].at + 400, FACE, FLOOR)!.active.index).toBe(0);
    expect(whackMole(s, MOLE_POPS[0].at + 400, FACE, FLOOR)).toBe(false);
    expect(whackMole(s, MOLE_POPS[0].at - 10, FACE, FLOOR)).toBe(false);
    void first;
  });

  it("画法：三个洞 + 冒头的地鼠 + 战果星；收走后为空", () => {
    const s = createMole(0, 0.4);
    const idle = buildMoleOps(s, 100, FACE, FLOOR);
    expect(idle.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(3);
    whackMole(s, MOLE_POPS[0].at + 200, FACE, FLOOR);
    const hitOps = buildMoleOps(s, MOLE_POPS[0].at + 220, FACE, FLOOR);
    expect(hitOps.some((op) => op.kind === "fillPath")).toBe(true);
    expect(hitOps.length).toBeGreaterThan(idle.length);
    expect(finite(hitOps)).toBe(true);
    expect(buildMoleOps(s, MOLE_MS, FACE, FLOOR)).toEqual([]);
  });
});

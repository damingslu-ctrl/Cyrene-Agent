import { describe, expect, it } from "vitest";
import {
  LASER_CATCH_MS, LASER_MS, buildLaserOps, catchLaser, createLaser, laserAlive, laserAt,
  laserAtPoint, laserBoundsFor, laserHitRadius,
} from "./girl-laser";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildLaserOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("激光笔", () => {
  it("红点始终在活动矩形内，且同一时刻解析同一落点", () => {
    const bounds = laserBoundsFor(FACE, FLOOR);
    for (const seed of [0, 0.2, 0.5, 0.8]) {
      for (let t = 0; t <= LASER_MS; t += 211) {
        const dot = laserAt(createLaser(0, seed), t, bounds);
        expect(dot.x).toBeGreaterThanOrEqual(bounds.x0 - 1e-6);
        expect(dot.x).toBeLessThanOrEqual(bounds.x1 + 1e-6);
        expect(dot.y).toBeGreaterThanOrEqual(bounds.y0 - 1e-6);
        expect(dot.y).toBeLessThanOrEqual(bounds.y1 + 1e-6);
      }
    }
    expect(laserAt(createLaser(0, 0.4), 1_234, bounds)).toEqual(laserAt(createLaser(0, 0.4), 1_234, bounds));
  });

  it("红点确实在动（不是一颗钉死的点）", () => {
    const bounds = laserBoundsFor(FACE, FLOOR);
    const a = laserAt(createLaser(0, 0.3), 300, bounds);
    const b = laserAt(createLaser(0, 0.3), 1_400, bounds);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4);
  });

  it("8 秒寿命；扑中后冻结在原地并进入 700ms 炸环", () => {
    const laser = createLaser(0, 0.5);
    const bounds = laserBoundsFor(FACE, FLOOR);
    expect(laserAlive(laser, LASER_MS - 1)).toBe(true);
    expect(laserAlive(laser, LASER_MS)).toBe(false);
    catchLaser(laser, 2_000);
    const frozen = laserAt(laser, 2_000, bounds);
    expect(laserAt(laser, 3_000, bounds)).toEqual(frozen);
    expect(laserAlive(laser, 2_000 + LASER_CATCH_MS)).toBe(true);
    expect(laserAlive(laser, 2_000 + LASER_CATCH_MS + 1)).toBe(false);
  });

  it("命中只认红点附近；重复扑不刷新冻结时刻", () => {
    const laser = createLaser(0, 0.6);
    const bounds = laserBoundsFor(FACE, FLOOR);
    const dot = laserAt(laser, 1_100, bounds);
    const r = laserHitRadius(FACE);
    expect(r).toBeGreaterThanOrEqual(6);
    expect(laserAtPoint(laser, 1_100, bounds, FACE, dot.x, dot.y)).toBe(true);
    expect(laserAtPoint(laser, 1_100, bounds, FACE, dot.x + r + 3, dot.y)).toBe(false);

    catchLaser(laser, 1_100);
    catchLaser(laser, 1_500);
    expect(laser.caughtAt).toBe(1_100);
    expect(laserAtPoint(laser, 1_100, bounds, FACE, dot.x, dot.y)).toBe(false);
  });

  it("画法：奶油光晕 + 玫红芯 + 四道光；扑中后多出炸环，坐标全有限", () => {
    const laser = createLaser(0, 0.2);
    const idle = buildLaserOps(laser, 900, FACE, FLOOR);
    expect(idle.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(3);
    expect(idle.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(4);
    expect(finite(idle)).toBe(true);

    catchLaser(laser, 900);
    const caught = buildLaserOps(laser, 1_200, FACE, FLOOR);
    expect(caught.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(caught.length).toBeGreaterThan(idle.length);
    expect(finite(caught)).toBe(true);
  });
});

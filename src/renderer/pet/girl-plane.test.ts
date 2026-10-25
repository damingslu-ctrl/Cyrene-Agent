import { describe, expect, it } from "vitest";
import {
  PLANE_CATCH_MS, PLANE_FLIGHT_MS, PLANE_MS, buildPlaneOps, catchPlane, createPlane, planeAlive, planeAt, planeAtPoint, planeHitRadius,
} from "./girl-plane";

const FACE = { cx: 41, top: 22, w: 46 };
const FLOOR = 84;

function allNumbersFinite(ops: ReturnType<typeof buildPlaneOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("纸飞机", () => {
  it("横穿 5.6s；整体寿命 7s，接住后进入 900ms 收尾", () => {
    const plane = createPlane(1_000);
    expect(planeAlive(plane, 1_000)).toBe(true);
    expect(planeAlive(plane, 1_000 + PLANE_MS - 1)).toBe(true);
    expect(planeAlive(plane, 1_000 + PLANE_MS)).toBe(false);

    const caught = createPlane(0);
    expect(catchPlane(caught, 2_000, FACE, FLOOR)).toBe(true);
    expect(planeAlive(caught, 2_000 + PLANE_CATCH_MS)).toBe(true);
    expect(planeAlive(caught, 2_000 + PLANE_CATCH_MS + 1)).toBe(false);
  });

  it("从一侧窗沿飞到另一侧：朝右起点在窗外，中途过窗，终点落到对面；朝左镜像", () => {
    const right = createPlane(0, 1, 0.3);
    expect(planeAt(right, 0, FACE, FLOOR).x).toBeLessThan(0);
    expect(planeAt(right, PLANE_FLIGHT_MS, FACE, FLOOR).x).toBeGreaterThan(82);
    const mid = planeAt(right, PLANE_FLIGHT_MS / 2, FACE, FLOOR);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(82);
    expect(mid.y).toBeGreaterThanOrEqual(6);

    const left = createPlane(0, -1, 0.3);
    expect(planeAt(left, 0, FACE, FLOOR).x).toBeGreaterThan(82);
    expect(planeAt(left, PLANE_FLIGHT_MS, FACE, FLOOR).x).toBeLessThan(0);
    expect(planeAt(left, PLANE_FLIGHT_MS / 2, FACE, FLOOR).x).toBeCloseTo(mid.x, 6);
  });

  it("轨迹解析可复现：同参数同落点；飞行进度夹在 0..1", () => {
    const a = planeAt(createPlane(0, 1, 0.7), 2_345, FACE, FLOOR);
    const b = planeAt(createPlane(0, 1, 0.7), 2_345, FACE, FLOOR);
    expect(a).toEqual(b);
    expect(a.p).toBeGreaterThan(0);
    expect(a.p).toBeLessThan(1);
    expect(planeAt(createPlane(0), PLANE_MS * 4, FACE, FLOOR).p).toBe(1);
  });

  it("命中只认机身附近的圆；接住会记下落点，之后不再判", () => {
    const plane = createPlane(0, 1, 0.5);
    const pos = planeAt(plane, 2_400, FACE, FLOOR);
    expect(planeHitRadius(FACE)).toBeGreaterThanOrEqual(7);
    const r = planeHitRadius(FACE);
    expect(planeAtPoint(plane, 2_400, FACE, FLOOR, pos.x, pos.y)).toBe(true);
    expect(planeAtPoint(plane, 2_400, FACE, FLOOR, pos.x + r + 3, pos.y)).toBe(false);
    expect(planeAtPoint(plane, 2_400, FACE, FLOOR, pos.x + r - 1, pos.y)).toBe(true);

    expect(catchPlane(plane, 2_400, FACE, FLOOR)).toBe(true);
    expect(plane.catchX).toBeCloseTo(pos.x, 6);
    expect(plane.catchY).toBeCloseTo(pos.y, 6);
    expect(planeAtPoint(plane, 2_400, FACE, FLOOR, pos.x, pos.y)).toBe(false);
    expect(catchPlane(plane, 2_500, FACE, FLOOR)).toBe(false);
  });

  it("接住后打着旋落到她脚边，最后落在窗内", () => {
    const plane = createPlane(0, 1, 0.5);
    const pos = planeAt(plane, 2_400, FACE, FLOOR);
    catchPlane(plane, 2_400, FACE, FLOOR);
    const end = planeAt(plane, 2_400 + PLANE_CATCH_MS, FACE, FLOOR);
    expect(end.x).toBeCloseTo(FACE.cx - 4, 5);
    expect(end.y).toBeCloseTo(FLOOR - 8, 5);
    expect(Math.abs(end.rot - pos.rot)).toBeGreaterThan(Math.PI * 2);
    expect(end.x).toBeGreaterThan(0);
    expect(end.x).toBeLessThan(82);
  });

  it("快飞出窗的点不到（p>0.985）；画法：航迹 + 双片翼 + 折线，接住后加闪光与爱心且坐标全有限", () => {
    const plane = createPlane(0, 1, 0.2);
    expect(planeAtPoint(plane, PLANE_FLIGHT_MS - 1, FACE, FLOOR, planeAt(plane, PLANE_FLIGHT_MS - 1, FACE, FLOOR).x, planeAt(plane, PLANE_FLIGHT_MS - 1, FACE, FLOOR).y)).toBe(false);

    const flying = buildPlaneOps(plane, 1_800, FACE, FLOOR);
    expect(flying.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(2);
    expect(flying.some((op) => op.kind === "strokePath")).toBe(true);
    expect(allNumbersFinite(flying)).toBe(true);

    catchPlane(plane, 1_800, FACE, FLOOR);
    const caught = buildPlaneOps(plane, 1_800 + 200, FACE, FLOOR);
    expect(caught.length).toBeGreaterThan(flying.length);
    expect(allNumbersFinite(caught)).toBe(true);
    expect(buildPlaneOps(plane, 1_800 + PLANE_CATCH_MS + 1, FACE, FLOOR)).toEqual([]);
  });
});

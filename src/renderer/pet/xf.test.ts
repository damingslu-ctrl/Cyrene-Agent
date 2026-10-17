import { describe, expect, it } from "vitest";
import { Xf, ribbon, cubicTo, quadTo, arc } from "./xf";

describe("Xf", () => {
  it("默认构造 identity", () => {
    const xf = new Xf();
    expect(xf.map([10, 20])).toEqual([10, 20]);
  });

  it("map 以脚部支点 (60, 100) 为心旋转（y 轴向下的屏幕系：+90° 把支点上方 10px 转到支点右侧 10px）", () => {
    const xf = new Xf();
    xf.rot = Math.PI / 2; // 90°
    const p = xf.map([60, 90]); // 10px above foot pivot
    expect(p[0]).toBeCloseTo(70, 1);
    expect(p[1]).toBeCloseTo(100, 1);
  });

  it("map 以脚部支点 (60, 100) 为心缩放", () => {
    const xf = new Xf();
    xf.sx = 2; xf.sy = 2;
    xf.px = 60; xf.py = 100;
    const p = xf.map([60, 90]); // 10px above foot pivot
    expect(p[0]).toBeCloseTo(60, 1);
    expect(p[1]).toBeCloseTo(80, 1); // 100 - 10*2 = 80
  });
});

describe("ribbon", () => {
  it("返回 Point2[] 且两端圆头帽（不少于 3 点）", () => {
    const pts = ribbon([[0, 50], [20, 50]], 4, 4);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("cubicTo / quadTo / arc", () => {
  it("cubicTo 返回 n 点", () => {
    const pts = cubicTo([[0, 0], [20, 0], [20, 20], [20, 40]], 8);
    expect(pts).toHaveLength(8);
  });

  it("quadTo 返回 n 点", () => {
    const pts = quadTo([[0, 0], [10, 20], [20, 40]], 6);
    expect(pts).toHaveLength(6);
  });

  it("arc 恰好返回 n 点（锚点 + 贝塞尔采样，约定：总数 = n）", () => {
    const pts = arc(50, 50, 10, 0, 78, 50);
    expect(pts).toHaveLength(12);
  });
});

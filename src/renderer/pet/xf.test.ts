import { describe, expect, it } from "vitest";
import { Xf, ribbon, cubicTo, quadTo, arc } from "./xf";
import type { Point2 } from "./ops";

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
  it("两侧各 n 点 + 末端 3 个圆头采样点（native ui.rs:221-255：out = left ++ 3 caps ++ right.rev()）", () => {
    const line: Point2[] = [[0, 50], [20, 50], [40, 44]];
    const pts = ribbon(line, 4, 4);
    expect(pts).toHaveLength(line.length * 2 + 3);
    // 圆头那三点必须真的落在末端法线半圈上，不能是三个重复点（平切口就是少了这段）
    const caps = pts.slice(line.length, line.length + 3);
    const end = line[line.length - 1];
    for (const [cx, cy] of caps) {
      expect(Math.hypot(cx - end[0], cy - end[1])).toBeCloseTo(2, 6); // w1/2 = 2
    }
    const distinct = new Set(caps.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
    expect(distinct.size).toBe(3);
    // 首点是 +法线侧（n=(dy,−dx)/len，水平段朝右时法线指向上方）
    expect(pts[0]).toEqual([0, 48]);
    expect(ribbon([[0, 50]], 4, 4)).toEqual([]);
  });
});

describe("cubicTo / quadTo / arc", () => {
  it("cubicTo 返回 n 点（不含段起点，native cubic_to 是 i=1..=N）", () => {
    const pts = cubicTo([[0, 0], [20, 0], [20, 20], [20, 40]], 8);
    expect(pts).toHaveLength(8);
    expect(pts[pts.length - 1]).toEqual([20, 40]); // 终点必须被取到
  });

  it("quadTo 返回 n 点（不含段起点）", () => {
    const pts = quadTo([[0, 0], [10, 20], [20, 40]], 6);
    expect(pts).toHaveLength(6);
    expect(pts[pts.length - 1]).toEqual([20, 40]);
  });

  it("arc = 起点 + N=10 次采样 = 11 点，逐点等于 native ui.rs:187 的二次贝塞尔", () => {
    const pts = arc(50, 50, 10, 0, 78, 50);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([50, 50]);
    expect(pts[10]).toEqual([78, 50]);
    // t=0.5：u²p0 + 2ut·p1 + t²p2 = 0.25·(50,50) + 0.5·(10,0) + 0.25·(78,50)
    expect(pts[5][0]).toBeCloseTo(0.25 * 50 + 0.5 * 10 + 0.25 * 78, 10);
    expect(pts[5][1]).toBeCloseTo(0.25 * 50 + 0.5 * 0 + 0.25 * 50, 10);
  });
});

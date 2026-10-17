import { describe, expect, it } from "vitest";
import { opsBounds } from "./ops";
import type { DrawOp } from "./ops";

describe("opsBounds", () => {
  it("空指令集返回 null（不许返回 0 尺寸框）", () => {
    expect(opsBounds([])).toBeNull();
  });

  it("按路径点求包围盒，椭圆按中心加减半径", () => {
    const ops: DrawOp[] = [
      { kind: "fillPath", fill: "#000", points: [[10, 20], [30, 5]] },
      { kind: "fillEllipse", fill: "#000", cx: 60, cy: 63.5, rx: 10, ry: 3.2 },
    ];
    // 实测 opsBounds: x[10,70]=w60, y[5,66.7]=h61.7（brief 手算值有误）
    expect(opsBounds(ops)).toEqual({ x: 10, y: 5, width: 60, height: 61.7 });
  });
});

import { describe, expect, it } from "vitest";
import {
  PRINT_GAP_MS, PRINT_MAX, PRINT_MS, buildPrintOps, spawnPrint, stepPrints, type PawMark,
} from "./girl-prints";

describe("爪印足迹", () => {
  it("记录屏幕坐标：窗口不动时落回脚下，窗口右移 10px 后脚印向左滑 10px", () => {
    const marks: PawMark[] = [];
    spawnPrint(marks, 1_000, 20, 100, 96, 1);
    expect(marks[0].screenX).toBe(120);

    const atSame = buildPrintOps(marks, 1_000, 100).filter((op) => op.kind === "fillEllipse");
    const atMoved = buildPrintOps(marks, 1_000, 110).filter((op) => op.kind === "fillEllipse");
    const centre = (ops: typeof atSame) => {
      const wide = [...ops].sort((a, b) => (b.rx ?? 0) - (a.rx ?? 0))[0];
      return wide.cx;
    };
    expect(centre(atSame)).toBeCloseTo(20, 6);
    expect(centre(atMoved)).toBeCloseTo(10, 6);
  });

  it("缩放档：屏幕坐标含缩放，画回窗内要除回去", () => {
    const marks: PawMark[] = [];
    spawnPrint(marks, 500, 20, 200, 96, -1, 2);
    expect(marks[0].screenX).toBe(240);
    const ops = buildPrintOps(marks, 500, 200, 2);
    const widest = [...ops.filter((op) => op.kind === "fillEllipse")].sort((a, b) => (b.rx ?? 0) - (a.rx ?? 0))[0];
    expect(widest.cx).toBeCloseTo(20, 6);
  });

  it("3.2 秒淡完；上限 10 枚，旧的先掉；坏时刻（未来）不画", () => {
    const marks: PawMark[] = [];
    for (let i = 0; i < PRINT_MAX + 4; i += 1) spawnPrint(marks, i * PRINT_GAP_MS, 30, 0, 96, 1);
    expect(marks).toHaveLength(PRINT_MAX);
    expect(marks[0].bornAt).toBe(4 * PRINT_GAP_MS);

    expect(buildPrintOps(marks, 13 * PRINT_GAP_MS + PRINT_MS + 1, 0)).toEqual([]);
    stepPrints(marks, 13 * PRINT_GAP_MS + PRINT_MS + 1);
    expect(marks).toHaveLength(0);

    const future = buildPrintOps([{ screenX: 30, originX: 0, localY: 96, facing: 1, bornAt: 5_000 }], 4_000, 0);
    expect(future).toEqual([]);
  });

  it("双色：每枚脚印有奶油底与玫瑰肉垫，坐标全有限", () => {
    const marks: PawMark[] = [];
    spawnPrint(marks, 0, 40, 0, 96, 1);
    const ops = buildPrintOps(marks, 0, 0);
    expect(ops.filter((op) => op.kind === "fillEllipse").length).toBe(8);
    for (const op of ops) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  HOP_COOLDOWN_MS,
  HOP_MS,
  HOP_SQUARES,
  buildHopOps,
  createHopscotch,
  hopAlive,
  hopAtPoint,
  hopSquareAt,
  stepHop,
} from "./girl-hopscotch";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildHopOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("跳格子", () => {
  it("三个粉笔格从左到右排开，都在窗内", () => {
    const s = createHopscotch(0, 0.3);
    const squares = [0, 1, 2].map((i) => hopSquareAt(s, 0, FACE, FLOOR, i as 0 | 1 | 2));
    expect(squares).toHaveLength(HOP_SQUARES);
    expect(squares[0].x).toBeLessThan(squares[1].x);
    expect(squares[1].x).toBeLessThan(squares[2].x);
    for (const sq of squares) {
      expect(sq.x).toBeGreaterThanOrEqual(0);
      expect(sq.x + sq.w).toBeLessThanOrEqual(82);
      expect(sq.y + sq.h).toBeLessThanOrEqual(FLOOR + 2);
    }
    expect(hopAlive(s, HOP_MS - 1)).toBe(true);
    expect(hopAlive(s, HOP_MS)).toBe(false);
  });

  it("必须按 1→2→3 的顺序踩；踩错从头来", () => {
    const s = createHopscotch(0, 0.1);
    expect(stepHop(s, 1_000, 1)).toBe("wrong");
    expect(s.next).toBe(0);
    expect(stepHop(s, 1_300, 0)).toBe("next");
    expect(s.next).toBe(1);
    expect(stepHop(s, 1_600, 0)).toBe("wrong");
    expect(s.next).toBe(0);
    expect(stepHop(s, 1_900, 0)).toBe("next");
    expect(stepHop(s, 2_200, 1)).toBe("next");
    expect(stepHop(s, 2_500, 2)).toBe("done");
    expect(s.next).toBe(HOP_SQUARES);
    expect(stepHop(s, 2_800, 0)).toBe("miss");
  });

  it("同一拍连点会被冷却吞掉，不推进也不重置", () => {
    const s = createHopscotch(0, 0.1);
    expect(stepHop(s, 1_000, 0)).toBe("next");
    expect(stepHop(s, 1_000 + HOP_COOLDOWN_MS - 1, 1)).toBe("miss");
    expect(s.next).toBe(1);
    expect(stepHop(s, 1_000 + HOP_COOLDOWN_MS, 1)).toBe("next");
  });

  it("点格子只认格内；格子之间的空档点不到", () => {
    const s = createHopscotch(0, 0.1);
    const sq = hopSquareAt(s, 1_000, FACE, FLOOR, 1);
    expect(hopAtPoint(s, 1_000, FACE, FLOOR, sq.x + sq.w / 2, sq.y + sq.h / 2)).toBe(1);
    const left = hopSquareAt(s, 1_000, FACE, FLOOR, 0);
    const gapX = (left.x + left.w + sq.x) / 2;
    expect(hopAtPoint(s, 1_000, FACE, FLOOR, gapX, sq.y + sq.h / 2)).toBe(-1);
  });

  it("画法：三只粉笔格 + 点亮序号；坐标全有限，收走后清空", () => {
    const s = createHopscotch(0, 0.4);
    stepHop(s, 1_000, 0);
    const ops = buildHopOps(s, 1_200, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "strokeRoundRect").length).toBeGreaterThanOrEqual(3);
    expect(ops.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(6);
    expect(finite(ops)).toBe(true);
    expect(buildHopOps(s, HOP_MS, FACE, FLOOR)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { RPS_SIGNS } from "../../shared/pet-rps";
import { RPS_MS, buildRpsOps, buildRpsPlayerOps, rpsAnchor } from "./girl-rps";

const FACE = { cx: 41, top: 22, w: 46, h: 34 };

describe("猜拳手型画法", () => {
  it("三只手型都在寿命内画得出，且各自图元不同（不是同一张图）", () => {
    const counts = RPS_SIGNS.map((sign) => buildRpsOps(sign, 600, FACE, 1).length);
    for (const count of counts) expect(count).toBeGreaterThan(4);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it("寿命外（含未来时刻）不画", () => {
    expect(buildRpsOps("rock", -1, FACE, 0)).toEqual([]);
    expect(buildRpsOps("rock", RPS_MS + 1, FACE, 0)).toEqual([]);
    expect(buildRpsOps("paper", RPS_MS, FACE, 0).length).toBeGreaterThan(0);
  });

  it("手型吊在脸上方：锚点在头顶之上，图元坐标全有限", () => {
    const anchor = rpsAnchor(FACE);
    expect(anchor.x).toBe(FACE.cx);
    expect(anchor.y).toBeLessThan(FACE.top);
    const ops = buildRpsOps("scissors", 900, FACE, 2.2);
    for (const op of ops) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill" || key === "stroke") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        if (Array.isArray(value)) expect(value.every((p) => p.every((n: number) => Number.isFinite(n)))).toBe(true);
      }
    }
  });

  it("玩家出牌落在脚边：三手各一张牌，文字取自共享词表", () => {
    for (const sign of RPS_SIGNS) {
      const ops = buildRpsPlayerOps(sign, FACE, 84);
      expect(ops).toHaveLength(3);
      const text = ops.find((op) => op.kind === "text");
      expect(text && "text" in text ? text.text : "").toContain("你出");
      expect(text && "y" in text ? text.y : 0).toBeGreaterThan(84 - 13);
    }
  });
});

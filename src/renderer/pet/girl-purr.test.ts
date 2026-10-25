import { describe, expect, it } from "vitest";
import { PURR_MS, buildPurrOps } from "./girl-purr";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };

function alphas(ops: ReturnType<typeof buildPurrOps>): number[] {
  const out: number[] = [];
  for (const op of ops) {
    const ink = "fill" in op ? op.fill : "stroke" in op ? op.stroke : "";
    const m = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(ink);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

function finite(ops: ReturnType<typeof buildPurrOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("呼噜", () => {
  it("剩 0 毫秒就不画；刚起手还没淡入，淡入后正常出声", () => {
    expect(PURR_MS).toBe(4_000);
    expect(buildPurrOps(FACE, 0, 1_000)).toEqual([]);
    expect(buildPurrOps(FACE, -1, 1_000)).toEqual([]);
    expect(buildPurrOps(FACE, PURR_MS, 1_000)).toEqual([]);
    expect(buildPurrOps(FACE, PURR_MS - 300, 1_000).length).toBeGreaterThan(0);
  });

  it("三圈声纹各两层（奶油粗底 + 玫瑰细线），另有胸口小星", () => {
    const ops = buildPurrOps(FACE, PURR_MS / 2, 1_500);
    const strokes = ops.filter((op) => op.kind === "strokePath");
    expect(strokes.length).toBe(6);
    const widths = strokes.map((op) => (op.kind === "strokePath" ? op.width : 0));
    expect(widths.filter((w) => w === 1.8).length).toBe(3);
    expect(widths.filter((w) => w === 0.8).length).toBe(3);
    expect(ops.some((op) => op.kind === "fillPath")).toBe(true);
    expect(finite(ops)).toBe(true);
  });

  it("淡入 300ms、淡出 600ms：两头比中段轻", () => {
    const sum = (left: number) => alphas(buildPurrOps(FACE, left, 2_000)).reduce((a, b) => a + b, 0);
    expect(sum(PURR_MS - 60)).toBeLessThan(sum(PURR_MS / 2));
    expect(sum(60)).toBeLessThan(sum(PURR_MS / 2));
  });
});

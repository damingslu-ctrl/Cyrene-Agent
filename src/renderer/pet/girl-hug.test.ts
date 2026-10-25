import { describe, expect, it } from "vitest";
import {
  HUG_MAX_TAPS,
  HUG_MS,
  HUG_TAP_COOLDOWN_MS,
  buildHugOps,
  createHug,
  hugAlive,
  hugAtPoint,
  tapHug,
} from "./girl-hug";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildHugOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("抱抱", () => {
  it("3.6 秒寿命；抱紧有 450ms 冷却，最多五下", () => {
    const s = createHug(0, 0.3);
    expect(hugAlive(s, 0)).toBe(true);
    expect(hugAlive(s, HUG_MS - 1)).toBe(true);
    expect(hugAlive(s, HUG_MS)).toBe(false);
    expect(tapHug(s, 1_000)).toBe(true);
    expect(tapHug(s, 1_000 + HUG_TAP_COOLDOWN_MS - 1)).toBe(false);
    for (let i = 0; i < 8; i += 1) tapHug(s, 1_100 + i * (HUG_TAP_COOLDOWN_MS + 1));
    expect(s.taps).toBe(HUG_MAX_TAPS);
    expect(tapHug(s, HUG_MS)).toBe(false);
  });

  it("命中区是上身椭圆：胸口点得到，发顶仍归摸摸头，脚边与窗外点不到", () => {
    expect(hugAtPoint(FACE, FACE.cx, FACE.bottom + FACE.h * 0.3)).toBe(true);
    expect(hugAtPoint(FACE, FACE.cx, FACE.bottom)).toBe(true);
    expect(hugAtPoint(FACE, FACE.cx, FACE.top)).toBe(false);
    expect(hugAtPoint(FACE, FACE.cx + FACE.w * 2, FACE.bottom)).toBe(false);
    expect(hugAtPoint(FACE, FACE.cx, FACE.bottom + FACE.h * 2)).toBe(false);
  });

  it("爱心随点击变多：每一下都叠一层，开场还有一圈地面光，坐标全有限", () => {
    const s = createHug(0, 0.2);
    const one = buildHugOps(s, 700, FACE, FLOOR);
    tapHug(s, 100);
    tapHug(s, 600);
    const three = buildHugOps(s, 700, FACE, FLOOR);
    expect(three.length).toBeGreaterThan(one.length);
    expect(three.some((op) => op.kind === "fillPath")).toBe(true);
    expect(three.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(finite(three)).toBe(true);
    expect(buildHugOps(s, HUG_MS, FACE, FLOOR)).toEqual([]);
  });

  it("开场和收尾都淡：中段最实，末尾渐隐", () => {
    const s = createHug(0, 0.1);
    const early = buildHugOps(s, 60, FACE, FLOOR);
    const middle = buildHugOps(s, 1_500, FACE, FLOOR);
    const late = buildHugOps(s, HUG_MS - 100, FACE, FLOOR);
    const alpha = (ops: ReturnType<typeof buildHugOps>) => {
      const fill = ops.find((op) => op.kind === "fillPath" && typeof op.fill === "string" && op.fill.startsWith("rgba"));
      return fill && "fill" in fill ? Number(fill.fill.match(/, ([0-9.]+)\)$/)?.[1] ?? 0) : 0;
    };
    expect(alpha(middle)).toBeGreaterThan(alpha(late));
    expect(alpha(early)).toBeLessThan(alpha(middle));
  });
});

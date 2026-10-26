import { describe, expect, it } from "vitest";
import {
  TAIL_HIT_COOLDOWN_MS,
  TAIL_MAX_HITS,
  TAIL_MS,
  TAIL_WARMUP_MS,
  buildTailOps,
  chaseTail,
  createTail,
  tailAlive,
  tailPhase,
  tailTipAt,
} from "./girl-tail";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildTailOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("追尾巴", () => {
  it("时间表：热身 → 追 → 收走", () => {
    const s = createTail(0, 0.3);
    expect(tailPhase(s, 0)).toBe("warmup");
    expect(tailPhase(s, TAIL_WARMUP_MS - 1)).toBe("warmup");
    expect(tailPhase(s, TAIL_WARMUP_MS)).toBe("chase");
    expect(tailAlive(s, TAIL_MS - 1)).toBe(true);
    expect(tailAlive(s, TAIL_MS)).toBe(false);
  });

  it("尾巴尖在窗内、贴地高度，且随时间真的在动", () => {
    const s = createTail(0, 0.2);
    const a = tailTipAt(s, 900, FACE, FLOOR);
    const b = tailTipAt(s, 1_500, FACE, FLOOR);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThanOrEqual(82);
    expect(a.y).toBeGreaterThan(FLOOR - 20);
    expect(a.y).toBeLessThanOrEqual(FLOOR);
    expect(a.r).toBeGreaterThanOrEqual(3);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(3);
  });

  it("抓尾巴：点中才计数，有冷却；抓满三下再伸手会被晃晕", () => {
    const s = createTail(0, 0.1);
    const at = (now: number) => {
      const tip = tailTipAt(s, now, FACE, FLOOR);
      return chaseTail(s, now, FACE, FLOOR, tip.x, tip.y);
    };
    expect(chaseTail(s, 900, FACE, FLOOR, -20, -20)).toBe("miss");
    expect(at(1_000)).toBe("hit");
    expect(at(1_000 + TAIL_HIT_COOLDOWN_MS - 1)).toBe("miss");
    expect(at(1_000 + TAIL_HIT_COOLDOWN_MS)).toBe("hit");
    expect(at(2_000 + TAIL_HIT_COOLDOWN_MS)).toBe("hit");
    expect(s.hits).toBe(TAIL_MAX_HITS);
    expect(at(3_000 + TAIL_HIT_COOLDOWN_MS)).toBe("dizzy");
    expect(s.hits).toBe(TAIL_MAX_HITS);
  });

  it("画法：奶油底 + 玫瑰主线 + 尾巴尖，坐标全有限；收走后清空", () => {
    const s = createTail(0, 0.4);
    const tip = tailTipAt(s, 1_200, FACE, FLOOR);
    chaseTail(s, 1_200, FACE, FLOOR, tip.x, tip.y);
    const ops = buildTailOps(s, 1_300, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(2);
    expect(ops.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(3);
    expect(finite(ops)).toBe(true);
    expect(buildTailOps(s, TAIL_MS, FACE, FLOOR)).toEqual([]);
  });
});

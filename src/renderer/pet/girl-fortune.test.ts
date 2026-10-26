import { describe, expect, it } from "vitest";
import {
  FORTUNE_MS,
  FORTUNE_SETTLE_MS,
  FORTUNE_TIERS,
  buildFortuneOps,
  createFortune,
  fortuneAtPoint,
  fortunePhase,
  fortuneSlipAt,
  fortuneTierAt,
  revealFortune,
} from "./girl-fortune";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };

function finite(ops: ReturnType<typeof buildFortuneOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("每日抽签", () => {
  it("四档签：大吉/中吉/小吉/末吉，按 roll 切段", () => {
    expect(FORTUNE_TIERS).toHaveLength(4);
    expect(FORTUNE_TIERS.map((t) => t.name)).toEqual(["大吉", "中吉", "小吉", "末吉"]);
    expect(fortuneTierAt(0)).toBe(0);
    expect(fortuneTierAt(0.119)).toBe(0);
    expect(fortuneTierAt(0.12)).toBe(1);
    expect(fortuneTierAt(0.419)).toBe(1);
    expect(fortuneTierAt(0.42)).toBe(2);
    expect(fortuneTierAt(0.779)).toBe(2);
    expect(fortuneTierAt(0.78)).toBe(3);
    expect(fortuneTierAt(0.999)).toBe(3);
  });

  it("时间表：挂上去 → 可抽 → 收走；签纸在她脸侧", () => {
    const s = createFortune(0, 0.3);
    expect(fortunePhase(s, 0)).toBe("settle");
    expect(fortunePhase(s, FORTUNE_SETTLE_MS - 1)).toBe("settle");
    expect(fortunePhase(s, FORTUNE_SETTLE_MS)).toBe("ready");
    expect(fortunePhase(s, FORTUNE_MS)).toBe("gone");
    const slip = fortuneSlipAt(s, 1_500, FACE);
    expect(slip.x).toBeGreaterThanOrEqual(0);
    expect(slip.x + slip.w).toBeLessThanOrEqual(82);
    expect(slip.y).toBeGreaterThan(FACE.top);
  });

  it("只揭一次；命中区是整张签纸", () => {
    const s = createFortune(0, 0.1);
    const slip = fortuneSlipAt(s, 1_500, FACE);
    expect(fortuneAtPoint(s, 300, FACE, slip.x + slip.w / 2, slip.y + slip.h / 2)).toBe(false);
    expect(fortuneAtPoint(s, 1_500, FACE, slip.x + slip.w / 2, slip.y + slip.h / 2)).toBe(true);
    expect(fortuneAtPoint(s, 1_500, FACE, slip.x - 30, slip.y)).toBe(false);
    expect(revealFortune(s, { tier: 2, line: FORTUNE_TIERS[2].line })).toBe(true);
    expect(s.revealed).toBe(true);
    expect(revealFortune(s, { tier: 0, line: FORTUNE_TIERS[0].line })).toBe(false);
    expect(s.result?.tier).toBe(2);
  });

  it("画法：签纸 + 系绳 + 档位星；揭晓后星数随档位增加；坐标全有限", () => {
    const s = createFortune(0, 0.4);
    const before = buildFortuneOps(s, 1_500, FACE);
    expect(before.filter((op) => op.kind === "fillRoundRect").length).toBeGreaterThanOrEqual(1);
    revealFortune(s, { tier: 3, line: FORTUNE_TIERS[3].line });
    const after = buildFortuneOps(s, 1_800, FACE);
    expect(after.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(4);
    expect(after.length).toBeGreaterThan(before.length - 2);
    expect(finite(after)).toBe(true);
    expect(buildFortuneOps(s, FORTUNE_MS, FACE)).toEqual([]);
  });
});

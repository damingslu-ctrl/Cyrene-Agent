import { describe, expect, it } from "vitest";
import { BOND_TIERS, bondTierOf, dateKey, daysTogether, nightKey } from "./girl-bond";

describe("girl-bond 羁绊档位", () => {
  it("五档门槛单调且称号唯一", () => {
    expect(BOND_TIERS.map((t) => t.name)).toEqual(["初识", "熟悉", "亲近", "依赖", "心意相通"]);
    for (let i = 1; i < BOND_TIERS.length; i += 1) {
      expect(BOND_TIERS[i].min).toBeGreaterThan(BOND_TIERS[i - 1].min);
    }
    expect(new Set(BOND_TIERS.map((t) => t.id)).size).toBe(BOND_TIERS.length);
  });

  it("边界含等号；越界/坏值都落在合法档", () => {
    expect(bondTierOf(0).name).toBe("初识");
    expect(bondTierOf(0.219999).name).toBe("初识");
    expect(bondTierOf(0.22).name).toBe("熟悉");
    expect(bondTierOf(0.45).name).toBe("亲近");
    expect(bondTierOf(0.66).name).toBe("依赖");
    expect(bondTierOf(0.86).name).toBe("心意相通");
    expect(bondTierOf(1).name).toBe("心意相通");
    expect(bondTierOf(-5).name).toBe("初识");
    expect(bondTierOf(Number.NaN).name).toBe("初识");
    expect(bondTierOf(1).nextAt).toBe(1);
    expect(bondTierOf(0.5).nextAt).toBe(0.66);
  });
});

describe("girl-bond 日历", () => {
  it("见面当天算第 1 天，跨日 +1，坏时间戳回 1", () => {
    const morning = new Date(2026, 9, 25, 9, 0, 0).getTime();
    const evening = new Date(2026, 9, 25, 23, 30, 0).getTime();
    const nextDay = new Date(2026, 9, 26, 0, 5, 0).getTime();
    const nextYear = new Date(2027, 0, 1, 0, 5, 0).getTime();
    expect(daysTogether(morning, evening)).toBe(1);
    expect(daysTogether(morning, nextDay)).toBe(2);
    expect(daysTogether(morning, nextYear)).toBe(69);
    expect(daysTogether(Number.NaN, nextDay)).toBe(1);
    expect(daysTogether(nextDay, morning)).toBe(1);
  });

  it("dateKey 本地日期；nightKey 的凌晨算前一晚", () => {
    const late = new Date(2026, 9, 25, 23, 30, 0).getTime();
    const afterMidnight = new Date(2026, 9, 26, 0, 30, 0).getTime();
    expect(dateKey(late)).toBe("2026-10-25");
    expect(dateKey(afterMidnight)).toBe("2026-10-26");
    expect(nightKey(late)).toBe("2026-10-25");
    expect(nightKey(afterMidnight)).toBe("2026-10-25");
    expect(nightKey(new Date(2026, 9, 26, 6, 0, 0).getTime())).toBe("2026-10-26");
  });
});

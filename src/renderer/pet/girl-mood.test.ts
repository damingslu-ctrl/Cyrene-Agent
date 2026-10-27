import { describe, expect, it } from "vitest";
import {
  MOOD_IDS,
  MOOD_LABELS,
  careScore,
  isMoodId,
  moodChatter,
  moodLine,
  moodTuning,
  parseDailyMood,
  rollMood,
} from "./girl-mood";

const care = (pats = 0, plays = 0, feeds = 0, toys = 0) => ({ pats, plays, feeds, toys });

describe("猫娘每日心情", () => {
  it("四种心情都有名字、一句解释与一句闲话", () => {
    expect(MOOD_IDS).toEqual(["lively", "lazy", "clingy", "proud"]);
    for (const id of MOOD_IDS) {
      expect(MOOD_LABELS[id].length).toBeGreaterThan(0);
      expect(moodLine(id).length).toBeGreaterThan(0);
      expect(moodChatter(id).length).toBeGreaterThan(0);
    }
    expect(isMoodId("lively")).toBe(true);
    expect(isMoodId("sleepy")).toBe(false);
  });

  it("昨天的照顾量决定今天的底子：零照顾懒洋洋，摸头多黏人，玩具多精神", () => {
    expect(careScore(care(1, 1, 0, 1))).toBe(4); // 摸头1 + 陪玩2 + 玩具1
    expect(rollMood(care(), 0.5)).toBe("lazy");
    expect(rollMood(care(9, 0, 1, 2), 0.9)).toBe("clingy"); // ≥10 且摸头占多
    expect(rollMood(care(0, 4, 1, 3), 0.2)).toBe("lively"); // ≥10 且陪玩占多
    expect(rollMood(care(3, 1, 0, 1), 0.1)).toBe("proud"); // 中间档 roll<0.35
    expect(rollMood(care(3, 1, 0, 1), 0.6)).toBe("lively");
    expect(rollMood(care(1, 0, 0, 0), 0.2)).toBe("lazy"); // 低档 <0.7
    expect(rollMood(care(1, 0, 0, 0), 0.8)).toBe("proud");
  });

  it("同一份照顾表与同一个 roll 只出一个答案：入口不自己随机", () => {
    const a = rollMood(care(2, 2, 1, 2), 0.42);
    const b = rollMood(care(2, 2, 1, 2), 0.42);
    expect(a).toBe(b);
  });

  it("心情只改节奏：歇多久、亲近快慢、多久说一句，都是有限正数", () => {
    const lively = moodTuning("lively");
    const lazy = moodTuning("lazy");
    expect(lively.restAfterMs).toBeGreaterThan(lazy.restAfterMs);
    expect(lively.affinityScale).toBeGreaterThan(0);
    expect(lively.chatScale).toBeGreaterThan(0);
    expect(lively.chatScale).toBeLessThan(lazy.chatScale);
    for (const id of MOOD_IDS) {
      const t = moodTuning(id);
      expect(Number.isFinite(t.restAfterMs)).toBe(true);
      expect(t.restAfterMs).toBeGreaterThan(10_000);
      expect(t.affinityScale).toBeGreaterThan(0.5);
      expect(t.chatScale).toBeGreaterThan(0.5);
    }
  });

  it("读档：只认合法的日期与心情；坏档返回 null", () => {
    expect(parseDailyMood({ day: "2026-10-27", id: "clingy" })).toEqual({ day: "2026-10-27", id: "clingy" });
    expect(parseDailyMood({ day: "10-27", id: "clingy" })).toBeNull();
    expect(parseDailyMood({ day: "2026-10-27", id: "sleepy" })).toBeNull();
    expect(parseDailyMood(null)).toBeNull();
  });
});

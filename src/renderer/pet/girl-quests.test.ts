import { describe, expect, it } from "vitest";
import {
  DAILY_QUESTS,
  bumpQuest,
  createQuests,
  parseQuests,
  questDone,
  questLine,
  questReport,
  questsAllDone,
  questsDoneCount,
} from "./girl-quests";

describe("今日小目标", () => {
  it("三件小事：摸摸头 5 / 陪它玩 2 / 喂小鱼干 1", () => {
    expect(DAILY_QUESTS.map((q) => [q.id, q.target])).toEqual([
      ["pat", 5],
      ["play", 2],
      ["feed", 1],
    ]);
  });

  it("计到目标为止：只报一次「刚好做完」，多记不溢出", () => {
    const s = createQuests();
    for (let i = 0; i < 4; i += 1) expect(bumpQuest(s, "pat")).toBe(false);
    expect(questDone(s, "pat")).toBe(false);
    expect(bumpQuest(s, "pat")).toBe(true);
    expect(bumpQuest(s, "pat")).toBe(false);
    expect(s.counts.pat).toBe(5);
    expect(bumpQuest(s, "play", 9)).toBe(true);
    expect(s.counts.play).toBe(2);
  });

  it("汇总与四行账：全清时换一句话，行内带勾", () => {
    const s = createQuests();
    bumpQuest(s, "pat", 3);
    bumpQuest(s, "play", 2);
    expect(questsDoneCount(s)).toBe(1);
    expect(questsAllDone(s)).toBe(false);
    expect(questLine(s, "pat")).toBe("· 摸摸头 3/5");
    expect(questLine(s, "play")).toBe("✓ 陪它玩 2/2");
    expect(questReport(s)[0]).toBe("今日小目标 1/3");
    expect(questReport(s)).toHaveLength(1 + DAILY_QUESTS.length);

    bumpQuest(s, "pat", 2);
    bumpQuest(s, "feed", 1);
    expect(questReport(s)[0]).toBe("今日小目标 全清啦");
    expect(questsAllDone(s)).toBe(true);
  });

  it("读盘自愈：坏字段归零，超目标夹回，不污染别的项", () => {
    const s = parseQuests({ counts: { pat: 99, play: -3, feed: "x" } });
    expect(s.counts).toEqual({ pat: 5, play: 0, feed: 0 });
    expect(parseQuests(null).counts).toEqual({ pat: 0, play: 0, feed: 0 });
    expect(parseQuests({ counts: { pat: 2.9 } }).counts.pat).toBe(2);
  });
});

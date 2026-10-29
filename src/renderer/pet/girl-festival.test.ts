// v1.19 节日日历：固定公历日期、下一个节日的倒计时、当天记账键与坏档解析。
import { describe, expect, it } from "vitest";
import {
  FESTIVALS,
  FESTIVAL_ORNAMENTS,
  festivalKey,
  festivalOn,
  nextFestival,
  parseFestivalState,
} from "./girl-festival";
import { wrapBubbleText } from "./art";

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 30, 0).getTime();
/** 气泡内宽 78px、字号 9（art.ts 的 BUBBLE 现算值）：一行的唯一判据。 */
const fitsOneBubbleLine = (text: string) => wrapBubbleText(text, 78, 9).length === 1;

describe("v1.19 节日日历", () => {
  it("五个节日只在当天命中；前一天与后一天都不算", () => {
    const hits: Array<[number, number, string]> = [
      [1, 1, "new-year"],
      [2, 14, "valentine"],
      [6, 1, "children"],
      [10, 31, "halloween"],
      [12, 25, "christmas"],
    ];
    for (const [m, d, id] of hits) {
      expect(festivalOn(day(2026, m, d))?.id, `${m}-${d}`).toBe(id);
      const prev = new Date(2026, m - 1, d - 1, 12, 30, 0).getTime();
      const next = new Date(2026, m - 1, d + 1, 12, 30, 0).getTime();
      expect(festivalOn(prev), `${m}-${d} 前一天`).toBe(null);
      if (!(m === 1 && d === 1)) expect(festivalOn(next), `${m}-${d} 后一天`).toBe(null);
    }
    // 12-24 平安夜不在表里：不硬凑一个「平安夜也算圣诞」。
    expect(festivalOn(day(2026, 12, 24))).toBe(null);
    expect(festivalOn(day(2026, 12, 26))).toBe(null);
  });

  it("节日条目完整：id/名字/台词/挂饰都不重样，台词装得进气泡", () => {
    expect(FESTIVALS.length).toBe(5);
    const ids = new Set(FESTIVALS.map((f) => f.id));
    const labels = new Set(FESTIVALS.map((f) => f.label));
    const lines = new Set(FESTIVALS.map((f) => f.line));
    expect(ids.size).toBe(5);
    expect(labels.size).toBe(5);
    expect(lines.size).toBe(5);
    for (const entry of FESTIVALS) {
      expect(FESTIVAL_ORNAMENTS).toContain(entry.ornament);
      expect(entry.line.length).toBeGreaterThan(2);
      // 节日台词是整句直接进气泡的：拿真实断行器量，必须一行装得下。
      expect(fitsOneBubbleLine(entry.line), entry.line).toBe(true);
    }
    expect(new Set(FESTIVALS.map((f) => f.ornament)).size).toBe(5);
  });

  it("下一个节日永远严格在今天之后：跨年从 12-26 数到元旦", () => {
    const after = nextFestival(day(2026, 12, 26));
    expect(after.def.id).toBe("new-year");
    expect(after.days).toBe(6);
    expect(after.year).toBe(2027);

    expect(nextFestival(day(2026, 1, 1)).def.id).toBe("valentine");
    expect(nextFestival(day(2026, 1, 1)).days).toBe(44);
    expect(nextFestival(day(2026, 2, 14)).def.id).toBe("children");
    expect(nextFestival(day(2026, 2, 14)).days).toBe(107);
  });

  it("当天问「下一个」不会把自己再报一遍", () => {
    const today = nextFestival(day(2026, 10, 31));
    expect(today.def.id).toBe("christmas");
    expect(today.days).toBe(55);
  });

  it("记账键带年份与日期：同一天同一节稳定，跨年就换键", () => {
    const key = festivalKey(FESTIVALS[0], day(2026, 1, 1, 0));
    expect(key).toBe("new-year:2026-01-01");
    expect(festivalKey(FESTIVALS[0], day(2026, 1, 1, 23))).toBe(key);
    expect(festivalKey(FESTIVALS[0], day(2027, 1, 1))).toBe("new-year:2027-01-01");
  });

  it("坏档读成「没记过」；正常档只收合法键并把次数夹在合理区间", () => {
    expect(parseFestivalState(null)).toEqual({ last: "", count: 0 });
    expect(parseFestivalState({ last: 42, count: "x" })).toEqual({ last: "", count: 0 });
    // 记账键坏了不许把已经数过的次数一起丢掉：两件事各管各的。
    expect(parseFestivalState({ last: "day:7", count: 2 })).toEqual({ last: "", count: 2 });
    expect(parseFestivalState({ last: "new-year:2026-01-01", count: 3 }))
      .toEqual({ last: "new-year:2026-01-01", count: 3 });
    expect(parseFestivalState({ last: "new-year:2026-01-01", count: 1e9 }).count).toBe(1_000_000);
    expect(parseFestivalState({ last: "new-year:2026-01-01", count: -5 })).toEqual({ last: "new-year:2026-01-01", count: 0 });
  });
});

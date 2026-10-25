import { describe, expect, it } from "vitest";
import {
  DIARY_MAX,
  composeDiaryLine,
  diaryLine,
  diaryReport,
  formatDiaryDay,
  parseDiary,
  pushDiary,
} from "./girl-diary";

describe("猫咪日记", () => {
  it("日期排版：10月25日；坏键原样返回", () => {
    expect(formatDiaryDay("2026-10-25")).toBe("10月25日");
    expect(formatDiaryDay("2026-01-09")).toBe("1月9日");
    expect(formatDiaryDay("哪天")).toBe("哪天");
  });

  it("一天挑两笔最大的事；什么都没发生就老实说安静", () => {
    expect(composeDiaryLine({ pats: 12, plays: 3, feeds: 0, toys: 5 })).toBe("被摸 12 下，玩具 5 次");
    expect(composeDiaryLine({ feeds: 2 })).toBe("吃了 2 顿");
    expect(composeDiaryLine({})).toBe("安安静静待了一天");
    expect(composeDiaryLine({ pats: -4, toys: 1.9 })).toBe("玩具 1 次");
  });

  it("同一天只留一条，最多七条，新的在末尾", () => {
    let entries: ReturnType<typeof parseDiary> = [];
    for (let i = 1; i <= 9; i += 1) {
      entries = pushDiary(entries, { day: `2026-10-0${i}`, text: `第 ${i} 天` });
    }
    expect(entries).toHaveLength(DIARY_MAX);
    expect(entries[entries.length - 1].day).toBe("2026-10-09");
    const replaced = pushDiary(entries, { day: "2026-10-09", text: "改写过" });
    expect(replaced).toHaveLength(DIARY_MAX);
    expect(replaced.filter((e) => e.day === "2026-10-09")).toEqual([{ day: "2026-10-09", text: "改写过" }]);
  });

  it("四行账：标题 + 今天 + 最近两条（新的在上）；没旧账时给空态", () => {
    const entries = [
      { day: "2026-10-21", text: "旧一" },
      { day: "2026-10-22", text: "旧二" },
      { day: "2026-10-23", text: "旧三" },
    ];
    const report = diaryReport(entries, { day: "2026-10-25", text: "被摸 4 下" });
    expect(report).toHaveLength(4);
    expect(report[0]).toBe("猫咪日记");
    expect(report[1]).toBe("10月25日 被摸 4 下");
    expect(report[2]).toBe("10月23日 旧三");
    expect(report[3]).toBe("10月22日 旧二");

    const empty = diaryReport([], { day: "2026-10-25", text: "被摸 4 下" });
    expect(empty).toHaveLength(3);
    expect(empty[2]).toBe("更早的日子还没写");
    expect(diaryLine({ day: "2026-10-24", text: "玩疯 2 回" })).toBe("10月24日 玩疯 2 回");
  });

  it("读盘自愈：坏条目丢掉，超长截断，最多七条", () => {
    const raw = [
      null,
      { day: "bad", text: "x" },
      { day: "2026-10-01", text: "" },
      { day: "2026-10-02", text: "好" },
      ...Array.from({ length: 9 }, (_, i) => ({ day: `2026-09-${String(i + 10).padStart(2, "0")}`, text: "x".repeat(60) })),
    ];
    const parsed = parseDiary(raw);
    expect(parsed).toHaveLength(DIARY_MAX);
    expect(parsed[0].day).toBe("2026-09-12");
    expect(parsed.every((e) => e.text.length <= 40)).toBe(true);
    expect(parseDiary("nope")).toEqual([]);
  });
});

// v1.19 她的时辰：八段边界、天色记号、报时格式、自动作息窗。
import { describe, expect, it } from "vitest";
import {
  AUTO_SLEEP_FROM_MINUTE,
  AUTO_SLEEP_IDLE_MS,
  AUTO_WAKE_MINUTE,
  PHASES,
  SKY_KINDS,
  autoSleepAt,
  autoWakeAt,
  clockAt,
  clockLine,
  normalizeClockKey,
  normalizeWatchedKey,
  parseSkies,
  phaseAtMinute,
  phaseKey,
  phaseLine,
  skyLine,
  watchedKey,
} from "./girl-clock";
import { wrapBubbleText } from "./art";

const at = (h: number, m = 0, day = 12) => new Date(2026, 9, day, h, m, 0).getTime();
/** 气泡内宽 78px、字号 9（art.ts 的 BUBBLE 现算值）：一行的唯一判据。 */
const fitsOneBubbleLine = (text: string) => wrapBubbleText(text, 78, 9).length === 1;

describe("v1.19 时辰分段", () => {
  it("八段的边界逐分钟钉住（含 0 点与 24 点前最后一分钟）", () => {
    const cases: Array<[number, string]> = [
      [0, "late"], [299, "late"],
      [300, "dawn"], [419, "dawn"],
      [420, "morning"], [659, "morning"],
      [660, "noon"], [779, "noon"],
      [780, "afternoon"], [1019, "afternoon"],
      [1020, "dusk"], [1139, "dusk"],
      [1140, "evening"], [1319, "evening"],
      [1320, "night"], [1439, "night"],
    ];
    for (const [minute, phase] of cases) {
      expect(phaseAtMinute(minute), `minute ${minute}`).toBe(phase);
    }
  });

  it("越界与坏数退回凌晨，不抛错", () => {
    expect(phaseAtMinute(-1)).toBe("late");
    expect(phaseAtMinute(1440)).toBe("night");
    expect(phaseAtMinute(Number.NaN)).toBe("late");
    expect(clockAt(Number.NaN).hhmm).toBe("00:00");
  });

  it("每段都有唯一的名字与一句换段台词，句子短到 78px 气泡装得下", () => {
    const labels = new Set<string>();
    const lines = new Set<string>();
    for (const def of PHASES) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(labels.has(def.label), def.label).toBe(false);
      labels.add(def.label);
      const line = phaseLine(def.phase);
      expect(line.length).toBeGreaterThan(2);
      // 不是数汉字个数，是拿真实断行器量：整句必须能落在一行里。
      expect(fitsOneBubbleLine(line), line).toBe(true);
      expect(lines.has(line), line).toBe(false);
      lines.add(line);
    }
    expect(labels.size).toBe(8);
  });

  it("只有清晨/黄昏/夜里有天色可看，三种记号各一句且互不相同", () => {
    expect(clockAt(at(5, 30)).sky).toBe("sunrise");
    expect(clockAt(at(18, 0)).sky).toBe("sunset");
    expect(clockAt(at(23, 0)).sky).toBe("moon");
    for (const h of [7, 11, 13, 19, 3]) expect(clockAt(at(h)).sky, `${h} 点`).toBe(null);

    // 天色集合就是这三样，表里表外不许各说各话。
    expect([...SKY_KINDS].sort()).toEqual(["moon", "sunrise", "sunset"]);
    expect(new Set(PHASES.map((def) => def.sky).filter(Boolean))).toEqual(new Set(SKY_KINDS));

    const lines = new Set(SKY_KINDS.map((kind) => skyLine(kind)));
    expect(lines.size).toBe(3);
    for (const line of lines) expect(fitsOneBubbleLine(line), line).toBe(true);
  });

  it("报时用本地时间、补零到四位", () => {
    expect(clockAt(at(7, 5)).hhmm).toBe("07:05");
    expect(clockAt(at(18, 20)).hhmm).toBe("18:20");
    expect(clockAt(at(0, 0)).hhmm).toBe("00:00");
    expect(clockLine(at(18, 20))).toBe("黄昏 · 18:20");
    expect(clockLine(at(23, 59))).toBe("夜里 · 23:59");
    // 报时行会被引擎拼进多行卡片：去掉「现在是」之后必须仍是一行。
    expect(fitsOneBubbleLine(clockLine(at(18, 20)))).toBe(true);
  });

  it("换段的记账键带日期：同一天同一段只算一次，跨天/跨段都要变", () => {
    const a = phaseKey(at(7, 0));
    expect(phaseKey(at(7, 59))).toBe(a);
    expect(phaseKey(at(11, 0))).not.toBe(a);
    expect(phaseKey(new Date(2026, 9, 13, 7, 0, 0).getTime())).not.toBe(a);
    expect(a.endsWith(":morning")).toBe(true);
  });
});

describe("v1.19 天色与读档", () => {
  it("天色记账键是「日期:种类」：同一天同一场看一次，跨天换键", () => {
    const key = watchedKey(at(18, 20), "sunset");
    expect(key).toBe("2026-10-12:sunset");
    expect(watchedKey(at(18, 59), "sunset")).toBe(key);
    expect(watchedKey(new Date(2026, 9, 13, 18, 20).getTime(), "sunset")).not.toBe(key);
    expect(watchedKey(at(18, 20), "moon")).not.toBe(key);
  });

  it("坏键读成空串；合法键逐字节保留", () => {
    expect(normalizeWatchedKey("2026-10-12:sunset")).toBe("2026-10-12:sunset");
    expect(normalizeWatchedKey("sunset:2026-10-12")).toBe("");
    expect(normalizeWatchedKey("2026-10-12:rainbow")).toBe("");
    expect(normalizeWatchedKey(42)).toBe("");
    expect(normalizeClockKey("2026-10-12:dusk")).toBe("2026-10-12:dusk");
    expect(normalizeClockKey("2026-10-12:teatime")).toBe("");
    expect(normalizeClockKey(null)).toBe("");
    // 校验表必须跟着 PHASES/SKY_KINDS 走：新增一段/一种天色忘了改正则，这里先红。
    for (const def of PHASES) {
      const wall = at(Math.floor(def.fromMinute / 60), def.fromMinute % 60);
      expect(normalizeClockKey(phaseKey(wall)), def.phase).toBe(phaseKey(wall));
    }
    for (const kind of SKY_KINDS) {
      expect(normalizeWatchedKey(watchedKey(at(18), kind)), kind).toBe(watchedKey(at(18), kind));
    }
  });

  it("天色账本只收非负整数：坏值逐项归零，不连坐另一笔", () => {
    expect(parseSkies(null)).toEqual({ sunrise: 0, sunset: 0, moon: 0 });
    expect(parseSkies({ sunrise: "x", sunset: -1, moon: 2.9 })).toEqual({ sunrise: 0, sunset: 0, moon: 2 });
    expect(parseSkies({ sunrise: 3, sunset: 1, moon: 1e9 }))
      .toEqual({ sunrise: 3, sunset: 1, moon: 1_000_000 });
  });
});

describe("v1.19 自动作息窗", () => {
  it("23:30 起、05:00 止：两端都按分钟卡", () => {
    expect(AUTO_SLEEP_FROM_MINUTE).toBe(23 * 60 + 30);
    expect(AUTO_WAKE_MINUTE).toBe(5 * 60);
    expect(autoSleepAt(23 * 60 + 29)).toBe(false);
    expect(autoSleepAt(23 * 60 + 30)).toBe(true);
    expect(autoSleepAt(0)).toBe(true);
    expect(autoSleepAt(4 * 60 + 59)).toBe(true);
    expect(autoSleepAt(5 * 60)).toBe(false);
    expect(autoSleepAt(12 * 60)).toBe(false);
  });

  it("醒来的判据正好是「不在睡窗里」，没有第二套边界", () => {
    for (const minute of [0, 299, 300, 720, 1409, 1410, 1439]) {
      expect(autoWakeAt(minute), `${minute}`).toBe(!autoSleepAt(minute));
    }
  });

  it("自动睡的门槛是 3 分钟的「你不在」", () => {
    expect(AUTO_SLEEP_IDLE_MS).toBe(180_000);
  });
});

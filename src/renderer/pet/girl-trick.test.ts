import { describe, expect, it } from "vitest";
import { TRICK_IDS, trickCommandFor, trickFromCommand } from "../../shared/pet-trick";
import {
  TRICKS,
  createTricks,
  parseTricks,
  teachTrick,
  trickLearned,
  trickReport,
  tricksLearned,
} from "./girl-trick";

describe("小把戏训练", () => {
  it("四件把戏各有名字、手势与学习次数", () => {
    expect(TRICKS.map((t) => t.id)).toEqual(["high-five", "spin", "nod", "shy"]);
    for (const t of TRICKS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.gesture.length).toBeGreaterThan(0);
      expect(t.need).toBeGreaterThanOrEqual(2);
    }
  });

  it("练到次数才学会；学会那一下返回 learned，然后再教只回 already", () => {
    const s = createTricks();
    const trick = TRICKS[0];
    for (let i = 1; i < trick.need; i += 1) {
      const r = teachTrick(s, trick.id);
      expect(r.learned).toBe(false);
      expect(r.already).toBe(false);
      expect(r.count).toBe(i);
    }
    const hit = teachTrick(s, trick.id);
    expect(hit).toMatchObject({ learned: true, already: false, count: trick.need, need: trick.need });
    expect(trickLearned(s, trick.id)).toBe(true);
    const again = teachTrick(s, trick.id);
    expect(again).toMatchObject({ learned: false, already: true, count: trick.need });
  });

  it("三件学会＝把戏大师；报告四行，学过的打勾", () => {
    const s = createTricks();
    for (const t of TRICKS.slice(0, 3)) {
      for (let i = 0; i < t.need; i += 1) teachTrick(s, t.id);
    }
    expect(tricksLearned(s)).toBe(3);
    const report = trickReport(s);
    expect(report.length).toBe(TRICKS.length + 1);
    expect(report[0]).toContain("3");
    expect(report[1].startsWith("✓")).toBe(true);
    expect(report[4].startsWith("·")).toBe(true);
  });

  it("读档：坏值夹回合法范围，学会状态由次数推出来", () => {
    const s = parseTricks({
      counts: { "high-five": 99, spin: -3, bogus: 8 },
    });
    expect(s.counts["high-five"]).toBe(TRICKS[0].need);
    expect(s.counts.spin).toBe(0);
    expect(trickLearned(s, "high-five")).toBe(true);
    expect(trickLearned(s, "spin")).toBe(false);
    expect(parseTricks(null).counts.nod).toBe(0);
  });

  it("命令表的把戏 id 与本模块一一对应（改名只改一边会当场红）", () => {
    expect([...TRICK_IDS]).toEqual(TRICKS.map((t) => t.id));
    for (const t of TRICKS) expect(trickFromCommand(trickCommandFor(t.id))).toBe(t.id);
  });
});

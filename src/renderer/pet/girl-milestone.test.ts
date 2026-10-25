import { describe, expect, it } from "vitest";
import { MILESTONES, milestoneFor, milestoneKey, parseCelebrated } from "./girl-milestone";

describe("纪念日", () => {
  it("只认 7/30/100/365 天，其余是普通的一天", () => {
    expect(MILESTONES).toEqual([7, 30, 100, 365]);
    expect(milestoneFor(7)).toBe(7);
    expect(milestoneFor(30)).toBe(30);
    expect(milestoneFor(100)).toBe(100);
    expect(milestoneFor(365)).toBe(365);
    expect(milestoneFor(6)).toBeNull();
    expect(milestoneFor(8)).toBeNull();
    expect(milestoneFor(0)).toBeNull();
    expect(milestoneFor(Number.NaN)).toBeNull();
  });

  it("同一个纪念日只有一个键；坏存档读成空表、重复键只留一份", () => {
    expect(milestoneKey(7)).toBe("day:7");
    expect(parseCelebrated(["day:7", "day:7", 3, null, "day:30"])).toEqual(["day:7", "day:30"]);
    expect(parseCelebrated("day:7")).toEqual([]);
    expect(parseCelebrated(null)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  TREASURES,
  createTreasures,
  findTreasure,
  parseTreasures,
  treasureReport,
  treasureTotal,
} from "./girl-treasure";

describe("拾荒收藏", () => {
  it("六件小东西都有名字；初始空账", () => {
    expect(TREASURES.length).toBe(6);
    const s = createTreasures();
    expect(treasureTotal(s)).toBe(0);
    expect(treasureReport(s).join("\n")).toContain("还没");
  });

  it("roll 决定捡到哪一件：边界 0 取第一件，0.999 取最后一件", () => {
    const a = findTreasure(createTreasures(), 0);
    expect(a.id).toBe(TREASURES[0].id);
    const b = findTreasure(createTreasures(), 0.999999);
    expect(b.id).toBe(TREASURES[TREASURES.length - 1].id);
    expect(b.total).toBe(1);
    expect(b.count).toBe(1);
  });

  it("同一件再捡到会累计；报告只列捡到过的", () => {
    const s = createTreasures();
    for (let i = 0; i < 3; i += 1) findTreasure(s, 0);
    const last = findTreasure(s, 0.5);
    expect(last.total).toBe(4);
    const report = treasureReport(s);
    expect(report[0]).toContain("4");
    expect(report.length).toBe(1 + 2);
    expect(report.join("\n")).toContain("×3");
  });

  it("读档：负数/小数/未知 id 都不进账", () => {
    const s = parseTreasures({
      counts: { [TREASURES[0].id]: 2.9, [TREASURES[1].id]: -4, bogus: 5 },
    });
    expect(s.counts[TREASURES[0].id]).toBe(2);
    expect(s.counts[TREASURES[1].id]).toBe(0);
    expect(treasureTotal(s)).toBe(2);
  });
});

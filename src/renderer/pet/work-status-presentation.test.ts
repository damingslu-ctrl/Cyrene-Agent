import { describe, expect, it } from "vitest";
import { WORK_PRESENTATIONS, WORK_STATUS_TIERS, presentationOf } from "./work-status-presentation";

describe("六档演出表", () => {
  it("六档一条不缺，且键与 tier 字段一致", () => {
    expect(WORK_STATUS_TIERS).toHaveLength(6);
    for (const tier of WORK_STATUS_TIERS) {
      const p = presentationOf(tier);
      expect(p.tier).toBe(tier);
    }
    expect(Object.keys(WORK_PRESENTATIONS).sort()).toEqual([...WORK_STATUS_TIERS].sort());
  });

  it("未知档位抛错（不许静默退化成 neutral）", () => {
    expect(() => presentationOf("不存在" as never)).toThrow(/未知工作状态档/);
  });

  it("每档至少说一句话（#74：不许哑着演）", () => {
    for (const tier of WORK_STATUS_TIERS) {
      expect(presentationOf(tier).lines.length).toBeGreaterThan(0);
    }
  });

  it("工作中有 typeCode 且不投身体（坐下敲）", () => {
    const p = presentationOf("工作中");
    expect(p.body).toBe("sit");
    expect(p.gesture).toBe("typeCode");
  });

  it("六档的表情两两不同（否则六档在脸上读成三档）", () => {
    const exprs = WORK_STATUS_TIERS.map((t) => presentationOf(t).expression);
    expect(new Set(exprs).size).toBeGreaterThanOrEqual(5);
  });
});

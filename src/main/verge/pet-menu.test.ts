import { describe, expect, it } from "vitest";
import { buildPetMenuItems } from "./pet-menu";

const now = 1_700_000_000_000;

describe("buildPetMenuItems", () => {
  it("安静期间标题变成「安静中 · 剩 N 分」且那条被禁用", () => {
    const items = buildPetMenuItems({ quietUntil: now + 5 * 60_000, now, tuckEnabled: true });
    expect(items[0].label).toBe("安静中 · 剩 5 分");
    expect(items[0].enabled).toBe(false);
    expect(items[1].label).toBe("取消安静");
  });

  it("不在安静期时第一项是「安静半小时」且可点（负判据配正对照）", () => {
    const items = buildPetMenuItems({ quietUntil: null, now, tuckEnabled: true });
    expect(items[0]).toMatchObject({ label: "安静半小时", enabled: true });
  });

  it("藏身开关的勾与状态一致", () => {
    expect(buildPetMenuItems({ quietUntil: null, now, tuckEnabled: false })[2]).toMatchObject({
      label: "贴边藏身", checked: false,
    });
  });
});

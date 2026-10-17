import { describe, expect, it } from "vitest";
import { shouldApplyBounds } from "./pet-bounds";

describe("shouldApplyBounds", () => {
  it("同一位置重复请求不发指令（native 的 >0.5 去重）", () => {
    expect(
      shouldApplyBounds({ x: 100, y: 100, width: 82, height: 108 }, { x: 100, y: 100, width: 82, height: 108 }),
    ).toBe(false);
  });

  it("0.4px 抖动忽略，0.6px 位移应用", () => {
    const base = { x: 100, y: 100, width: 82, height: 108 };
    expect(shouldApplyBounds(base, { ...base, x: 100.4 })).toBe(false);
    expect(shouldApplyBounds(base, { ...base, x: 100.6 })).toBe(true);
  });

  it("尺寸与位置各自独立判断（展开动画期间两条指令分别发）", () => {
    const base = { x: 100, y: 100, width: 82, height: 108 };
    expect(shouldApplyBounds(base, { ...base, width: 248, height: 482 })).toBe(true);
  });
});

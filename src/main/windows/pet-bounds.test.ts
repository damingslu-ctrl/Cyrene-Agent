import { describe, expect, it } from "vitest";
import { shouldApplyBounds } from "./pet-bounds";

const BASE = { x: 100, y: 100, width: 82, height: 108 };

describe("shouldApplyBounds", () => {
  it("同一 bounds 重复请求：两条门都不开", () => {
    expect(shouldApplyBounds(BASE, { ...BASE })).toEqual({ move: false, size: false });
  });

  it("位移 0.6 / 尺寸 0 → 只开位置门（只发 setPosition）", () => {
    expect(shouldApplyBounds(BASE, { ...BASE, x: 100.6 })).toEqual({ move: true, size: false });
  });

  it("位移 0 / 尺寸 0.6 → 只开尺寸门（只发 setSize）", () => {
    expect(shouldApplyBounds(BASE, { ...BASE, width: 82.6 })).toEqual({ move: false, size: true });
  });

  it("位移 0.4 + 尺寸 0.4 → 一条都不发（合式 4 维求和会误判为 0.566 > 0.5）", () => {
    expect(shouldApplyBounds(BASE, { x: 100.4, y: 100, width: 82.4, height: 108 })).toEqual({
      move: false,
      size: false,
    });
  });

  it("收起 → 面板档：尺寸门开，位置按锚点左移时也开", () => {
    expect(shouldApplyBounds(BASE, { x: 100, y: 100, width: 248, height: 482 })).toEqual({
      move: false,
      size: true,
    });
    expect(shouldApplyBounds(BASE, { x: -66, y: 100, width: 248, height: 482 })).toEqual({
      move: true,
      size: true,
    });
  });
});

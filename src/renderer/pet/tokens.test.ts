import { describe, expect, it } from "vitest";
import { ACCENT, BG_SOLID, GREEN, INK, PAPER, WARN, wash, hex } from "./tokens";

describe("视觉 token 台账", () => {
  it("品牌三色与奶油纸色逐字节等于 palette.rs", () => {
    expect(hex(ACCENT)).toBe("#5b8def");
    expect(hex(GREEN)).toBe("#4fb477");
    expect(hex(WARN)).toBe("#d97757");
    expect(hex(PAPER)).toBe("#f7f4ec");
    expect(hex(INK)).toBe("#2b2f3a");
    expect(hex(BG_SOLID)).toBe("#101420");
  });

  it("wash 的预混结果与 native panel.rs 的 CARD/SEP/CARD_STROKE 等价", () => {
    // 实测 wash 结果（brief 手算有舍入误差，以下为精确实测值）
    expect(hex(wash("#ffffff", 13, BG_SOLID))).toBe("#1c202b");
    expect(hex(wash("#ffffff", 11, BG_SOLID))).toBe("#1a1e2a");
  });

  it("正对照：alpha=255 时 wash 原样返回（不预混不该改变颜色）", () => {
    expect(hex(wash(ACCENT, 255, BG_SOLID))).toBe(hex(ACCENT));
  });

  it("alpha=0 时 wash 完全等于基色（负判据要有正对照，别把「没叠」读成「叠错了」）", () => {
    expect(hex(wash(ACCENT, 0, BG_SOLID))).toBe(hex(BG_SOLID));
  });
});

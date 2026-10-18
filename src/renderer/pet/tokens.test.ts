import { describe, expect, it } from "vitest";
import {
  ACCENT, BG_SOLID, GREEN, INK, PAPER, PANEL_CARD, PANEL_CARD_STROKE, PANEL_SEP,
  SHADOW, WARN, wash, withAlpha, hex,
} from "./tokens";

describe("视觉 token 台账", () => {
  // 这些字面量是按 native 源码抄的（坐标写在 tokens.ts 每个 token 的行上注释里）；
  // `hex()` 对合法小写十六进制是恒等往返，所以这条锁的是「台账里的字面量没被人顺手改跑」，
  // 不是「值绑回了 palette.rs」。rebase native 时要对着那三处坐标逐条核。
  it("品牌三色 / 奶油纸色 / 墨色 / 面板基色的字面量与 native 源码一致", () => {
    expect(hex(ACCENT)).toBe("#5b8def"); // palette.rs ACCENT from_rgb(0x5b,0x8d,0xef)
    expect(hex(GREEN)).toBe("#4fb477");
    expect(hex(WARN)).toBe("#d97757");
    expect(hex(PAPER)).toBe("#f7f4ec");
    expect(hex(INK)).toBe("#2b2f3a"); // ui.rs:17
    expect(hex(BG_SOLID)).toBe("#101420"); // panel.rs::theme rgb(16,20,32)
  });

  it("wash 的预混结果可由 native theme::over 的算式推出（不是实测口径）", () => {
    // over(fg,a,bg)：每通道 = round(fg·α/255 + bg·(1−α/255))，α 是 u8。
    // BG_SOLID = rgb(16,20,32)，WHITE = rgb(255,255,255)：
    //   CARD（α=13）b = round(13 + 32·242/255) = round(43.37) = 43 = 0x2b
    //   SEP （α=11）b = round(11 + 32·244/255) = round(41.61) = 42 = 0x2a
    // α/255 的分母是奇数，a·α + b·(255−α) 永不算不出 .5 边界，所以 JS 的 Math.round
    // 与 Rust 的 .round() 在 0..255 全域等价，不存在「±1 归属」问题。
    // ⚠️ 这只证明「fork 的 wash 与 native 数值相等」；spec §6.2 要的「按 Chromium
    // 管线重推导」还没做（见 §6.2 与 spec §9-6，落点在 P2 面板轮 + Task 10 上屏）。
    expect(PANEL_CARD()).toBe("#1c202b"); // panel.rs:69 CARD = over(WHITE,13,BG_SOLID)
    expect(PANEL_SEP()).toBe("#1a1e2a"); // panel.rs:71 SEP  = over(WHITE,11,BG_SOLID)
    // 唯一需要两步复合的那个（基色是 CARD，不是 BG_SOLID）：
    // CARD=(28,32,43)，α=18 → r=round(18+28·237/255)=44=0x2c, g=round(18+32·237/255)=48=0x30,
    // b=round(18+43·237/255)=58=0x3a
    expect(PANEL_CARD_STROKE()).toBe("#2c303a"); // panel.rs:70
  });

  it("面板底与三张表面色必须是不透明 6 位 hex（token 台账文件头承诺的那条锁）", () => {
    // 美术契约「面板底必须不透明」：半透明的面板底会被桌布漂移污染，
    // native 为此专门改成预混不透明色（#19/#20）。任何一条退化成 rgba 就该在这里崩。
    for (const c of [BG_SOLID, PANEL_CARD(), PANEL_CARD_STROKE(), PANEL_SEP()]) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("正对照：alpha=255 时 wash 原样返回（不预混不该改变颜色）", () => {
    expect(hex(wash(ACCENT, 255, BG_SOLID))).toBe(hex(ACCENT));
  });

  it("alpha=0 时 wash 完全等于基色（负判据要有正对照，别把「没叠」读成「叠错了」）", () => {
    expect(hex(wash(ACCENT, 0, BG_SOLID))).toBe(hex(BG_SOLID));
  });

  it("两种 alpha 量纲各自设闸：把 0..255 喂给 withAlpha 会当场崩，而不是静默压成实心", () => {
    // withAlpha = ui.rs:145（0..1），wash = panel.rs::theme::over（0..255）。
    // Task 9 真实踩过这条：地面投影写成 withAlpha(SHADOW, a*fade*255)，
    // 被 clamp 顶成 1.0，五环影子全变实心盘。现在它抛。
    expect(withAlpha(INK, 0.5)).toBe("rgba(43, 47, 58, 0.5)");
    expect(() => withAlpha(SHADOW, 0.016 * 255)).toThrow(RangeError);
    expect(() => withAlpha(SHADOW, Number.NaN)).toThrow(RangeError);
    expect(() => wash(ACCENT, 256, BG_SOLID)).toThrow(RangeError);
    expect(() => wash("#fff", 10, BG_SOLID)).toThrow(RangeError); // 3 位缩写不许混进台账
  });
});

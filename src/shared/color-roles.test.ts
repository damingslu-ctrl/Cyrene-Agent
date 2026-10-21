import { describe, expect, it } from "vitest";
import { classifyRgb, proposeToken, scanColorLiterals } from "./color-roles";

describe("品牌色分类器", () => {
  it("正对照：一段明知有粉的 CSS 必须被扫出 3 处，且行号与属性都对", () => {
    const css = [
      ".a { color: #ff5b8a; }",
      ".b { background: rgb(255, 91, 138); }",
      ".c { border-color: #c9a7f5; }",
    ].join("\n");
    const hits = scanColorLiterals(css);
    expect(hits.map((h) => [h.line, h.property, h.family]))
      .toEqual([[1, "color", "pink"], [2, "background", "pink"], [3, "border-color", "violet"]]);
  });

  it("分类：上游粉/紫/红各自入位，中性与自家色不入位", () => {
    expect(classifyRgb(255, 91, 138)).toBe("pink");   // #ff5b8a 上游强调
    expect(classifyRgb(233, 30, 99)).toBe("pink");    // #e91e63 material 粉（surface-pattern）
    expect(classifyRgb(201, 167, 245)).toBe("violet");// #c9a7f5
    expect(classifyRgb(25, 22, 31)).toBe("violet");   // #19161f 紫调近黑
    expect(classifyRgb(232, 17, 35)).toBe("red");     // #e81123 Windows 关闭
    expect(classifyRgb(242, 125, 146)).toBe("red");   // ROSE #f27d92：h=349 → 见下条，自家色靠表不靠窗口
    expect(classifyRgb(255, 255, 255)).toBe(null);
    expect(classifyRgb(29, 29, 31)).toBe(null);       // #1d1d1f
    expect(classifyRgb(142, 142, 147)).toBe(null);    // #8e8e93
  });

  it("ROSE 落在 red 窗口里——所以「禁止」只能由迁移表决定，分类器只负责分类", () => {
    expect(classifyRgb(242, 125, 146)).not.toBe("pink");
    expect(classifyRgb(242, 125, 146)).toBe("red");
  });

  it("url(#fade) 不是颜色", () => {
    expect(scanColorLiterals(".x { mask: url(#fade); }")).toEqual([]);
    expect(scanColorLiterals(".x { background: #fade; }")).toHaveLength(1);
  });

  it("提案：红一律 needsReview，紫调近黑按属性分流", () => {
    expect(proposeToken({ text: "#e81123", family: "red", line: 1, property: "background",
      alpha: null, fallbackOf: null }))
      .toBe("needsReview");
    expect(proposeToken({ text: "#19161f", family: "violet", line: 1, property: "background",
      alpha: null, fallbackOf: null })).toBe("--rb-surface-elevated");
    expect(proposeToken({ text: "#19161f", family: "violet", line: 1, property: "color",
      alpha: null, fallbackOf: null })).toBe("--rb-text-primary");
    expect(proposeToken({ text: "#ff5b8a", family: "pink", line: 1, property: "background",
      alpha: null, fallbackOf: null })).toBe("--rb-accent");
    expect(proposeToken({ text: "#ff9fbd", family: "pink", line: 1, property: "border-color",
      alpha: null, fallbackOf: null })).toBe("--rb-pink-100");
  });

  it("空格/斜杠语法与逗号语法等价（R-18-4：只认逗号 = 这把锁对 40 个写法 57 处全瞎）", () => {
    const css = ".a { box-shadow: 0 0 0 3px rgb(255 91 138 / 15%); }";
    const hits = scanColorLiterals(css);
    expect(hits).toHaveLength(1);
    expect(hits[0].family).toBe("pink");
    expect(hits[0].alpha).toBe(0.15);
    expect(hits[0].property).toBe("box-shadow");
    expect(proposeToken(hits[0]))
      .toBe("color-mix(in srgb, var(--rb-accent) 15%, transparent)");
  });

  it("近黑：不透明的是面，带 alpha 的是阴影墨——后者不许自动提案", () => {
    expect(proposeToken({ text: "#19161f", family: "violet", line: 1, property: "background",
      alpha: null, fallbackOf: null })).toBe("--rb-surface-elevated");
    expect(proposeToken({ text: "rgb(25 22 31 / 22%)", family: "violet", line: 1,
      property: "box-shadow", alpha: 0.22, fallbackOf: null })).toBe("needsReview");
  });
});

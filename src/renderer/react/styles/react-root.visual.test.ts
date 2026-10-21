import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { LIGHT_TOKENS } from "../../../shared/palette-from-cat";

const stylesheet = readFileSync(resolve(__dirname, "react-root.css"), "utf8");
const sharedTokens = readFileSync(resolve(__dirname, "../../ui/tokens.css"), "utf8");
const pearlTheme = readFileSync(resolve(__dirname, "../../ui/themes/pearl-white.css"), "utf8");

describe("chat workspace surface", () => {
  it("uses the neutral page and workspace surfaces with the installer motif", () => {
    const dom = new JSDOM(`
    <html data-ui-theme="pearl-white"><head><style>${sharedTokens}\n${stylesheet}\n${pearlTheme}</style></head><body>
      <main class="cy-page">
        <section class="cy-workspace is-empty"></section>
      </main>
    </body></html>
    `, { pretendToBeVisual: true });
    const { document } = dom.window;
    const rootStyle = dom.window.getComputedStyle(document.documentElement);
    const rules = Array.from(document.styleSheets[0].cssRules) as CSSStyleRule[];
    const emptyPattern = rules.find((rule) => rule.selectorText === ".cy-workspace::before");
    const filledPattern = rules.find((rule) => rule.selectorText === ".cy-workspace.has-messages::before");

    // 期望值交给派生器，不手写十六进制去凑：这个 fixture 的顺序是
    // tokens.css → react-root.css → pearl-white.css，**不含 theme.css**。改动前真实应用里
    // theme.css 那个同特异度、源序在后的 [data-ui-theme="pearl-white"] 块一直盖着主题文件，
    // 所以 fixture 测到的层叠结果跟真实层叠结果并不一致；删掉那个块之后两者才第一次相等。
    // tokens.css 的 :root 把这两个令牌写成 var(--rb-bg-0) / var(--rb-bg-1) 是故意的间接层，
    // 这里断言的是解析出来的成品值，不许为了过测试把它拍平成字面量。
    expect(rootStyle.getPropertyValue("--rb-surface-page").trim()).toBe(LIGHT_TOKENS["--rb-surface-page"]);
    expect(rootStyle.getPropertyValue("--rb-surface-workspace").trim())
      .toBe(LIGHT_TOKENS["--rb-surface-workspace"]);
    expect(emptyPattern).toBeDefined();
    expect(emptyPattern?.style.backgroundImage).toContain("cyrene-surface-pattern.svg");
    expect(emptyPattern?.style.opacity).toBe("0.9");
    expect(emptyPattern?.style.pointerEvents).toBe("none");
    expect(filledPattern?.style.opacity).toBe("0.55");
  });
});

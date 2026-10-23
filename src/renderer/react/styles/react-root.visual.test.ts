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

    // 期望值交给派生器，不手写十六进制去凑。理由要说准（原注释那句是从 brief 抄来的，站不住）：
    // 这个 fixture 的顺序是 tokens.css → react-root.css → pearl-white.css，**不含 theme.css**；
    // 而 theme.css 里【改动前后都一样】一条 --rb-surface-* 声明都没有（实测 grep 命中 0 条），
    // 所以那个珍珠白覆盖块从没盖过这两个令牌，fixture 与真实层叠在这两条上本来就一致。
    // 打红的真正原因是主题文件自己的字面量被派生值换掉了：pearl-white.css 旧 :3-4 的
    // --rb-surface-page: #ECECEE / --rb-surface-workspace: #FFFFFF（连同旧 :58 的 --rb-bg-0: #ffffff）
    // 一起收敛到同一个派生结果 #eeeae0 / #f9f7f1，硬编码期望当场过期 —— 这正是要把期望交给
    // LIGHT_TOKENS 的理由：值由派生器说了算，测试不复制第二份真相。
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

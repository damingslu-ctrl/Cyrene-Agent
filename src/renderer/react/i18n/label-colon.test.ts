/**
 * 「标签 冒号 值」那颗冒号归语言文件管，不归 JSX 管。
 *
 * 起因是 Wave 4 T14 的 en 真窗档：卡片上那行写的是 `This machine：v1.15.0`——全角冒号出现在
 * 英文界面上，是排版缺陷而不是口味问题（`network.clientUpdate.currentLabel` 那句英文本身是对的）。
 * 冒号在 JSX 里写死，翻译文件管不到它，所以三份语言表一起齐、逐字对齐的锁也不会响：
 * 这一条扫源文件的尺补的正是那个洞。
 *
 * 两处口径：
 * - 站点面：`.tsx` 里 `t("…")}：` 与 `t(key)}：`（动态键，如 `LineItem` 的 `t(labelKey)`）这种形状
 *   一处不许留（15 处历史违例已在本次改完）；渲染端另有一条宽的——模板字符串里 `)}：` 也算
 *   （`UsageStatsPanel.tsx` 那两条 tooltip 就是这么漏出去的，共 2 处）。
 * - 值面：拉丁字母那档语言（`en`）的 `ui.labelColon` 不许含全角冒号——否则把冒号搬进语言文件
 *   只是换了个写死的地方。
 *
 * 这两条量的都是**源码**。渲染出来的字符串对不对，另有一把现场尺：
 * `src/renderer/react/features/settings/UsageStatsPanel.label-colon.test.tsx`（jsdom，量 title 里的全角／半角）。
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import jaJP from "./ja-JP.json";
import zhCN from "./zh-CN.json";

/** `__dirname` = `src/renderer/react/i18n`，仓库根在四级上；多退一级 glob 会收不到任何文件。 */
const REPO = resolve(__dirname, "../../../..");

/**
 * 认的是「翻译闭合后紧跟一颗全角冒号」，键写成字面量还是变量都算。
 * 只收 `t(` 起头：`${formatFullDate(…)}` 那种模板插值长得一样，但不是这里的形状（见下方反对照）。
 */
const HARDCODED_COLON = /\bt\(\s*(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|[A-Za-z_][\w.]*|\[[^\]\n]*\])\s*\)\}\s*：/;

/**
 * 渲染端（界面本体）还有一条更宽的：任何表达式闭合后紧跟一颗全角冒号都算，
 * 模板字符串里的也算（`UsageStatsPanel.tsx` 那两条 tooltip 就是这么漏出去的）。
 * 只收 `src/renderer/**`：主进程里 `${title}：${text}` 那种是**拼给用户看的中文正文**
 * （朋友圈正文、旅行播报），那里没有"另一档语言"可切，套这条尺是把它当缺陷冤枉了。
 */
const RENDERER_COLON_AFTER_CLOSE = /\)\}\s*：/;

/** 测试与夹具本身要留着写反例的地方，跟色板尺同一条豁免。 */
const IS_TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

function tsxFiles(): string[] {
  return globSync("src/**/*.tsx", { cwd: REPO })
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !IS_TEST_FILE.test(file))
    .sort();
}

function rendererTsxFiles(): string[] {
  return tsxFiles().filter((file) => file.startsWith("src/renderer/"));
}

function scan(files: string[], rule: RegExp): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    const lines = readFileSync(resolve(REPO, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (rule.test(line)) hits.push(`${rel}:${index + 1}`);
    });
  }
  return hits;
}

describe("界面语言：标签后的冒号", () => {
  it("扫到了 .tsx，且不是空扫（一把扫不到文件的尺等于没有尺）", () => {
    const files = tsxFiles();
    expect(files.length, ".tsx 文件数").toBeGreaterThan(50);
    expect(files.some((file) => file === "src/renderer/react/features/network/ClientUpdateSection.tsx"), "含更新卡").toBe(true);
    expect(rendererTsxFiles().length, "渲染端 .tsx 文件数").toBeGreaterThan(40);
  });

  it("任何 .tsx 都不许在翻译闭合后写死全角冒号", () => {
    expect(scan(tsxFiles(), HARDCODED_COLON), `写死冒号的站点：`).toEqual([]);
  });

  it("渲染端连模板字符串里的全角冒号也不许留（tooltip 那种）", () => {
    expect(scan(rendererTsxFiles(), RENDERER_COLON_AFTER_CLOSE), "渲染端写死冒号的站点：").toEqual([]);
  });

  it("这把尺有牙：写死的形状必须被认出来", () => {
    expect(HARDCODED_COLON.test('<li>{t("network.core.modeLabel")}：{ports}</li>'), "正对照：字面量键").toBe(true);
    expect(HARDCODED_COLON.test("<li>{t(labelKey)}：</li>"), "正对照：动态键").toBe(true);
    expect(HARDCODED_COLON.test('{t("ui.labelColon")}'), "搬进语言文件之后不该再被认成违例").toBe(false);
    // 宽尺要能咬住模板插值那一形状（它正是第一条尺的盲区）。
    expect(RENDERER_COLON_AFTER_CLOSE.test("${formatFullDate(locale, rangeEnd)}：${value}"), "正对照：模板插值").toBe(true);
    // 而它只管渲染端：主进程拼中文正文的那几处不在射程内，这条边界本身也要有牙。
    expect(rendererTsxFiles().some((file) => file.includes("moments-context")), "主进程文件不进渲染端射程").toBe(false);
  });

  it("三份语言表都给了这颗冒号", () => {
    for (const [locale, table] of Object.entries({ "zh-CN": zhCN, en, "ja-JP": jaJP })) {
      const colon = (table as { ui: { labelColon?: unknown } }).ui?.labelColon;
      expect(typeof colon === "string" && colon.length > 0, `${locale} 的 ui.labelColon`).toBe(true);
    }
  });

  it("拉丁字母那档不许用全角冒号：搬进语言文件不是换个地方写死", () => {
    const colon = (en as { ui: { labelColon: string } }).ui.labelColon;
    expect(colon.includes("："), `en 的 ui.labelColon = ${JSON.stringify(colon)}`).toBe(false);
    expect(colon.includes(":"), "得有冒号").toBe(true);
    // 中日两档照自己语体的写法走，这里只钉「别跟着英文半角跑」这一头。
    expect((zhCN as { ui: { labelColon: string } }).ui.labelColon).toBe("：");
    expect((jaJP as { ui: { labelColon: string } }).ui.labelColon).toBe("：");
  });
});

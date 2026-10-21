/**
 * 派生锁：CSS 里每一个**还在直接着色的** `--rb-*` / `--md-*` 值，都必须等于
 * `src/shared/palette-from-cat.ts` 算出来的那一个。
 *
 * 两条互补的断言，缺一条就是漏的：
 * - 正向：表里的每个令牌，若在 CSS 里以字面量出现，值必须相等（防止有人手改 CSS 里的一个色）。
 * - 反向：CSS 里以字面量出现的每个令牌，必须在表里（防止有人**新写**一个没派生的色）。
 *
 * `var()` / `color-mix()` 形态的声明两条都豁免——那是故意的间接层（跟着角色令牌自动跟变），
 * 拍平它反而丢掉「改一处跟三处」。
 *
 * 层叠是这里最容易看错的东西：同一个令牌名现在在四个文件里各写一遍，而入口 HTML 的 link
 * 顺序 + `theme.css` 自己的 @import 决定了「谁最后写的谁生效」。所以这个测试不是逐文件断言，
 * 而是按真实源序解析后再断言生效值——不然它测的是「每个文件单独看着对」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS_BY_SCHEME } from "../../shared/palette-from-cat";

/** 真实源序：`ui/tokens.css` 先 link，`ui/theme.css` 后 link，而 theme.css 的 @import 在它自己规则之前。 */
const SOURCES = [
  "ui/tokens.css",
  "ui/themes/pearl-white.css",
  "ui/themes/charcoal-pink.css",
  "ui/theme.css",
] as const;

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

interface Decl { name: string; value: string; selector: string }

/**
 * 行级扫描。这四份主题文件是平铺的（没有 CSS 嵌套、没有一行两声明），
 * 所以一旦出现「同一行里既有 `{` 又有 `}`」或花括号不配对，就抛错而不是猜——
 * 尺自己崩了不许读成 PASS（验收三层尺纪律）。
 */
function collectDecls(css: string, label: string): Decl[] {
  const out: Decl[] = [];
  let selector = "";
  let depth = 0;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of stripped.split("\n")) {
    const text = line.replace(/\r$/, "");
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    if (opens && closes && text.trim() !== "}") {
      throw new Error(`${label}: 不支持的单行块，请把这一行拆开：${text.trim()}`);
    }
    if (opens) {
      selector = text.slice(0, text.indexOf("{")).trim();
      depth += opens;
      continue;
    }
    if (closes) {
      depth -= closes;
      if (depth < 0) throw new Error(`${label}: 花括号不配对`);
      if (depth === 0) selector = "";
      continue;
    }
    const m = /^\s*(--(?:rb|md)-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(text);
    if (m && depth > 0) out.push({ name: m[1], value: m[2].trim(), selector });
  }
  if (depth !== 0) throw new Error(`${label}: 文件结束时仍处在 ${depth} 层块内`);
  return out;
}

/**
 * 按真实层叠算出生效值：同特异度 → 源序在后者的那条赢，所以直接「后者覆盖前者」。
 *
 * 选择器要**整串相等**才算主题级：`includes('data-ui-theme="charcoal-pink"')` 会把
 * `[data-ui-theme="charcoal-pink"] .cy-command-terminal` 这种 scoped 覆盖也当成主题级，
 * 于是它（源序在后）盖掉真正的主题值——正向那条会因「值不含色面字面量」被豁免，
 * 结果就是**这个令牌在深色档彻底没人管**。Task 15 Step 1 已把那条 scoped 规则改成 `var()`，
 * 但锁不能依赖「CSS 恰好没有 scoped 覆盖」这个前提，它自己必须只认主题级。
 *
 * 四份文件实测无 `@media`（`grep -c` 全 0），所以行级扫描不处理条件块是安全的；
 * 若将来引入 `@media`，选择器串会变成 `@media …`，这些声明会落到「不在主题级」里被漏掉——
 * 到时候要改这个解析器，而不是放松断言。
 */
function effective(scheme: "light" | "dark"): Map<string, string> {
  const wanted = scheme === "light" ? "pearl-white" : "charcoal-pink";
  const map = new Map<string, string>();
  for (const file of SOURCES) {
    const css = readFileSync(resolve(__dirname, "..", file), "utf8");
    for (const d of collectDecls(css, file)) {
      const isDefault = d.selector === ":root";
      const isTheme = d.selector === `[data-ui-theme="${wanted}"]`;
      if (!isDefault && !isTheme) continue;
      map.set(d.name, d.value);
    }
  }
  return map;
}

describe("配色派生锁", () => {
  const light = effective("light");
  const dark = effective("dark");

  it("两档都解析出了 100 个以上令牌，且两档的页底不同（正对照：解析器真的在干活）", () => {
    expect(light.size).toBeGreaterThan(100);
    expect(dark.size).toBeGreaterThan(100);
    expect(light.get("--rb-surface-page")).not.toBe(dark.get("--rb-surface-page"));
    // 若 collectDecls 的选择器判断失效，这里会是「一个都没收到」→ 上面两条先红。
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme}：表里的令牌若在 CSS 里是字面量，值必须等于派生结果`, () => {
      const eff = scheme === "light" ? light : dark;
      const bad: string[] = [];
      for (const [name, derived] of Object.entries(TOKENS_BY_SCHEME[scheme])) {
        const current = eff.get(name);
        if (current === undefined) continue; // 该档确实没声明这个令牌（theme.css 的珍珠块已删）
        if (!COLOR_LITERAL.test(current)) continue; // var()/color-mix()：故意的间接层
        if (current !== derived) bad.push(`${name}: 生效=${current} 派生=${derived}`);
      }
      expect(bad, `${scheme} 有 ${bad.length} 条与派生结果不一致\n${bad.join("\n")}`).toEqual([]);
    });
  }

  it("反向：CSS 里以字面量出现的着色令牌，必须都在派生表里", () => {
    const orphans: string[] = [];
    for (const [scheme, eff] of [["light", light], ["dark", dark]] as const) {
      for (const [name, value] of eff) {
        if (!COLOR_LITERAL.test(value)) continue;
        if (TOKENS_BY_SCHEME[scheme][name] === undefined) orphans.push(`${scheme} ${name} = ${value}`);
      }
    }
    // 白名单：确有不参与派生的着色令牌时，在这里加条目并写明理由；空表是本期目标。
    const WHITELIST: string[] = [];
    expect(orphans.filter((o) => !WHITELIST.some((w) => o.startsWith(w)))).toEqual([]);
  });

  it("没有任何主题文件留着上游品牌粉/紫的字面量", () => {
    const banned = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
      /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i,
      /#221c46/i, /#181432/i, /#08070f/i, /#fef7ff/i, /#a094c1/i];
    const hits: string[] = [];
    for (const [scheme, eff] of [["light", light], ["dark", dark]] as const) {
      for (const [name, value] of eff) {
        for (const re of banned) if (re.test(value)) hits.push(`${scheme} ${name} = ${value}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

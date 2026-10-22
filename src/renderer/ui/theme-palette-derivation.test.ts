/**
 * 派生锁：CSS 里每一个**着色令牌**（`--rb-*` / `--md-*` / `--cy-*`）的生效值，都必须等于
 * `src/shared/palette-from-cat.ts` 算出来的那一个。
 *
 * 四条互补的断言，缺一条就是漏的：
 * - 正向：表里的每个令牌，按真实层叠解开的生效值必须等于派生值（防止有人手改 CSS 里的一个色）。
 * - 反向：CSS 里以字面量出现的每个着色令牌，必须在表里；写成 `var()` 的角色别名解开后
 *   也必须正好落在某个派生值上（防止有人**新写**一个没派生的色）。
 * - 悬空：主题级声明里的 `var(--x)` 必须指向本档真实存在的令牌（防止改名后留下死链）。
 * - 覆盖面：四份来源之外的样式表不许声明着色令牌（否则上面三条算的层叠前提已经不成立）。
 *
 * **`var()` 间接层不再豁免**（A-1 收紧）：旧版锁把 `var()` 一律跳过，于是
 * 「`--md-code-border: var(--rb-pink-200)`」这种写法——表里派生的值与 CSS 指向的值**不一致**——
 * 完全看不见。现在间接层被逐层解开：同值别名合法（那是刻意的角色别名），异值别名当场点名，
 * 悬空别名单独报。
 *
 * 层叠是这里最容易看错的东西：同一个令牌名现在在四个文件里各写一遍，而入口 HTML 的 link
 * 顺序 + `theme.css` 自己的 @import 决定了「谁最后写的谁生效」。所以这个测试不是逐文件断言，
 * 而是按真实源序解析后再断言生效值——不然它测的是「每个文件单独看着对」。
 *
 * 已知局限（**这些是范围，不是漏扫**）：
 * 1. 本锁只看**主题级**的声明。规则里的字面量（`border-color: #ff5b8a;` 这种）不在射程内——
 *    所以禁用色那条断言只声明「生效的主题级着色令牌里没有上游品牌色」，不声明「这四份文件干净」。
 *    规则级字面量由 `brand-color-migration.test.ts` 的**原文**逐字扫描负责（Task 19 扩的范围）。
 * 2. `--cy-*` 一族从 Task 19 起进正则（`--(?:rb|md|cy)-`）：`themes/charcoal-pink.css:120-122`
 *    的 `--cy-pill-bg/-border/-status` 已换成 `var(--rb-*)`，反向断言看到的都是间接层。
 *    若以后有人把色值硬写回 `--cy-*`，反向断言会当场点名。
 * 3. 复合值（`color-mix()`、字体栈、里头像 `var()` 的多段阴影）解不开成单个颜色。正向那条对
 *    **表内令牌**仍然逐串相等地比（表里的阴影/渐变本来就是复合值，CSS 里也是同一个串）；
 *    反向那条对解不开的复合值放行——它不含色面字面量，不是「新写了一个没派生的色」。
 * 4. 跨行选择器列表只在**含主题级段**时抛错（R-16-4）。四份文件今天有 155 处跨行列表，全是
 *    `[data-ui-theme="…"] .foo` 这类带后缀的 scoped 选择器——本锁靠整串相等本来就不消费它们，
 *    对它们抛错只会让整把锁收集失败（`Tests no tests`），比红更坏。会落错档的只有「列表里某一段
 *    整串就是主题级选择器」这一种形状，那时才抛。
 * 5. 层叠按 `index.html` 的 link 顺序算（`tokens.css` → `theme.css`，两个主题文件由 theme.css 的
 *    @import 带进来）。只 link `theme.css` 的独立预览页（`plan-approval-preview.html`）少了
 *    tokens.css 那一层默认声明，那是页面自带的差异，不在本锁射程内。
 * 6. React 窗口（`react/index.html`）另有一份 `react/styles/react-root.css`，它的 `:root` 块里也有
 *    `--cy-pill-bg/-border/-status`。这三个名字**不在派生表里**（是组件胶囊的语义别名），所以本锁
 *    不消费它们；但 `themes/charcoal-pink.css:120-122` 里有同名的另一份，真实生效值取决于样式注入
 *    顺序。两份都是 `var(--rb-*)` 间接层、都落在派生值上，所以不构成配色漂移，只是重复声明。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS_BY_SCHEME, type ThemeScheme, type TokenMap } from "../../shared/palette-from-cat";

/** 真实源序：`ui/tokens.css` 先 link，`ui/theme.css` 后 link，而 theme.css 的 @import 在它自己规则之前。 */
const SOURCES = [
  "ui/tokens.css",
  "ui/themes/pearl-white.css",
  "ui/themes/charcoal-pink.css",
  "ui/theme.css",
] as const;

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

/**
 * 纯 `var(--x)` 形态。带 fallback 的 `var(--x, #fff)` 也算：fallback 是给「目标不存在」兜底的，
 * 但本锁仍然按「目标必须存在」处理——有 fallback 也不许掩盖一次改名。
 */
const PURE_VAR = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]*?)\s*)?\)$/;

/** 解间接层的深度上限：超过就是环（A→B→A），环按悬空报。 */
const MAX_ALIAS_DEPTH = 10;

/**
 * 派生表里有名字、四份 CSS 的**主题级层里没有声明**的 (档, 名字)。这是地板，不是白名单：
 * `--rb-glow-secondary` 只写在 `themes/pearl-white.css:80`，深色档没有来源，而它全仓 0 消费者
 * （`grep -rn "var(--rb-glow-secondary" src/` = 0），所以今天画不出任何东西。
 * 一旦有人给它加消费者，正确修法是把深色值补进 `themes/charcoal-pink.css` 的主题级块
 * （见 R-16-1 的九行），不是把它留在下面这条数组里。
 */
const WITHOUT_SOURCE: Record<ThemeScheme, string[]> = {
  light: [],
  dark: ["--rb-glow-secondary"],
};

interface Decl { name: string; value: string; selector: string }

/**
 * 主题级选择器：**整串相等**才算。
 * `includes('data-ui-theme="charcoal-pink"')` 会把 `[data-ui-theme="charcoal-pink"] .cy-command-terminal`
 * 这种 scoped 覆盖也当成主题级，于是它（源序在后）盖掉真正的主题值——正向那条会因「值不含色面字面量」
 * 被豁免，结果就是**这个令牌在深色档彻底没人管**。
 *
 * 引号风格容忍单双引号（生成器 `apply-theme-palette.mjs` 也容忍），免得两边对「算不算主题级」
 * 给出不同答案；但**带后缀的 scoped 选择器一律不算**。
 */
const THEME_LEVEL = /^(?::root|\[\s*data-ui-theme\s*=\s*["']?[a-z-]+["']?\s*\])$/;
const THEME_ATTR = /^\[\s*data-ui-theme\s*=\s*["']?([a-z-]+)["']?\s*\]$/;

const THEME_NAME: Record<ThemeScheme, string> = { light: "pearl-white", dark: "charcoal-pink" };

function isThemeLevelFor(selector: string, wanted: string): boolean {
  if (selector === ":root") return true;
  const m = THEME_ATTR.exec(selector);
  return m !== null && m[1] === wanted;
}

/**
 * 行级扫描。这四份主题文件是平铺的（没有 CSS 嵌套、没有一行两声明），
 * 所以一旦出现「同一行里既有 `{` 又有 `}`」或花括号不配对，就抛错而不是猜——
 * 尺自己崩了不许读成 PASS（验收三层尺纪律）。
 *
 * 一行两声明同样**抛错**：它不会让锁红，只会让第二条声明被行级正则漏掉，那是比红更坏的失效。
 *
 * 跨行选择器列表**只在含主题级段时**抛错（R-16-4，见文件头局限 4）：解析器只记末段选择器，
 * 所以 `:root,\n.foo { … }` 会把声明记到 `.foo` 名下、漏掉主题根；而 `[data-ui-theme="…"] .foo`
 * 这种带后缀的段不是主题级，锁本来就不消费，对它们抛错只会让整把锁收集失败。
 */
function collectDecls(css: string, label: string): Decl[] {
  const out: Decl[] = [];
  let selector = "";
  let depth = 0;
  let selectorContinuation = false;
  let pendingList: string[] = [];
  const stripped = css.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const text of logicalLines(stripped, label)) {
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    if (opens && closes) {
      throw new Error(`${label}: 不支持的单行块，请把这一行拆开：${text.trim()}`);
    }
    if (opens) {
      const beforeBrace = text.slice(0, text.indexOf("{")).trim();
      if (selectorContinuation) {
        const segments = [...pendingList, beforeBrace]
          .join(",")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const themeLevel = segments.filter((s) => THEME_LEVEL.test(s));
        if (themeLevel.length) {
          throw new Error(
            `${label}: 跨行选择器列表里含主题级段（${themeLevel.join(", ")}），` +
              `解析器只记末段选择器，会把这条声明落错档：${text.trim()}`,
          );
        }
      }
      selector = beforeBrace;
      depth += opens;
      pendingList = [];
      continue;
    }
    if (closes) {
      depth -= closes;
      if (depth < 0) throw new Error(`${label}: 花括号不配对`);
      if (depth === 0) { selector = ""; selectorContinuation = false; pendingList = []; }
      continue;
    }
    const trimmed = text.trim();
    selectorContinuation = trimmed.endsWith(",");
    if (selectorContinuation) pendingList.push(trimmed.slice(0, -1).trim());
    else pendingList = [];
    if ((text.match(/--(?:rb|md|cy)-[a-z0-9-]+\s*:/g) ?? []).length > 1) {
      throw new Error(`${label}: 一行两条声明，按行解析会漏掉第二条：${trimmed}`);
    }
    const m = /^\s*(--(?:rb|md|cy)-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(text);
    if (m && depth > 0) out.push({ name: m[1], value: m[2].trim(), selector });
  }
  if (depth !== 0) throw new Error(`${label}: 文件结束时仍处在 ${depth} 层块内`);
  return out;
}

/**
 * 把跨行的声明合并成一条逻辑行。
 *
 * 不做这一步，`tokens.css:110` 的 `--rb-font-ui`（值跨两行）和 `tokens.css:114` 的 `--rb-font-mono`
 * （首行有值、`;` 在下一行）在行级扫描里**根本不存在**——于是 `var(--rb-font-ui)` 会被误判成
 * 悬空引用，而一个真悬空的引用会混在误判里不被点名。漏扫比误报更坏，所以先把尺修对。
 */
function logicalLines(css: string, label: string): string[] {
  const lines = css.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!/^\s*--[a-z0-9-]+\s*:/.test(text) || text.includes(";")) {
      out.push(text);
      continue;
    }
    let buf = text;
    let j = i + 1;
    while (j < lines.length && !buf.includes(";")) {
      buf = `${buf} ${lines[j]}`;
      j++;
    }
    if (!buf.includes(";")) {
      throw new Error(`${label}:${i + 1} 声明没有分号收尾：${text.trim()}`);
    }
    out.push(buf);
    i = j - 1;
  }
  return out;
}

/**
 * 按真实层叠算出生效值：同特异度 → 源序在后者的那条赢，所以直接「后者覆盖前者」。
 *
 * 四份文件实测无 `@media`（`grep -c` 全 0），所以行级扫描不处理条件块是安全的；
 * 若将来引入 `@media`，选择器串会变成 `@media …`，这些声明会落到「不在主题级」里被漏掉——
 * 到时候要改这个解析器，而不是放松断言。
 */
function effective(scheme: ThemeScheme): Map<string, string> {
  const wanted = THEME_NAME[scheme];
  const map = new Map<string, string>();
  for (const file of SOURCES) {
    const css = readFileSync(resolve(__dirname, "..", file), "utf8");
    for (const d of collectDecls(css, file)) {
      if (!isThemeLevelFor(d.selector, wanted)) continue;
      map.set(d.name, d.value);
    }
  }
  return map;
}

/**
 * 解开纯 `var()` 间接层：沿着本档的生效值往下走，直到不再是纯 var 为止。
 *
 * - 目标不在本档生效值里 → dangling（改名后留下的死链；CSS 会让整条声明失效，不是「退回默认」）。
 * - 成环（A→B→A）→ 按 dangling 报，深度上限 `MAX_ALIAS_DEPTH` 只是兜底。
 * - 非纯 var（`color-mix()`、字体栈、多段阴影）→ 原样返回，那类值解不开成单个颜色。
 */
function resolveAlias(value: string, eff: Map<string, string>): { value: string; dangling: string | null } {
  let cur = value.trim();
  const seen = new Set<string>();
  for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth++) {
    const m = PURE_VAR.exec(cur);
    if (!m) return { value: cur, dangling: null };
    const target = m[1];
    if (seen.has(target)) return { value: cur, dangling: target };
    seen.add(target);
    const next = eff.get(target);
    if (next === undefined) return { value: cur, dangling: target };
    cur = next.trim();
  }
  return { value: cur, dangling: null };
}

interface ForwardReport { bad: string[]; missing: string[]; dangling: string[] }

/** 两档的生效值。放在模块级，好让「正对照」那一组也能直接用真实数据。 */
const light = effective("light");
const dark = effective("dark");

/**
 * 正向断言的纯函数。抽出来是为了让「正对照」能直接拿它喂人造数据——
 * 证明这把尺确实会红，而不是只证明今天恰好是绿的。
 */
function forwardViolations(
  scheme: ThemeScheme,
  eff: Map<string, string>,
  derived: TokenMap = TOKENS_BY_SCHEME[scheme],
): ForwardReport {
  const bad: string[] = [];
  const missing: string[] = [];
  const dangling: string[] = [];
  for (const [name, want] of Object.entries(derived)) {
    const current = eff.get(name);
    if (current === undefined) { missing.push(name); continue; }
    const r = resolveAlias(current, eff);
    if (r.dangling !== null) {
      dangling.push(`${name}: ${current} → 指向本档没有定义的 ${r.dangling}`);
      continue;
    }
    if (r.value !== want) bad.push(`${name}: 生效=${r.value} 派生=${want}`);
  }
  return { bad, missing, dangling };
}

/**
 * 反向断言：CSS 里出现的着色值必须落在派生表的地盘上。
 *
 * - 表内的名字由正向那条管（值是否等于派生值），这里只管**表外**的名字。
 * - 表外的名字写成字面量 → 一定是不该存在的「新色」。
 * - 表外的名字写成 `var()` → 那是角色别名（`--rb-task-card-surface: var(--rb-surface-elevated)`），
 *   合法；解开后必须正好是某个派生值，否则就是借了个没派生的色。
 */
function orphanColours(scheme: ThemeScheme, eff: Map<string, string>): string[] {
  const derivedValues = new Set(Object.values(TOKENS_BY_SCHEME[scheme]));
  const orphans: string[] = [];
  for (const [name, declared] of eff) {
    if (TOKENS_BY_SCHEME[scheme][name] !== undefined) continue;
    const r = resolveAlias(declared, eff);
    if (r.dangling !== null) continue;
    if (!PURE_VAR.test(declared.trim())) {
      if (COLOR_LITERAL.test(declared)) orphans.push(`${scheme} ${name} = ${declared}`);
      continue;
    }
    if (COLOR_LITERAL.test(r.value) && !derivedValues.has(r.value)) {
      orphans.push(`${scheme} ${name} = ${declared} → ${r.value}`);
    }
  }
  return orphans;
}

/** 表外名字里的悬空引用（表内的由 `forwardViolations` 报，两边不重复报同一个错）。 */
function danglingRoleAliases(eff: Map<string, string>, table: TokenMap): string[] {
  const out: string[] = [];
  for (const [name, declared] of eff) {
    if (table[name] !== undefined) continue;
    const r = resolveAlias(declared, eff);
    if (r.dangling !== null) out.push(`${name}: ${declared} → 指向本档没有定义的 ${r.dangling}`);
  }
  return out;
}

/**
 * 找出样式表里**主题级块**中的着色令牌声明。
 *
 * 主题级 = 选择器整串是 `:root` / `:root[data-ui-theme=…]` / `[data-ui-theme=…]`。
 * 组件作用域的 CSS（`react/**` 里那些 `.foo { --cy-pill-bg: … }`）不参与主题层叠，不算。
 */
function themeLevelTokenDecls(css: string): string[] {
  const out: string[] = [];
  const re = /(^|[\s,}])((?::root(?:\s*\[data-ui-theme[^\]]*\])?)|(?:\[data-ui-theme\s*=\s*["']?[a-z-]+["']?\s*\]))\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    const body = css.slice(start, Math.max(start, i - 1));
    for (const line of body.split("\n")) {
      const d = /^\s*(--(?:rb|md|cy)-[a-z0-9-]+)\s*:/.exec(line);
      if (d) out.push(`${m[2]} { ${d[1]}`);
    }
    re.lastIndex = i;
  }
  return out;
}

describe("配色派生锁", () => {
  it("两档都解析出了 100 个以上令牌，且两档的页底不同（正对照：解析器真的在干活）", () => {
    expect(light.size).toBeGreaterThan(100);
    expect(dark.size).toBeGreaterThan(100);
    expect(light.get("--rb-surface-page")).not.toBe(dark.get("--rb-surface-page"));
    // 若 collectDecls 的选择器判断失效，这里会是「一个都没收到」→ 上面两条先红。
  });

  it("解析器吃下跨行声明（--rb-font-ui 的值跨两行，--rb-font-mono 的分号在下一行）", () => {
    expect(light.get("--rb-font-ui")).toContain("Segoe UI");
    expect(light.get("--rb-font-mono")).toContain("monospace");
    expect(dark.get("--rb-font-ui")).toContain("Segoe UI");
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme}：表里的令牌解开间接层后，值必须等于派生结果`, () => {
      const eff = scheme === "light" ? light : dark;
      const { bad, missing, dangling } = forwardViolations(scheme, eff);
      expect(bad, `${scheme} 有 ${bad.length} 条与派生结果不一致\n${bad.join("\n")}`).toEqual([]);
      expect(dangling, `${scheme} 有 ${dangling.length} 条悬空引用\n${dangling.join("\n")}`).toEqual([]);
      expect(missing.sort(), `${scheme} 表里有名字而 CSS 里没有声明：${missing.join(", ")}`)
        .toEqual(WITHOUT_SOURCE[scheme]);
    });
  }

  it("反向：CSS 里出现的着色值必须落在派生表的地盘上（含解开的角色别名）", () => {
    const orphans = [...orphanColours("light", light), ...orphanColours("dark", dark)];
    // 白名单按 `<scheme> <name>` **整串相等**匹配：前缀匹配会让 `light --rb-foo` 顺带放行
    // `light --rb-foobar`。今天为空表——空表是本期目标。
    const WHITELIST: string[] = [];
    expect(orphans.filter((o) => !WHITELIST.includes(o.slice(0, o.indexOf(" = "))))).toEqual([]);
  });

  it("悬空：主题级声明里的 var() 必须指向本档真实存在的令牌", () => {
    const hits = [
      ...danglingRoleAliases(light, TOKENS_BY_SCHEME.light),
      ...danglingRoleAliases(dark, TOKENS_BY_SCHEME.dark),
    ];
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("覆盖面：四份来源之外的样式表不在主题级块里声明派生表里的令牌", () => {
    // 只盯**派生表里的令牌名**：组件作用域的 CSS 声明 `--cy-pill-*`（`react/styles/react-root.css`）
    // 不参与主题层叠，不算；而四份来源之外若有人写 `:root { --rb-surface-page: #fff; }`，
    // 它会在真实层叠里盖掉本锁算出的生效值——那时这把尺读的是假绿。
    const root = resolve(__dirname, "..");
    const scanned = new Set(SOURCES.map((f) => resolve(root, f)));
    const tableNames = new Set([
      ...Object.keys(TOKENS_BY_SCHEME.light),
      ...Object.keys(TOKENS_BY_SCHEME.dark),
    ]);
    const hits: string[] = [];
    for (const file of styleSheets(root)) {
      if (scanned.has(resolve(file))) continue;
      const css = readFileSync(file, "utf8");
      for (const decl of themeLevelTokenDecls(css)) {
        const name = /(--(?:rb|md|cy)-[a-z0-9-]+)/.exec(decl)?.[1] ?? "";
        if (!tableNames.has(name)) continue;
        hits.push(`${file.slice(root.length + 1)}: ${decl}`);
      }
    }
    expect(
      hits,
      `这些样式表在真实层叠里，却不在本锁的四份来源里——要么加进 SOURCES，要么把声明挪进来源文件：\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("生效的主题级着色令牌里没有上游品牌粉/紫字面量（规则里的字面量不在本条射程，见文件头局限 1）", () => {
    // `#ff9bb8` 是 Task 15 漏掉的深色胶囊状态色（R-C15-6），`#4a4a4a` 是同一处写死的灰：
    // 两者都必须来自角色令牌，不许再以字面量出现在主题级声明里。
    const banned = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
      /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i,
      /#221c46/i, /#181432/i, /#08070f/i, /#fef7ff/i, /#a094c1/i, /#ff9bb8/i, /#4a4a4a/i];
    const hits: string[] = [];
    for (const [scheme, eff] of [["light", light], ["dark", dark]] as const) {
      for (const [name, declared] of eff) {
        const value = resolveAlias(declared, eff).value;
        for (const re of banned) if (re.test(value)) hits.push(`${scheme} ${name} = ${declared} → ${value}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

/**
 * 正对照：这把尺必须会红。改动锁的人若只看到全绿，没资格相信它有效。
 * 人造数据喂**生产函数**（`forwardViolations` / `resolveAlias`），不另写一套判定逻辑。
 */
describe("正对照：锁本身有牙", () => {
  const table: TokenMap = { "--x-base": "#123456", "--x-alias": "#123456" };

  it("同值别名：var() 指向派生值相同的令牌 → 不算违规", () => {
    const eff = new Map([["--x-base", "#123456"], ["--x-alias", "var(--x-base)"]]);
    const r = forwardViolations("light", eff, table);
    expect(r.bad).toEqual([]);
    expect(r.dangling).toEqual([]);
  });

  it("异值别名：var() 指向派生值不同的令牌 → 被点名", () => {
    const eff = new Map([["--x-base", "#654321"], ["--x-alias", "var(--x-base)"]]);
    const r = forwardViolations("light", eff, table);
    expect(r.bad.join("\n")).toContain("--x-alias");
    expect(r.dangling).toEqual([]);
  });

  it("悬空别名：var() 指向不存在的令牌 → 单独报，不混进「值不一致」", () => {
    const eff = new Map([["--x-alias", "var(--x-gone)"]]);
    const r = forwardViolations("light", eff, table);
    expect(r.dangling.join("\n")).toContain("--x-gone");
    expect(r.bad).toEqual([]);
  });

  it("链式别名：var → var → 字面量，解到底层", () => {
    const eff = new Map([
      ["--x-base", "#123456"],
      ["--x-mid", "var(--x-base)"],
      ["--x-alias", "var(--x-mid)"],
    ]);
    const r = forwardViolations("light", eff, table);
    expect(r.bad).toEqual([]);
    expect(r.dangling).toEqual([]);
  });

  it("环：var → var → var 回到原点，按悬空报（不无限递归）", () => {
    const eff = new Map([["--x-alias", "var(--x-a)"], ["--x-a", "var(--x-b)"], ["--x-b", "var(--x-a)"]]);
    const r = forwardViolations("light", eff, table);
    expect(r.dangling.length).toBeGreaterThan(0);
  });

  it("真实文件确实存在纯 var() 间接层（否则上面的正对照是空转）", () => {
    const count = (eff: Map<string, string>) =>
      [...eff.values()].filter((v) => PURE_VAR.test(v.trim())).length;
    // 实测：浅色档 26 条、深色档 24 条主题级纯 var() 声明。
    expect(count(light)).toBeGreaterThan(10);
    expect(count(dark)).toBeGreaterThan(10);
    // 表内令牌走间接层的：浅色档实测 5 条
    // （--rb-surface-soft / --rb-slider-fill / --rb-toggle-on / --md-code-border / --md-table-border）
    const tableAliases = Object.keys(TOKENS_BY_SCHEME.light)
      .filter((n) => PURE_VAR.test((light.get(n) ?? "").trim()));
    expect(tableAliases.length).toBeGreaterThan(0);
  });
});

/** 递归列出目录下的样式表（覆盖面断言用）。 */
function styleSheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...styleSheets(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

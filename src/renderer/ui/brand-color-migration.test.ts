/**
 * 品牌色锁：模块 CSS 里的每一个上游粉/紫字面量，要么已经被换成表里指定的令牌，
 * 要么在表里被明确 `keep` 并写了理由。
 *
 * 五条断言，一条都不能省：
 * 1. 表形：表不是空表（≥ 60 条），每个 `keep` 都带理由，且表里不许残留 `needsReview`
 *    （那是草案期的临时标记，裁决完必须消失）。
 * 2. 残留（模块）：扫模块 CSS，凡命中分类器且不在 `keep` 集合里的写法 → 红。
 * 3. 残留（主题文件原文）：四份主题文件里除 `--rb-*` 声明行（值就是色板本身）之外，
 *    凡命中分类器且不在 `keep` 集合里的写法 → 红（R-16-3 I1(b)，Task 19 收口）。
 * 4. 可解析：表里 `token` 与 `expr` 提到的**每一个** `--rb-*` / `--md-*`，必须同时在
 *    `tokens.css`、`pearl-white.css`、`charcoal-pink.css` 三处声明，且在派生表两档都有值。
 *    理由：`plan-approval-preview.html` 与 `plugin-market-preview.html` 这两个入口只 link
 *    `ui/theme.css`，拿不到 `tokens.css`；而只在一份主题文件里出现的令牌，换过去就会在另一档
 *    主题里解析为空——**颜色直接消失**。
 * 5. 反空转的上界：`keep` 行数 ≤ 60。没有这条，「把红族 51 处全判 keep」也能过前三条，
 *    而那是把上游粉留在屏幕上的最快路径。
 *
 * 已知局限（**是范围，不是漏扫**）：
 * - `hsl()/hsla()` 不做（实测 39 处里只有 `music/components/LoadingScreen.css:41-42` 是字面 hue，
 *   h=11 橙 / h=175 青，非品牌身份）。
 * - 本锁不关心令牌名：`--cy-*` 与 `--rb-*` 一样逐字扫。Task 19 已把三行 `--cy-pill-*` 换成
 *   `var(--rb-*)`，所以它们不再产生命中；若有人写回色值，这里和派生锁会同时红。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanColorLiterals } from "../../shared/color-roles";
import { TOKENS_BY_SCHEME } from "../../shared/palette-from-cat";
import migration from "../../../scripts/build/color-migration.json";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

const KEEP = new Set(
  Object.entries(migration as Record<string, { keep?: boolean }>)
    .filter(([, v]) => v.keep === true)
    .map(([k]) => k.toLowerCase()),
);

/** `__dirname` = `src/renderer/ui`，所以仓库根是三级：多退一级会把 cwd 落到 `src`，glob 收不到任何文件。 */
const REPO = resolve(__dirname, "../../..");

function moduleCss(): string[] {
  return globSync("src/**/*.css", { cwd: REPO })
    .map((f) => f.replace(/\\/g, "/"))
    .sort()
    .filter((f) => !THEME_FILES.includes(f));
}

/** 主题文件里的 `--rb-*` 声明行是色板本身（回写脚本同样跳过），其余原文一律在射程内。 */
const PALETTE_DECL = /^\s*--rb-[a-z0-9-]+\s*:/i;

function scanResidue(files: string[], skipPaletteDecls: boolean): { residue: string[]; hits: number } {
  const residue: string[] = [];
  let hits = 0;
  for (const file of files) {
    const css = readFileSync(resolve(REPO, file), "utf8");
    const lines = css.split("\n");
    for (const hit of scanColorLiterals(css)) {
      hits += 1;
      if (skipPaletteDecls && PALETTE_DECL.test(lines[hit.line - 1] ?? "")) continue;
      if (KEEP.has(hit.text.toLowerCase())) continue;
      residue.push(`${file}:${hit.line} ${hit.property}: ${hit.text}`);
    }
  }
  return { residue, hits };
}

describe("上游品牌色只能来自迁移表的裁决", () => {
  const rows = migration as Record<string, { token?: string; expr?: string; keep?: boolean; reason?: string; needsReview?: boolean }>;

  it("正对照：迁移表不是空表，每个 keep 都写了理由，且没有残留的 needsReview", () => {
    const entries = Object.entries(rows);
    expect(entries.length).toBeGreaterThanOrEqual(60);
    const 无理由 = entries.filter(([, v]) => v.keep === true && !(v.reason ?? "").trim().length);
    expect(无理由.map(([k]) => k)).toEqual([]);
    const 草案标记 = entries.filter(([, v]) => v.needsReview === true).map(([k]) => k);
    expect(草案标记, "needsReview 是草案期的临时标记，Step 3 裁决完必须消失").toEqual([]);
    // 分类器扫自己：确保这条测试用到的扫描器不是死的。
    expect(scanColorLiterals(".x { color: #ff5b8a; }")).toHaveLength(1);
    // 文件集也扫自己：glob 的 cwd 退错一级会收成空数组，第 2 条断言就会「零处残留」假绿。
    expect(moduleCss().length, "moduleCss() 一个文件都没收到，残留断言会假绿").toBeGreaterThan(60);
  });

  it("模块 CSS 里不残留未裁决的品牌色写法", () => {
    const { residue } = scanResidue(moduleCss(), false);
    expect(residue, `${residue.length} 处未清\n${residue.slice(0, 40).join("\n")}`).toEqual([]);
  });

  it("四份主题文件的原文也不残留未裁决的品牌色写法", () => {
    const { residue, hits } = scanResidue(THEME_FILES, true);
    // 正对照：主题文件里仍留着两条 keep 的软墨（`rgba(38, 28, 46, α)`，两档各两处），
    // 扫不到就说明「零残留」是因为分类器在这四份文件上一无所获，而不是真的干净。
    expect(hits, "主题文件一处命中都没有，这条断言的负结果不可信").toBeGreaterThan(0);
    expect(residue, `${residue.length} 处未清\n${residue.slice(0, 40).join("\n")}`).toEqual([]);
  });

  it("表里引用的每个令牌在三份定义文件里都存在，且两档派生值都在", () => {
    const read = (f: string) => readFileSync(resolve(REPO, f), "utf8");
    const inTokens = new Set([...read("src/renderer/ui/tokens.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const inPearl = new Set([...read("src/renderer/ui/themes/pearl-white.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const inCharcoal = new Set([...read("src/renderer/ui/themes/charcoal-pink.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const bad: string[] = [];
    for (const [spelling, row] of Object.entries(rows)) {
      // `expr` 里可能提到不止一个令牌（`color-mix(in srgb, var(--a) 30%, var(--b))`），逐个核对。
      const mentioned = new Set<string>();
      for (const value of [row.token ?? "", row.expr ?? ""]) {
        for (const m of value.matchAll(/--(?:rb|md)-[a-z0-9-]+/g)) mentioned.add(m[0]);
      }
      for (const token of mentioned) {
        if (!inTokens.has(token) || !inPearl.has(token) || !inCharcoal.has(token)) {
          bad.push(`${spelling} -> ${token}（三处定义不齐）`);
        }
        if (TOKENS_BY_SCHEME.light[token] === undefined || TOKENS_BY_SCHEME.dark[token] === undefined) {
          bad.push(`${spelling} -> ${token}（不在派生表里）`);
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("反空转：keep 行数不超过 60（全判 keep 是最快把上游粉留在屏幕上的路径）", () => {
    expect(KEEP.size).toBeLessThanOrEqual(60);
  });
});

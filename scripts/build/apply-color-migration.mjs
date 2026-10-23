// scripts/build/apply-color-migration.mjs
/**
 * 按 `scripts/build/color-migration.json` 把 CSS 里的上游品牌色换成 `var()` 引用。
 *
 * 两种射程，判据不同：
 * - **模块 CSS**（`src` 下所有 `.css`，去掉四份主题文件）：每一处品牌字面量都必须处置。
 * - **四份主题文件**：只处置**非 `--rb-*` 声明**里的字面量。`--rb-*` 的值就是色板本身
 *   （`--rb-danger: #dd6a7f` 的 hue 也落在红窗里），把它们换成 `var()` 是自引用。
 *
 * 每处命中按 `fallbackOf` 分两支（R-18-2 的逐处分支，判据在 `deadFallback()`）：
 * - **死兜底**：前项在两档派生表里都有值、且三份定义文件都声明 ⇒ 该字面量永远画不出来，
 *   把最外层的 `var(--x, …)` 收成 `var(--x)`。`var(--a, var(--b, #c))` 里 `--a` 是死的就
 *   整段收掉——内层连「兜底的兜底」都不是。
 * - **其余**（裸字面量 / 活兜底）：按表换成 `var(--token)` 或 `expr`（洗色用 `color-mix`，
 *   alpha 必须保住，否则 8% 的 hover 底会变成实心块）。
 *
 * 表是人工裁决的唯一权威。脚本只做两件判断：这处字面量前项死不死、这段 `var()` 到哪儿结束。
 * 别的都由表说了算——这是它能被审计的前提。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

/** 色板定义文件：死兜底的「前项一定有值」要在这三份里都成立。 */
const DEF_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

/**
 * R-C15-6：`--cy-pill-*` 三个令牌在 `charcoal-pink.css` 里写的是色值，而其中
 * `--cy-pill-status: #ff9bb8` 是上游粉、`--cy-pill-bg/-border` 是不随主题变的灰。
 * 它们的正确形态是「角色令牌的间接层」，按写法映射的表表达不了这层语义，所以单列。
 * 值不是 `var()` 的声明都要在这里点名，否则脚本抛错——不认识的 `--cy-*` 不静默放过。
 */
const PILL_FIXES = {
  "--cy-pill-bg": "--rb-surface-elevated",
  "--cy-pill-border": "--rb-border-strong",
  "--cy-pill-status": "--rb-pink-300",
};

const CHECK = process.argv.includes("--check");
const DECL_LINE = /^\s*(--[a-z0-9-]+)\s*:/i;

const outfile = resolve("node_modules/.cache/mochi-palette/color-roles.mjs");
const paletteFile = resolve("node_modules/.cache/mochi-palette/palette-from-cat.mjs");
await esbuild.build({
  entryPoints: [resolve("src/shared/color-roles.ts")],
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
await esbuild.build({
  entryPoints: [resolve("src/shared/palette-from-cat.ts")],
  bundle: true, format: "esm", platform: "node", outfile: paletteFile, logLevel: "silent",
});
const { scanColorLiterals } = await import(new URL(`file://${outfile}`).href);
const { TOKENS_BY_SCHEME } = await import(new URL(`file://${paletteFile}`).href);
const migration = JSON.parse(readFileSync(resolve("scripts/build/color-migration.json"), "utf8"));

/** 表按写法索引；键就是分类器吐出来的原文小写，所以查找也用原文小写，不做空白折叠。 */
const BY_SPELLING = new Map(Object.entries(migration).map(([k, v]) => [k.toLowerCase(), v]));

const defSource = new Map(DEF_FILES.map((f) => [f, readFileSync(resolve(f), "utf8")]));
const declaredCache = new Map();
function declaredInDefFiles(token) {
  if (!declaredCache.has(token)) {
    const re = new RegExp(`^\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
    declaredCache.set(token, DEF_FILES.every((f) => re.test(defSource.get(f))));
  }
  return declaredCache.get(token);
}

/** 死兜底判据（R-18-2 / A1）：两档派生表都有值，且三份定义文件都声明。 */
function deadFallback(token) {
  return TOKENS_BY_SCHEME.light[token] !== undefined
    && TOKENS_BY_SCHEME.dark[token] !== undefined
    && declaredInDefFiles(token);
}

/**
 * 命中点外层套着的每一个 `var(--x, …)`，从最外层到最内层。
 * 逐字符走括号栈：到 index 时栈里剩下的就是「还没闭合」的那些，正好是外层。
 */
function enclosingVars(line, index) {
  const stack = [];
  for (let i = 0; i < index; i += 1) {
    const ch = line[i];
    if (ch === "(") {
      const before = line.slice(Math.max(0, i - 8), i);
      const m = /var\s*$/.exec(before);
      let token = null;
      if (m) {
        const after = /^\(\s*(--[a-z0-9-]+)/i.exec(line.slice(i));
        token = after ? after[1] : null;
      }
      stack.push({ start: i - (m ? m[0].length : 0), token });
    } else if (ch === ")" && stack.length) {
      stack.pop();
    }
  }
  return stack.filter((v) => v.token); // 栈序即开括号顺序：最外层在前
}

/** 从 `var(` 的左括号位置找它的右括号，返回该 `var(...)` 的 [start, end)。 */
function varSpan(line, varStart) {
  const open = line.indexOf("(", varStart);
  let depth = 0;
  for (let i = open; i < line.length; i += 1) {
    if (line[i] === "(") depth += 1;
    else if (line[i] === ")") {
      depth -= 1;
      if (depth === 0) return [varStart, i + 1];
    }
  }
  throw new Error(`var( 没有闭合：${line.trim()}`);
}

function rowFor(hit, file) {
  const row = BY_SPELLING.get(hit.text.toLowerCase());
  if (!row) {
    throw new Error(
      `${file}:${hit.line} 的写法 ${hit.text} 不在迁移表里。`
        + "表是唯一权威：要留它就补一条 keep + 理由，要换就补 token/expr，不许脚本临场决定。",
    );
  }
  return row;
}

function replacementFor(row, hit, file) {
  if (row.keep) return null;
  if (row.token) return { token: row.token, text: `var(${row.token})` };
  if (row.expr) return { token: null, text: row.expr };
  throw new Error(`${file}:${hit.line} 迁移表里 ${hit.text} 既没有 token/expr 也不是 keep`);
}

/** 同一行里多个命中会产出重叠的编辑：外包的那条（死兜底整段收掉）赢，被它盖住的丢掉。 */
function resolveEdits(edits, file, lineNo) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const e of sorted) {
    const last = kept[kept.length - 1];
    if (last && e.start >= last.start && e.end <= last.end) {
      if (e.start === last.start && e.end === last.end && e.text !== last.text) {
        throw new Error(`${file}:${lineNo} 两处命中给出同一段不同替换：${e.text} / ${last.text}`);
      }
      continue;
    }
    if (last && e.start < last.end) {
      throw new Error(`${file}:${lineNo} 命中范围部分重叠，脚本不猜：${e.start}-${e.end} vs ${last.start}-${last.end}`);
    }
    kept.push(e);
  }
  return kept;
}

let totalSites = 0;
let totalLines = 0;
let failed = false;

const moduleFiles = globSync("src/**/*.css", { cwd: process.cwd() })
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !THEME_FILES.includes(f))
  .sort();
const allFiles = [...moduleFiles, ...THEME_FILES].sort();

for (const file of allFiles) {
  const before = readFileSync(resolve(file), "utf8");
  const isTheme = THEME_FILES.includes(file);
  const hitsByLine = new Map();
  for (const hit of scanColorLiterals(before)) {
    if (!hitsByLine.has(hit.line)) hitsByLine.set(hit.line, []);
    hitsByLine.get(hit.line).push(hit);
  }

  const lines = before.split("\n"); // 行尾 \r 原样留在行内，join 回去还是 CRLF
  let changed = 0;
  let sites = 0;

  for (const [lineNo, hits] of hitsByLine) {
    const line = lines[lineNo - 1];
    const decl = DECL_LINE.exec(line);
    const declName = decl ? decl[1].toLowerCase() : null;

    // 主题文件的 `--rb-*` 声明就是色板；`--cy-pill-*` 由下面的 PILL_FIXES 管。
    if (isTheme && (declName?.startsWith("--rb-") || Object.hasOwn(PILL_FIXES, declName))) continue;

    const edits = [];
    for (const hit of hits) {
      if (isTheme && declName?.startsWith("--rb-")) continue; // 理论上到不了这里
      const row = rowFor(hit, file);
      sites += 1;

      const outerDead = enclosingVars(line, hit.index).find((v) => deadFallback(v.token));
      if (outerDead) {
        const [start, end] = varSpan(line, outerDead.start);
        edits.push({ start, end, text: `var(${outerDead.token})`, kind: "collapse" });
        continue;
      }
      const replacement = replacementFor(row, hit, file);
      if (!replacement) continue; // keep：不动值
      edits.push({ start: hit.index, end: hit.index + hit.text.length, text: replacement.text, kind: "value" });
    }

    const resolved = resolveEdits(edits, file, lineNo);
    if (!resolved.length) continue;
    let next = line;
    for (const e of [...resolved].sort((a, b) => b.start - a.start)) {
      next = next.slice(0, e.start) + e.text + next.slice(e.end);
    }
    if (next !== line) {
      lines[lineNo - 1] = next;
      changed += 1;
    }
  }

  // PILL_FIXES：只认这三条。别的 `--cy-*` 是布局/尺寸令牌（例如
  // `--cy-message-reading-width: min(…)`），不是色值，脚本不该碰；它们若真带品牌色，
  // 由锁的原文扫描当场红。
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(--cy-[a-z0-9-]+)(\s*):\s*([^;]*);([\s\S]*)$/.exec(lines[i]);
    if (!m) continue;
    const [, indent, name, colon, value, tail] = m;
    if (!Object.hasOwn(PILL_FIXES, name)) continue;
    if (/^var\(/.test(value.trim())) continue;
    lines[i] = `${indent}${name}${colon}: var(${PILL_FIXES[name]});${tail}`;
    changed += 1;
  }

  if (!changed) continue;
  totalSites += sites;
  totalLines += changed;
  if (CHECK) {
    failed = true;
    console.error(`漂移：${file} 有 ${changed} 行该回写（${sites} 处品牌字面量）`);
    continue;
  }
  writeFileSync(resolve(file), lines.join("\n"), "utf8");
  console.log(`${file}: 回写 ${changed} 行 / ${sites} 处`);
}

console.log(CHECK
  ? `--check：${failed ? `有漂移（共 ${totalLines} 行）` : "无漂移"}`
  : `按表回写 ${totalLines} 行 / ${totalSites} 处品牌字面量`);
process.exit(failed ? 1 : 0);

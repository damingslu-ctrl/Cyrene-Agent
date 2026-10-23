/**
 * 着色令牌可解析锁：模块 CSS / TSX 里的每一个着色族 `var()` 引用，都必须能解析到东西。
 *
 * 为什么要有这把锁（既有三把都看不见这个洞）：
 * - `theme-palette-derivation.test.ts` 只看**主题级声明**的令牌，规则里的引用不在射程。
 * - `brand-color-migration.test.ts` 只看**色值字面量**，引用一个不存在的令牌时没有字面量可看。
 * - `hardcoded-color-ratchet.test.ts` 只数**带色行数**，悬空引用照样只占一行。
 *
 * 结果是这一类坏掉的东西能一路活着进发布：上游写了 `var(--rb-border)`，而 `--rb-border`
 * **从来没被声明过**——浏览器在 computed-value 阶段把整条声明丢掉，那条边框根本不存在，
 * 而且没有任何一盏红灯。这与 A-1（派生锁对 `var()` 间接层开天窗）是同一类问题：
 * 尺子照不到的地方，就是坏改动能藏身的地方。
 *
 * 判据：引用要能解析到下列之一——
 * 1. **已声明**：在任一 CSS 文件里声明过，或运行时注入（TSX 的内联样式对象 / `setProperty`）。
 * 2. **兜底链终止于字面量**：`var(--x, #abc)` 或 `var(--x, var(--y, #abc))`。
 *
 * 兜底链终止于**另一个也没声明的令牌**不算数——那还是悬空：
 * `var(--rb-surface-raised, var(--rb-surface-default))` 两个名字都没有，这条背景等于没有。
 *
 * 已知局限（范围，不是漏扫）：
 * 1. 本锁只判断「有没有值」，不判断「在当前作用域有没有值」。某个令牌只在深色主题里声明、
 *    却被浅色主题的组件引用，本锁看不见——那是派生锁的层叠职责。
 * 2. 兜底是**字面量**时一律放行（不要求它是猫色板派生的色）。那个字面量由品牌色锁单独
 *    裁决（迁移表里有 keep 条目），所以不是没人管，是另一把锁在管。
 * 3. TSX 的内联样式以 `"--name":` 判定为「已声明」，这是**过近似**：对象里恰好有个同名键
 *    也会被当成注入源。多算比少算安全——少算会把好代码误判成坏。
 * 4. 扫描范围是**生产源**：测试文件（`*.test.*` / `*.spec.*`，不限扩展名）既不算引用
 *    也不算声明。测试里的 `var(--rb-nope)` 是夹具，不是屏幕上的东西；测试里声明的令牌也不会
 *    进运行时，所以不算「已声明」是对的。实测这条过滤不改变判定结果（生产源引用里没有一条
 *    依赖只在测试文件里声明过的令牌）。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** `__dirname` = `src/renderer/ui`，仓库根在三级之上（R-18-6）。 */
const REPO = resolve(__dirname, "../../..");
const norm = (f: string) => f.split("\\").join("/");

/** 着色族令牌名：必须至少有一段，否则 `--rb-` 这种残名会混进来。 */
const COLOR_TOKEN = /^--(?:rb|md|cy)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** CSS 里的自定义属性声明。 */
const CSS_DECL = /(--[a-zA-Z0-9-]+)\s*:/g;
/** 运行时注入：TSX 内联样式对象 `{"--name": ...}` / `setProperty("--name", ...)`。 */
const TS_INJECT = /["'](--[a-zA-Z0-9-]+)["']\s*:/g;
const TS_SET_PROPERTY = /setProperty\(\s*["'](--[a-zA-Z0-9-]+)["']/g;

/**
 * 测试文件不进射程（见文件头局限 4）。按「扩展名之前的那一段」判，不限扩展名——
 * 今天仓里只有 `.test.ts`，但将来出现 `.test.css` 夹具时，同一条规则照样把它排掉。
 */
const IS_TEST_FILE = /\.(test|spec)\./;

interface Ref {
  file: string;
  line: number;
  name: string;
  /** `var()` 的第二个参数（兜底），没有则是 null。 */
  fallback: string | null;
}

/** 取出 `var(` 之后按括号配平的那一段（兜底里可能还有嵌套 `var()`）。 */
function readVarArgs(text: string, open: number): { args: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return { args: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** 按**顶层逗号**拆 `var()` 的参数：第一个是名字，其余拼回兜底。 */
function splitArgs(args: string): { name: string; fallback: string | null } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return { name: args.trim(), fallback: null };
  return { name: args.slice(0, cut).trim(), fallback: args.slice(cut + 1).trim() || null };
}

function collectDeclared(): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>();
  const add = (name: string, where: string) => {
    if (!declared.has(name)) declared.set(name, new Set());
    declared.get(name)!.add(where);
  };
  for (const file of sourceFiles().css) {
    const text = readFileSync(resolve(REPO, file), "utf8");
    for (const m of text.matchAll(CSS_DECL)) add(m[1], file);
  }
  for (const file of sourceFiles().ts) {
    const text = readFileSync(resolve(REPO, file), "utf8");
    for (const m of text.matchAll(TS_INJECT)) add(m[1], file);
    for (const m of text.matchAll(TS_SET_PROPERTY)) add(m[1], file);
  }
  return declared;
}

/** 生产源清单：测试文件剔除（文件头局限 4）。 */
function sourceFiles(): { css: string[]; ts: string[] } {
  const css = globSync("src/**/*.css", { cwd: REPO }).map(norm).filter((f) => !IS_TEST_FILE.test(f));
  const ts = globSync("src/**/*.{ts,tsx}", { cwd: REPO }).map(norm).filter((f) => !IS_TEST_FILE.test(f));
  return { css, ts };
}

function collectRefs(): Ref[] {
  const refs: Ref[] = [];
  const { css, ts } = sourceFiles();
  const files = [...css, ...ts];
  for (const file of files) {
    const lines = readFileSync(resolve(REPO, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      let idx = line.indexOf("var(");
      while (idx >= 0) {
        const open = idx + 3;
        const parsed = readVarArgs(line, open);
        if (!parsed) break;
        const { name, fallback } = splitArgs(parsed.args);
        if (COLOR_TOKEN.test(name)) refs.push({ file, line: i + 1, name, fallback });
        idx = line.indexOf("var(", parsed.end);
      }
    });
  }
  return refs;
}

/**
 * 解析一个引用。返回 null = 能解析；返回字符串 = 为什么悬空。
 *
 * 判定链：名字已声明 → 通过；否则看兜底——兜底里没有 `var(` 则是字面量 → 通过；
 * 兜底里还有 `var(--y)` 则对 `--y` 递归（深度封顶，防兜底自引用时无限递归）。
 */
function resolveRef(
  ref: Ref,
  declared: Map<string, Set<string>>,
  depth = 0,
): string | null {
  if (declared.has(ref.name)) return null;
  if (ref.fallback === null) return "没有声明，也没有兜底";
  const inner = /^var\(/.test(ref.fallback) ? readVarArgs(ref.fallback, 3) : null;
  if (!inner) return null; // 字面量兜底
  if (depth > 8) return "兜底链太深，判据本身有问题";
  const parsed = splitArgs(inner.args);
  if (!COLOR_TOKEN.test(parsed.name)) return null; // 兜底指向非着色族，交给别的尺
  return resolveRef({ ...ref, name: parsed.name, fallback: parsed.fallback }, declared, depth + 1);
}

describe("着色令牌的引用必须能解析", () => {
  const declared = collectDeclared();
  const refs = collectRefs();

  it("扫描器本身没塌（正对照）", () => {
    // 这些下限抄自棘轮锁的同口径实测值：扫空或正则失效会让后面那条直接读成绿。
    expect(declared.size, "一个着色令牌都没扫到").toBeGreaterThan(100);
    expect(refs.length, "一个着色族引用都没扫到").toBeGreaterThan(1000);
    expect(declared.has("--rb-accent"), "主题令牌 --rb-accent 没被算成已声明").toBe(true);
    expect(declared.has("--cy-msg-size"), "运行时注入的 --cy-msg-size 没被算成已声明").toBe(true);
    // 判定逻辑自身的正反对照。
    expect(resolveRef({ file: "x", line: 1, name: "--rb-accent", fallback: null }, declared)).toBeNull();
    expect(
      resolveRef({ file: "x", line: 1, name: "--rb-nope", fallback: null }, declared),
      "没声明又没兜底的引用被判成能解析",
    ).not.toBeNull();
    expect(
      resolveRef({ file: "x", line: 1, name: "--rb-nope", fallback: "#abc" }, declared),
      "字面量兜底被判成悬空",
    ).toBeNull();
    expect(
      resolveRef(
        { file: "x", line: 1, name: "--rb-nope", fallback: "var(--rb-nope2)" },
        declared,
      ),
      "兜底指向另一个没声明的令牌被判成能解析",
    ).not.toBeNull();
  });

  it("模块 CSS / TSX 里没有解析不了的着色引用", () => {
    const broken: string[] = [];
    for (const ref of refs) {
      const why = resolveRef(ref, declared);
      if (why) broken.push(`${ref.file}:${ref.line}  ${ref.name} —— ${why}`);
    }
    expect(broken.join("\n"), "这些着色引用既没有声明也没有能落地的兜底，浏览器会把整条声明丢掉").toBe(
      "",
    );
  });
});

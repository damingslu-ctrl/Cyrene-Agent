/**
 * `scripts/` 目录树里的 node:test 文件必须真的被跑到。
 *
 * 现有五颗（`scripts/build/verify-dynamic-imports`、`scripts/packaging/electron-builder-config`、
 * `prepare-mingit`、`prepare-mpv`、`scripts/perf/chat-renderer-recording`）写的是 `node:test` API，
 * 而 `vitest.config.mts` 的 include 是逐条列举的白名单，没有一条覆盖 `scripts` 下的 `.test.mjs`
 * （只有 `scripts/cline-poc` 下的 `.test.ts`）。仓库里也没有任何地方出现 `node --test`。
 * 于是它们「在盘上、全绿、没人跑」——2026-11-01 实测那一趟是 17 tests / 17 pass / 750 ms：
 * 红不了，也不会被跑，锁的字段被改坏没有人来收。
 *
 * 判据不是「有几颗文件」，是**四件事同时成立**：门禁脚本存在（A）、CI 真的调用它（B）、
 * `scripts/` 里任何一颗长得像测试的文件都不许掉在两个 runner 之外（C）、这一步还得有一个
 * 真能在本 fork 上触发起来的入口（E）。B 只管「文件里写了这一行」，而实测本 fork 上
 * `on: push` 从来不产出 run——写在 workflow 里不等于跑得起来，这条差值由 E 补。
 * C 靠通配匹配算，而匹配器本身有两颗对照钉着：同一棵树上真在的一颗必须命中、
 * 它的实现体必须不命中（D）——少了后一颗，「匹配一切」的坏匹配器会让 C 空跑成绿。
 * D 还钉「长得像测试」这条枚举本身：少认一种扩展名会让那颗文件从走查里蒸发，
 * C 便数不到越界者，同样是空跑成绿。
 */
import { load } from "js-yaml";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptsRoot = path.join(repoRoot, "scripts");

/**
 * 「长得像测试」的判据只抽出来一处，好让 D 能拿名字直接照它。
 *
 * 这条判据的失败方向是**少认**：漏掉一种扩展名，那颗文件就从 `found` 里蒸发，
 * C 于是看不见任何越界者并报绿——2026-11-01 在现拼的假仓库根上真踩到了：藏一颗
 * `scripts/perf/hidden-case.test.js`，旧写法的 `tsx?` 覆盖不到裸 `js`，整档绿。
 * 改完第一版又踩第二次：`tsx` 那一型盖不住裸 `ts`，D 的名字级对照当场把它逮住。
 * 所以扩展名逐条列全，不写 `[cm]?js` 这种分组写法；每一种都有自己的正对照。
 */
const TEST_SHAPED_NAMES = [
  "case.test.js",
  "case.test.mjs",
  "case.test.cjs",
  "case.test.jsx",
  "case.test.ts",
  "case.test.mts",
  "case.test.cts",
  "case.test.tsx",
];

function isTestShaped(name: string): boolean {
  return /\.(test|spec)\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$/.test(name);
}

/**
 * 只走 `scripts` 这一棵。从仓库根起手会爬进 `native` 的 target 目录、`release`、`.tmp`
 * （本机 `.tmp` 里放过 73 片安装包分块），那既慢又不是这条判据的射程。
 */
function testShapedFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(abs);
      } else if (isTestShaped(entry.name)) {
        found.push(`scripts/${path.relative(scriptsRoot, abs).split(path.sep).join("/")}`);
      }
    }
  };
  walk(scriptsRoot);
  return found.sort();
}

/**
 * 把 glob 翻成正则，只支持这两处实际用到的两种通配：`**` 跨段、`*` 段内。
 * 写歪了的失败方向是「匹配不到任何东西」，那会被 C 读成每颗文件都没人跑——响的红，不是静默的绿。
 */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".+";
        }
      } else {
        // 段内通配要吃得下字符：`*` 写成 `[^/]*` 会让 `*.ts` 匹配不上 `a.ts`，
        // 「匹配不到任何东西」的匹配器能把整棵树的测试算成没人跑——红得响，但红得没道理。
        out += "[^/]+";
      }
    } else if (c === "." || c === "$" || c === "(" || c === ")" || c === "|" || c === "+" || c === "[" || c === "]" || c === "^" || c === "\\") {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/test.yml"), "utf8");
const vitestConfig = readFileSync(path.join(repoRoot, "vitest.config.mts"), "utf8");

/** 门禁脚本名：package.json 与 CI 步骤必须用同一个名字，改名要两处一起改。 */
const GATE_SCRIPT = "test:scripts";

describe("scripts/ 的 node:test 门禁", () => {
  const command = pkg.scripts?.[GATE_SCRIPT] ?? "";

  it("A package.json 里有 node --test 的门禁脚本，且参数落在 scripts 那一棵", () => {
    // 正对照：同一个 scripts 块必然读得出 `test`，证明 JSON 没解析成空对象。
    expect(pkg.scripts?.test).toBeTruthy();
    expect(command).toMatch(/node\s+--test/);
    // 只钉形状、不钉整串 glob：glob 往宽里改（如多收一种扩展名）不该让 A 红，
    // 「宽到漏文件」由 C 去判——C 才是那条算覆盖率的。
    expect(command).toMatch(/(?:\.\/)?scripts\/\S+\.test\.\w+/);
  });

  it("B CI 真的调用这一步", () => {
    // 正对照：这份 workflow 里必然有 vitest 那几步，证明读对了文件、不是空串。
    expect(workflow).toMatch(/vitest run/);
    expect(workflow).toMatch(/pnpm(?:\s+exec)?\s+(?:run\s+)?test:scripts(?![\w-])/);
  });

  it("E 这一步有真能在本 fork 上触发起来的入口", () => {
    // 读 YAML 而不是在原文上找 `workflow_dispatch` 那串字：注释里也写着这个词
    // （就在 workflow 自己顶上几行），正则读法会把「写在注释里的打算」当成「有入口」。
    const raw = (load(workflow) as { on?: unknown }).on;
    // 两种合法写法都认：块式映射（键值各一行）与流式序列（`on: [push, ...]`）。
    // 只钉一种会把合法改口读成红——钉错方向的锁，下一轮就没人信它了。
    const triggerNames = Array.isArray(raw) ? raw : Object.keys((raw ?? {}) as Record<string, unknown>);
    // 正对照：另两个触发器解析得出来，证明 `on` 这块真被读到了，
    // 不是「解析器读成空数组/空对象」被 E 认成「没有入口」，也不是空的那一侧混过了断言。
    expect(triggerNames).toContain("push");
    expect(triggerNames).toContain("pull_request");
    // 实测（2026-11-01）：本 fork 全仓 18 趟 run 全是 workflow_dispatch，两个带 `on: push`
    // 的工作流（Test / plugin-sdk）各自 total_count=0；同一份工作流在上游有 636 趟 push run。
    // 「push 会触发」在这个仓是一句不兑现的话，所以入口必须是手动 dispatch，否则 B 钉住的
    // 那一行永远不会被执行——门禁的全部意义就没了。
    expect(triggerNames).toContain("workflow_dispatch");
  });

  it("C scripts 下每颗测试文件都被某个 runner 认走", () => {
    // 匹配器自己先照一遍：跨段、段内、锚定都对了，下面那句「谁没被认走」才算数。
    expect(globToRegExp("scripts/**/*.test.mjs").test("scripts/packaging/prepare-mpv.test.mjs")).toBe(true);
    expect(globToRegExp("scripts/**/*.test.mjs").test("scripts/packaging/prepare-mpv.mjs")).toBe(false);
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("a/b.ts")).toBe(false);
    const gatePatterns = [...command.matchAll(/["']?(scripts\/[^"'"\s]+)["']?/g)].map((m) => m[1]);
    const vitestIncludes = [...vitestConfig.matchAll(/"((?:src|skills|scripts)\/[^"]+)"/g)].map((m) => m[1]);
    const covered = (file: string) =>
      [...gatePatterns, ...vitestIncludes].some((pattern) => globToRegExp(pattern).test(file));
    const found = testShapedFiles();
    // 走查与读法都要有对照：真在盘上的一颗必须被认走，它的实现体必须不被认走。
    expect(covered("scripts/packaging/prepare-mpv.test.mjs")).toBe(true);
    expect(covered("scripts/packaging/prepare-mpv.mjs")).toBe(false);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((file) => !covered(file))).toEqual([]);
  });

  it("D 走查与枚举都看得见东西（数到空集不许读成绿）", () => {
    const found = testShapedFiles();
    // 这三颗分居三个子目录：走查只爬得动一层的坏法会当场少掉两颗。
    for (const anchor of [
      "scripts/build/verify-dynamic-imports.test.mjs",
      "scripts/packaging/prepare-mpv.test.mjs",
      "scripts/perf/chat-renderer-recording.test.mjs",
    ]) {
      expect(found).toContain(anchor);
    }
    // 枚举形状的对照：少认一种扩展名＝那颗文件从 found 里蒸发，C 数不到越界者便空跑成绿。
    for (const name of TEST_SHAPED_NAMES) {
      expect(isTestShaped(name)).toBe(true);
    }
    for (const name of ["prepare-mpv.mjs", "helper.js", "case.test.js.bak"]) {
      expect(isTestShaped(name)).toBe(false);
    }
  });
});

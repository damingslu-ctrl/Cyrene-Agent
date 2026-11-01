/**
 * 「读盘上源码原文、再按一个写死的行尾去匹配」这一类断言，判的是本机根本看不见的那个变量。
 *
 * 2026-11-01 实测到的第一颗：`src/main/verge/core-ipc.test.ts` 里
 * `expect(bootstrap).toMatch(/canSwap,\n\s*coreDir,/)` —— 本机绿、CI 红。根因不在断言，
 * 在环境：Windows runner 镜像把 `core.autocrlf` 设成 true，而本仓没有 `.gitattributes`，
 * 于是 checkout 把 LF 的 blob 换成 CRLF 的工作树；那颗断言收到的正文变成
 * `/**\r\n * 内核宿主的装配层…`，`canSwap,` 后面直接顶着一个 `\r`，`\n` 永远对不上。
 * 同一趟里 `ChatPage.test.ts:84` 侥幸没红，靠的是前面那段 `[\s\S]{0,800}?` 正好能把 `\r`
 * 吞掉——那是运气，不是契约，所以这一类一起收。
 *
 * 判据是**两件事同时成立**：那颗正则落在「匹配」的调用里（`.replace()` 的本事就是处理行尾，
 * 不算），且它写死了一种行尾（`\n` 前面既没有 `\r?` 也没有 `\s`，或者反过来只认 `\r\n`）。
 * A 管走查真爬得动、扫描器认得出正则字面量（把除法当字面量会把整仓算成越界——红得响但没道理；
 * 反过来漏认字面量就是空跑成绿）；B 管谓词本身的档位，两侧都有名字照；C 是全仓结论；
 * D 管环境那一半（CI 在 checkout 之前把 `core.autocrlf` 钉成 false）；
 * E 拿真字节做因果对照——同一颗断言在 LF 与 CRLF 两副正文上必须读出两个结果，
 * 少了这一档，前面四条都能在一把「其实咬不着任何东西」的锁上绿着。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

/** 只走 vitest 真会跑的两棵；`packages`/`examples` 压根不在 include 里，判不到也不该判。 */
const WALK_ROOTS = ["src", "scripts"];

/** `.replace()`/`.replaceAll()` 的活儿就是换行尾，放行；`.split()` 不放（下面 B 有对照）。 */
const FRAGMENTERS = new Set(["replace", "replaceAll"]);

/**
 * 「换行匹配位」吃不吃两种行尾：前面是 `\r?` 或 `\s`，或整个落在字符类里。
 * 落在字符类里的那一档（`[\r\n]`、`[^\n]`）放行的理由与 `.replace()` 同源——它不要求某个确定的邻接字符。
 */
type NewlineHit = { lfOnly: boolean; crlfOnly: boolean };

/**
 * 从 `/` 起手扫一颗正则字面量：转义对整体吃、字符类里的 `/` 不算收口、跨行即判「这不是字面量」。
 * 回 `null` 的失败方向要说清：`null` 意味着这个 `/` 当除法跳过，漏认的代价是那颗真字面量从走查里蒸发，
 * 所以 A 用四条名字级对照钉住「认得出 / 认不出」的两端。
 */
function scanRegexLiteral(text: string, start: number): { end: number; hits: NewlineHit[] } | null {
  let k = start + 1;
  let inClass = false;
  const hits: NewlineHit[] = [];
  let prev: { kind: "esc" | "other"; ch: string; opt: boolean } | null = null;
  for (; k < text.length; k += 1) {
    const c = text[k];
    if (c === "\n") return null;
    if (c === "\\") {
      const ch = text[k + 1] ?? "";
      const opt = text[k + 2] === "?" || text[k + 2] === "*";
      if (ch === "n" && !inClass) {
        const crOpt = !!prev && prev.kind === "esc" && prev.ch === "r" && prev.opt;
        const ws = !!prev && prev.kind === "esc" && (prev.ch === "s" || prev.ch === "S");
        const crlfOnly = !!prev && prev.kind === "esc" && prev.ch === "r" && !prev.opt;
        hits.push({ lfOnly: !crOpt && !ws && !crlfOnly, crlfOnly });
      }
      prev = { kind: "esc", ch, opt };
      k += opt ? 2 : 1;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let m = k + 1;
      while (m < text.length && /[a-z]/.test(text[m])) m += 1;
      return { end: m, hits };
    }
    prev = { kind: "other", ch: c };
  }
  return null;
}

const OPERAND_ENDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "%", "<", ">", "~", "^", "*"]);
const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "await", "yield"]);

/** 带字符串/注释状态机的字面量走查：注释与串里的 `/a\nb/` 是散文，不是代码。 */
function regexLiterals(text: string): { start: number; end: number; hits: NewlineHit[]; line: number }[] {
  const out: { start: number; end: number; hits: NewlineHit[]; line: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === quote) { i += 1; break; }
        if (quote !== "`" && text[i] === "\n") break;
        i += 1;
      }
      continue;
    }
    if (c === "/") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j])) j -= 1;
      const before = j >= 0 ? text[j] : "";
      const word = /(\w+)\s*$/.exec(text.slice(0, i))?.[1] ?? "";
      if (before === "" || OPERAND_ENDERS.has(before) || KEYWORDS.has(word)) {
        const lit = scanRegexLiteral(text, i);
        if (lit) {
          out.push({ start: i, end: lit.end, hits: lit.hits, line: text.slice(0, i).split(/\r?\n/).length });
          i = lit.end;
          continue;
        }
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * 就近的那个开括号前面的方法名——决定这颗正则在「匹配」还是在「切/换」。
 * 读不准就回空串，而空串按越界办：宁可多红一颗让人来看，不许「读不出调用者」变成默认放行。
 */
function enclosingCallee(text: string, start: number): string {
  let depth = 0;
  for (let i = start - 1; i >= 0; i -= 1) {
    const c = text[i];
    if (c === ")") depth += 1;
    else if (c === "(") {
      if (depth === 0) return /\.([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, i - 60), i))?.[1] ?? "";
      depth -= 1;
    }
  }
  return "";
}

function violationsIn(text: string): string[] {
  const bad: string[] = [];
  for (const lit of regexLiterals(text)) {
    const callee = enclosingCallee(text, lit.start);
    if (FRAGMENTERS.has(callee)) continue;
    const source = text.slice(lit.start, lit.end);
    for (const hit of lit.hits) {
      if (hit.lfOnly) bad.push(`:${lit.line} .${callee || "?"}() 只认 LF  ←  ${source}`);
      if (hit.crlfOnly) bad.push(`:${lit.line} .${callee || "?"}() 只认 CRLF  ←  ${source}`);
    }
  }
  return bad;
}

function testFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(entry.name)) found.push(abs);
    }
  };
  for (const root of WALK_ROOTS) walk(path.join(repoRoot, root));
  return found.sort();
}

/**
 * 档位对照全部写成**字符串**，不是正则字面量：本锁的 C 档要扫全仓，
 * 把「越界的写法」当代码留在文件里，锁就会把自己判红——那正是假绿的反面教材。
 */
const TOLERANT_FIXTURES = [
  "expect(src).toMatch(/canSwap,\\r?\\n\\s*coreDir,/)",
  "expect(src).toMatch(/,\\s*\\n\\s*coreDir,/)",
  "expect(src).toMatch(/[\\r\\n]/)",
  "expect(src).toMatch(/[^\\n]/)",
  "const one = a / b; expect(src).toMatch(/x/)",
  "x.replace(/\\r\\n/g, \"\\n\")",
  "x.replace(/-----(BEGIN|END) PRIVATE KEY-----|\\n/g, \"\")",
];

const STRICT_FIXTURES = [
  "expect(src).toMatch(/canSwap,\\n\\s*coreDir,/)",
  "expect(src).toMatch(/(^|\\n)---(\\n|$)/)",
  "expect(src).split(/\\n/)",
  "x.search(/a\\r\\nb/)",
  "const RE = /a\\nb/;",
];

/** 数 CR 那一步在 workflow 里唯一的锚：步名改了这里必须一起改，否则 D 档是在空气上排序。 */
const CENSUS_TOKEN = "Census the checked-out line endings";

/**
 * 钉子步骤里那三条 echo 的锚。为什么要有这一档，是 2026-11-02 第一趟现场教出来的：
 * `git config --global core.autocrlf` 打出来是**空的**（镜像那颗 true 钉在 system 层，global 看不见），
 * 只留 global 读数的话，日志会把「镜像没设过」当成结论——那是条会误导下一个人的读数。
 */
const ECHO_EFFECTIVE = "effective value:";
const ECHO_GLOBAL = "global value:";
const ECHO_PINNED = "pinned value:";

/** 两副合成档：同一批锚点换个位次，判据必须跟着换面，否则「排序」只是照抄当下的文件。 */
const SYNTHETIC_WORKFLOW_OK = [
  "  - name: Pin",
  `    run: echo "${ECHO_EFFECTIVE} x" && echo "${ECHO_GLOBAL} x"`,
  "    run: git config --global core.autocrlf false",
  `    run: echo "${ECHO_PINNED} x"`,
  "  - uses: actions/checkout@v7",
  `  - name: ${CENSUS_TOKEN}`,
].join("\n");

const SYNTHETIC_WORKFLOW_SWAPPED = [
  `  - name: ${CENSUS_TOKEN}`,
  "  - uses: actions/checkout@v7",
  "    run: git config --global core.autocrlf false",
].join("\n");

/**
 * 第三副只动 echo 的位次：钉子先落下、三条读数后打印。
 * 这样「三条都在」依旧成立，但标着 effective/global 的那两条其实读的是钉过之后的值——
 * 少了这一副，位次判据就只验了「有没有」，没验「谁在前」。
 */
const SYNTHETIC_WORKFLOW_ECHO_LATE = [
  "  - name: Pin",
  "    run: git config --global core.autocrlf false",
  `    run: echo "${ECHO_EFFECTIVE} x" && echo "${ECHO_GLOBAL} x" && echo "${ECHO_PINNED} x"`,
  "  - uses: actions/checkout@v7",
  `  - name: ${CENSUS_TOKEN}`,
].join("\n");

/**
 * 环境侧那三条位次判据抽成纯函数——D 档要用它同时读真文件和三副合成档。
 * 要防的假绿很具体：钉子与 checkout 两颗锚都在，但钉子排在 checkout **之后**，
 * 解包已经完成，那一趟 `git config` 改动对这批文件一个字都管不着。
 */
function pins(text: string): {
  pinBeforeCheckout: boolean;
  censusAfterCheckout: boolean;
  echoesStraddlePin: boolean;
} {
  const pin = text.indexOf("core.autocrlf false");
  const checkout = text.search(/- (?:name:[^\r\n]*\r?\n\s*)?uses: actions\/checkout@/);
  const census = text.indexOf(CENSUS_TOKEN);
  const before = [text.indexOf(ECHO_EFFECTIVE), text.indexOf(ECHO_GLOBAL)];
  const after = text.indexOf(ECHO_PINNED);
  return {
    pinBeforeCheckout: pin > -1 && checkout > -1 && pin < checkout,
    censusAfterCheckout: checkout > -1 && census > checkout,
    echoesStraddlePin: pin > -1 && before.every((k) => k > -1 && k < pin) && after > pin,
  };
}

describe("读盘原文的断言不许写死行尾（EOL 脆弱锁）", () => {
  it("A 走查真爬得动，且扫描器认得出正则字面量", () => {
    const files = testFiles();
    expect(files.length).toBeGreaterThan(700);
    const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");
    const listed = files.map(rel);
    // 三颗分居主/渲染/编排三棵：只爬得动一层的坏走查会当场少掉两颗。
    // 第四颗是 `.tsx`：走查的扩展名枚举少认一种，那颗文件就从射程里蒸发，
    // C 数不到越界者同样是空跑成绿——与本仓 include 里 `**/*.test.tsx` 那一档对齐。
    for (const anchor of [
      "src/main/verge/core-ipc.test.ts",
      "src/renderer/react/features/chat/pages/ChatPage.test.ts",
      "src/main/orchestrator/build-options.test.ts",
      "src/renderer/react/features/network/ClientUpdateSection.test.tsx",
      // 本锁自己也必须在射程里——C 档的「0 越界」不含自扫的话，就是给自己留了天窗。
      "src/main/eol-fragile-assertion.test.ts",
    ]) {
      expect(listed).toContain(anchor);
    }
    // 扫描器两端各一颗：认得出字面量（漏认＝那颗文件从走查里蒸发＝空跑成绿），
    // 也不把除法当字面量（误认＝整仓算成越界，红得没有道理）。
    expect(regexLiterals("expect(src).toMatch(/a\\nb/)").length).toBe(1);
    expect(regexLiterals("const one = a / b; expect(src).toMatch(/x/)").length).toBe(1);
    expect(regexLiterals("// 见 /a\\nb/ 这个写法\nconst one = a / b;").length).toBe(0);
    expect(regexLiterals("const s = \"见 /a\\\\nb/ 这个写法\";").length).toBe(0);
  });

  it("B 谓词的档位：合法写法放行、只认一种行尾的越界", () => {
    for (const fixture of TOLERANT_FIXTURES) {
      expect(violationsIn(fixture), `合法写法被判红：${fixture}`).toEqual([]);
    }
    for (const fixture of STRICT_FIXTURES) {
      expect(violationsIn(fixture), `越界写法被判绿：${fixture}`).not.toEqual([]);
    }
    // `.split(/\n/)` 不放行的理由要说清：切完每行还挂着 `\r`，下游断言跟着变——
    // 它是「匹配位」的另一种写法，不是「处理行尾」的活儿。这条档位一旦被放宽，上面那颗对照当场红。
    expect(violationsIn("x.replace(/\\n/g, \"\\r\\n\")")).toEqual([]);
    expect(violationsIn("x.split(/\\n/)")).not.toEqual([]);
  });

  it("C 全仓越界 = 0", () => {
    const offenders: string[] = [];
    for (const abs of testFiles()) offenders.push(...violationsIn(readFileSync(abs, "utf8")).map((v) => `${path.relative(repoRoot, abs)}${v}`));
    // 读数机自己先照一遍：把一颗已知的越界写法喂进同一条链路，必须点出来，
    // 否则「0 越界」可能只是走查读不出东西。
    const injected = violationsIn('expect(src).toMatch(/a,\\n\\s*b,/)');
    expect(injected.length).toBeGreaterThan(0);
    expect(offenders, `这些断言在 CRLF 工作树上会读成另一副样子：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("D CI 在 checkout 之前把 autocrlf 钉成 false，并在 checkout 之后数 CR", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/test.yml"), "utf8");
    // 两颗锚点都得存在，否则「pin 在 checkout 之前」会在「两者都不存在」上空跑成绿。
    expect(workflow.indexOf("core.autocrlf false")).toBeGreaterThan(-1);
    expect(pins(workflow)).toEqual({ pinBeforeCheckout: true, censusAfterCheckout: true, echoesStraddlePin: true });
    // 钉的是 global：checkout 用的是 git 自己的进程，仓库级配置在它解包之后才生效，管不到这批文件。
    expect(workflow).toMatch(/git config --global core\.autocrlf false/);
    // 合成档给排序判据装牙：真文件将来被搬错位置时，这一档要能提前红，而不是只认现在这一副。
    expect(pins(SYNTHETIC_WORKFLOW_OK)).toEqual({ pinBeforeCheckout: true, censusAfterCheckout: true, echoesStraddlePin: true });
    expect(pins(SYNTHETIC_WORKFLOW_SWAPPED)).toEqual({ pinBeforeCheckout: false, censusAfterCheckout: false, echoesStraddlePin: false });
    // 第三副只搬 echo：三条读数都在，但 effective/global 落在钉子之后——那条「生效值」就废了。
    expect(pins(SYNTHETIC_WORKFLOW_ECHO_LATE)).toEqual({ pinBeforeCheckout: true, censusAfterCheckout: true, echoesStraddlePin: false });
  });

  it("E 同一颗断言在两副行尾的正文上必须给出同一个答案（真字节）", () => {
    const raw = readFileSync(path.join(repoRoot, "src", "main", "verge", "core-bootstrap.ts"), "utf8");
    const lf = raw.replace(/\r\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    // 两档正文必须真的不一样，否则下面四条都是空转。钉法要讲清：空行在 CRLF 档里是 `\r\n\r\n`，
    // 所以「不许出现 `\n\r`」是错的 witness（实测确实出现）；真的差异凭据是
    // 「LF 档一颗 CR 都没有」+「CRLF 档成对出现」。
    expect(crlf).not.toBe(lf);
    expect(lf.includes("\r")).toBe(false);
    expect(crlf.includes("\r\n")).toBe(true);

    const fixed = /canSwap,\r?\n\s*coreDir,/;
    // 反对照只能用 new RegExp 造：写成字面量就会被本锁 C 档算成越界。
    const lfOnly = new RegExp("canSwap,\\n\\s*coreDir,");
    expect(fixed.test(lf), "钉死的那条接线在 LF 正文上读不出来").toBe(true);
    expect(fixed.test(crlf), "钉死的那条接线在 CRLF 正文上读不出来").toBe(true);
    // 因果：旧写法只在 LF 命中——CI 那一红不是玄学，是这两行读数。
    expect(lfOnly.test(lf)).toBe(true);
    expect(lfOnly.test(crlf), "旧写法若在 CRLF 上也命中，这一类根本不存在，锁该报红提醒自己").toBe(false);
    // 盘上真身（本机什么行尾都算）也得过。
    expect(fixed.test(raw)).toBe(true);
  });
});

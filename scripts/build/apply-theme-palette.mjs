// scripts/build/apply-theme-palette.mjs
/**
 * 把 `src/shared/palette-from-cat.ts` 的派生值按令牌名逐条写回四份 CSS。
 *
 * 只改值：不增删声明、不改令牌名、不动不在派生表里的行、不动值是 var()/color-mix() 的行。
 * 档位按**所属选择器**判、不按文件判（R-C15-1，理由见 BLOCK_SCHEMES 上方注释）：
 * 只有 theme.css 需要（它一份文件住两层叠角色），另外三份仍是一档一文件。
 * 为什么不手改：派生表 104 个名字，四份 CSS 里带色字面量的令牌声明实测 261 行
 * （tokens.css 69 / pearl-white.css 87 / charcoal-pink.css 84 / theme.css 21），
 * `ee4f779b` 首次落盘按名字回写了其中 252 条（67 / 80 / 84 / 21）；手改必然出现
 * 「改了三处漏了第四处」——那正是 native 色板台账立规矩要防的事（palette.rs:1-10）。
 * 为什么不把 CSS 变成生成物：这四份文件里还住着选择器、注释、排版与非色令牌，
 * 让脚本拥有整个文件等于让它决定「这行长什么样」，diff 就没人能审了。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild"; // vite 的传递依赖，已在树里；本期不新增依赖

const TARGETS = [
  // 顺序 = 浏览器看到的源序（tokens.css 先 link，theme.css 后 link 且它的 @import 在自己规则之前）
  // 这三份「一个文件一种档」，档位写死就是对的：
  //  * tokens.css 的 :root 是**故意**落浅色的默认层（normalizeUiTheme() 与 renderer/ui/theme.ts:32
  //    的兜底主题都是 pearl-white，默认段该跟兜底一致，顺带去掉启动瞬间的深→浅闪），
  //    它不参与逐选择器判档 —— 见 commit ee4f779b 正文 ① 与 brief Step 6 注 ①。
  //    实测把同一套分类器套到它头上：整份文件只有 1 条块开启行（`:root`），它 93 条在表声明会
  //    全部判成深色档（93/0），正是这里要避免的。
  { file: "src/renderer/ui/tokens.css", scheme: "light" },
  { file: "src/renderer/ui/themes/pearl-white.css", scheme: "light" },
  { file: "src/renderer/ui/themes/charcoal-pink.css", scheme: "dark" },
  // theme.css 一份文件里住两层叠角色（:7 的 :root = 深色安全默认值、:30 与 :1160 的 pearl 块 =
  // 珍珠白覆盖层），按文件分档必然把其中一边写错，所以它走 bySelector（R-C15-1）。
  { file: "src/renderer/ui/theme.css", bySelector: true },
];
const CHECK = process.argv.includes("--check");
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

/**
 * 纯间接层：`var(--x)` 或 `var(--x, <fallback>)`。
 *
 * 只认**整串就是** var() 的形态。字体栈（`600 80px/1.10 var(--rb-font-sans)`）与
 * `color-mix()` 都不是「一个令牌的别名」，它们是复合值，不该被拍平成一个色。
 */
const PURE_VAR = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]*?)\s*)?\)$/;

async function loadDerivation() {
  // esbuild 是 vite 的依赖，能在 Node 里直接把那个 TS 模块打成 ESM 再 import；
  // 产物落 node_modules/.cache（在 D: 上，且已被 gitignore），不写系统 TEMP。
  const outfile = resolve("node_modules/.cache/mochi-palette/palette-from-cat.mjs");
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [resolve("src/shared/palette-from-cat.ts")],
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

/**
 * 尾组必须是 [\s\S]*，不能是 .*：`.` 不匹配 \r，而本仓库四份 CSS 全是 CRLF，
 * split("\n") 后每行以 \r 收尾，(.*$) 里那个没有 m 标志的 $ 永远等不到行尾——
 * 实测那样一份声明都匹配不上（tokens.css 命中 0 条），missing 卫兵会当场把四个文件全判死。
 * 换成 [\s\S]* 后行尾的 \r 落进 tail，回写时原样拼回，行尾还是 CRLF。
 */
const DECL = /^(\s*)(--(?:rb|md)-[a-z0-9-]+)(\s*):\s*([^;]*);([\s\S]*)$/;

/**
 * R-C15-1 —— 档位由**所属选择器**决定，不是由文件决定。
 *
 * `theme.css` 一份文件里同时住着两层叠角色：
 *   `:7` 的 `:root`（12 条 `--rb-feedback-*`，文件头注释写的就是「深色安全默认值」）
 *   `:30` 与 `:1160` 的 `[data-ui-theme="pearl-white"]` 块（后者带 12 条同名覆盖 + 13 条 `--md-*`）
 * `:root` 跟 `[data-ui-theme="…"]` 同为 (0,1,0) 特异度，而 `:4-5` 的 `@import` 排在 `:root` **之前**，
 * 于是 charcoal 模式下 `theme.css` 自己的 `:root` 盖掉 `charcoal-pink.css` 里的同名声明：
 * 12 条 `--rb-feedback-*` 的活值**全部**出自这个块（`charcoal-pink.css` 只定义其中 6 条，
 * `tokens.css` 一条都没有）。旧 TARGETS 把整个 theme.css 写死成 light，等于把珍珠白的反馈色
 * 写进深色档唯一的活值 —— 实测 `:root` 的 surface/fg/muted/border/shadow 五条当时落的正是
 * LIGHT 档字面量（`#2b2f3a` / `#f7f4ec` / `#868a96` / `rgba(138,180,255,0.28)` / α0.28），
 * 深色档应为 `#1c202a` / `#e8e6df` / `#9a9daa` / `rgba(232,230,223,0.14)` / α0.38。
 *
 * 判档只认「块开启行」：把块注释内容去掉、再去掉行尾空白（含 \r）之后以 `{` 结尾的那一行，
 * 选择器取该行 `{` 之前的文本。**不做花括号深度计数** —— 实测 `theme.css:35` 与
 * `pearl-white.css:116` 的注释里各写着一句 `body { background: transparent }`：按原始字符数
 * 这两份文件的 `{`/`}` 各是 163/162 而**剥掉注释内容后**都是 162/161，正好等于「以 `{` 结尾的行数」
 * 与「以 `}` 结尾的行数」；深度计数器若按原始字符数走，会被这两句注释各带偏 1。
 * `@import` 行不以 `{` 结尾，天然不是开启行；`@media` / `@keyframes` 这类 at-rule 开启行
 * 不分类、沿用外层档（四份文件里两者命中均为 0 条）。分类不到的选择器里出现**在派生表里的**声明就抛错 ——
 * 跟下面的 missing 卫兵同一套哲学：宁可红着退出，不许默默按某一档写。
 *
 * **主题级 = 选择器整串相等**（R-C15-2）。这不是抄派生锁，是它的因果：派生锁按层叠算「活值」，
 * 只认整串相等的主题级选择器；生成器若按「包含主题前缀」判档，就会拿表里的值去拍平 scoped 覆盖，
 * 于是**屏幕上是 A、审计认的是 B**，正是这把锁要抓的东西。
 * 实测反例只有一处：`charcoal-pink.css:130` 的 `[data-ui-theme="charcoal-pink"] .cy-command-terminal`
 * 故意把 `--rb-surface-elevated` 压平成 `var(--rb-surface-page)`（终端面板不要浮起面）。
 * 拍平它会把终端背景从 `#101420` 改成 `#1c202b`——那是改产品，不是改派生物。
 * 所以 scoped 块**一个字都不动**：表管的是「主题级声明」，局部工艺归局部工艺。
 */
const BLOCK_SCHEMES = [
  { re: /^\[\s*data-ui-theme\s*=\s*["']?pearl-white["']?\s*\]$/, scheme: "light" },
  { re: /^\[\s*data-ui-theme\s*=\s*["']?charcoal-pink["']?\s*\]$/, scheme: "dark" },
  { re: /^:root$/, scheme: "dark" }, // 默认段跟 charcoal 同档：见上面注释的层叠推导
];

/**
 * 带主题前缀、但整串**不是**主题级选择器 → scoped 局部覆盖，不归表管。
 *
 * `data-ui-theme-pending` 那种**没有等号**的（`html[data-ui-theme-pending] .sticker-shell`）
 * 不算 scoped：它是「还没定档」的过渡态，不属于任何一档，所以它若开始住在表令牌，
 * 按下面「分类不到就抛错」处理，不许默默按某一档写。
 */
const SCOPED = /data-ui-theme\s*=|:root/;

/** 块注释的两个界定符拼在这里，免得注释正文里出现字面量把它们提前闭合/误导读者。 */
const OPEN = "/*";
const CLOSE = "*/";
const BRACE = "{";
const TRAILING_WS = /\s+$/; // \s 含 \r：CRLF 文件的行尾空白一次去干净

/**
 * @param selector 块开启行 `{` 之前的文本
 * @param uniformScheme 一档一文件时传该文件的档；theme.css 这类按选择器分档的传 undefined
 * @returns {{ kind: "theme" | "inherit" | "scoped" | "other", scheme: string | null }}
 *   theme   = 主题级声明，归表管；scheme 是它该用的那一档
 *   inherit = at-rule（@media/@keyframes），沿用外层档
 *   scoped  = 带主题前缀的局部覆盖，不归表管，一个字都不动
 *   other   = 分类不到的选择器；若它住了表里的令牌，rewrite() 会抛错
 */
function classifyBlock(selector, uniformScheme) {
  if (selector.startsWith("@")) return { kind: "inherit", scheme: null };
  const hit = BLOCK_SCHEMES.find(({ re }) => re.test(selector));
  if (hit) return { kind: "theme", scheme: uniformScheme ?? hit.scheme };
  if (SCOPED.test(selector)) return { kind: "scoped", scheme: null };
  return { kind: "other", scheme: null };
}

/**
 * 只为判档服务：把块注释的内容从这一行的可见文本里去掉，并回传行末是否仍在注释中。
 * 回写照旧用原始行拼接，注释内容一个字都不会被删。
 */
function withoutComments(line, inComment) {
  let code = "";
  let open = inComment;
  let i = 0;
  while (i < line.length) {
    if (open) {
      const end = line.indexOf(CLOSE, i);
      if (end < 0) break;
      open = false;
      i = end + 2;
    } else {
      const start = line.indexOf(OPEN, i);
      if (start < 0) { code += line.slice(i); break; }
      code += line.slice(i, start);
      open = true;
      i = start + 2;
    }
  }
  return { code, inComment: open };
}

/**
 * 逐行给出「这一行住在哪个块里、该用哪一档」。
 * 开新块就记新块，不弹栈：四份目标文件（theme/pearl/charcoal/tokens）实测 at-rule 开启行 0 条、
 * 剥注释后的 `{` 数 162/161/35/1 与「以 `{` 结尾的行数」逐份相等，即没有嵌套块，
 * 所以「最近一个开启行即所属块」成立。
 * 真出现嵌套时，内层块结束后档位不会退回外层；届时把这条注释作废、改成显式栈，别将就。
 * 选择器只取开启行 `{` 之前的那一段，跨行的选择器列表（上一行以 `,` 结尾）按**最后一段**判档：
 * 实测四份文件里这种续行型开启行有 73/72/10/0 条，但带在表声明的块只有 theme.css 的 :7 与 :1160
 * 两个、都是单行选择器，所以今天不受影响；而 theme.css 里最后一段判不出档的开启行
 * （如 :24 的 `html[data-ui-theme-pending] .sticker-shell`）一旦开始住在表令牌，走的是上面的抛错，
 * 不是静默换档 —— 要支持那种写法就把上一行的累积补在这里，别补默认档。
 *
 * `uniformScheme` 传了就走「一档一文件」：主题级块一律用那一档（tokens.css 的 `:root`
 * 是浅色默认层，不能按 BLOCK_SCHEMES 里 `:root→dark` 判）；传 undefined 就按选择器分档。
 */
function resolveBlocks(source, uniformScheme) {
  const lines = source.split("\n");
  const schemes = new Array(lines.length);
  let inComment = false;
  let scheme = null;
  let kind = null; // 当前块归不归表管：theme / inherit / scoped / other
  let block = { selector: null, line: 0 }; // 第一个开启行之前：顶层，档位为 null，命中派生令牌即抛
  for (let i = 0; i < lines.length; i++) {
    const scanned = withoutComments(lines[i], inComment);
    inComment = scanned.inComment;
    const text = scanned.code.replace(TRAILING_WS, "");
    if (text.endsWith(BRACE)) {
      const selector = text.slice(0, -1).trim();
      const classified = classifyBlock(selector, uniformScheme);
      block = { selector, line: i + 1 };
      kind = classified.kind;
      // at-rule 沿用外层档，其余按判档结果（scoped/other 的 scheme 是 null，交给 rewrite 决定跳过还是抛错）
      if (kind !== "inherit") scheme = classified.scheme;
    }
    schemes[i] = { scheme, kind, block };
  }
  return schemes;
}

/**
 * 逐行处理并**按原样保留每行的行尾**：本仓库 `core.autocrlf=true` 且历史 blob 里 CRLF/LF 混存，
 * 用 split(/\r?\n/) 再 join("\n") 会把没动的行也统一成 LF，diff 立刻变成「整文件重写」。
 * 所以这里按 "\n" 切，行首 \r 留在行尾，join 回 "\n" 就还是原样。
 * 每行用哪一档由 `schemes[i]` 给出：theme.css 按所属选择器判，另外三份整份同一个档。
 * @param maps  TOKENS_BY_SCHEME
 * @param names 该目标参与判档的令牌名全集（missing 卫兵的名字域，与改动前等宽）
 */
function rewrite(source, maps, schemes, names, file) {
  const seen = new Set();
  const lines = source.split("\n");
  const blocks = new Map(); // 开启行号 -> 该块统计，只为把日志写清楚，不参与判档
  const details = []; // 逐条改动明细（行号/令牌/旧值/新值），只为把日志写清楚，不参与判档
  let rewritten = 0;
  const statOf = (block, scheme) => {
    let stat = blocks.get(block.line);
    if (!stat) {
      stat = { line: block.line, selector: block.selector, scheme, decls: 0, rewritten: 0 };
      blocks.set(block.line, stat);
    }
    return stat;
  };
  const out = lines.map((line, i) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const [, indent, name, colon, value, tail] = m;
    if (!names.has(name)) return line; // 不在派生表：一字不动（也不必判档）
    seen.add(name);
    const { scheme, kind, block } = schemes[i];
    if (kind === "scoped") {
      // scoped 局部覆盖：不归表管，一个字都不动（R-C15-2，见 BLOCK_SCHEMES 上方注释）
      return line;
    }
    if (kind === "other" || kind === null) {
      throw new Error(
        `${file}:${i + 1} 令牌 ${name} 的档位判不出来：它住在` +
          (block.selector === null
            ? "任何块之外（第一个块开启行之前）"
            : `未分类的选择器块 ${block.selector} 里（开启行 :${block.line}）`) +
          `。要新增一档请写进 BLOCK_SCHEMES 显式分类，不许默默套用某一档。`,
      );
    }
    if (!scheme) {
      throw new Error(
        `${file}:${i + 1} 令牌 ${name} 所在的块没有档位（at-rule 不在任何主题块里）：` +
          `${block.selector}（开启行 :${block.line}）。`,
      );
    }
    const map = maps[scheme];
    if (!Object.prototype.hasOwnProperty.call(map, name)) {
      // 两档键集今天一模一样（palette-from-cat.test.ts 自检 104/104）；真分叉了就当异常处理——
      // 静默跳过等于让这一行留着另一档的值，那是更难查的错。
      throw new Error(`${file}:${i + 1} 令牌 ${name} 在 ${scheme} 档里没有派生值`);
    }
    const stat = statOf(block, scheme);
    stat.decls += 1;
    if (!COLOR_LITERAL.test(value)) {
      // 间接层：只有「它指向的令牌与本令牌在这一档派生到同一个值」时才合法——
      // 那才是角色别名（`--md-copy-border: var(--rb-border-soft)`），拍平会丢掉
      // 「改一处跟三处」。指向异值就是一句谎：CSS 说这行是 A 的别名，表说它是 B，
      // 屏幕上活的是 A、审计认的是 B —— 那正是派生锁要抓的东西，所以拍平成表里的值。
      const indirect = PURE_VAR.exec(value.trim());
      if (!indirect) return line; // color-mix() / 字体栈：复合值，不在射程内
      const target = map[indirect[1]];
      if (target === undefined) return line; // 引用的令牌不在这一档的表里（跨档或非色）：不动
      if (target === map[name]) return line; // 同值：合法的角色别名，保持间接层
      rewritten += 1;
      stat.rewritten += 1;
      details.push({ line: i + 1, name, from: value.trim(), to: map[name], kind: "间接层指向异值" });
      return `${indent}${name}${colon}: ${map[name]};${tail}`;
    }
    if (value.trim() === map[name]) return line;
    rewritten += 1;
    stat.rewritten += 1;
    details.push({ line: i + 1, name, from: value.trim(), to: map[name], kind: "字面量" });
    return `${indent}${name}${colon}: ${map[name]};${tail}`;
  });
  // 常驻警报：派生表里的令牌声明**不许跨行折行**。按行回写是这套设计的前提——
  // 折行的续行（如 `0 1px 2px rgba(…);`）不带名字、不会被匹配，留在原地就是一枚过期的 rgba，
  // 拼出来还是坏值。要加新令牌就写成一整行。
  const missing = [...names].filter((name) => !seen.has(name) && source.includes(`${name}:`));
  if (missing.length) {
    throw new Error(`${file}: 这些令牌在该文件里出现却没被回写（值形态异常）：${missing.join(", ")}`);
  }
  return { text: out.join("\n"), rewritten, blocks: [...blocks.values()], details };
}

const { TOKENS_BY_SCHEME } = await loadDerivation();
let failed = false;
for (const target of TARGETS) {
  const { file } = target;
  const path = resolve(file);
  const before = readFileSync(path, "utf8");
  // 判档涉及哪几档：bySelector 用 BLOCK_SCHEMES 里的全部档，一档一文件只用它自己那一档。
  const inScope = target.bySelector
    ? [...new Set(BLOCK_SCHEMES.map(({ scheme }) => scheme))]
    : [target.scheme];
  const names = new Set(inScope.flatMap((scheme) => Object.keys(TOKENS_BY_SCHEME[scheme])));
  const schemes = resolveBlocks(before, target.bySelector ? undefined : target.scheme);
  const { text, rewritten, blocks, details } = rewrite(before, TOKENS_BY_SCHEME, schemes, names, file);
  const scope = target.bySelector
    ? `按选择器分档 ${blocks.map((b) => `:${b.line} ${b.selector}→${b.scheme} 改 ${b.rewritten}/${b.decls}`).join(" | ")}`
    : `scheme=${target.scheme}${blocks.length ? ` ${blocks.map((b) => `:${b.line} ${b.selector} 改 ${b.rewritten}/${b.decls}`).join(" | ")}` : ""}`;
  const detailText = details
    .map((d) => `    :${d.line} ${d.name} [${d.kind}] ${d.from} → ${d.to}`)
    .join("\n");
  if (CHECK) {
    if (rewritten) {
      failed = true;
      console.error(`漂移：${file} 有 ${rewritten} 条值不等于派生结果（${scope}；跑 npm run palette:apply）`);
      if (detailText) console.error(detailText);
    }
    continue;
  }
  if (rewritten) writeFileSync(path, text, "utf8");
  console.log(`${file}: 回写 ${rewritten} 条（${scope}）`);
  if (detailText) console.log(detailText);
}
process.exit(failed ? 1 : 0);

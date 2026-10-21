// scripts/build/apply-theme-palette.mjs
/**
 * 把 `src/shared/palette-from-cat.ts` 的派生值按令牌名逐条写回四份 CSS。
 *
 * 只改值：不增删声明、不改令牌名、不动不在派生表里的行、不动值是 var()/color-mix() 的行。
 * 为什么不手改：带颜色的声明一共 287 行、去重 104 个名字，手改必然出现
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
  { file: "src/renderer/ui/tokens.css", scheme: "light" },
  { file: "src/renderer/ui/themes/pearl-white.css", scheme: "light" },
  { file: "src/renderer/ui/themes/charcoal-pink.css", scheme: "dark" },
  { file: "src/renderer/ui/theme.css", scheme: "light" },
];
const CHECK = process.argv.includes("--check");
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

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
 * 逐行处理并**按原样保留每行的行尾**：本仓库 `core.autocrlf=true` 且历史 blob 里 CRLF/LF 混存，
 * 用 split(/\r?\n/) 再 join("\n") 会把没动的行也统一成 LF，diff 立刻变成「整文件重写」。
 * 所以这里按 "\n" 切，行首 \r 留在行尾，join 回 "\n" 就还是原样。
 */
function rewrite(source, map, file) {
  const seen = new Set();
  const lines = source.split("\n");
  let rewritten = 0;
  const out = lines.map((line) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const [, indent, name, colon, value, tail] = m;
    if (!Object.prototype.hasOwnProperty.call(map, name)) return line; // 不在派生表：一字不动
    seen.add(name);
    if (!COLOR_LITERAL.test(value)) return line; // var()/color-mix() 的间接层是故意的，不拍平
    if (value.trim() === map[name]) return line;
    rewritten += 1;
    return `${indent}${name}${colon}: ${map[name]};${tail}`;
  });
  // 常驻警报：派生表里的令牌声明**不许跨行折行**。按行回写是这套设计的前提——
  // 折行的续行（如 `0 1px 2px rgba(…);`）不带名字、不会被匹配，留在原地就是一枚过期的 rgba，
  // 拼出来还是坏值。要加新令牌就写成一整行。
  const missing = Object.keys(map).filter((name) => !seen.has(name) && source.includes(`${name}:`));
  if (missing.length) {
    throw new Error(`${file}: 这些令牌在该文件里出现却没被回写（值形态异常）：${missing.join(", ")}`);
  }
  return { text: out.join("\n"), rewritten };
}

const { TOKENS_BY_SCHEME } = await loadDerivation();
let failed = false;
for (const { file, scheme } of TARGETS) {
  const path = resolve(file);
  const before = readFileSync(path, "utf8");
  const { text, rewritten } = rewrite(before, TOKENS_BY_SCHEME[scheme], file);
  if (CHECK) {
    if (rewritten) {
      failed = true;
      console.error(`漂移：${file} 有 ${rewritten} 条值不等于派生结果（跑 npm run palette:apply）`);
    }
    continue;
  }
  if (rewritten) writeFileSync(path, text, "utf8");
  console.log(`${file}: 回写 ${rewritten} 条（scheme=${scheme}）`);
}
process.exit(failed ? 1 : 0);

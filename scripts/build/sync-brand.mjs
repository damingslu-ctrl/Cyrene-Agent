// 身份字段的唯一生成入口：src/shared/brand.ts -> electron-builder.yml / package.json。
// 用法：node scripts/build/sync-brand.mjs [--check]
//   --check 只比对并打印差异，不写文件；CI 与 build 串这一条（spec §3-B2）。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 本仓库 core.autocrlf=true，且 package.json / electron-builder.yml 在工作区是 CRLF
 * （brand.ts 却是 LF——同一个仓库里两种行尾混着）。若按 plan 原文直接用
 * `JSON.stringify(…) + "\n"` 写出 LF，`--check` 会在每次 checkout 后都报漂移
 * （读回来是 CRLF、比的是 LF），生成器也会把整份文件改成 LF 从而在 git diff 里
 * 显示成整文件重写。所以这里统一：先按原文件的行尾归一成 LF 再改，写回前还原。
 * 判据（brand-consistency.test.ts）读的是解析后的字段，与行尾无关，不受影响。
 */
function readText(file) {
  const source = readFileSync(file, "utf8");
  return { source, eol: source.includes("\r\n") ? "\r\n" : "\n" };
}

function toLf(source) {
  return source.replace(/\r\n/g, "\n");
}

function withEol(text, eol) {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

/**
 * brand.ts 是 TS，脚本不引编译产物（build 顺序里 main 还没编译）。
 * 这里用最窄的正则把 `export const X = "…"` 读出来——读不到即抛错，
 * 绝不在脚本里再维护一份默认值（那才是真正的「两处定义」）。
 */
export function readBrand(file) {
  const source = readFileSync(file, "utf8");
  const pick = (name) => {
    const hit = new RegExp(`export const ${name} = "([^"]+)"`).exec(source);
    if (!hit) throw new Error(`brand.ts 缺少 export const ${name} = "…"`);
    return hit[1];
  };
  return {
    productName: pick("PRODUCT_NAME"),
    productNameZh: pick("PRODUCT_NAME_ZH"),
    appId: pick("APP_ID"),
    dataDirName: pick("DATA_DIR_NAME"),
  };
}

export function buildBrandFields(brand) {
  const lower = brand.productName.toLowerCase();
  return {
    lowerName: lower,
    // electron-builder.yml 里逐行替换的锚点：只碰这四行，其余一律不动。
    yml: [
      ["^appId:.*$", `appId: ${brand.appId}`],
      ["^productName:.*$", `productName: ${brand.productName}`],
      ["^  artifactName:.*$", `  artifactName: ${brand.productName}-Setup-\${version}.\${ext}`],
      ["^  menuCategory:.*$", `  menuCategory: ${brand.productName}`],
    ],
    pkg: {
      name: lower,
      productName: brand.productName,
      description: `${brand.productNameZh}桌面猫（本机构建，不联网升级）`,
      binKey: lower,
    },
  };
}

/**
 * 窗口标题也是身份字段：改产品名时标题必须跟着走，不能留成第二套真相。
 *
 * 只列**用户可见的窗口**——dev 预览页（react-perf / user-menu-preview /
 * plan-approval-preview / ui-preview）不在册，它们是开发用的本地页面。
 *
 * 修的正是「麻糬 · 聊天（React）」这类开发残余：兄弟窗口（语音通话 / 音乐 / 提醒）
 * 都没有后缀，只有一个窗口挂着「（React）」——那是上游重构期留下的脚手架标记，
 * 用户在任务栏里能直接看见。
 */
export function buildWindowTitles(brand) {
  const zh = brand.productNameZh;
  return [
    { file: path.join("src", "renderer", "index.html"), title: brand.productName },
    { file: path.join("src", "renderer", "react", "index.html"), title: `${zh} · 聊天` },
    { file: path.join("src", "renderer", "call-react", "index.html"), title: `${zh} · 语音通话` },
    { file: path.join("src", "renderer", "music", "index.html"), title: `${zh} · 音乐` },
    { file: path.join("src", "renderer", "toast", "index.html"), title: `${zh} · 提醒` },
  ];
}

function applyTitle(source, title) {
  const re = /<title>[\s\S]*?<\/title>/;
  if (!re.test(source)) throw new Error(`窗口 html 里找不到 <title>：${title}`);
  return source.replace(re, `<title>${title}</title>`);
}

function applyYml(source, pairs) {
  let text = source;
  for (const [pattern, replacement] of pairs) {
    const re = new RegExp(pattern, "m");
    if (!re.test(text)) throw new Error(`electron-builder.yml 里找不到锚点 ${pattern}`);
    text = text.replace(re, replacement);
  }
  return text;
}

function applyPkg(source, fields) {
  const json = JSON.parse(source);
  const next = {
    ...json,
    name: fields.pkg.name,
    productName: fields.pkg.productName,
    description: fields.pkg.description,
    bin: { [fields.pkg.binKey]: json.bin?.[Object.keys(json.bin ?? {})[0]] ?? "./dist/cli/index.js" },
  };
  // 缩进与键序按现状保真：JSON.stringify 保留插入顺序，而上面展开原对象时
  // name/productName 已在原位，不会把 main/scripts 挤到前面。
  // 实测（本机 package.json）：`JSON.stringify(JSON.parse(x), null, 2) + "\n"` 与原文件
  // 逐字节相同（行尾归一后），因此这一条成立；不改成逐行替换。
  return `${JSON.stringify(next, null, 2)}\n`;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const check = process.argv.includes("--check");
  const brand = readBrand(path.join(projectRoot, "src", "shared", "brand.ts"));
  const fields = buildBrandFields(brand);
  const ymlPath = path.join(projectRoot, "electron-builder.yml");
  const pkgPath = path.join(projectRoot, "package.json");
  const ymlFile = readText(ymlPath);
  const pkgFile = readText(pkgPath);
  const ymlNext = withEol(applyYml(toLf(ymlFile.source), fields.yml), ymlFile.eol);
  const pkgNext = withEol(applyPkg(toLf(pkgFile.source), fields), pkgFile.eol);
  const drift = [];
  if (ymlFile.source !== ymlNext) drift.push("electron-builder.yml");
  if (pkgFile.source !== pkgNext) drift.push("package.json");

  const titleFiles = buildWindowTitles(brand).map(({ file, title }) => {
    const abs = path.join(projectRoot, file);
    const current = readText(abs);
    const next = withEol(applyTitle(toLf(current.source), title), current.eol);
    return { file, abs, current: current.source, next };
  });
  const titleDrift = titleFiles.filter((entry) => entry.current !== entry.next);
  for (const entry of titleDrift) drift.push(entry.file);

  if (check) {
    if (drift.length) {
      console.error(`[brand] 生成物与 src/shared/brand.ts 不一致：${drift.join(", ")}。跑 node scripts/build/sync-brand.mjs`);
      process.exitCode = 1;
    } else {
      console.log(`[brand] ${brand.productName} (${brand.appId}) 一致`);
    }
  } else {
    writeFileSync(ymlPath, ymlNext, "utf8");
    writeFileSync(pkgPath, pkgNext, "utf8");
    for (const entry of titleDrift) writeFileSync(entry.abs, entry.next, "utf8");
    console.log(`[brand] 已写入 ${drift.length ? drift.join(", ") : "（无变化）"}`);
  }
}

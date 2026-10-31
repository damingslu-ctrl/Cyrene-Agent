import { build } from "esbuild";
import { copyFileSync, cpSync, globSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertRelativeDynamicImports } from "./verify-dynamic-imports.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = process.argv[2];
if (target !== "main" && target !== "preload") {
  throw new Error("Usage: node scripts/build/desktop-typescript.mjs <main|preload>");
}

const configPath = path.join(repoRoot, `tsconfig.${target}.json`);
const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));

const parsed = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot, undefined, configPath);
if (parsed.errors.length > 0) {
  throw new Error(parsed.errors.map((issue) => ts.flattenDiagnosticMessageText(issue.messageText, "\n")).join("\n"));
}

const entryPoints = parsed.fileNames.filter((file) => /\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file));
const outDir = parsed.options.outDir;
// 编译前把整棵输出抹掉。esbuild 只写这一趟编译到的文件，**不会回收**上一次在、这次不在的产物：
// 本轮实测过这个形状——造一颗临时模块编进 `dist/main/main/`，删掉它的源码，再按改前的脚本编一趟
// （812 个入口照常报「built」），那颗 JS 原地留着、mtime 都没动；换成这一行再编，它才消失。
// 而 `electron-builder.yml:27` 打的是 `dist/**/*`，所以产物面的残留会一路跟进装机包。
// 病的是源码面归零、产物面没人回收这个**结构性缺口**（P4 删掉的公告与旧更新器正是这一类），
// 不是某一颗已知的文件：当前装机包里 grep 不到那两组的名字，说明这台机器的 `dist` 曾经整体清过——
// 那是运气，不是设计，而不可达的尸块会让产物面与源码面对不上，且只有产物面是用户拿在手里的东西
// （`upstream-off` 的 A1／A3 扫的是源码面，看不见这里）。
// 原来这里只抹 `plugins` 一个目录：那是唯一一个被回收过的角落，编译出的 JS 从来没人管。
rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints,
  outbase: parsed.options.rootDir,
  outdir: outDir,
  bundle: false,
  platform: "node",
  target: "es2022",
  format: "cjs",
  sourcemap: true,
  tsconfig: configPath,
  ...(target === "main"
    ? {
        define: {
          __CYRENE_GMAIL_CLIENT_ID__: JSON.stringify(process.env.CYRENE_GMAIL_CLIENT_ID ?? ""),
          __CYRENE_GMAIL_CLIENT_SECRET__: JSON.stringify(process.env.CYRENE_GMAIL_CLIENT_SECRET ?? ""),
        },
      }
    : {}),
  logLevel: "warning",
});

// tsc also copies imported JSON files. Keep their relative paths for runtime require().
for (const dir of target === "main" ? ["main", "shared"] : ["preload", "shared"]) {
  const sourceDir = path.join(repoRoot, "src", dir);
  for (const relative of globSync("**/*.json", { cwd: sourceDir })) {
    const destination = path.join(outDir, dir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(sourceDir, relative), destination);
  }
}

if (target === "main") {
  cpSync(path.join(repoRoot, "src", "plugins"), path.join(outDir, "plugins"), {
    recursive: true,
    filter: (source) => statSync(source).isDirectory() ||
      source.endsWith("manifest.json") ||
      source.endsWith("manifest.schema.json") ||
      source.endsWith("native-import.cjs"),
  });
  cpSync(path.join(repoRoot, "src", "main", "plugin-panel"), path.join(outDir, "plugin-panel"), { recursive: true });
  assertRelativeDynamicImports(outDir);
}

console.log(`[desktop] built ${entryPoints.length} ${target} TypeScript files`);

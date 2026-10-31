import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";

export const SCAN_ROOTS = ["src", "scripts", "build", "packages", ".github"] as const;
export const SCAN_ROOT_FILES = ["electron-builder.yml", "package.json"] as const;
/**
 * 只列**会被打进产物或被构建/装机流程执行**的文本扩展名。
 *
 * `.js/.cjs/.py/.ps1/.cmd/.bat` 是 A-2 补进来的：原来的集合认 `.mjs` 却不认 `.cjs`，
 * 于是 `src/plugins/native-import.cjs`、`src/main/plugin-panel/panel-bridge.js`、
 * `scripts/packaging/music-component-entry.py` 与两份 PowerShell 装机脚本整份在射程外——
 * 把上游域名搬进这些文件，六条规则一条都不会红。
 * `.map`（源映射）`.lock`（依赖锁）与二进制不在此列：它们不承载可读的上游标识。
 */
export const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mjs", ".cjs", ".js", ".css", ".html", ".json",
  ".yml", ".yaml", ".nsh", ".ps1", ".cmd", ".bat", ".py",
]);

export function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    // 按名字跳 `release` 曾经在这里：它一个产物也没挡住（electron-builder 的输出在**仓库根**的
    // `release/`，而仓库根本就不是扫描根，五个根里没有任何 `release` 产物），
    // 却把 `scripts/release/`（发布脚本本体）整份划到射程外——实测少扫 1 个文件，
    // 那 1 个正好是往 GitHub 推安装包的那支脚本。产物目录要跳就跳它的真名（`node_modules`/`dist`），
    // 别拿一个既可能是产物、也可能是源码的名字当判据。
    if (entry === "node_modules" || entry === "dist") continue;
    const full = path.join(root, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) sourceFiles(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) out.push(full);
  }
  return out;
}

export function scannedFiles(cwd = process.cwd()): string[] {
  const base = path.resolve(cwd);
  const fromRoots = SCAN_ROOTS.flatMap((root) => {
    const abs = path.join(base, root);
    try {
      return statSync(abs).isDirectory() ? sourceFiles(abs) : [];
    } catch {
      return [];
    }
  });
  const fromRootFiles = SCAN_ROOT_FILES.map((name) => path.join(base, name)).filter((abs) => {
    try {
      return statSync(abs).isFile();
    } catch {
      return false;
    }
  });
  return [...fromRoots, ...fromRootFiles];
}

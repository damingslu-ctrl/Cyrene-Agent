import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";

export const SCAN_ROOTS = ["src", "scripts", "build", "packages", ".github"] as const;
export const SCAN_ROOT_FILES = ["electron-builder.yml", "package.json"] as const;
export const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css", ".html", ".json", ".yml", ".yaml", ".nsh"]);

export function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist" || entry === "release") continue;
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

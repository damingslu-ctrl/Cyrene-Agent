/**
 * 「不接收上游任何东西」的可判定契约（spec §3-A）。
 *
 * 为什么不是 grep 一下就完事：这条锁是**常驻**的。删掉公告、字体、更新器之后，
 * 后续任何改动只要把上游域名重新引回 src/，这里当场红。A 期的静态判据全押在这一个文件里，
 * 运行时那把尺（Task 6 的 egress 看门狗）负责证明「没有间接路径」，两把尺不互相替代。
 *
 * 每条规则自带正对照（`positiveControl`）：规则写坏了（转义吃掉、大小写改了）
 * 会在正对照这一行红，而不是安静地扫 0 个命中然后报 PASS——spec §4 的「尺自己崩了不许读成 PASS」。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/** 锁自身必须排除：它的正对照字符串就是被禁标识，不排除会自炸。 */
const SELF = "upstream-off.test.ts";
const SCAN_ROOTS = ["src", "scripts", "build", "packages"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css", ".html", ".json", ".yml", ".yaml", ".nsh"]);

interface Rule {
  clause: string;
  pattern: RegExp;
  /** 必须匹配的字面量：规则写坏了这里先红。 */
  positiveControl: string;
  /** 逐文件例外，必须写理由；例外是显式破例，不是放宽判据。 */
  exceptions: Array<{ file: string; reason: string }>;
}

const RULES: Rule[] = [
  {
    clause: "A1 公告",
    pattern: /cyrene-announcement|NEWS_GET|NEWS_UPDATED|useNewsFeed|news-feed/i,
    positiveControl: "https://gitee.com/playa0/cyrene-announcement/raw/main/",
    exceptions: [],
  },
];

function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "release") continue;
    const stats = statSync(full);
    if (stats.isDirectory()) sourceFiles(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  const roots = path.resolve(process.cwd());
  return SCAN_ROOTS.flatMap((root) => {
    const abs = path.join(roots, root);
    try {
      return statSync(abs).isDirectory() ? sourceFiles(abs) : [];
    } catch {
      return [];
    }
  });
}

describe("上游出口清零（静态标识面）", () => {
  const files = scannedFiles();

  it("扫描器真的在扫东西（空扫不许读成 PASS）", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  for (const rule of RULES) {
    it(`${rule.clause}：全仓不出现上游标识`, () => {
      expect(rule.pattern.test(rule.positiveControl)).toBe(true);
      const hits: string[] = [];
      for (const file of files) {
        if (path.basename(file) === SELF) continue;
        const exempt = rule.exceptions.find((candidate) => file.endsWith(candidate.file));
        const text = readFileSync(file, "utf8");
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(text)) continue;
        if (exempt) continue;
        hits.push(path.relative(process.cwd(), file));
      }
      expect(hits).toEqual([]);
    });
  }
});

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
/**
 * 根目录文件不属于任何扫描根，但 A3 的两条判据就住在它们里面：
 * `publish`/`provider` 在 `electron-builder.yml`，`electron-updater` 依赖在 `package.json`。
 * 不显式列出来的话，A3 会扫到一个空集合然后报 PASS——锁自己瞎了却读成「干净」。
 */
const SCAN_ROOT_FILES = ["electron-builder.yml", "package.json"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css", ".html", ".json", ".yml", ".yaml", ".nsh"]);

interface Rule {
  clause: string;
  pattern: RegExp;
  /**
   * 必须匹配的字面量：规则写坏了这里先红。
   * 是数组而非单值：一个 pattern 里并了几个分支（如 `autoUpdater` 与 `provider: github`）时，
   * 每个分支都要有自己的正对照，否则「哪个分支被写坏了」仍然看不出来。
   */
  positiveControls: string[];
  /** 逐文件例外，必须写理由；例外是显式破例，不是放宽判据。 */
  exceptions: Array<{ file: string; reason: string }>;
}

const RULES: Rule[] = [
  {
    clause: "A1 公告",
    pattern:
      /cyrene-announcement|NEWS_GET|NEWS_UPDATED|useNewsFeed|news-feed|news:get|exposeInMainWorld\(\s*"news"|NewsItem|NewsDialog|news-types/i,
    positiveControls: ["https://gitee.com/playa0/cyrene-announcement/raw/main/"],
    exceptions: [],
  },
  {
    clause: "A2 字体远端",
    pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
    positiveControls: ['@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono");'],
    exceptions: [
      {
        file: "features/chat/components/svg-sanitize.test.ts",
        reason:
          "Fixtures of the stripFontImports regression test: the domain must appear in the input to prove the sanitizer deletes it.",
      },
      {
        file: "features/chat/components/svg-card-block.test.ts",
        reason:
          "Same reason: asserts renderSvgCardSafe strips a remote font @import from user SVG.",
      },
      {
        file: "features/chat/components/mermaid-block.test.ts",
        reason:
          "Same reason: asserts the mermaid pipeline emits no Google Fonts reference.",
      },
    ],
  },
  {
    clause: "A3 更新面",
    pattern: /electron-updater|APP_UPDATE_CHECK|autoUpdater|github-app-updater|scheduleStartupUpdateCheck/i,
    positiveControls: ['import { autoUpdater } from "electron-updater";'],
    exceptions: [
      { file: "scripts/verify/installer-artifacts.mjs", reason: "保留的是「latest.yml 不得出现」的反向锁，正文里必须写出这个文件名才能证明锁在生效" },
    ],
  },
  {
    clause: "A3 上游发布源",
    // `provider` 的值在 YAML 里可以带引号（`provider: "github"`），不带引号的写法只是其中一种：
    // 只认裸值等于让「加个引号」就能绕过这条锁。
    pattern: /provider:\s*["']?github|owner:\s*Playa-Cyrene|repo:\s*Cyrene-Agent/i,
    positiveControls: ["provider: github", 'provider: "github"', "provider: 'github'"],
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
  const base = path.resolve(process.cwd());
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

/** 例外表的 `file` 一律用 `/` 分隔书写，跟 `path.sep` 无关（Windows 上是 `\`）。 */
function posixPath(file: string): string {
  return file.split(path.sep).join("/");
}

describe("上游出口清零（静态标识面）", () => {
  const files = scannedFiles();

  it("扫描器真的在扫东西（空扫不许读成 PASS）", () => {
    expect(files.length).toBeGreaterThan(300);
    // 根配置文件必须真的进了扫描集合：A3 的 publish / 依赖判据只能在这里被证伪，
    // 少了它们规则就是「永远扫不到」的死锁而不是锁。
    expect(files.map((file) => path.relative(process.cwd(), file))).toEqual(
      expect.arrayContaining(SCAN_ROOT_FILES),
    );
  });

  for (const rule of RULES) {
    it(`${rule.clause}：全仓不出现上游标识`, () => {
      for (const control of rule.positiveControls) {
        expect(rule.pattern.test(control), `正对照未命中，规则写坏了：${control}`).toBe(true);
      }
      const hits: string[] = [];
      for (const file of files) {
        if (path.basename(file) === SELF) continue;
        const exempt = rule.exceptions.find((candidate) => posixPath(file).endsWith(candidate.file));
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

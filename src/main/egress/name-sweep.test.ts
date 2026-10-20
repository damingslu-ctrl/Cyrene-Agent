/**
 * 名字清扫（Task 10a：主进程身份与日志前缀）的常驻锁。
 *
 * 为什么只有 grep 不够：这一档改的是**用户看得见的产品名**（托盘提示、窗口标题、
 * 启动 banner）和日志前缀。它们没有运行时报错，改回去（或新加一处写死）只有人眼
 * 看得出来，所以判据必须常驻 CI。
 *
 * 判据故意**不是**「全仓不许出现 Cyrene」：(c) 档已落盘的数据键（`cyrene.sqlite`、
 * `logs/cyrene.log`、持久化窗口状态键 `cyrene.workspace` / `cyrene.music-player`、
 * `cyrene.*` AG-UI 事件名）与身份标识符（`cyrene-agent.ts` 等）必须原样留着，
 * 全仓零命中要么恒红要么只能写成空判据。所以这里只钉两件事：
 *   1. 标题/提示这一**赋值形状**里的字面量字符串不许带产品名旧拼写；
 *   2. 被扫过的字面量文件（banner / 日志标签）整份零旧拼写。
 * 两条都配正对照：尺写坏了（转义吃掉、大小写改了）要在正对照这行红，而不是安静地
 * 扫到 0 命中再报 PASS（spec §4「尺自己崩了不许读成 PASS」）。
 */
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 标题/提示/过滤器名赋值：`title: "…"`、`title: \`…\``、`setToolTip("…")`、`name: "…"`。
 * 这几处是原生对话框与托盘上用户直接看到的字面量。
 */
const TITLE_SHAPE = /(?:title:\s*|setToolTip\(\s*|name:\s*)["'`][^"'`\n]*cyrene/i;
/** 只用来证明 TITLE_SHAPE 这把尺是好的（不是恒假）。 */
const TITLE_SHAPE_CONTROLS = [
  'title: "Cyrene · 聊天",',
  "title: `Cyrene · 提醒`,",
  'tray.setToolTip("Cyrene");',
  'filters: [{ name: "Cyrene 插件包", extensions: ["zip"] }],',
];

/**
 * 整份零旧拼写的判据（正对照同样必须命中 ANY_NAME）。
 * 必须带 `i`：旧字标的符号名是全大写 `CYRENE_LOGO`，只认 `Cyrene|cyrene` 的尺
 * 会对着大写残留扫到 0 命中然后报 PASS——那正是 spec §4 要避免的「崩了的尺读成绿」。
 */
const ANY_NAME = /cyrene/i;
const ANY_NAME_CONTROLS = ['CYRENE_LOGO', 'Cyrene: "Cyrene"', "♡ Cyrene Agent ♡", 'LOG_PREFIX = "[Cyrene]"'];

/** 清扫过的字面量文件：一份都不许留旧产品名。 */
const ZERO_TOLERANCE_FILES = [
  "src/main/tray.ts",
  "src/shared/banner.ts",
  "src/shared/logger-tags.ts",
  "src/cli/banner/ascii.ts",
  "src/cli/banner/render.ts",
  "src/cli/banner/text.ts",
  "src/main/orchestrator/tools/builtin-tools/download-file-tool.ts",
  "src/main/orchestrator/tools/builtin-tools/fetch-url-tool.ts",
];

/** 标题/提示形状判据覆盖的文件（同目录内的其余旧拼写是 (c) 档数据键，不在此判据范围）。 */
const TITLE_SHAPE_FILES = [
  "src/main/tray.ts",
  "src/main/windows/create-aux-windows.ts",
  "src/main/windows/create-music-player-window.ts",
  "src/main/windows/create-toast-window.ts",
  // Task 10a 实扫时新发现的 (a) 档落点：原生导入对话框的标题与 zip 过滤器名
  "src/main/plugin-runtime.ts",
];

/**
 * 反向判据：清扫过的落点必须真的从 brand 取值。
 * 只写「不许有旧名字」的话，把标题整行删掉也能读成绿；这一条钉住「名字还在，只是换了来源」。
 */
const BRAND_SOURCED: Array<{ file: string; pattern: RegExp; what: string }> = [
  { file: "src/main/tray.ts", pattern: /BRAND\.productName/, what: "托盘提示取 brand 的产品名" },
  { file: "src/main/windows/create-aux-windows.ts", pattern: /BRAND\.productName/, what: "聊天/欢迎/通话窗口标题" },
  { file: "src/main/windows/create-music-player-window.ts", pattern: /BRAND\.productName/, what: "音乐窗口标题" },
  { file: "src/main/windows/create-toast-window.ts", pattern: /BRAND\.productName/, what: "提醒窗口标题" },
  { file: "src/main/plugin-runtime.ts", pattern: /BRAND\.productName/, what: "插件导入对话框标题与过滤器名" },
  { file: "src/shared/banner.ts", pattern: /BRAND\.productName/, what: "启动 banner 首行" },
  { file: "src/cli/banner/text.ts", pattern: /PRODUCT_NAME/, what: "CLI banner 标题" },
  { file: "src/shared/logger-tags.ts", pattern: /Brand:\s*BRAND\.logPrefix/, what: "日志标签的值" },
  { file: "src/cli/banner/ascii.ts", pattern: /MOCHI_LOGO/, what: "CLI ANSI Shadow 字标符号名" },
  { file: "src/shared/banner.ts", pattern: /MOCHI_LOGO/, what: "主进程侧 ANSI Shadow 字标符号名" },
];

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

function windowsDirFiles(): string[] {
  const dir = path.resolve(process.cwd(), "src/main/windows");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `src/main/windows/${name}`);
}

describe("名字清扫锁：用户可见产品名与日志前缀只从 brand 取", () => {
  it("扫描面非空（空扫不许读成 PASS）", () => {
    const texts = [...ZERO_TOLERANCE_FILES, ...TITLE_SHAPE_FILES].map((file) => read(file));
    for (const text of texts) expect(text.length).toBeGreaterThan(200);
    // 标题形状判据的落点必须真的存在：windows/ 目录里至少有 5 处 `title:` 字面量赋值，
    // 否则这条规则扫的是空气（窗口工厂被搬走也会让锁瞎掉）。
    const titleAssignments = windowsDirFiles()
      .map(read)
      .reduce((sum, text) => sum + (text.match(/title:\s*["'`]/g) ?? []).length, 0);
    expect(titleAssignments).toBeGreaterThanOrEqual(5);
  });

  it("正对照：两把尺都抓得到旧写法", () => {
    for (const control of TITLE_SHAPE_CONTROLS) {
      expect(TITLE_SHAPE.test(control), `尺写坏了：${control}`).toBe(true);
      TITLE_SHAPE.lastIndex = 0;
    }
    for (const control of ANY_NAME_CONTROLS) {
      expect(ANY_NAME.test(control), `尺写坏了：${control}`).toBe(true);
    }
    // 负对照：brand 取值的新写法确实不该被标题判据抓到
    expect(TITLE_SHAPE.test("title: `${BRAND.productName} · 聊天`,")).toBe(false);
    TITLE_SHAPE.lastIndex = 0;
  });

  it("清扫过的字面量文件整份零旧产品名", () => {
    const hits: string[] = [];
    for (const file of ZERO_TOLERANCE_FILES) {
      if (ANY_NAME.test(read(file))) hits.push(file);
      ANY_NAME.lastIndex = 0;
    }
    expect(hits).toEqual([]);
  });

  it("窗口标题与托盘提示的**字面量**里不再有旧产品名", () => {
    const hits: string[] = [];
    for (const file of TITLE_SHAPE_FILES) {
      const line = read(file)
        .split(/\r?\n/)
        .find((text) => TITLE_SHAPE.test(text));
      if (line) hits.push(`${file}: ${line.trim()}`);
      TITLE_SHAPE.lastIndex = 0;
    }
    expect(hits).toEqual([]);
  });

  for (const { file, pattern, what } of BRAND_SOURCED) {
    it(`${file}：${what}`, () => {
      pattern.lastIndex = 0;
      expect(pattern.test(read(file)), `${file} 里找不到 ${pattern}`).toBe(true);
    });
  }
});

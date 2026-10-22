import { readFileSync, globSync } from "node:fs";
import * as path from "node:path";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../shared/brand";

/**
 * 生成物与源不一致即红（spec §3-B2 的第二条 CI 判据）。
 *
 * 为什么要有这把锁而不是「记得跑脚本」：`electron-builder.yml` 的 appId/productName
 * 决定装到系统里的名字，`brand.ts` 决定运行时的 userData。两者一旦分叉，
 * 用户看到的是「开始菜单叫 Cyrene、数据目录叫 Mochi」，而这种分叉只有装机后才暴露。
 */
function readFields() {
  const yml = load(readFileSync(resolve(process.cwd(), "electron-builder.yml"), "utf8")) as {
    appId?: string; productName?: string; nsis?: { artifactName?: string; menuCategory?: string };
  };
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    name?: string; productName?: string; description?: string; bin?: Record<string, string>;
  };
  return { yml, pkg };
}

describe("身份生成物与 brand.ts 一致", () => {
  it("electron-builder.yml 的四个身份字段由 BRAND 推出", () => {
    const { yml } = readFields();
    expect(yml.appId).toBe(BRAND.appId);
    expect(yml.productName).toBe(BRAND.productName);
    expect(yml.nsis?.menuCategory).toBe(BRAND.productName);
    expect(yml.nsis?.artifactName).toBe(`${BRAND.productName}-Setup-\${version}.\${ext}`);
  });

  it("package.json 的 name/productName/bin 与 BRAND 同源", () => {
    const { pkg } = readFields();
    expect(pkg.productName).toBe(BRAND.productName);
    expect(pkg.name).toBe(BRAND.productName.toLowerCase());
    expect(Object.keys(pkg.bin ?? [])).toEqual([BRAND.productName.toLowerCase()]);
  });

  it("userData 目录名与 appId 不撞上游（正对照：上游字面量确实不再出现）", () => {
    const { yml, pkg } = readFields();
    expect(pkg.description).not.toMatch(/Cyrene/);
    expect(yml.appId).not.toBe("com.cyrene.live2d");
  });
});

/**
 * 窗口标题锁。
 *
 * 为什么单开一把：上游重构期在标题里留了脚手架标记（`麻糬 · 聊天（React）`），
 * 兄弟窗口（语音通话 / 音乐 / 提醒）都没有这个后缀——它是上游自己的开发残余，
 * 用户在任务栏里能直接看见。`scripts/build/sync-brand.mjs` 负责按 brand.ts 生成
 * 精确标题，这里守的是**形状**（必须以品牌名开头、不许带开发后缀），
 * 两者不重复定义同一份文案。
 *
 * 文件集**从目录派生**（A-3）：原来手抄五份，于是 `sticker-manager/index.html`
 * 这种后加的窗口天然在射程外——锁看着绿，其实没扫过它。现在把 `src/renderer/**`
 * 下所有 html 都算进来，只放行下面这张逐条写理由的排除表。
 */
const NOT_A_WINDOW: Array<{ file: string; reason: string }> = [
  {
    file: "src/renderer/learn-exam.html",
    reason: "考试页是浏览器面板里的 WebContentsView 文档（`cyrene-exam://` 协议），没有独立窗口与任务栏名额；它的 <title> 是内嵌页的语义标题",
  },
  { file: "src/renderer/react-perf/index.html", reason: "dev 性能基线页（Perf Harness），不随包发布" },
  { file: "src/renderer/plan-approval-preview.html", reason: "dev 预览页：预览卡片的静态样子" },
  { file: "src/renderer/user-menu-preview.html", reason: "dev 预览页：头像侧边菜单" },
  { file: "src/renderer/ui/preview.html", reason: "dev 预览页：设计令牌对照" },
  { file: "src/renderer/ui/modal.html", reason: "全仓零引用的 dev 片段（`modal.html` 无任何 loadFile/loadURL 指向它）" },
];

function windowHtmls(): string[] {
  const dir = resolve(process.cwd(), "src/renderer");
  return globSync("**/*.html", { cwd: dir })
    .map((f) => f.split(path.sep).join("/"))
    .sort()
    .map((f) => `src/renderer/${f}`)
    .filter((f) => !NOT_A_WINDOW.some((entry) => entry.file === f));
}

function titleOf(relPath: string): string {
  const html = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const hit = /<title>([^<]*)<\/title>/.exec(html);
  expect(hit, `${relPath} 里没有 <title>`).not.toBeNull();
  return hit![1];
}

/** 形状判据：品牌名开头 + 没有上游那套括号后缀。 */
function titleLooksShipped(title: string): boolean {
  const startsWithBrand = title === BRAND.productName || title.startsWith(`${BRAND.productNameZh} · `);
  return startsWithBrand && !title.includes("（React）");
}

describe("窗口标题是品牌派生的，没有开发残余", () => {
  it("派生的窗口清单非空，且排除表没有过期条目", () => {
    const htmls = windowHtmls();
    // 正对照：glob 跑空会让下面那条「逐个合格」直接读成绿。
    expect(htmls.length, "一个窗口 html 都没派生出来").toBeGreaterThanOrEqual(5);
    expect(htmls).toEqual(
      expect.arrayContaining([
        "src/renderer/index.html",
        "src/renderer/react/index.html",
        "src/renderer/sticker-manager/index.html",
      ]),
    );
    // 排除表是显式破例，不是放宽判据：被排除的文件必须仍然存在，否则条目已过期，
    // 下一个人会把「文件改名了」误读成「已经处理过了」。
    for (const { file } of NOT_A_WINDOW) {
      expect(() => readFileSync(resolve(process.cwd(), file), "utf8"), `${file} 已不存在，排除表过期`).not.toThrow();
    }
  });

  it("用户可见窗口的标题以品牌名开头且不带「（React）」", () => {
    for (const relPath of windowHtmls()) {
      const title = titleOf(relPath);
      expect(titleLooksShipped(title), `${relPath} 的标题「${title}」不合格`).toBe(true);
    }
  });

  it("判据自己会红（正对照：坏标题必须被判不合格）", () => {
    // 反过来验尺：如果这条永远为真，上面那条锁就是摆设。
    expect(titleLooksShipped("麻糬 · 聊天（React）")).toBe(false);
    expect(titleLooksShipped("Cyrene · Chat")).toBe(false);
    expect(titleLooksShipped("麻糬 · 聊天")).toBe(true);
  });
});

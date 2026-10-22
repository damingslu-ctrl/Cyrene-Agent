import { readFileSync } from "node:fs";
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
 * 只覆盖**用户可见的窗口**：dev 预览页（react-perf / user-menu-preview /
 * plan-approval-preview / ui-preview）不在册。
 */
const WINDOW_HTMLS = [
  "src/renderer/index.html",
  "src/renderer/react/index.html",
  "src/renderer/call-react/index.html",
  "src/renderer/music/index.html",
  "src/renderer/toast/index.html",
];

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
  it("用户可见窗口的标题以品牌名开头且不带「（React）」", () => {
    for (const relPath of WINDOW_HTMLS) {
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

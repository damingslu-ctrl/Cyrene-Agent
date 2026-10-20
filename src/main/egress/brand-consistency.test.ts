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

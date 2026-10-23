import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("打包配置不携带升级源", () => {
  it("electron-builder.yml 没有 publish 块", () => {
    const config = load(readFileSync(resolve(process.cwd(), "electron-builder.yml"), "utf8")) as {
      publish?: unknown;
      nsis?: unknown;
    };
    // 正对照：js-yaml 能读出同一文件的其他键，证明解析器没坏、不是「读不到所以 undefined」
    expect(config.nsis).toBeTruthy();
    expect(config.publish).toBeUndefined();
  });

  it("package.json 的 build.publish 也不存在", () => {
    // electron-builder 允许把打包配置内嵌进 package.json，只看 yml 会漏掉这一条入口：
    // `build.publish` 一旦写回去，同样会产出 latest.yml。当前 package.json 没有 build 键，
    // 所以 `build?.publish` 是 undefined——判据是「没有升级源」，不是「必须有 build 块」。
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      name?: unknown;
      build?: { publish?: unknown };
    };
    // 正对照：读得到 name，证明解析到的确实是 package.json 而不是空对象
    expect(pkg.name).toBeTruthy();
    expect(pkg.build?.publish).toBeUndefined();
  });
});

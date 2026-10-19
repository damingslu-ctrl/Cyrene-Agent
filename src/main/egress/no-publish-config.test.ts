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
});

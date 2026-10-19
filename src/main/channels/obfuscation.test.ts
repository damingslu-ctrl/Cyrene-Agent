import { describe, expect, it } from "vitest";
import {
  ObfuscationIntegrityError,
  OBF_PREFIX_LEGACY,
  OBF_PREFIX_V2,
  deobfuscateLegacy,
  deobfuscateV2,
  obfuscateV2,
} from "./obfuscation";

/**
 * 与实现同一口径的历史 key：userData 钉在 cyrene-verge，name 钉在 cyrene-verge。
 * 也导出单字节形式给集成测试（settings-store.test.ts）拼 legacy 密文用，避免两处复制。
 */
export function legacyKeyByte(index: number, appDataDir = "C:\\Users\\tester\\AppData\\Roaming"): number {
  const { createHash } = require("crypto") as typeof import("crypto");
  // 复刻改造前 settings-store.ts:51-68 的公式，只为用户数据能读回来这一件事存在。
  const seed = `${appDataDir}\\cyrene-verge::cyrene-verge::cyrene-bot-secret`;
  const key = createHash("sha256").update(seed).digest().subarray(0, 16);
  return key[index % key.length];
}

describe("频道密钥混淆", () => {
  it("v2 round-trip 与身份无关：换 userData 目录/换 app 名都读得回来", () => {
    const stored = obfuscateV2("feishu-secret");
    expect(stored.startsWith(OBF_PREFIX_V2)).toBe(true);
    expect(deobfuscateV2(stored)).toBe("feishu-secret");
  });

  it("v2 密文被改坏一个字符就抛错，不再静默返回乱码（spec §5-1）", () => {
    const stored = obfuscateV2("feishu-secret");
    const body = stored.slice(OBF_PREFIX_V2.length);
    const flipped = `${OBF_PREFIX_V2}${body.slice(0, -2)}${body.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => deobfuscateV2(flipped)).toThrow(ObfuscationIntegrityError);
  });

  it("旧 obf:（无版本）用旧公式解一次，解出的就是当时的明文", () => {
    const appDataDir = "C:\\Users\\tester\\AppData\\Roaming";
    const bytes = Buffer.from("qq-token", "utf8").map((b, i) => b ^ legacyKeyByte(i, appDataDir));
    const stored = OBF_PREFIX_LEGACY + bytes.toString("base64");
    expect(deobfuscateLegacy(stored, appDataDir)).toBe("qq-token");
  });

  it("旧 obf: 配错钥匙时解出非法 UTF-8，判为失败而不是返回乱码", () => {
    const wrongDir = "C:\\Users\\other\\AppData\\Roaming";
    const testerDir = "C:\\Users\\tester\\AppData\\Roaming";
    const bytes = Buffer.from("qq-token", "utf8").map((b, i) => b ^ legacyKeyByte(i, wrongDir));
    const stored = OBF_PREFIX_LEGACY + bytes.toString("base64");
    expect(() => deobfuscateLegacy(stored, testerDir)).toThrow(ObfuscationIntegrityError);
  });
});

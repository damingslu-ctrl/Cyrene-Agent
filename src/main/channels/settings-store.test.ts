// channels settings-store 单元测试
// 重点验证 safeStorage encrypt/decrypt 边界 + 私有字段保存往返
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron 的 safeStorage（不需要真 keychain）
const encState = new Map<string, string>(); // plaintext → base64 密文
let encryptCalls = 0;
let decryptCalls = 0;
// 可变开关：默认 true（与历史行为一致）；旧格式升级测试里关掉，强走 obf:2: 混淆层
let storageAvailable = true;

vi.mock("electron", () => {
  return {
    app: {
      getPath: (k: string) => (k === "appData" ? "C:\\Users\\tester\\AppData\\Roaming" : os.tmpdir()),
      isReady: () => true,
    },
    safeStorage: {
      isEncryptionAvailable: () => true, // 注意：settings-store 会把结果缓存进模块级 memo，测试里翻转它没用
      encryptString: (plain: string) => {
        // 关掉这个开关 → encryptString 抛错 → encryptField 捕获后落到 obf:2: 混淆档（与生产 catch 分支一致）
        if (!storageAvailable) throw new Error("safeStorage 已被测试关掉 —— 强制走混淆档");
        encryptCalls++;
        const fake = Buffer.from("ENC(" + plain + ")").toString("base64");
        encState.set(plain, fake);
        return Buffer.from(fake, "base64");
      },
      decryptString: (buf: Buffer) => {
        decryptCalls++;
        const b64 = buf.toString("base64");
        // 反查明文
        for (const [plain, stored] of encState.entries()) {
          if (stored === b64) return plain;
        }
        throw new Error("mock decrypt failed");
      },
    },
  };
});

// 必须在 mock 后 import
// eslint-disable-next-line import/first
import { loadChannelsSettings, saveChannelsSettings } from "./settings-store";
// eslint-disable-next-line import/first
import { OBF_PREFIX_LEGACY, OBF_PREFIX_V2 } from "./obfuscation";
// eslint-disable-next-line import/first
import { legacyKeyByte } from "./obfuscation.test";

describe("channels/settings-store", () => {
  beforeEach(() => {
    // 每个测试前清掉磁盘文件（如果存在）
    const p = path.join(os.tmpdir(), "channels-settings.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);
    encState.clear();
    encryptCalls = 0;
    decryptCalls = 0;
    storageAvailable = true;
  });

  it("loadChannelsSettings: 不存在时返回默认值", () => {
    const cfg = loadChannelsSettings();
    expect(cfg.wechat.enabled).toBe(false);
    expect(cfg.feishu.enabled).toBe(false);
    expect(cfg.qq.enabled).toBe(false);
    expect(cfg.qq.port).toBe(6200);
    expect(cfg.rateLimitPerUser).toBe(10);
  });

  it("encrypts the QQ access token and normalizes numeric allowlists", () => {
    saveChannelsSettings({ qq: {
      enabled: true,
      listenMode: "wsl",
      port: 6200,
      accessToken: "qq-secret",
      allowedPrivateUserIds: [" 10001 ", "bad", "10001"],
      allowedGroupIds: ["20001"],
      groupRequireMention: true,
      groupReplyStyle: "reply-and-mention",
      groupToolPolicy: "off",
      groupMemoryPolicy: "shared-personal",
    } });
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).not.toContain("qq-secret");
    const loaded = loadChannelsSettings();
    expect(loaded.qq.accessToken).toBe("qq-secret");
    expect(loaded.qq.allowedPrivateUserIds).toEqual(["10001"]);
    expect(loaded.qq.allowedGroupIds).toEqual(["20001"]);
  });

  it("saveChannelsSettings + load: 私密字段加密落盘 + 解密还原", () => {
    saveChannelsSettings({
      feishu: {
        enabled: true,
        appId: "cli_test_001",
        appSecret: "my-super-secret",
      },
    });
    // 磁盘上应该是 enc: 前缀密文
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).not.toContain("my-super-secret"); // 明文不落盘
    expect(raw).toContain("cli_test_001"); // 公开字段明文
    expect(raw).toContain('"appSecret": "enc:'); // 私密字段已加密
    // 加载回来：明文还原
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appId).toBe("cli_test_001");
    expect(loaded.feishu.appSecret).toBe("my-super-secret");
  });

  it("saveChannelsSettings: 不传 secret 不覆盖已有值", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "secret-1" } });
    // 第二次保存不传 secret
    saveChannelsSettings({ feishu: { enabled: false, appId: "cli_002" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("secret-1"); // 保留
    expect(loaded.feishu.appId).toBe("cli_002");
    expect(loaded.feishu.enabled).toBe(false);
  });

  it("saveChannelsSettings: 传新 secret 覆盖", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "old" } });
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "new" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("new");
  });

  it("saveChannelsSettings: persists the off tool sandbox", () => {
    saveChannelsSettings({ toolSandbox: "off" });
    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });

  it("migrates the removed safe-only mode to off without elevating permissions", () => {
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ toolSandbox: "safe-only" }),
      "utf8",
    );

    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });

  it("旧 obf: 记录读回明文，并就地升级为 obf:2:（safeStorage 不可用的混淆档）", () => {
    // 关掉 safeStorage 才会走混淆层：生产里这档就是 headless/沙盒环境
    storageAvailable = false;
    // 按改造前的公式拼一条旧密文（legacyKeyByte 复刻 settings-store.ts:51-68，见 obfuscation.test.ts）
    const bytes = Buffer.from("feishu-secret", "utf8").map((b, i) => b ^ legacyKeyByte(i));
    const legacy = `${OBF_PREFIX_LEGACY}${bytes.toString("base64")}`;
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ feishu: { enabled: true, appId: "cli_x", appSecret: legacy } }, null, 2),
      "utf8",
    );
    expect(loadChannelsSettings().feishu.appSecret).toBe("feishu-secret");
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).toContain('"appSecret": "obf:2:');
    expect(raw).not.toContain("feishu-secret");
    expect(raw).not.toContain(OBF_PREFIX_LEGACY + '"');
  });

  it("旧格式升级是幂等的：已是 obf:2: 的盘上记录再 load 不再被重写", () => {
    storageAvailable = false;
    const bytes = Buffer.from("feishu-secret", "utf8").map((b, i) => b ^ legacyKeyByte(i));
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ feishu: { enabled: true, appId: "cli_x", appSecret: `${OBF_PREFIX_LEGACY}${bytes.toString("base64")}` } }, null, 2),
      "utf8",
    );
    const once = loadChannelsSettings();
    expect(once.feishu.appSecret).toBe("feishu-secret");
    const afterFirstLoad = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(afterFirstLoad).toContain('"appSecret": "obf:2:');

    // 第二次 load：不存在任何 obf:（无版本）字段了 → 不再重写，盘上内容逐字节不变
    const second = loadChannelsSettings();
    expect(second.feishu.appSecret).toBe("feishu-secret");
    const afterSecondLoad = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(afterSecondLoad).toBe(afterFirstLoad);
  });

  it("obf:2: 校验和不过时不静默丢数据：旧解码器能兜底就返回明文，且盘上密文原样保留", () => {
    storageAvailable = false;
    // 拼一条「给了 obf:2: 前缀但校验和字段是垃圾」的记录——模拟密钥轮换后密文对不上号的场景
    const bytes = Buffer.from("feishu-secret", "utf8").map((b, i) => b ^ legacyKeyByte(i));
    const brokenV2 = `${OBF_PREFIX_V2}00000000:${bytes.toString("base64")}`;
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ feishu: { enabled: true, appId: "cli_x", appSecret: brokenV2 } }, null, 2),
      "utf8",
    );
    // 旧解码器兜底解出明文，不走「清空」那一路
    expect(loadChannelsSettings().feishu.appSecret).toBe("feishu-secret");
    // 升级重写后盘上是完好密文，明文不泄露
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).toContain('"appSecret": "obf:2:');
    expect(raw).not.toContain("feishu-secret");
  });
});

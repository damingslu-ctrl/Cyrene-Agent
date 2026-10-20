import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { BRAND } from "../shared/brand";
import { VERGE_LEGACY_DIR_NAME, VERGE_MIGRATION_MARKER } from "./app-identity";
import { migrateVergeUserData } from "./verge-identity-migration";

// 全部 fixture 都在 os.tmpdir() 下：真实 %APPDATA% 一个字节都不许碰，
// 也不实例化 electron app —— 这一层只做参数拼装，跑不了真机也不该跑。
let appData: string;

function legacyDir(): string {
  return path.join(appData, VERGE_LEGACY_DIR_NAME);
}

function brandDir(): string {
  return path.join(appData, BRAND.dataDirName);
}

beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-verge-mig-"));
});

afterEach(() => {
  fs.rmSync(appData, { recursive: true, force: true });
});

describe("migrateVergeUserData", () => {
  it("默认目标取自 brand.dataDirName：cyrene-verge 整体改名成 Mochi 并落身份标记", () => {
    fs.mkdirSync(path.join(legacyDir(), "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "logs", "cyrene.log"), "ledger", "utf8");

    expect(migrateVergeUserData({ appDataPath: appData }).status).toBe("renamed");
    expect(fs.readFileSync(path.join(brandDir(), "logs", "cyrene.log"), "utf8")).toBe("ledger");
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(fs.existsSync(path.join(brandDir(), VERGE_MIGRATION_MARKER))).toBe(true);
  });

  // 只钉参数管道：显式传了 target 就用传入的目录，不被 brand 默认值顶掉。
  // 生产链路到不了这一支 —— 命令行带 --user-data-dir 时 pre-ready 整步跳过搬运（见
  // application/pre-ready.ts 的 usesExplicitUserDataDir），探针目录永远不会当迁移目标。
  it("正对照：显式传 targetUserDataPath 时按传入目录拼（只测参数管道，非生产用法）", () => {
    fs.mkdirSync(path.join(legacyDir(), "chats"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "chats", "a.json"), "{}", "utf8");
    const probeDir = path.join(appData, "probe-profile");

    expect(migrateVergeUserData({ appDataPath: appData, targetUserDataPath: probeDir }).status).toBe("renamed");
    expect(fs.existsSync(path.join(probeDir, "chats", "a.json"))).toBe(true);
    expect(fs.existsSync(brandDir())).toBe(false);
  });

  it("两者并存时逐项并入、旧数据优先，全部搬空才移除旧目录", () => {
    fs.mkdirSync(path.join(legacyDir(), "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "cyrene-chats", "index.json"), '{"from":"legacy"}', "utf8");
    fs.mkdirSync(path.join(brandDir(), "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(brandDir(), "cyrene-chats", "index.json"), '{"from":"fresh"}', "utf8");
    fs.writeFileSync(path.join(brandDir(), "installer-options.json"), "{}", "utf8");

    expect(migrateVergeUserData({ appDataPath: appData }).status).toBe("merged");
    expect(fs.readFileSync(path.join(brandDir(), "cyrene-chats", "index.json"), "utf8")).toBe('{"from":"legacy"}');
    expect(fs.existsSync(path.join(brandDir(), "installer-options.json"))).toBe(true);
    expect(fs.existsSync(legacyDir())).toBe(false);
  });

  it("旧目录不存在的新安装返回 none，且不凭空造出 Mochi 目录", () => {
    expect(migrateVergeUserData({ appDataPath: appData }).status).toBe("none");
    expect(fs.existsSync(brandDir())).toBe(false);
  });

  it("Cyrene 闸门在这一层同样生效：目标被指成 Cyrene 时抛出，且落盘前就拒绝", () => {
    fs.mkdirSync(path.join(legacyDir(), "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "logs", "cyrene.log"), "ledger", "utf8");
    const upstream = path.join(appData, "Cyrene");

    expect(() => migrateVergeUserData({ appDataPath: appData, targetUserDataPath: upstream })).toThrow(/禁写|forbidden/);
    // 抛出发生在任何文件系统操作之前：旧目录原样躺着，Cyrene 也没被建出来
    expect(fs.readFileSync(path.join(legacyDir(), "logs", "cyrene.log"), "utf8")).toBe("ledger");
    expect(fs.existsSync(upstream)).toBe(false);
  });

  it("目标占位不是目录时搬不动：旧目录原样保留、不写标记，交给下次启动重试", () => {
    fs.mkdirSync(path.join(legacyDir(), "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "logs", "cyrene.log"), "ledger", "utf8");
    // 目标位置上躺着一个同名文件（不是目录）：整体重命名走不通，逐项并入也写不进去
    fs.writeFileSync(path.join(appData, BRAND.dataDirName), "not-a-dir", "utf8");

    expect(migrateVergeUserData({ appDataPath: appData }).status).toBe("partial");
    expect(fs.readFileSync(path.join(legacyDir(), "logs", "cyrene.log"), "utf8")).toBe("ledger");
    expect(fs.existsSync(path.join(legacyDir(), VERGE_MIGRATION_MARKER))).toBe(false);
  });
});

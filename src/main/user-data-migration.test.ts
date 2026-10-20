import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as nodeFs from "node:fs";
import { migrateLegacyUserData } from "./user-data-migration";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));

// 用临时目录模拟 appData，构造旧目录 live2d-cyrene 与新目录 Mochi 的各种组合
let root: string;
/** Task 9 的用例各自再开一个 appData（名字前缀不同），统一在 afterEach 里回收，不往 TEMP 漏目录。 */
const tmpRoots: string[] = [];

function legacyDir(): string {
  return path.join(root, "live2d-cyrene");
}

/**
 * 迁移目标一律用 `Mochi`：Task 9 起 `%APPDATA%\Cyrene` 是上游的真实数据、全程只读禁写，
 * 迁移器按名字拒绝它（闸门同时查 target 的 basename）。这份 fixture 当年写 `Cyrene`
 * 是因为那时它就是目标目录名；现在换成 fork 自己的目录名，语义不变。
 */
function targetDir(): string {
  return path.join(root, "Mochi");
}

function writeFixture(dir: string, name: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function readTarget(name: string): string {
  return fs.readFileSync(path.join(targetDir(), name), "utf8");
}

/** 备份目录里某个条目的所有被覆盖版本（备份按时间戳分子目录） */
function backedUp(name: string): string[] {
  const root = path.join(targetDir(), ".legacy-migration-overwritten");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((stamp) => path.join(root, stamp, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"));
}

function migrate() {
  return migrateLegacyUserData({ appDataPath: root, targetUserDataPath: targetDir() });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-migration-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
  tmpRoots.length = 0;
});

describe("migrateLegacyUserData", () => {
  it("recovers from a transient directory rename error without changing file contents", () => {
    writeFixture(legacyDir(), "cyrene-chats/conv.json", '{"messages":["preserve"]}');
    const rename = vi.spyOn(nodeFs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("busy"), { code: "EPERM" });
    });
    expect(migrate().status).toBe("renamed");
    expect(rename.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(readTarget("cyrene-chats/conv.json")).toBe('{"messages":["preserve"]}');
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(fs.existsSync(path.join(targetDir(), ".legacy-user-data-migrated"))).toBe(true);
  });

  it("preserves the old directory and leaves no marker when retries are exhausted", () => {
    writeFixture(legacyDir(), "cyrene-chats/conv.json", '{"messages":["preserve"]}');
    const rename = vi.spyOn(nodeFs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("busy"), { code: "EPERM" });
    });
    expect(migrate().status).toBe("failed");
    expect(rename).toHaveBeenCalledTimes(5);
    expect(fs.readFileSync(path.join(legacyDir(), "cyrene-chats/conv.json"), "utf8")).toBe('{"messages":["preserve"]}');
    expect(fs.existsSync(targetDir())).toBe(false);
    rename.mockRestore();
    expect(migrate().status).toBe("renamed");
    expect(readTarget("cyrene-chats/conv.json")).toBe('{"messages":["preserve"]}');
  });
  it("旧目录不存在时什么都不做", () => {
    const result = migrateLegacyUserData({ appDataPath: root, targetUserDataPath: targetDir() });
    expect(result.status).toBe("none");
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(fs.existsSync(targetDir())).toBe(false);
  });

  it("新旧目录路径一致时跳过", () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    const result = migrateLegacyUserData({ appDataPath: root, targetUserDataPath: legacyDir() });
    expect(result.status).toBe("skipped");
    expect(fs.existsSync(legacyDir())).toBe(true);
  });

  it("目标不存在时整体重命名", () => {
    writeFixture(legacyDir(), "app-settings.json", "{}");
    writeFixture(legacyDir(), "cyrene-chats/conv-1.json", "{}");

    const result = migrateLegacyUserData({ appDataPath: root, targetUserDataPath: targetDir() });

    expect(result.status).toBe("renamed");
    expect(fs.existsSync(legacyDir())).toBe(false);
    expect(fs.existsSync(path.join(targetDir(), "app-settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir(), "cyrene-chats/conv-1.json"))).toBe(true);
  });

  it("两者并存时逐项并入且旧数据优先", () => {
    // 旧目录：真实用户数据
    writeFixture(legacyDir(), "app-settings.json", '{"language":"zh-CN"}');
    writeFixture(legacyDir(), "memory.json", "{}");
    // 新目录：安装器写入的文件 + 一个会被旧数据覆盖的残留
    writeFixture(targetDir(), "installer-options.json", '{"launchAtLogin":true}');
    writeFixture(targetDir(), "app-settings.json", '{"petVisible":false}');

    const result = migrateLegacyUserData({ appDataPath: root, targetUserDataPath: targetDir() });

    expect(result.status).toBe("merged");
    // 旧数据覆盖新目录同名文件
    expect(fs.readFileSync(path.join(targetDir(), "app-settings.json"), "utf8")).toBe('{"language":"zh-CN"}');
    // 新目录独有文件保留（开机自启勾选不能丢）
    expect(fs.readFileSync(path.join(targetDir(), "installer-options.json"), "utf8")).toBe('{"launchAtLogin":true}');
    expect(fs.existsSync(path.join(targetDir(), "memory.json"))).toBe(true);
    // 被覆盖的目标版本移进备份目录，而不是直接删除
    expect(backedUp("app-settings.json")).toEqual(['{"petVisible":false}']);
    // 全部搬空后旧目录移除
    expect(fs.existsSync(legacyDir())).toBe(false);
  });

  it("运行时锁文件不迁移：保留新目录版本，丢弃旧目录陈旧副本", () => {
    writeFixture(legacyDir(), "lockfile", "stale-pid");
    writeFixture(legacyDir(), "memory.json", "{}");
    writeFixture(targetDir(), "lockfile", "fresh-pid");

    const result = migrateLegacyUserData({ appDataPath: root, targetUserDataPath: targetDir() });

    expect(result.status).toBe("merged");
    expect(fs.readFileSync(path.join(targetDir(), "lockfile"), "utf8")).toBe("fresh-pid");
    expect(fs.existsSync(path.join(targetDir(), "memory.json"))).toBe(true);
    expect(fs.existsSync(legacyDir())).toBe(false);
  });
});

describe("migrateLegacyUserData — 迁移只发生一次", () => {
  // 复现场景：升级后又运行了一次 1.2.x 旧版，旧版按旧名字重新建出 live2d-cyrene，
  // 里面是旧版的默认/陈旧文件。修复前，下次启动会再次「旧数据优先」并入，覆盖当前数据。
  it("重命名迁移后旧目录被旧版重新创建：不再并入，当前数据不被覆盖", () => {
    writeFixture(legacyDir(), "model-settings.json", '{"model":"deepseek"}');
    expect(migrate().status).toBe("renamed");

    // 用户在新版里继续使用，数据更新
    writeFixture(targetDir(), "model-settings.json", '{"model":"deepseek","profiles":2}');
    // 旧版重新建出旧目录，写入陈旧的默认配置
    writeFixture(legacyDir(), "model-settings.json", '{"model":"stale-default"}');

    expect(migrate().status).toBe("already_migrated");
    expect(readTarget("model-settings.json")).toBe('{"model":"deepseek","profiles":2}');
    // 重新出现的旧目录原样保留，不删除任何东西
    expect(fs.readFileSync(path.join(legacyDir(), "model-settings.json"), "utf8")).toBe('{"model":"stale-default"}');
  });

  it("合并迁移成功后同样写入完成标记，重新出现的旧目录不再并入", () => {
    writeFixture(legacyDir(), "memory.json", '{"v":"real"}');
    writeFixture(targetDir(), "installer-options.json", "{}");
    expect(migrate().status).toBe("merged");

    writeFixture(legacyDir(), "memory.json", '{"v":"stale"}');
    expect(migrate().status).toBe("already_migrated");
    expect(readTarget("memory.json")).toBe('{"v":"real"}');
  });

  it("修复之前已完成迁移的安装：旧目录不在时补记标记，之后旧目录再出现也不并入", () => {
    // 已有安装：只有新目录，没有完成标记
    writeFixture(targetDir(), "app-settings.json", '{"current":true}');
    expect(migrate().status).toBe("none");
    expect(fs.existsSync(path.join(targetDir(), ".legacy-user-data-migrated"))).toBe(true);

    writeFixture(legacyDir(), "app-settings.json", '{"current":false}');
    expect(migrate().status).toBe("already_migrated");
    expect(readTarget("app-settings.json")).toBe('{"current":true}');
  });

  it("首次合并（安装器已建好新目录、尚无标记）仍按旧数据优先完成迁移", () => {
    writeFixture(targetDir(), "installer-options.json", '{"launchAtLogin":true}');
    writeFixture(legacyDir(), "app-settings.json", '{"language":"zh-CN"}');

    expect(migrate().status).toBe("merged");
    expect(readTarget("app-settings.json")).toBe('{"language":"zh-CN"}');
    expect(readTarget("installer-options.json")).toBe('{"launchAtLogin":true}');
  });
});

/** 整棵子树的快照（相对路径 → 文件内容），用来证明「一个字节都没动」。 */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(dir);
  return out;
}

describe("migrateLegacyUserData — Task 9 身份迁移（cyrene-verge → Mochi）", () => {
  /** 身份迁移的标记名：与历史 live2d 那次必须不同，见下面第三例。 */
  const VERGE_MARKER = ".migrated-from-cyrene-verge";

  it("迁移器拒绝任何指向 Cyrene 的 legacy 目录（那是用户的真实数据，只读禁写）", () => {
    // 全程 tmp：这里只是同名模拟，真实 %APPDATA%\Cyrene 任何测试都不碰
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const forbidden = path.join(appData, "Cyrene");
    fs.mkdirSync(path.join(forbidden, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(forbidden, "cyrene-chats", "a.json"), "{}", "utf8");
    fs.writeFileSync(path.join(forbidden, "app-settings.json"), '{"language":"zh-CN"}', "utf8");
    const before = snapshotTree(forbidden);

    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "Cyrene",
        markerFileName: VERGE_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);

    // 正对照：被拒绝之后 Cyrene 目录一个字节没动
    expect(snapshotTree(forbidden)).toEqual(before);
    expect(fs.readdirSync(path.join(forbidden, "cyrene-chats"))).toEqual(["a.json"]);
    expect(fs.existsSync(path.join(appData, "Mochi"))).toBe(false);

    // 反方向同样拒绝：Cyrene 当迁移目标也不许（闸门查 target 的 basename）
    fs.mkdirSync(path.join(appData, "cyrene-verge"), { recursive: true });
    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: forbidden,
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);
    expect(snapshotTree(forbidden)).toEqual(before);
    expect(fs.existsSync(path.join(appData, "cyrene-verge"))).toBe(true);
  });

  it("cyrene-verge -> Mochi 整体重命名并落标记，重跑为 already_migrated", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const legacy = path.join(appData, "cyrene-verge");
    fs.mkdirSync(path.join(legacy, "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "logs", "cyrene.log"), "x", "utf8");

    const run = () =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MARKER,
      });

    expect(run().status).toBe("renamed");
    expect(fs.existsSync(path.join(appData, "Mochi", "logs", "cyrene.log"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MARKER))).toBe(true);

    // 幂等：旧目录已经不在了，重跑什么也不做，Mochi 完好
    expect(run().status).toBe("none");
    expect(fs.readFileSync(path.join(appData, "Mochi", "logs", "cyrene.log"), "utf8")).toBe("x");

    // 旧目录若重新出现（例如又跑了一次旧版 fork），凭标记拒绝再并入，当前数据不被陈旧副本覆盖
    fs.mkdirSync(path.join(legacy, "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "logs", "cyrene.log"), "stale", "utf8");
    expect(run().status).toBe("already_migrated");
    expect(fs.readFileSync(path.join(appData, "Mochi", "logs", "cyrene.log"), "utf8")).toBe("x");
    expect(fs.readFileSync(path.join(legacy, "logs", "cyrene.log"), "utf8")).toBe("stale");
  });

  it("两个标记名必须不同：随重命名搬进 Mochi 的历史标记不许把身份迁移判成 already_migrated", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const legacy = path.join(appData, "cyrene-verge");
    fs.mkdirSync(path.join(appData, "live2d-cyrene"), { recursive: true });
    fs.writeFileSync(path.join(appData, "live2d-cyrene", "memory.json"), '{"v":"real"}', "utf8");
    fs.mkdirSync(path.join(legacy, "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "logs", "cyrene.log"), "current", "utf8");

    // 第一步（pre-ready 的历史迁移）：live2d-cyrene 并入 cyrene-verge，历史标记落进 cyrene-verge
    expect(
      migrateLegacyUserData({ appDataPath: appData, targetUserDataPath: legacy }).status,
    ).toBe("merged");
    expect(fs.existsSync(path.join(legacy, ".legacy-user-data-migrated"))).toBe(true);

    // 第二步（身份迁移）：整体重命名会把历史标记一起搬进 Mochi。
    // 若两次迁移复用同一个标记名，这一步会静默返回 already_migrated，数据留在旧目录不搬。
    expect(
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MARKER,
      }).status,
    ).toBe("renamed");
    // 两个标记并存才是「两次迁移都记过账」；历史标记没把身份迁移带跑
    expect(fs.existsSync(path.join(appData, "Mochi", ".legacy-user-data-migrated"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appData, "Mochi", "memory.json"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it("大小写归一：Windows 路径不区分大小写，`cyrene` / `CYRENE` 同样拒绝", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const upstream = path.join(appData, "Cyrene");
    fs.mkdirSync(path.join(upstream, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(upstream, "cyrene-chats", "a.json"), "{}", "utf8");
    const before = snapshotTree(upstream);
    fs.mkdirSync(path.join(appData, "cyrene-verge"), { recursive: true });

    // 源目录名的小写形态
    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "cyrene",
        markerFileName: VERGE_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);
    // 目标目录名的大写形态
    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "CYRENE"),
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);

    expect(snapshotTree(upstream)).toEqual(before);
    expect(fs.existsSync(path.join(appData, "Mochi"))).toBe(false);
    // 大写形态在文件系统上指的就是同一个目录：从那条路径看回去，内容依旧一个字节没动
    expect(snapshotTree(path.join(appData, "CYRENE"))).toEqual(before);
  });

  it("新字段有默认值：不传 legacyDirName/markerFileName 时仍是 live2d-cyrene + 历史标记", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const legacy = path.join(appData, "live2d-cyrene");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "memory.json"), '{"v":"real"}', "utf8");

    expect(
      migrateLegacyUserData({ appDataPath: appData, targetUserDataPath: path.join(appData, "Mochi") }).status,
    ).toBe("renamed");
    expect(fs.existsSync(path.join(appData, "Mochi", ".legacy-user-data-migrated"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MARKER))).toBe(false);
  });
});

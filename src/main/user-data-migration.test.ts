import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as nodeFs from "node:fs";
import { migrateLegacyUserData } from "./user-data-migration";
import { VERGE_MIGRATION_MARKER } from "./app-identity";

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
        markerFileName: VERGE_MIGRATION_MARKER,
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
        markerFileName: VERGE_MIGRATION_MARKER,
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
        markerFileName: VERGE_MIGRATION_MARKER,
      });

    expect(run().status).toBe("renamed");
    expect(fs.existsSync(path.join(appData, "Mochi", "logs", "cyrene.log"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MIGRATION_MARKER))).toBe(true);

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

  it("两步链路的标记各记各的账：历史标记与身份标记在 Mochi 里并存，旧目录搬空", () => {
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

    // 第二步（身份迁移）：整体重命名把历史标记一起搬进 Mochi，两枚标记并存才是「两次迁移都记过账」。
    expect(
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MIGRATION_MARKER,
      }).status,
    ).toBe("renamed");
    expect(fs.existsSync(path.join(appData, "Mochi", ".legacy-user-data-migrated"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appData, "Mochi", "memory.json"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });

  // 生产形态：pre-ready 的顺序是 live2d 先、身份迁移后，而两步的目标都是 Mochi。
  // 首启时 Mochi 已经存在（单实例锁在 pre-ready 更早处就把它建了出来），于是 live2d 那步
  // 走「旧目录不在」分支、什么也没搬却把 .legacy-user-data-migrated 补记进 Mochi。
  // 标记名若与身份迁移共用，下一眼看到的就是这枚补记的标记 → already_migrated，
  // 用户整个 cyrene-verge 账本静默留在原地。下面这对用例把这条真路径钉住：
  // 正例必须真的搬，同名坍缩对照必须搬不动（否则这两条断言读不出区别）。
  it("生产形态：Mochi 已由单实例锁建出且被 live2d 步骤补记了标记，身份迁移仍必须真搬", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const target = path.join(appData, "Mochi");
    const legacy = path.join(appData, "cyrene-verge");
    // 首启的真实磁盘状态：目标目录已存在（锁文件），live2d-cyrene 早就不在了
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SingletonLock"), "pid", "utf8");
    fs.mkdirSync(path.join(legacy, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "cyrene-chats", "index.json"), '{"from":"verge"}', "utf8");

    // 第一步（历史迁移，默认参数 = 默认标记名）：什么也没搬，但把标记补记进了 Mochi
    expect(migrateLegacyUserData({ appDataPath: appData, targetUserDataPath: target }).status).toBe("none");
    expect(fs.existsSync(path.join(target, ".legacy-user-data-migrated"))).toBe(true);

    // 第二步（身份迁移）：必须真的搬运。目标已存在 → 逐项并入，所以是 merged 而非 renamed；
    // 关键是它绝不能凭上一步补记的标记判成 already_migrated。
    expect(
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: target,
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MIGRATION_MARKER,
      }).status,
    ).toBe("merged");
    expect(fs.readFileSync(path.join(target, "cyrene-chats", "index.json"), "utf8")).toBe('{"from":"verge"}');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(target, VERGE_MIGRATION_MARKER))).toBe(true);
  });

  // 上面那条的坍缩对照：两步共用同一个标记名时，身份迁移静默返回 already_migrated、
  // 数据原样留在 cyrene-verge。这条用例必须红，才证明正例不是同义反复。
  it("坍缩对照：两步共用同一标记名时身份迁移静默跳过，账本留在旧目录", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const target = path.join(appData, "Mochi");
    const legacy = path.join(appData, "cyrene-verge");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SingletonLock"), "pid", "utf8");
    fs.mkdirSync(path.join(legacy, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "cyrene-chats", "index.json"), '{"from":"verge"}', "utf8");

    expect(migrateLegacyUserData({ appDataPath: appData, targetUserDataPath: target }).status).toBe("none");

    expect(
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: target,
        legacyDirName: "cyrene-verge",
        markerFileName: ".legacy-user-data-migrated",
      }).status,
    ).toBe("already_migrated");
    expect(fs.existsSync(path.join(target, "cyrene-chats", "index.json"))).toBe(false);
    expect(fs.readFileSync(path.join(legacy, "cyrene-chats", "index.json"), "utf8")).toBe('{"from":"verge"}');
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
        markerFileName: VERGE_MIGRATION_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);
    // 目标目录名的大写形态
    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "CYRENE"),
        legacyDirName: "cyrene-verge",
        markerFileName: VERGE_MIGRATION_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);

    expect(snapshotTree(upstream)).toEqual(before);
    expect(fs.existsSync(path.join(appData, "Mochi"))).toBe(false);
    // 大写形态在文件系统上指的就是同一个目录：从那条路径看回去，内容依旧一个字节没动
    expect(snapshotTree(path.join(appData, "CYRENE"))).toEqual(before);
  });

  // 只看 basename 的旧闸门会被 `Cyrene/sub` 绕过（basename 是 sub），也看不见 appDataPath
  // 整个躲在上游目录里面。生产里 legacyPath = appDataPath + legacyDirName 是拼出来的，
  // 所以段检查要覆盖三条完整路径：appDataPath、拼出来的 legacyPath、targetUserDataPath。
  it("闸门查每一条路径的每一个段：`Cyrene/sub` 与上游目录里的 appData 同样拒绝", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    tmpRoots.push(appData);
    const upstream = path.join(appData, "Cyrene");
    fs.mkdirSync(path.join(upstream, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(upstream, "cyrene-chats", "a.json"), "{}", "utf8");
    const before = snapshotTree(upstream);
    fs.mkdirSync(path.join(appData, "cyrene-verge"), { recursive: true });

    // 源目录名是拼接形态：上一版闸门在这里放行，接着就跑 existsSync/rename 进了禁写目录
    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "Cyrene/sub",
        markerFileName: VERGE_MIGRATION_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);

    // appDataPath 与目标都躲在上游目录里面：两条派生路径每一段都带着 Cyrene
    expect(() =>
      migrateLegacyUserData({
        appDataPath: path.join(upstream, "nested"),
        targetUserDataPath: path.join(upstream, "nested", "Mochi"),
        legacyDirName: "live2d-cyrene",
        markerFileName: VERGE_MIGRATION_MARKER,
      }),
    ).toThrow(/禁写|forbidden/);

    // 正对照：只认完整段。cyrene-verge / live2d-cyrene 都是合法目录名（本仓库的路径里就带着），
    // 三条路径全带这两段时必须照常搬完，段检查不许误伤。
    const wrapped = path.join(appData, "cyrene-verge", "live2d-cyrene");
    fs.mkdirSync(path.join(wrapped, "live2d-cyrene"), { recursive: true });
    fs.writeFileSync(path.join(wrapped, "live2d-cyrene", "memory.json"), '{"v":"real"}', "utf8");
    expect(
      migrateLegacyUserData({
        appDataPath: wrapped,
        targetUserDataPath: path.join(wrapped, "Mochi"),
        legacyDirName: "live2d-cyrene",
        markerFileName: VERGE_MIGRATION_MARKER,
      }).status,
    ).toBe("renamed");

    expect(snapshotTree(upstream)).toEqual(before);
    expect(fs.existsSync(path.join(appData, "Mochi"))).toBe(false);
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
    expect(fs.existsSync(path.join(appData, "Mochi", VERGE_MIGRATION_MARKER))).toBe(false);
  });
});

/**
 * 手动兜底脚本的常驻锁（Task 9 修复轮 1）。
 *
 * 为什么要在测试里读脚本文本：`scripts/migrate-user-data.cmd` 可以双击真跑，改名之后它一度
 * 仍把目标写着上游 `Cyrene`，还会对目标里的同名条目直接 `Remove-Item -Recurse -Force`——
 * 一条能把用户 246 MB 真数据删掉的可执行路径，而应用侧的闸门永远管不到它。
 * 每条判据都配正对照：尺写坏了（转义吃掉、大小写改了）要在正对照这行红，
 * 而不是安静地扫到 0 命中再报 PASS。
 */
describe("scripts/migrate-user-data.ps1 — 不许把上游 Cyrene 当目标", () => {
  const ps1 = fs.readFileSync(path.resolve(process.cwd(), "scripts", "migrate-user-data.ps1"), "utf8");
  const FORBIDDEN_TARGET_ASSIGN = /\$target\s*=\s*Join-Path\s+\$appData\s+['"]Cyrene['"]/i;
  const DESTRUCTIVE_OVERWRITE = /Remove-Item\s+-LiteralPath\s+\$dest\b[^|\r\n]*-Recurse/i;
  const SEGMENT_REFUSAL = /-eq\s+['"]cyrene['"]/i;

  it("正对照：判据正则确实能抓到三种危险形态（尺自己坏了要在这里红）", () => {
    expect(ps1.length).toBeGreaterThan(400);
    expect(ps1).toContain("$ErrorActionPreference");
    expect("$target = Join-Path $appData 'Cyrene'").toMatch(FORBIDDEN_TARGET_ASSIGN);
    expect("Remove-Item -LiteralPath $dest -Recurse -Force").toMatch(DESTRUCTIVE_OVERWRITE);
    expect("if ($segment.ToLower() -eq 'cyrene') { exit 1 }").toMatch(SEGMENT_REFUSAL);
  });

  it("目标是 brand 的 Mochi，两个搬运源按应用内的先后都在", () => {
    expect(ps1).toMatch(/Join-Path\s+\$appData\s+['"]Mochi['"]/i);
    expect(ps1).toMatch(/live2d-cyrene/);
    expect(ps1).toMatch(/cyrene-verge/);
  });

  it("有一道按路径段拒绝上游 Cyrene 的硬闸门，拒绝即退出", () => {
    expect(ps1).toMatch(SEGMENT_REFUSAL);
    expect(ps1).toMatch(/exit\s+1/);
  });

  it("没把 Cyrene 赋成目标，也不再直接删目标里的同名条目（改成移进时间戳备份目录）", () => {
    expect(ps1).not.toMatch(FORBIDDEN_TARGET_ASSIGN);
    expect(ps1).not.toMatch(DESTRUCTIVE_OVERWRITE);
    expect(ps1).toMatch(/\.legacy-migration-overwritten/);
  });

  it("进程守卫查本 fork 的名字，不再只查上游 Cyrene", () => {
    expect(ps1).toMatch(/Get-Process\s+-Name\s+'Mochi',\s*'cyrene-verge',\s*'Cyrene'/i);
  });
});

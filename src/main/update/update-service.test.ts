import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_UPDATE_REASONS,
  type ClientUpdatePhase,
  type ClientUpdateReason,
  type ClientUpdateState,
} from "../../shared/client-update-types";
import type { ResponseLike } from "../verge/subscription-fetch";
import { CLIENT_UPDATE_REPO } from "./github-release";
import type { DownloadTarget, InstallerDownloadResult, InstallerDownloader } from "./installer-download";
import type { InstallerLauncher, InstallerLaunchResult } from "./installer-launch";
import {
  CLIENT_RELEASE_TIMEOUT_MS,
  CLIENT_UPDATE_FIRST_DELAY_MS,
  CLIENT_UPDATE_INTERVAL_MS,
  CLIENT_UPDATE_SETTINGS_FILE,
  createClientUpdateService,
  createReleaseFetcher,
  installerNameFor,
  ReleaseEgressRefused,
  type ClientUpdateService,
  type ClientUpdateServiceDeps,
  type SettingsIo,
} from "./update-service";

const SRC_DIR = path.join(process.cwd(), "src", "main", "update");

/* ---------------------------------------------------------------- 假发布页 */

const RELEASE_DIGEST = "ab".repeat(32);
const OTHER_DIGEST = "cd".repeat(32);
const BYTES = 289_746_294;
const CURRENT = "1.15.0";
const NEW = "1.16.0";
const FILE = `Mochi-Setup-${NEW}.exe`;

function releaseFor(version: string, digest: string | null = `sha256:${RELEASE_DIGEST}`): Record<string, unknown> {
  const name = `Mochi-Setup-${version}.exe`;
  return {
    tag_name: `v${version}`,
    name: `Mochi ${version}`,
    prerelease: false,
    draft: false,
    html_url: `https://github.com/${CLIENT_UPDATE_REPO}/releases/tag/v${version}`,
    url: `https://api.github.com/repos/${CLIENT_UPDATE_REPO}/releases/9001`,
    assets: [
      {
        name,
        browser_download_url: `https://github.com/${CLIENT_UPDATE_REPO}/releases/download/v${version}/${name}`,
        digest,
        size: BYTES,
      },
    ],
  };
}

const release = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...releaseFor(NEW),
  ...overrides,
});

/* -------------------------------------------------------------- 目录与假盘 */

const ROOT = path.resolve("userData-harness");
const UPDATES = path.join(ROOT, "updates");
const SETTINGS = path.join(ROOT, "update", "settings.json");

interface Clock {
  value: number;
}

interface FakeIo {
  io: SettingsIo;
  files: Map<string, string>;
  failNextWrite(error: Error | null): void;
  writes(): number;
}

function makeIo(initial: Record<string, string> = {}): FakeIo {
  const files = new Map(Object.entries(initial));
  let writeError: Error | null = null;
  let writes = 0;
  return {
    files,
    io: {
      // 目录由调用方保证；这一层只验「路径是什么、写了什么」。
      mkdir: () => {},
      read: (file) => files.get(file) ?? null,
      write: (file, text) => {
        writes += 1;
        if (writeError) throw writeError;
        files.set(file, text);
      },
    },
    failNextWrite: (error) => {
      writeError = error;
    },
    writes: () => writes,
  };
}

interface FakeTimer {
  run: () => void;
  ms: number;
  fired: boolean;
  cancelled: boolean;
}

/* ------------------------------------------------------------------ 装配 */

interface Setup {
  service: ClientUpdateService;
  state(): ClientUpdateState;
  logs: string[];
  disk: Map<string, { bytes: number; digest: string }>;
  calls: { release: number; download: number; digestOf: number; sizeOf: number; sweep: number };
  resetCalls(): void;
  targets: DownloadTarget[];
  launches: string[];
  launchResults: InstallerLaunchResult[];
  quits: number[];
  timers: FakeTimer[];
  /** 还排着（没被撤销也没响过）的那几只闹钟。 */
  live(): FakeTimer[];
  /** 手动拨表：排程的判据由测试决定什么时候发生。 */
  fire(): void;
  io: FakeIo;
  setRelease(json: unknown): void;
  setReleaseError(error: Error | null): void;
  setVersion(version: string): void;
  setCoreRunning(on: boolean): void;
  /** 装配层那一句 `quitApp()` 抛错：这一层不许因此改写「安装器确实起来了」。 */
  setQuitError(error: Error | null): void;
  failNextDownload(result: InstallerDownloadResult): void;
  seedDisk(name: string, digest: string, bytes?: number): void;
}

function setup(overrides: Partial<ClientUpdateServiceDeps> = {}, ioInitial: Record<string, string> = {}): Setup {
  const io = makeIo(ioInitial);
  const logs: string[] = [];
  const clock: Clock = { value: 1_700_000_000_000 };
  const timers: FakeTimer[] = [];
  const disk = new Map<string, { bytes: number; digest: string }>();
  const calls = { release: 0, download: 0, digestOf: 0, sizeOf: 0, sweep: 0 };
  const targets: DownloadTarget[] = [];
  const launches: string[] = [];
  const launchResults: InstallerLaunchResult[] = [];
  const quits: number[] = [];
  let releaseJson: unknown = release();
  let releaseError: Error | null = null;
  let nextDownloadFailure: InstallerDownloadResult | null = null;
  let currentVersion = CURRENT;
  let coreRunning = false;
  let quitError: Error | null = null;

  const downloader: InstallerDownloader = {
    async download(target) {
      calls.download += 1;
      targets.push(target);
      if (nextDownloadFailure) {
        const failure = nextDownloadFailure;
        nextDownloadFailure = null;
        // 与真实现同口径：败了就没有正名，`.part` 当场删——盘上不该多出任何东西。
        return failure;
      }
      disk.set(target.fileName, { bytes: BYTES, digest: target.digest });
      return { ok: true, fileName: target.fileName, bytes: BYTES, hops: 1 };
    },
    async digestOf(name) {
      calls.digestOf += 1;
      return disk.get(name)?.digest ?? null;
    },
    sizeOf(name) {
      calls.sizeOf += 1;
      return disk.get(name)?.bytes ?? null;
    },
    filePathOf: (name) => path.join(UPDATES, name),
    dir: () => UPDATES,
    pruneInstalled: () => [],
    sweepParts() {
      calls.sweep += 1;
      return ["Mochi-Setup-1.16.0.exe.part"];
    },
  };

  const launcher: InstallerLauncher = {
    async launch(filePath) {
      launches.push(filePath);
      if (launchResults.length) return launchResults.shift() as InstallerLaunchResult;
      return { ok: true, pid: 4242 };
    },
    args: () => ["/S", "--updated", "--force-run"],
  };

  const schedule = (run: () => void, ms: number) => {
    const timer: FakeTimer = { run, ms, fired: false, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };

  const deps: ClientUpdateServiceDeps = {
    currentVersion: () => currentVersion,
    downloader,
    launcher,
    getRelease: async () => {
      calls.release += 1;
      if (releaseError) throw releaseError;
      return releaseJson;
    },
    coreIsRunning: () => coreRunning,
    quitApp: () => {
      if (quitError) throw quitError;
      quits.push(1);
    },
    schedule,
    now: () => (clock.value += 1),
    log: (line) => logs.push(line),
    settingsIo: io.io,
    ...overrides,
  };

  const service = createClientUpdateService(deps);
  return {
    service,
    state: () => service.state(),
    logs,
    disk,
    calls,
    resetCalls: () => {
      for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
    },
    targets,
    launches,
    launchResults,
    quits,
    timers,
    live: () => timers.filter((timer) => !timer.cancelled && !timer.fired),
    fire() {
      const [timer] = timers.filter((t) => !t.cancelled && !t.fired);
      if (!timer) throw new Error("没有排着的闹钟：这一趟链根本没上弦");
      timer.fired = true;
      timer.run();
    },
    io,
    setRelease: (json) => {
      releaseError = null;
      releaseJson = json;
    },
    setReleaseError: (error) => {
      releaseError = error;
    },
    setVersion: (version) => {
      currentVersion = version;
    },
    setCoreRunning: (on) => {
      coreRunning = on;
    },
    setQuitError: (error) => {
      quitError = error;
    },
    failNextDownload: (result) => {
      nextDownloadFailure = result;
    },
    seedDisk: (name, digest, bytes = BYTES) => {
      disk.set(name, { bytes, digest });
    },
  };
}

/** 让所有已排队的微任务与宏任务走完一轮（排程那一条链的 `.finally` 就在这一轮里）。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/* ==================================================================== 尺 */

describe("update-service：三本账各写各的", () => {
  it("全绿一趟：检查→下载→安装各留一条回执，装完才退出", async () => {
    const h = setup();
    const checked = await h.service.check();
    expect(checked).toMatchObject({ outcome: "available", latestVersion: NEW, reason: null });
    const downloaded = await h.service.download();
    expect(downloaded).toMatchObject({ outcome: "ready", version: NEW, fileName: FILE, bytes: BYTES, reason: null });
    const installed = await h.service.install();
    expect(installed).toMatchObject({ outcome: "launched", version: NEW, reason: null });

    expect(h.calls.release).toBe(1);
    expect(h.calls.download).toBe(1);
    // 起的是「我们自己按版本号推出来的那个正名」，不是从 JSON 里抄的路径。
    expect(h.targets[0]).toMatchObject({ fileName: FILE, digest: RELEASE_DIGEST });
    expect(h.launches).toEqual([path.join(UPDATES, FILE)]);
    expect(h.quits).toHaveLength(1);

    const state = h.service.state();
    expect(state.phase).toBe("idle");
    expect(state.currentVersion).toBe(CURRENT);
    expect(state.check?.at ?? 0).toBeLessThan(state.download?.at ?? 0);
    expect(state.download?.at ?? 0).toBeLessThan(state.install?.at ?? 0);
  });

  it("phase 说的是「正在走哪一段」：在途那一帧各段都认得出，走完回 idle", async () => {
    const h = setup();
    const checking = h.service.check();
    expect(h.service.state().phase).toBe("checking");
    await checking;
    expect(h.service.state().phase).toBe("idle");

    const downloading = h.service.download();
    expect(h.service.state().phase).toBe("downloading");
    await downloading;

    const installing = h.service.install();
    expect(h.service.state().phase).toBe("installing");
    await installing;
    expect(h.service.state().phase).toBe("idle");
  });

  it("state() 给的是副本：账面不被读它的人改走", async () => {
    const h = setup();
    await h.service.check();
    const first = h.service.state();
    const second = h.service.state();
    expect(first.check).not.toBe(second.check);
    expect(first.check).toEqual(second.check);
    (first.check as unknown as { outcome: string }).outcome = "latest";
    expect(h.service.state().check?.outcome).toBe("available");
  });

  it("currentVersion 每次现读：下一次启动读到新版本号，我们这边没替它记过账", async () => {
    const h = setup();
    expect(h.service.state().currentVersion).toBe(CURRENT);
    h.setVersion(NEW);
    expect(h.service.state().currentVersion).toBe(NEW);
    // 三本账都不落盘：整趟绿下来，盘上只可能有那一份 autoCheck，而这里连开关都没碰过。
    await h.service.check();
    await h.service.download();
    expect(h.io.files.size).toBe(0);
  });

  it("回执里的字节：败的那一趟记 0，半包不上账", async () => {
    const h = setup();
    await h.service.check();
    h.failNextDownload({ ok: false, reason: "write-failed", detail: "ENOSPC: no space left on device", fileName: FILE });
    const receipt = await h.service.download();
    expect(receipt).toMatchObject({ outcome: "failed", bytes: 0, reason: "write-failed" });
    expect(receipt.detail).toContain("no space");
  });
});

describe("update-service：账本之间不许互相作废", () => {
  it("检查失败不作废上一趟读出来的资产：离线也装得下已经下好的包", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    // 「今天没网」被接成「昨天那个包不算数」的形状是：离线时连手上新包都装不了。
    h.setReleaseError(new Error("getaddrinfo ENOTFOUND api.github.com"));
    const failed = await h.service.check();
    expect(failed).toMatchObject({ outcome: "failed", reason: "network-failed", latestVersion: null });

    const installed = await h.service.install();
    expect(installed.outcome).toBe("launched");
    expect(h.launches).toEqual([path.join(UPDATES, FILE)]);
    expect(h.quits).toHaveLength(1);
  });

  it("发布页回落后（latest）不作废 ready：已经核对过的包仍然可以装", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    // 上游把 latest 指回我们本机这一版（撤版/回滚都长这样）：这一档读出来是 latest。
    h.setRelease(releaseFor(CURRENT));
    const back = await h.service.check();
    expect(back).toMatchObject({ outcome: "latest", latestVersion: CURRENT });
    expect((await h.service.install()).outcome).toBe("launched");
  });

  it("下载失败不提前作废 ready：装那一段自己重算字节，失败那本账不越权", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    // 发布页换过一枚摘要（有人重传了资产），于是这一次真的会重下——而重下失败了。
    h.setRelease(releaseFor(NEW, `sha256:${OTHER_DIGEST}`));
    await h.service.check();
    h.failNextDownload({ ok: false, reason: "network-failed", detail: "90 秒没收到字节", fileName: FILE });
    const retry = await h.service.download();
    expect(retry).toMatchObject({ outcome: "failed", reason: "network-failed" });
    // 盘上那一份仍然是我们核对过的字节：install 认的是字节，不是「上一次下载败过」。
    expect((await h.service.install()).outcome).toBe("launched");
  });

  it("已是最新时没有东西可下：那一档不是失败，reason 为空、话说在 detail 里", async () => {
    const h = setup();
    h.setRelease(releaseFor(CURRENT));
    const downloaded = await h.service.download();
    expect(downloaded.outcome).toBe("failed");
    expect(downloaded.reason).toBeNull();
    expect(downloaded.detail).toContain("不比本机新");
    expect(downloaded.bytes).toBe(0);
    expect(h.calls.download).toBe(0);
  });
});

describe("update-service：判据的顺序就是成本的顺序", () => {
  it("内核还在跑时不读盘：core-running 排在重算摘要之前", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    h.setCoreRunning(true);
    h.resetCalls();
    const installed = await h.service.install();
    expect(installed).toMatchObject({ outcome: "failed", reason: "core-running" });
    // 这一段最贵的是读 290 MB 算 sha256：明知不能装还先读全盘，就是替用户花时间。
    expect(h.calls.digestOf).toBe(0);
    expect(h.calls.sizeOf).toBe(0);
    expect(h.launches).toEqual([]);
    expect(h.quits).toEqual([]);
    expect(installed.detail).toContain("停掉");
  });

  it("包不在了先说 no-package，并且不去算摘要（stat 比读全盘便宜）", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    h.disk.clear();
    h.resetCalls();
    const first = await h.service.install();
    expect(first).toMatchObject({ outcome: "failed", reason: "no-package", version: NEW });
    expect(h.calls.digestOf).toBe(0);
    expect(h.launches).toEqual([]);
    // ready 当场作废：第二次点说的是「先下」，而不是继续报那个已经不存在的包。
    const again = await h.service.install();
    expect(again).toMatchObject({ outcome: "failed", reason: "no-package" });
    expect(again.detail).toContain("先点下载");
  });

  it("被人动过的包不许冒充新升级：装之前重算 sha256，并作废 ready", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    h.seedDisk(FILE, OTHER_DIGEST);
    const installed = await h.service.install();
    expect(installed).toMatchObject({ outcome: "failed", reason: "stale-package", version: NEW });
    expect(installed.detail).toContain(RELEASE_DIGEST.slice(0, 12));
    expect(installed.detail).toContain(OTHER_DIGEST.slice(0, 12));
    expect(h.launches).toEqual([]);
    expect(h.quits).toEqual([]);
    expect((await h.service.install()).reason).toBe("no-package");
  });

  it("包还在但发布页已经往前走了一版：stale-package 说的是「先重下那一版」", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    const newer = "1.17.0";
    h.setRelease(releaseFor(newer));
    await h.service.check();
    const installed = await h.service.install();
    expect(installed).toMatchObject({ outcome: "failed", reason: "stale-package", version: NEW });
    expect(installed.detail).toContain(newer);
    // 重下新那一版之后，装的才是新那一版。
    await h.service.download();
    const after = await h.service.install();
    expect(after).toMatchObject({ outcome: "launched", version: newer });
    expect(h.launches[h.launches.length - 1]).toBe(path.join(UPDATES, `Mochi-Setup-${newer}.exe`));
  });

  it("盘上已经有一份对得上的包：下载这一步不重新吃 290 MB", async () => {
    const h = setup();
    h.seedDisk(FILE, RELEASE_DIGEST);
    await h.service.check();
    const receipt = await h.service.download();
    expect(receipt).toMatchObject({ outcome: "ready", bytes: BYTES, reason: null });
    expect(receipt.detail).toContain("没有重新下载");
    expect(h.calls.download).toBe(0);
    // 正对照：摘要对不上的那一份才会触发真下载。
    h.seedDisk(FILE, OTHER_DIGEST);
    expect((await h.service.download()).outcome).toBe("ready");
    expect(h.calls.download).toBe(1);
  });
});

describe("update-service：在途去分两种，答案不一样", () => {
  type Key = "check" | "download" | "install";
  const BUSY: Record<Key, ClientUpdatePhase> = { check: "checking", download: "downloading", install: "installing" };
  const call = (service: ClientUpdateService, key: Key) =>
    key === "check" ? service.check() : key === "download" ? service.download() : service.install();

  it("同一段的第二次点击并入那一趟：一条连接都不多开", async () => {
    const h = setup();
    const first = h.service.check();
    const second = h.service.check();
    expect(second).toBe(first);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(h.calls.release).toBe(1);

    await h.service.check();
    const d1 = h.service.download();
    const d2 = h.service.download();
    expect(d2).toBe(d1);
    await Promise.all([d1, d2]);
    expect(h.calls.download).toBe(1);
  });

  it("跨段点击只回 in-flight，且不在对方那本账上留记录", async () => {
    for (const busy of ["check", "download", "install"] as const) {
      const h = setup();
      if (busy !== "check") await h.service.check();
      if (busy === "install") await h.service.download();
      const inflight = call(h.service, busy);
      expect(h.service.state().phase).toBe(BUSY[busy]);

      const others = (["check", "download", "install"] as const).filter((key) => key !== busy);
      // 账面必须在**发出**那两趟之前拍：先拍再发的话，被拒那一趟当场往对方账里写的假账会一起进快照，
      // 这把尺就只量得出「两趟之后还是那两趟」——而那正是我们要否掉的行为本身。
      const snapshot = h.service.state();
      const refused = others.map((key) => call(h.service, key));
      const receipts = (await Promise.all(refused)) as Array<{ outcome: string; reason: string | null; detail: string | null }>;
      for (const receipt of receipts) {
        expect(receipt.outcome).toBe("failed");
        expect(receipt.reason).toBe("in-flight");
        expect(receipt.detail).toContain(`正在${{ check: "检查", download: "下载", install: "安装" }[busy]}`);
      }
      const after = h.service.state();
      for (const key of others) {
        expect(after[key], `${busy} 在途时不许往 ${key} 那本账里写假账`).toEqual(snapshot[key]);
      }
      await inflight;
    }
  });

  it("in-flight 那一条回执的字段仍按类型填满：说的是手上这一版，不是占位", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    const installing = h.service.install();
    const refused = await h.service.download();
    expect(refused).toMatchObject({ outcome: "failed", version: NEW, fileName: FILE, bytes: 0, reason: "in-flight" });
    await installing;
  });
});

describe("update-service：起来之后才退，起不来就什么都不做", () => {
  it("安装器没起来时绝对不退出：这是唯一一档什么都没发生", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    h.launchResults.push({ ok: false, detail: "安装器没起来：spawn ENOENT" });
    const failed = await h.service.install();
    expect(failed).toMatchObject({ outcome: "failed", reason: "launch-failed", version: NEW });
    expect(h.quits).toEqual([]);
    // 「还能再点一次」的凭据：ready 没被这一趟吃掉，包也还在盘上。
    expect(h.disk.has(FILE)).toBe(true);
    expect((await h.service.install()).outcome).toBe("launched");
    expect(h.quits).toHaveLength(1);
  });

  it("quitApp 抛错也不改写那一档 launched：起来的是安装器，退出是另一回事", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    h.setQuitError(new Error("协作退出没走完"));
    const installed = await h.service.install();
    expect(installed.outcome).toBe("launched");
    expect(installed.detail).toContain("pid 4242");
    expect(h.quits).toEqual([]);
    // 不能咽下去：装配层要能从这一句里看出「猫退了没有」。
    expect(h.logs.some((line) => line.includes("安装器起来了但退出没走顺") && line.includes("协作退出没走完"))).toBe(true);
  });

  it("launched 不许被写成「升级成功」：我们看不见那一幕", async () => {
    const h = setup();
    await h.service.check();
    await h.service.download();
    const installed = await h.service.install();
    expect(installed.outcome).toBe("launched");
    expect(installed.detail).toContain("下一次启动读到的版本号才是凭据");
    expect(h.logs.some((line) => line.includes("升级成功"))).toBe(false);
  });
});

describe("update-service：排程只走检查（spec D3 的负判据）", () => {
  it("start() 排的是 90s，之后每 6h；整条链一次都不碰下载", async () => {
    const h = setup();
    const swept = h.service.start();
    expect(swept).toEqual(["Mochi-Setup-1.16.0.exe.part"]);
    expect(h.calls.sweep).toBe(1);
    expect(h.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_FIRST_DELAY_MS]);
    expect(CLIENT_UPDATE_FIRST_DELAY_MS).toBe(90_000);
    expect(CLIENT_UPDATE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(CLIENT_UPDATE_FIRST_DELAY_MS).toBeLessThan(CLIENT_UPDATE_INTERVAL_MS);

    h.fire();
    await flush();
    expect(h.calls.release).toBe(1);
    expect(h.service.state().check?.outcome).toBe("available");
    // 关键那条：查到了新版**也不自动下载**。
    expect(h.calls.download).toBe(0);
    expect(h.service.state().download).toBeNull();
    expect(h.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_INTERVAL_MS]);
    expect(h.timers).toHaveLength(2);

    h.setRelease(releaseFor("1.17.0"));
    h.fire();
    await flush();
    expect(h.calls.release).toBe(2);
    expect(h.service.state().check?.latestVersion).toBe("1.17.0");
    expect(h.calls.download).toBe(0);
  });

  it("检查败了那条链不能断：下一次照排", async () => {
    const h = setup();
    h.service.start();
    h.setReleaseError(new Error("ECONNREFUSED"));
    h.fire();
    await flush();
    expect(h.service.state().check).toMatchObject({ outcome: "failed", reason: "network-failed" });
    expect(h.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_INTERVAL_MS]);
    h.setRelease(release());
    h.fire();
    await flush();
    expect(h.service.state().check?.outcome).toBe("available");
  });

  it("autoCheck 关着时什么都不排；打开从 90s 起，不为「刚勾上」立刻打一枪", async () => {
    const h = setup({}, { [SETTINGS]: JSON.stringify({ autoCheck: false }) });
    expect(h.service.state().autoCheck).toBe(false);
    h.service.start();
    expect(h.timers).toEqual([]);

    h.service.setAutoCheck(true);
    expect(h.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_FIRST_DELAY_MS]);
    expect(h.calls.release).toBe(0);
  });

  it("关掉就撤销在跑的那条链", async () => {
    const h = setup();
    h.service.start();
    h.service.setAutoCheck(false);
    expect(h.live()).toEqual([]);
    expect(h.timers.every((timer) => timer.cancelled)).toBe(true);
    h.setRelease(release());
    // 关掉之后再没有闹钟可拨：整条链停在原地，一次请求都没发。
    expect(() => h.fire()).toThrow("没有排着的闹钟");
    expect(h.calls.release).toBe(0);
  });

  it("stop() 是终止：在途那一趟跑完不许自己再上弦", async () => {
    const h = setup();
    h.service.start();
    h.fire();
    h.service.stop();
    await flush();
    // 没有这一条，退出时会在事件循环里留下一颗 6 小时的闹钟。
    expect(h.timers).toHaveLength(1);
    expect(h.live()).toEqual([]);
  });

  it("start() 之后重新上弦：stop 不是「这一世再不排程」", async () => {
    const h = setup();
    h.service.start();
    h.service.stop();
    h.service.start();
    expect(h.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_FIRST_DELAY_MS]);
  });
});

describe("update-service：设置只存 autoCheck 那一颗", () => {
  it("开关落盘并被下一个会话读到，文件里除 autoCheck 之外没有别的字段", async () => {
    const h = setup();
    expect(h.service.setAutoCheck(false)).toEqual({ ok: true, detail: null });
    const raw = h.io.files.get(SETTINGS);
    if (!raw) throw new Error(`setAutoCheck 没落盘：${SETTINGS}`);
    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>)).toEqual(["autoCheck"]);
    expect(JSON.parse(raw)).toEqual({ autoCheck: false });

    // 下一个会话：同一份盘，读到的是关；三本账一条都不在（账本不落盘）。
    const next = setup({}, { [SETTINGS]: raw });
    expect(next.service.state()).toMatchObject({
      currentVersion: CURRENT,
      autoCheck: false,
      phase: "idle",
      check: null,
      download: null,
      install: null,
    });
    next.service.start();
    expect(next.timers).toEqual([]);
    // 再翻回来。
    expect(next.service.setAutoCheck(true).ok).toBe(true);
    expect(JSON.parse(next.io.files.get(SETTINGS) as string)).toEqual({ autoCheck: true });
    expect(next.live().map((timer) => timer.ms)).toEqual([CLIENT_UPDATE_FIRST_DELAY_MS]);
  });

  it("设置那颗落在 <userData>/update/，不在 updates/ 里面（清扫与保留都碰不到它）", () => {
    const h = setup();
    h.service.setAutoCheck(true);
    expect(CLIENT_UPDATE_SETTINGS_FILE).toBe(path.join("update", "settings.json"));
    const written = [...h.io.files.keys()];
    expect(written).toEqual([SETTINGS]);
    expect(SETTINGS.startsWith(`${UPDATES}${path.sep}`)).toBe(false);
    expect(SETTINGS).toBe(path.join(path.dirname(UPDATES), CLIENT_UPDATE_SETTINGS_FILE));
  });

  it("读不懂的文件按默认走、说一句，并且下一次 save 把它盖回合法形状", async () => {
    for (const [label, text] of [
      ["坏 JSON", "{oops"],
      ["不是布尔", JSON.stringify({ autoCheck: "yes" })],
      ["缺字段", JSON.stringify({ other: true })],
      ["空串", "null"],
    ] as const) {
      const h = setup({}, { [SETTINGS]: text });
      expect(h.service.state().autoCheck, label).toBe(true);
      expect(h.logs.some((line) => line.includes("按默认走")), label).toBe(true);
      h.service.setAutoCheck(false);
      expect(JSON.parse(h.io.files.get(SETTINGS) as string)).toEqual({ autoCheck: false });
    }
  });

  it("存不住也要说：这一次会话里仍然生效，重启回到默认", () => {
    const h = setup();
    h.io.failNextWrite(new Error("EPERM: operation not permitted"));
    const saved = h.service.setAutoCheck(false);
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("写失败本该报回来");
    expect(saved.detail).toContain("EPERM");
    expect(h.logs.some((line) => line.includes("没能存住"))).toBe(true);
    // 会话内仍然翻了面（不因为存不下就当没发生过）。
    expect(h.service.state().autoCheck).toBe(false);
    expect(h.io.files.size).toBe(0);
  });

  it("默认开：这条通道是 P4 断掉上游更新的替代物，默认关等于装了一条没人按的更新通道", () => {
    const h = setup();
    expect(h.service.state().autoCheck).toBe(true);
    h.service.start();
    expect(h.live()).toHaveLength(1);
  });
});

describe("update-service：下载那一段把 installer-download 的话原样带上账", () => {
  const PASSTHROUGH: ClientUpdateReason[] = ["network-failed", "digest-mismatch", "too-large", "write-failed", "no-asset", "wrong-source", "digest-missing"];

  it("reason 一档都不许被并成「网络失败」：话术不同，用户要做的事就不同", async () => {
    const h = setup();
    await h.service.check();
    for (const reason of PASSTHROUGH) {
      h.disk.clear();
      h.failNextDownload({ ok: false, reason, detail: `假失败 ${reason}`, fileName: FILE });
      const receipt = await h.service.download();
      expect(receipt, reason).toMatchObject({ outcome: "failed", reason, bytes: 0 });
      expect(receipt.detail, reason).toContain(`假失败 ${reason}`);
    }
    expect(h.calls.download).toBe(PASSTHROUGH.length);
  });

  it("检查读不出来的那几档，下载一个字节都不发", async () => {
    const cases: Array<{ label: string; json: unknown; reason: ClientUpdateReason; version?: string }> = [
      { label: "tag 读不出", json: release({ tag_name: "nightly" }), reason: "bad-response" },
      { label: "本机版本号读不出", json: release(), reason: "bad-response", version: "main-2026-10-31" },
      { label: "没有对得上的安装包", json: release({ assets: [] }), reason: "no-asset" },
      { label: "预发布", json: release({ prerelease: true }), reason: "prerelease-only" },
      { label: "草稿", json: release({ draft: true }), reason: "prerelease-only" },
      { label: "没带 sha256 凭据", json: releaseFor(NEW, null), reason: "digest-missing" },
      {
        label: "别人的仓库",
        json: release({ html_url: "https://github.com/other/repo/releases/tag/v1.16.0", url: "https://api.github.com/repos/other/repo/releases/1" }),
        reason: "wrong-source",
      },
    ];
    for (const { label, json, reason, version } of cases) {
      const h = version ? setup({ currentVersion: () => version }) : setup();
      h.setRelease(json);
      const checked = await h.service.check();
      expect(checked, label).toMatchObject({ outcome: "failed", reason });
      const downloaded = await h.service.download();
      expect(downloaded, label).toMatchObject({ outcome: "failed", reason });
      // 「一个字节都不下」是这一档唯一有意义的判据。
      expect(h.calls.download, label).toBe(0);
      expect(downloaded.bytes, label).toBe(0);
      expect(downloaded.detail, label).not.toBeNull();
    }
  });

  it("没先点检查就直接点下载：自己补一趟检查，仍然只发一次发布页请求", async () => {
    const h = setup();
    const receipt = await h.service.download();
    expect(receipt).toMatchObject({ outcome: "ready", fileName: FILE });
    expect(h.calls.release).toBe(1);
    expect(h.calls.download).toBe(1);
  });

  it("补的那一趟检查失败时，下载把它的下场原样带过来", async () => {
    const h = setup();
    h.setReleaseError(new Error("HTTP 500（api.github.com）"));
    const receipt = await h.service.download();
    expect(receipt).toMatchObject({ outcome: "failed", reason: "network-failed", bytes: 0 });
    expect(receipt.detail).toContain("先检查这一步就没走过去");
    expect(h.calls.download).toBe(0);
  });

  it("安装包的正名从我们自己的版本号推出来，不是从 JSON 里抄的", async () => {
    expect(installerNameFor(NEW)).toBe(FILE);
    expect(installerNameFor("1.16.0-beta.2")).toBe("Mochi-Setup-1.16.0-beta.2.exe");
    // 资产名字对得上这把尺：这一层推出来的东西，起安装器那一层的形状尺必须认。
    const assets = (release() as { assets: Array<{ name: string }> }).assets;
    expect(assets[0].name).toBe(installerNameFor(NEW));
    const h = setup();
    h.setRelease({ ...release(), tag_name: "v1.16.0", assets: [{ ...assets[0], name: `../../evil.exe` }] });
    const checked = await h.service.check();
    expect(checked).toMatchObject({ outcome: "failed", reason: "no-asset" });
  });
});

describe("update-service：发布页那一条的出口闸门", () => {
  interface Call {
    url: string;
    init: RequestLike;
  }

  interface RequestLike {
    redirect: string;
    signal: AbortSignal;
    headers: Record<string, string>;
  }

  function fakeFetch(script: (url: string, call: Call) => ResponseLike | Error): { fetch: (url: string, init: RequestInit) => Promise<ResponseLike>; calls: Call[] } {
    const calls: Call[] = [];
    return {
      calls,
      async fetch(url, init) {
        const call: Call = { url, init: { redirect: init.redirect as string, signal: init.signal as AbortSignal, headers: init.headers as Record<string, string> } };
        calls.push(call);
        const outcome = script(url, call);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    };
  }

  const json = (body: unknown): ResponseLike => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });

  const redirect = (location: string): ResponseLike => ({
    ok: false,
    status: 302,
    headers: { get: (name) => (name.toLowerCase() === "location" ? location : null) },
    text: async () => "",
  });

  it("白名单在发请求之前判：假发布页一个请求都没发出去", async () => {
    for (const url of ["https://api.github.com.evil.tld/x", "https://api.github.com@evil.tld/x", "http://api.github.com/x", "not a url"]) {
      const h = fakeFetch(() => json(release()));
      const fetchRelease = createReleaseFetcher({ url, fetchImpl: h.fetch });
      await expect(fetchRelease()).rejects.toBeInstanceOf(ReleaseEgressRefused);
      expect(h.calls).toEqual([]);
    }
  });

  it("跟跳转要逐跳重新过闸门：跳到别人那台也算走出白名单", async () => {
    const h = fakeFetch((url) => (url.includes("api.github.com") ? redirect("https://release-assets.githubusercontent.com/x") : json(release())));
    await expect(createReleaseFetcher({ fetchImpl: h.fetch })()).rejects.toBeInstanceOf(ReleaseEgressRefused);
    // 第一跳确实发了请求（闸门是在每一跳上判的），第二跳被拦下。
    expect(h.calls).toHaveLength(1);
  });

  it("正对照：钉住的那台之间跳转能落地，并带着 UA 与 accept", async () => {
    const h = fakeFetch((url) => (url.endsWith("/latest") ? redirect("/repos/x/releases/tag/v1.16.0") : json(release())));
    const got = (await createReleaseFetcher({ fetchImpl: h.fetch })()) as { tag_name: string };
    expect(got.tag_name).toBe("v1.16.0");
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.init.redirect).toBe("manual");
      expect(call.init.headers.accept).toBe("application/vnd.github+json");
      expect(call.init.headers["user-agent"]).toBe("mochi-client-updater/v1");
    }
    expect(h.calls[1].url).toBe("https://api.github.com/repos/x/releases/tag/v1.16.0");
  });

  it("非 2xx / 不是 JSON / 跳转太多都要说出来，不许静默放宽", async () => {
    const notFound = fakeFetch(() => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "Not Found" }));
    await expect(createReleaseFetcher({ fetchImpl: notFound.fetch })()).rejects.toThrow(/HTTP 404/);

    const html = fakeFetch(() => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>rate limited</html>" }));
    await expect(createReleaseFetcher({ fetchImpl: html.fetch })()).rejects.toThrow(/不是 JSON/);

    const loop = fakeFetch(() => redirect("https://api.github.com/hop"));
    await expect(createReleaseFetcher({ fetchImpl: loop.fetch, maxRedirects: 2 })()).rejects.toThrow(/超过 2 跳/);

    const noLocation = fakeFetch(() => ({ ok: false, status: 301, headers: { get: () => null }, text: async () => "" }));
    await expect(createReleaseFetcher({ fetchImpl: noLocation.fetch })()).rejects.toThrow(/没给地址/);

    const broken = fakeFetch(() => new Error("socket hang up"));
    await expect(createReleaseFetcher({ fetchImpl: broken.fetch })()).rejects.toThrow(/socket hang up/);
  });

  it("到点那一句说的是「没等到」：与「请求没回来」指向不同的下一步", async () => {
    const seen: string[] = [];
    // 假 fetch 只做一件事：永远不 resolve，只在 abort 那一声里 reject——与真 fetch 的取消语义同形。
    const neverResolves = (url: string, init: RequestInit) =>
      new Promise<ResponseLike>((_resolve, reject) => {
        seen.push(url);
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(createReleaseFetcher({ fetchImpl: neverResolves, timeoutMs: 5 })()).rejects.toThrow(/秒没等到发布页/);
    expect(seen).toHaveLength(1);
    expect(CLIENT_RELEASE_TIMEOUT_MS).toBe(30_000);
  });

  it("闸门拒的那一趟在账本里是 wrong-source，别的是 network-failed", async () => {
    const forged = createReleaseFetcher({ url: "https://api.github.com.evil.tld/repos/x/releases/latest", fetchImpl: fakeFetch(() => json(release())).fetch });
    const h = setup({ getRelease: forged });
    expect(await h.service.check()).toMatchObject({ outcome: "failed", reason: "wrong-source" });
    expect(h.logs.some((line) => line.includes("一个请求都没发"))).toBe(true);

    const offline = createReleaseFetcher({ fetchImpl: fakeFetch(() => new Error("ECONNREFUSED")).fetch });
    const h2 = setup({ getRelease: offline });
    expect(await h2.service.check()).toMatchObject({ outcome: "failed", reason: "network-failed" });
  });
});

describe("update-service：词表与生产者（反向锁）", () => {
  /**
   * 每档都要在这一份测试里被**真的跑出来过**，值取那条 `it()` 标题里的片段——
   * 有人删了那条测试这里就红。比「源码里 grep 得到这个词」强一档：那只能证明代码写过，
   * 不能证明现在还跑得出。
   *
   * 「不许有没产出的词」这一半由 TS 的 `Record<ClientUpdateReason, string>` 兜：
   * 词表里添一档而这里没补，编译就过不去。
   */
  const REASON_PROOF: Record<ClientUpdateReason, string> = {
    "network-failed": "别的是 network-failed",
    "bad-response": "下载一个字节都不发",
    "no-asset": "下载一个字节都不发",
    "wrong-source": "别的是 network-failed",
    "prerelease-only": "下载一个字节都不发",
    "digest-missing": "下载一个字节都不发",
    "digest-mismatch": "原样带上账",
    "too-large": "原样带上账",
    "write-failed": "原样带上账",
    "no-package": "包不在了先说 no-package",
    "stale-package": "不许冒充新升级",
    "core-running": "内核还在跑时不读盘",
    "launch-failed": "安装器没起来时绝对不退出",
    "in-flight": "只回 in-flight",
  };

  it("词表 14 档：源码里有生产者，测试里跑得出结果", () => {
    expect(CLIENT_UPDATE_REASONS.length).toBe(14);
    expect(new Set<string>(CLIENT_UPDATE_REASONS).size).toBe(CLIENT_UPDATE_REASONS.length);
    expect(Object.keys(REASON_PROOF).sort()).toEqual([...CLIENT_UPDATE_REASONS].sort());

    const names = readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(names.length).toBeGreaterThanOrEqual(4);
    const blob = names.map((name) => readFileSync(path.join(SRC_DIR, name), "utf8")).join("\n");
    for (const reason of CLIENT_UPDATE_REASONS) {
      expect(blob, `"${reason}" 没有任何生产者：词表里的这一档该删`).toContain(`"${reason}"`);
    }

    const self = readFileSync(path.join(SRC_DIR, "update-service.test.ts"), "utf8");
    for (const [reason, proof] of Object.entries(REASON_PROOF)) {
      expect(proof.trim(), reason).not.toBe("");
      expect(self, `词表里的 ${reason} 没有对应的测试标题片段：${proof}`).toContain(proof);
    }
  });

  it("落盘只有那一颗设置：账本不落盘，Verge 与内核目录一个字节都不碰", () => {
    const source = readFileSync(path.join(SRC_DIR, "update-service.ts"), "utf8");
    expect(source).toContain("CLIENT_UPDATE_SETTINGS_FILE");
    expect(source).toContain("renameWithRetrySync");
    // 这一层唯一的写是 `<userData>/update/settings.json`（原子写）；删除类的一个都不许有——
    // 安装包的生命归 `installer-download.ts` 的 pruneInstalled/sweepParts。
    for (const forbidden of ["rmSync", "unlinkSync", "unlink(", "appendFile", "rimraf", "clash-verge", "verge-mihomo", "CORE_DIR_NAME"]) {
      expect(source, `update-service 里出现了 ${forbidden}：这一层不该碰那些东西`).not.toContain(forbidden);
    }
  });
});

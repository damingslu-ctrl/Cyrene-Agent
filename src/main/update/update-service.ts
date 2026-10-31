/**
 * v1.26 客户端更新通道的状态机（Wave 4 T12c）：三本账、一条在途、一把退出前的闸门。
 *
 * 数据面已经在两处各自收口了（`github-release.ts` 判发布页、`installer-download.ts` 落字节、
 * `installer-launch.ts` 起安装器）。这一层只管四件只有它会判错的事：
 *
 * 1) **账本之间不许互相冒充，也不许互相作废**。三本账各写各的；一趟检查失败**不作废**
 *    上一趟读出来的那一颗资产——「今天没网」和「昨天那个包不算数」是两件事，
 *    把它们连起来的结果是用户离线时连已经下好的包都装不了。
 *    反过来，`download` 失败也不动 `ready` 那本账：装之前会重算字节，账本身没必要提前作废。
 * 2) **判据的顺序就是成本的顺序**。`install` 这一段：认版本（内存里的比较）→ 问内核
 *    （一个布尔）→ 查文件在不在（一次 stat）→ 重算 sha256（读 290 MB）→ 起进程。
 *    把 `core-running` 排在哈希之后，等于每次都先替用户读全盘、再告他「不能装」。
 * 3) **在途去重分两种，答案不一样**：同一段的第二次点击**并入那一趟**（两个人拿到同一份
 *    结果，而不是开出两条连接去下同一个 290 MB）；跨段的点击回 `in-flight`，
 *    并且**不写进账本**——`phase` 已经说了「正在走哪一段」，再往检查那本里塞一条
 *    「检查失败」是把「你没等到」记成「它败了」。
 * 4) **`launched` 之后才退出，`launch-failed` 时绝对不退出**。安装器没起来是唯一一档
 *    「什么都没发生」的败：App 还在原地、包还在盘上、用户还能再点一次。
 *    反过来的形状是退出码 0、猫没了、什么都没装。
 *
 * 另两条边界：排程那一条链**只走检查**（spec D3「只检查不自动下载」，一条负判据尺钉着）；
 * 落盘只写 `<userData>/update/settings.json` 这一颗，Verge 的目录一个字节都不碰。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ClientCheckOutcome,
  type ClientCheckReceipt,
  type ClientDownloadOutcome,
  type ClientDownloadReceipt,
  type ClientInstallOutcome,
  type ClientInstallReceipt,
  type ClientUpdatePhase,
  type ClientUpdateReason,
  type ClientUpdateState,
} from "../../shared/client-update-types";
import { renameWithRetrySync } from "../storage/rename-with-retry";
import { isAllowedUpdateUrl } from "../verge/core-source";
import { type FetchLike } from "../verge/subscription-fetch";
import { CLIENT_RELEASE_API_URL, decideClientCheck, type ClientAssetPick } from "./github-release";
import { CLIENT_USER_AGENT, type InstallerDownloader } from "./installer-download";
import type { InstallerLauncher } from "./installer-launch";

/** spec D3「启动后 90s 一次」：错开开机那一团（窗口、内核、订阅），也别慢到像没安排。 */
export const CLIENT_UPDATE_FIRST_DELAY_MS = 90_000;
/** spec D3「之后每 6h」。匿名 60 次/时的配额对这一档绰绰有余（每 6h 才花 1 次）。 */
export const CLIENT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 发布页只是一份 JSON：这一档用总时长（不是静默超时），到点就当没问到。 */
export const CLIENT_RELEASE_TIMEOUT_MS = 30_000;
export const CLIENT_RELEASE_MAX_REDIRECTS = 5;

/** 只存这一颗：账本不落盘（见 `client-update-types.ts` 里 `currentVersion` 那段）。 */
export const CLIENT_UPDATE_SETTINGS_FILE = path.join("update", "settings.json");

/** 安装包的**正名**：从我们自己的版本号推出来，不从 JSON 里的 `assets[].name` 抄。 */
export function installerNameFor(version: string): string {
  return `Mochi-Setup-${version}.exe`;
}

export interface ReadyPackage {
  version: string;
  fileName: string;
  bytes: number;
  /** 下载时核对上的那枚 sha256；装之前再用它重算一遍。 */
  digest: string;
}

/* ------------------------------------------------------------ 设置那一条线 */

export interface ClientUpdateSettings {
  autoCheck: boolean;
}

/**
 * 默认**开**。这条通道是 P4「断掉上游更新」的替代物，默认关就等于装着一条没人按的更新通道；
 * 而关与开都只影响排程那一条链，手动按钮任何时候都能用（spec D3）。
 */
export const DEFAULT_CLIENT_UPDATE_SETTINGS: ClientUpdateSettings = { autoCheck: true };

export interface SettingsIo {
  mkdir(dir: string): void;
  read(file: string): string | null;
  /** 原子写；败了抛出去，由 `save` 归成一句能说的话。 */
  write(file: string, text: string): void;
}

export interface ClientUpdateSettingsStore {
  load(): ClientUpdateSettings;
  save(next: ClientUpdateSettings): { ok: boolean; detail: string | null };
  path(): string;
}

export const nodeSettingsIo: SettingsIo = {
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  read: (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  write: (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameWithRetrySync(tmp, file);
  },
};

export function createSettingsStore(
  settingsPath: () => string,
  io: SettingsIo = nodeSettingsIo,
  log: (line: string) => void = () => {},
): ClientUpdateSettingsStore {
  return {
    path: settingsPath,
    load(): ClientUpdateSettings {
      const raw = io.read(settingsPath());
      if (raw === null) return { ...DEFAULT_CLIENT_UPDATE_SETTINGS };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 读不懂就当没存过：这种文件坏掉不该让整条通道起不来，下一次 save 会把它盖回合法形状。
        log(`更新设置读不懂，按默认走：${settingsPath()}`);
        return { ...DEFAULT_CLIENT_UPDATE_SETTINGS };
      }
      const value = (parsed as { autoCheck?: unknown })?.autoCheck;
      if (typeof value !== "boolean") {
        log(`更新设置里的 autoCheck 不是布尔（${String(value)}），按默认走`);
        return { ...DEFAULT_CLIENT_UPDATE_SETTINGS };
      }
      return { autoCheck: value };
    },
    save(next: ClientUpdateSettings): { ok: boolean; detail: string | null } {
      try {
        io.write(settingsPath(), JSON.stringify(next, null, 2));
        return { ok: true, detail: null };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/* ------------------------------------------------------------ 发布页那一条 */

/** 出口闸门拒掉的那一趟：归 `wrong-source`，不归 `network-failed`（要用户做的事不同）。 */
export class ReleaseEgressRefused extends Error {}

export interface ReleaseFetchOptions {
  url?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRedirects?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

/**
 * 读 `releases/latest` 那一份 JSON。
 *
 * 与内核通道那份 `createUpdateNetwork` 各写一次逐跳是刻意的：那一份带着内核的 UA、
 * 内核的失败归类（只有一档 `download-failed`）与 22 MB 的读法，共用一把尺的结果是
 * 两边的话术互相串。这里只保留同一件**规则**：闸门在发请求之前过、每一跳都再过一次。
 */
export function createReleaseFetcher(options: ReleaseFetchOptions = {}): () => Promise<unknown> {
  const startUrl = options.url ?? CLIENT_RELEASE_API_URL;
  const doFetch = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? CLIENT_RELEASE_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? CLIENT_RELEASE_MAX_REDIRECTS;

  return async (): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = startUrl;
      let hops = 0;
      for (;;) {
        if (!isAllowedUpdateUrl(current, "release")) {
          throw new ReleaseEgressRefused(`发布页不在白名单，一个请求都没发：${hostOf(current)}`);
        }
        let res: Awaited<ReturnType<FetchLike>>;
        try {
          res = await doFetch(current, {
            redirect: "manual",
            signal: controller.signal,
            headers: { "user-agent": CLIENT_USER_AGENT, accept: "application/vnd.github+json" },
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(`${Math.round(timeoutMs / 1000)} 秒没等到发布页：${hostOf(current)}`);
          }
          throw new Error(`发布页请求没回来：${messageOf(error)}`);
        }
        if (res.status >= 300 && res.status < 400) {
          if (hops >= maxRedirects) throw new Error(`发布页跳转超过 ${maxRedirects} 跳：${hostOf(current)}`);
          const location = res.headers.get("location");
          if (!location) throw new Error(`发布页 ${res.status} 说要跳转但没给地址`);
          try {
            current = new URL(location, current).toString();
          } catch {
            throw new Error(`发布页给的跳转地址读不出：${location}`);
          }
          hops += 1;
          continue;
        }
        if (!res.ok) throw new Error(`发布页 HTTP ${res.status}（${hostOf(current)}）`);
        const text = await res.text();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Error("发布页回来的不是 JSON");
        }
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

/* ------------------------------------------------------------------ 状态机 */

export interface ClientUpdateServiceDeps {
  /** `app.getVersion()`：每次现读，不落盘、不记账（见 `ClientUpdateState` 的注释）。 */
  currentVersion(): string;
  downloader: InstallerDownloader;
  launcher: InstallerLauncher;
  /** 读发布页 JSON；注入点是给单测与真窗验收留的（假 GitHub 服务器）。 */
  getRelease?(): Promise<unknown>;
  settingsPath?(): string;
  settingsIo?: SettingsIo;
  /** 我们自己那颗内核在不在跑（`isOwnCoreMode(mode) && state !== "stopped"`）。外部/安装版那颗不算。 */
  coreIsRunning(): boolean;
  /** 安装器起来之后由装配层调用：走的是 App 的正常退出，好让协作退出与代理还原跑完。 */
  quitApp(): void;
  /** 注入计时器：单测里换成一个能手动拨的假闹钟。返回撤销那一只的函数。 */
  schedule?(run: () => void, ms: number): () => void;
  now?(): number;
  log?(line: string): void;
}

export interface ClientUpdateService {
  state(): ClientUpdateState;
  check(): Promise<ClientCheckReceipt>;
  download(): Promise<ClientDownloadReceipt>;
  install(): Promise<ClientInstallReceipt>;
  setAutoCheck(on: boolean): { ok: boolean; detail: string | null };
  /** 启动清扫 `.part` + 按 autoCheck 排第一条链；回本趟扫掉了哪些。 */
  start(): string[];
  stop(): void;
}

const PHASE_WORD: Record<ClientUpdatePhase, string> = {
  idle: "空闲",
  checking: "检查",
  downloading: "下载",
  installing: "安装",
};

export function createClientUpdateService(deps: ClientUpdateServiceDeps): ClientUpdateService {
  const now = deps.now ?? ((): number => Date.now());
  const log = deps.log ?? (() => {});
  const getRelease = deps.getRelease ?? createReleaseFetcher();
  const doSchedule = deps.schedule ?? ((run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  const settings = createSettingsStore(
    deps.settingsPath ?? (() => path.join(path.dirname(deps.downloader.dir()), CLIENT_UPDATE_SETTINGS_FILE)),
    deps.settingsIo ?? nodeSettingsIo,
    log,
  );

  let autoCheck = settings.load().autoCheck;
  let phase: ClientUpdatePhase = "idle";
  let check: ClientCheckReceipt | null = null;
  let download: ClientDownloadReceipt | null = null;
  let install: ClientInstallReceipt | null = null;
  /** 最近一次**读得出来**的那一颗资产（`available` 才有；失败那一趟不许作废它）。 */
  let asset: ClientAssetPick | null = null;
  /** 盘上已经存在、且摘要核对过的那一颗。 */
  let ready: ReadyPackage | null = null;

  let checkInflight: Promise<ClientCheckReceipt> | null = null;
  let downloadInflight: Promise<ClientDownloadReceipt> | null = null;
  let installInflight: Promise<ClientInstallReceipt> | null = null;
  let cancelTimer: (() => void) | null = null;
  /** `stop()` 之后那条链不许自己再上弦：在途那一趟的 `.finally` 会排出一颗 6 小时的闹钟，而进程已经在退出了。 */
  let stopped = false;

  const inFlightPhase = (): ClientUpdatePhase | null =>
    installInflight ? "installing" : downloadInflight ? "downloading" : checkInflight ? "checking" : null;

  const busyDetail = (busy: ClientUpdatePhase): string =>
    `已经有一趟在走了（正在${PHASE_WORD[busy]}），这一次没开新连接`;

  /* —— 三本账各自的写法。字节段的 `bytes` 在败时记 0：半包不落账。 —— */

  function writeCheck(
    outcome: ClientCheckOutcome,
    latestVersion: string | null,
    reason: ClientUpdateReason | null,
    detail: string | null,
  ): ClientCheckReceipt {
    const receipt: ClientCheckReceipt = { outcome, at: now(), latestVersion, reason, detail };
    check = receipt;
    log(`检查=${outcome}${latestVersion ? ` latest=${latestVersion}` : ""}${reason ? ` reason=${reason}` : ""}${detail ? ` — ${detail}` : ""}`);
    return receipt;
  }

  function writeDownload(
    outcome: ClientDownloadOutcome,
    version: string,
    fileName: string,
    bytes: number,
    reason: ClientUpdateReason | null,
    detail: string | null,
  ): ClientDownloadReceipt {
    const receipt: ClientDownloadReceipt = { outcome, at: now(), version, fileName, bytes, reason, detail };
    download = receipt;
    log(`下载=${outcome} ${fileName}${bytes ? ` ${bytes}B` : ""}${reason ? ` reason=${reason}` : ""}${detail ? ` — ${detail}` : ""}`);
    return receipt;
  }

  function writeInstall(
    outcome: ClientInstallOutcome,
    version: string,
    reason: ClientUpdateReason | null,
    detail: string | null,
  ): ClientInstallReceipt {
    const receipt: ClientInstallReceipt = { outcome, at: now(), version, reason, detail };
    install = receipt;
    log(`安装=${outcome} ${version}${reason ? ` reason=${reason}` : ""}${detail ? ` — ${detail}` : ""}`);
    return receipt;
  }

  /** 在途那一档的字段仍按类型填满：取的是「手上这一版」，不是什么都不知道时的占位。 */
  const downloadSubject = (): { version: string; fileName: string } => {
    const version = asset?.version ?? deps.currentVersion();
    return { version, fileName: installerNameFor(version) };
  };
  const installSubject = (): string => ready?.version ?? asset?.version ?? deps.currentVersion();

  /* ------------------------------------------------------------------ 检查 */

  async function performCheck(): Promise<ClientCheckReceipt> {
    phase = "checking";
    try {
      const currentVersion = deps.currentVersion();
      let release: unknown;
      try {
        release = await getRelease();
      } catch (error) {
        const reason: ClientUpdateReason = error instanceof ReleaseEgressRefused ? "wrong-source" : "network-failed";
        return writeCheck("failed", null, reason, messageOf(error));
      }
      const decision = decideClientCheck(release, currentVersion);
      if (decision.outcome === "available" && decision.asset) {
        asset = decision.asset;
      } else if (decision.outcome === "latest") {
        // 发布页那版不比我们新：这一档没有可下的东西，但**已经核对过的包**（ready）留着。
        asset = null;
      }
      // failed：这一趟什么都没读出来，所以它没有资格改动上一趟读出来的东西。
      return writeCheck(decision.outcome, decision.latestVersion, decision.reason, decision.detail);
    } finally {
      phase = "idle";
    }
  }

  /* ------------------------------------------------------------------ 下载 */

  async function performDownload(): Promise<ClientDownloadReceipt> {
    phase = "downloading";
    try {
      // `asset` 是个被兄弟函数改过的闭包变量，TS 不替它收窄：一次取进局部量再判。
      let pick: ClientAssetPick | null = asset;
      if (pick === null) {
        const first = await performCheck();
        pick = asset;
        if (pick === null) {
          // 检查那本账已经说了它的话；这一本只说「没有东西可下」，把检查的下场原样带过来。
          // 「已是最新」在词表里不是失败，所以那一趟 reason 是 null——页面读的是 detail。
          return writeDownload(
            "failed",
            deps.currentVersion(),
            installerNameFor(deps.currentVersion()),
            0,
            first.reason,
            first.outcome === "latest"
              ? `发布页那版（${first.latestVersion ?? "?"}）不比本机新，没有要下的安装包`
              : `先检查这一步就没走过去：${first.detail ?? first.outcome}`,
          );
        }
      }
      const digest = pick.digest;
      if (digest === null) {
        return writeDownload("failed", pick.version, installerNameFor(pick.version), 0, "digest-missing", `${pick.name} 没带 sha256 凭据，一个字节都不下`);
      }
      const fileName = installerNameFor(pick.version);

      // 先认盘上那一颗：上一趟下好的还在、摘要也对得上，就不必再吃 290 MB 的下行。
      const onDisk = deps.downloader.sizeOf(fileName);
      if (onDisk !== null && onDisk > 0) {
        const got = await deps.downloader.digestOf(fileName);
        if (got === digest) {
          ready = { version: pick.version, fileName, bytes: onDisk, digest };
          return writeDownload("ready", pick.version, fileName, onDisk, null, `盘上已有 ${fileName}，sha256 与发布页给的那枚对得上——没有重新下载`);
        }
        log(`盘上那份 ${fileName} 的摘要对不上（${got ? `${got.slice(0, 12)}…` : "读不出"}），重下一趟`);
      }

      const result = await deps.downloader.download({
        fileName,
        downloadUrl: pick.downloadUrl,
        digest,
        version: pick.version,
      });
      if (result.ok) {
        ready = { version: pick.version, fileName: result.fileName, bytes: result.bytes, digest };
        return writeDownload("ready", pick.version, result.fileName, result.bytes, null, null);
      }
      // 败了这一趟不动 ready：`.part` 当场删掉了、正名从没被写过，盘上那份仍是它原本的样子。
      // 「能不能装」由 install 那一段重算字节来判，而不是由这里提前作废。
      return writeDownload("failed", pick.version, result.fileName, 0, result.reason, result.detail);
    } finally {
      phase = "idle";
    }
  }

  /* ------------------------------------------------------------------ 安装 */

  async function performInstall(): Promise<ClientInstallReceipt> {
    phase = "installing";
    try {
      if (ready === null) {
        return writeInstall("failed", installSubject(), "no-package", "手上没有已核对的安装包：先点下载");
      }
      const subject = ready;
      if (asset !== null && asset.version !== subject.version) {
        return writeInstall(
          "failed",
          subject.version,
          "stale-package",
          `包是 ${subject.version}，检查认下的却是 ${asset.version}——先重新下载 ${asset.version}`,
        );
      }
      // 内核闸门排在读盘之前：这一段最贵的是重算 sha256，明知不能装还先读 290 MB 是替用户花时间。
      if (deps.coreIsRunning()) {
        return writeInstall(
          "failed",
          subject.version,
          "core-running",
          "我们自己那颗内核还在跑：先在「内核」卡片里停掉再装——安装器会硬关掉这个 App，协作退出跑不到，代理与端口会留在原地没人收",
        );
      }
      const size = deps.downloader.sizeOf(subject.fileName);
      if (size === null || size <= 0) {
        ready = null;
        return writeInstall("failed", subject.version, "no-package", `${subject.fileName} 已经不在盘上了（被清理或移走），重新下载一次`);
      }
      // 装之前重算一遍：下载核对与点击安装之间可能隔着几天，那颗文件被人动过是完全可能的。
      const got = await deps.downloader.digestOf(subject.fileName);
      if (got !== subject.digest) {
        ready = null;
        return writeInstall(
          "failed",
          subject.version,
          "stale-package",
          `${subject.fileName} 的 sha256 与下载时核对的不是同一个（${got ? `${got.slice(0, 12)}…` : "读不出"} ≠ ${subject.digest.slice(0, 12)}…）——不许拿它冒充新升级`,
        );
      }

      const launched = await deps.launcher.launch(deps.downloader.filePathOf(subject.fileName));
      if (!launched.ok) {
        // 唯一一档「什么都没发生」：App 必须还在原地，用户还能再点一次。
        return writeInstall("failed", subject.version, "launch-failed", launched.detail);
      }
      const receipt = writeInstall(
        "launched",
        subject.version,
        null,
        `安装器已起来（pid ${launched.pid ?? "?"}）。「装好了」这一句我们看不见——下一次启动读到的版本号才是凭据`,
      );
      try {
        deps.quitApp();
      } catch (error) {
        log(`安装器起来了但退出没走顺：${messageOf(error)}`);
      }
      return receipt;
    } finally {
      // 起来之后我们已经不在原地了；这一行只在败的那几趟里真的执行到。
      phase = "idle";
    }
  }

  /* ------------------------------------------------------------------ 排程 */

  function arm(delayMs: number): void {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    if (!autoCheck || stopped) return;
    cancelTimer = doSchedule(() => {
      void service
        .check()
        .finally(() => arm(CLIENT_UPDATE_INTERVAL_MS));
    }, delayMs);
  }

  const service: ClientUpdateService = {
    state(): ClientUpdateState {
      return {
        currentVersion: deps.currentVersion(),
        autoCheck,
        phase,
        check: check ? { ...check } : null,
        download: download ? { ...download } : null,
        install: install ? { ...install } : null,
      };
    },

    check() {
      if (checkInflight) return checkInflight;
      const busy = inFlightPhase();
      if (busy) {
        // 不写账：`phase` 已经说了正在走哪一段，把「你没等到」记成「检查败了」是编一本假账。
        return Promise.resolve({ outcome: "failed", at: now(), latestVersion: null, reason: "in-flight", detail: busyDetail(busy) } satisfies ClientCheckReceipt);
      }
      const inflight = performCheck().finally(() => {
        if (checkInflight === inflight) checkInflight = null;
      });
      checkInflight = inflight;
      return inflight;
    },

    download() {
      if (downloadInflight) return downloadInflight;
      const busy = inFlightPhase();
      if (busy) {
        const subject = downloadSubject();
        return Promise.resolve({
          outcome: "failed",
          at: now(),
          version: subject.version,
          fileName: subject.fileName,
          bytes: 0,
          reason: "in-flight",
          detail: busyDetail(busy),
        } satisfies ClientDownloadReceipt);
      }
      const inflight = performDownload().finally(() => {
        if (downloadInflight === inflight) downloadInflight = null;
      });
      downloadInflight = inflight;
      return inflight;
    },

    install() {
      if (installInflight) return installInflight;
      const busy = inFlightPhase();
      if (busy) {
        return Promise.resolve({
          outcome: "failed",
          at: now(),
          version: installSubject(),
          reason: "in-flight",
          detail: busyDetail(busy),
        } satisfies ClientInstallReceipt);
      }
      const inflight = performInstall().finally(() => {
        if (installInflight === inflight) installInflight = null;
      });
      installInflight = inflight;
      return inflight;
    },

    setAutoCheck(on: boolean) {
      autoCheck = on;
      // 关掉就撤销这一条链；打开重新从 90s 起排——不为「刚勾上」立刻打一枪 api.github.com。
      // `arm` 自己会看 `autoCheck`，所以关掉那一路只是撤销，不会排出一颗新的。
      arm(CLIENT_UPDATE_FIRST_DELAY_MS);
      const saved = settings.save({ autoCheck: on });
      if (!saved.ok) log(`自动检查的开关没能存住（这次会话里有效，重启后回到默认）：${saved.detail}`);
      return saved;
    },

    start() {
      const swept = deps.downloader.sweepParts();
      if (swept.length) log(`启动清扫：删掉 ${swept.length} 个半包（${swept.join(", ")}）`);
      stopped = false;
      arm(CLIENT_UPDATE_FIRST_DELAY_MS);
      return swept;
    },

    stop() {
      stopped = true;
      if (cancelTimer) {
        cancelTimer();
        cancelTimer = null;
      }
    },
  };

  return service;
}

/**
 * Wave 4 T12d：客户端更新的装配层——把状态机接到真盘、真 fetch、真进程上。
 *
 * 判定在 `update-service`，字节在 `installer-download`，安装器那一下在 `installer-launch`；
 * 这一层只有接线，而接线上有三条只有这里会答错的问题：
 *
 * 1) **「能不能装」问的是内存里那颗进程，不是盘上的状态文件**。`ownCoreIsLive` 的口径与
 *    `core-bootstrap` 的 `canSwap`、内核卡片那两颗会 kill 进程的按钮是同一件事：只有 `running`
 *    与 `starting` 才是「我们 spawn 出来、现在还活着的那一颗」。`exited`（崩了、或自愈打完之后
 *    停在原地）与 `blocked`（压根没起）都不该拦住安装——把它们算成「还在跑」，用户就得先在
 *    内核卡片里点一次「停止」才能升级，而那一下什么进程都没关，纯粹是我们自己造出来的一道墙。
 *    `external` 那颗不归我们（`isOwnCoreMode`），安装器动不到它，跟着一起挡就等于拿
 *    Verge 在不在跑决定我们升不升级。
 * 2) **写面只有两处**：`<userData>/updates/`（安装包与 `.part`）与 `<userData>/update/settings.json`
 *    （唯一落盘的那一颗 `autoCheck`）。Verge 的目录一个字节都不碰（spec D2）。
 * 3) **退出走的是 App 的正常退出**。`quitApp` 给的是 `() => app.quit()`：`before-quit` 会拉起
 *    受控退出，固定阶段清理（含内核收口与代理还原）跑完之后进程才没。绕开它去 `process.exit()`
 *    的形状是「升级装完了，系统代理还指着我们那颗内核的端口」。
 *
 * 注入点（`getRelease`／`fetchImpl`／`spawnImpl`／`schedule`／`now`）是给 T14 的真窗验收留的：
 * 那一趟要在本机把「有更新 / 无更新 / 摘要不符 / 网络失败」四档连起来跑，而出口白名单不会放行
 * 一台假服务器——所以假的是这两条出口，不是白名单本身。
 */
import path from "node:path";
import { UPDATE_DIR_NAME } from "../../shared/client-update-types";
import { isOwnCoreMode, type CoreStatus } from "../../shared/core-types";
import type { FetchLike } from "../verge/subscription-fetch";
import { createInstallerDownloader, type DownloadFs } from "./installer-download";
import { createInstallerLauncher, type SpawnInstaller } from "./installer-launch";
import {
  CLIENT_UPDATE_SETTINGS_FILE,
  createClientUpdateService,
  type ClientUpdateService,
  type SettingsIo,
} from "./update-service";

/** 我们那颗内核此刻活着吗——只有这一档会拦住安装（见文件头 ①）。 */
export function ownCoreIsLive(status: CoreStatus): boolean {
  return isOwnCoreMode(status.mode) && (status.state === "running" || status.state === "starting");
}

export interface ClientUpdateAssemblyOptions {
  /** 本客户端的 userData：`updates/` 与 `update/settings.json` 都在这儿，不进 Verge 目录。 */
  userData: string;
  /** `app.getVersion()`：每次现读，不落盘、不记账。 */
  currentVersion(): string;
  /** 内核宿主当下那份账（内存里的，不是状态文件）。 */
  coreStatus(): CoreStatus;
  /** 安装器起来之后发起的退出：必须是受控退出那一条（`() => app.quit()`）。 */
  quitApp(): void;
  log?(line: string): void;
  /** 读发布页 JSON 的那一条出口；不给就用真的 fetch，每一跳都过出口闸门。 */
  getRelease?(): Promise<unknown>;
  fetchImpl?: FetchLike;
  /** 起安装器那一下。默认 `child_process.spawn`，注入给单测与真窗验收。 */
  spawnImpl?: SpawnInstaller;
  /** 安装包落盘的那点盘上动作。默认落到真盘，注入给单测。 */
  downloadFs?: DownloadFs;
  /** 设置那颗的读写。默认落到真盘，注入给单测。 */
  settingsIo?: SettingsIo;
  schedule?(run: () => void, ms: number): () => void;
  now?(): number;
}

export interface ClientUpdateAssembly {
  /** 状态机本体：五条通道、启动清扫与排程吃的都是它。 */
  service: ClientUpdateService;
  updatesDir(): string;
  /** 除 `updatesDir()` 之外唯一会落盘的一颗文件。 */
  settingsFile(): string;
}

export function createClientUpdateAssembly(options: ClientUpdateAssemblyOptions): ClientUpdateAssembly {
  const log = options.log ?? (() => {});
  const updatesDir = () => path.join(options.userData, UPDATE_DIR_NAME);
  const settingsFile = () => path.join(options.userData, CLIENT_UPDATE_SETTINGS_FILE);

  const downloader = createInstallerDownloader({
    updatesDir,
    fetchImpl: options.fetchImpl,
    fs: options.downloadFs,
    log: (line) => log(`下载 ${line}`),
  });
  const launcher = createInstallerLauncher({
    spawnImpl: options.spawnImpl,
    log: (line) => log(`安装器 ${line}`),
  });

  const service = createClientUpdateService({
    currentVersion: options.currentVersion,
    downloader,
    launcher,
    settingsPath: settingsFile,
    settingsIo: options.settingsIo,
    coreIsRunning: () => ownCoreIsLive(options.coreStatus()),
    quitApp: options.quitApp,
    getRelease: options.getRelease,
    schedule: options.schedule,
    now: options.now,
    log,
  });

  return { service, updatesDir, settingsFile };
}

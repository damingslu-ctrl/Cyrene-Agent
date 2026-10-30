/**
 * 内核宿主的装配层（Wave 3 T10b）：把 `core-manager` 那八个注入点接到真盘、真进程、真控制器上。
 *
 * 判据在 `core-manager` / `core-source` 那两层用假端口已经钉死了；这一层只证接线，
 * 而接线上有三条只有这里能判断错的线：
 *
 * 1) **口令跟着数据面走，不跟着我们高兴**。整条数据面（网络页、订阅页、桌宠那条兼容端点）
 *    的地址与口令都来自 Verge 那本 `clash-verge.yaml`。本机实测那本账上写的是
 *    `secret: set-your-secret`——15 个字符，既不是十六进制也不是随机串，是 Verge 的出厂占位值。
 *    我们若嫌它「不成形状」而自己生成一枚，起来的这颗内核就会把数据面挡在 401 外面：
 *    进程在跑、端口在听、页面一句错误都没有，只是全瞎。所以**账上那枚原样用**，
 *    读不到口令（没有那本账、或那把键是空的）才用自己那枚存在 `<userData>/core/secret` 的。
 * 2) **端口也一样跟着那本账走**。`external-controller` 声明 9097、`mixed-port` 声明 7896，
 *    首选档就是这一组；撞上去了才退到扫描段，并把真实端口通过 `controllerOverride()`
 *    交给数据面——否则「起了内核」与「页面看得见内核」是两件事，用户只看到前者成功。
 * 3) **覆写只在我们自己那颗活着的时候生效**。判据是管理器内存里那份当下状态
 *    （`running` 且 mode 不是 external），不是盘上的状态文件：文件会留在原地骗人
 *    （进程早没了、或者 Verge 自己又把内核起回了 9097），内存里那份账不会。
 *
 * 另有一条纪律：这一层不写 Verge 的任何文件。读它的 `clash-verge.yaml` 与 `profiles.yaml`，
 * 写只写我们自己的 `runtime/core.yaml`、`core/secret`、`core.log`（spec D2 的边界）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CORE_LOG_FILE,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MIXED_PORT,
  isOwnCoreMode,
  type CorePortPair,
  type CoreStatus,
} from "../../shared/core-types";
import { readControllerConfig, type ControllerConfig } from "./controller-config";
import { createCoreLogSink } from "./core-log";
import { createCoreManager, type CoreChild, type CoreManager } from "./core-manager";
import { createUsedPortsProbe } from "./core-ports";
import { bundledExePath, controllerPortOf, coreDirOf, pickInstalledBinary } from "./core-source";
import { buildCoreRuntime } from "./core-runtime";
import { createCoreSecretStore } from "./core-secret";
import { createProfileStore } from "./profile-store-port";
import type { ProfileStorePort } from "./profile-service";
import { createVergeRunningProbe } from "./verge-process";

/** 控制器敲门的等待：只问「有没有人在听」，等久了也不会变出答案。 */
export const CONTROLLER_PROBE_TIMEOUT_MS = 1500;

/** 安装版 Verge 把内核放在这几处；按顺序找，第一个有合格文件的目录算数。 */
export function installedCoreDirs(env: NodeJS.ProcessEnv): string[] {
  const bases = [
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"],
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs") : null,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set(bases.map((base) => path.join(base, "Clash Verge")))];
}

/**
 * 控制器是否在听。
 *
 * **任何 HTTP 应答都算在听**，包括 401：口令不对不等于那儿没进程。把 401 判成「没人」，
 * external 态就永远立不起来，我们会在同一台机器上再 spawn 第二颗内核去抢同一个端口。
 */
export function createControllerProbe(options: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): (url: string) => Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? CONTROLLER_PROBE_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  return async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await doFetch(`${url.replace(/\/+$/, "")}/version`, { signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * `ChildProcess` → 管理器要的那只窄口。
 *
 * `pid` 拿不到就当成失败：一颗连 pid 都给不出来的进程，我们既停不掉它也报不出它，
 * 让它进账等于留下一颗没人管的内核占着端口。
 */
export function toCoreChild(child: ChildProcess, onError?: (detail: string) => void): CoreChild {
  const pid = child.pid;
  if (typeof pid !== "number") {
    try {
      child.kill();
    } catch {
      /* 本来就没起来 */
    }
    throw new Error("spawn 没回 pid");
  }
  if (onError) {
    // ENOENT（那颗粒子根本不存在）在 Node 里是异步 'error' 事件，不会让 spawn() 当场抛。
    // 不接住它，core.log 里就只剩「控制器不应答」这句废话，真正那句「找不到文件」永远看不见。
    child.on("error", (error) => onError(error instanceof Error ? error.message : String(error)));
  }
  return {
    pid,
    stdout: child.stdout,
    stderr: child.stderr,
    on: (event, listener) => {
      child.on(event, listener);
      return undefined;
    },
    kill: (signal) => child.kill(signal),
  };
}

export interface CoreAssemblyOptions {
  /** Verge 的数据目录：读它的 `clash-verge.yaml`（地址与口令）与 `profiles.yaml`（正文）。 */
  getConfigRoot(): string | null;
  /** 本客户端的 userData：`core/`、`runtime/core.yaml`、`core.log` 都在这儿，不进 Verge 目录。 */
  userData: string;
  isVergeRunning?(): boolean;
  usedPorts?(): number[];
  spawnCore?(exePath: string, args: string[], cwd: string, onError: (detail: string) => void): CoreChild;
  probeController?(url: string): Promise<boolean>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  readdir?(dir: string): string[];
  exists?(file: string): boolean;
  now?(): number;
}

export interface CoreAssembly {
  manager: CoreManager;
  status(): CoreStatus;
  /**
   * 数据面该用哪个控制器。非 null 的条件只有一个：**那颗内核是我们起的并且现在活着**。
   * 其余时候（external / 没起 / 起了又崩在自愈路上）一律回 null，让数据面按盘上那本账走。
   */
  controllerOverride(): ControllerConfig | null;
  /** 口令的来源：`verge` ＝那本账上读回来的，`mochi` ＝我们自己生成并存的，`none` ＝还没起过。 */
  secretSource(): "verge" | "mochi" | "none";
  /** 这班内核吃的那份 runtime 配置路径；还没写过配置就是 null（页面不必画，故障上报要用）。 */
  runtimeFile(): string | null;
  logFile(): string;
  coreDir(): string;
}

export function createCoreAssembly(options: CoreAssemblyOptions): CoreAssembly {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const readdir = options.readdir ?? defaultReaddir;
  const isVergeRunning = options.isVergeRunning ?? createVergeRunningProbe();
  const usedPorts = options.usedPorts ?? createUsedPortsProbe();
  const probeController = options.probeController ?? createControllerProbe({ fetchImpl: options.fetchImpl });
  const spawnCore = options.spawnCore ?? defaultSpawnCore;
  const now = options.now ?? (() => Date.now());

  const coreDir = () => coreDirOf(options.userData);
  const logFile = () => path.join(options.userData, CORE_LOG_FILE);

  /** 已知口令都登记在这里，写日志前逐条打码——包括从 Verge 账上读回来的那一枚。 */
  const knownSecrets = new Set<string>();
  const sink = createCoreLogSink({ filePath: logFile, secrets: () => knownSecrets });
  // 管理器的 appendLog 自带时间戳，装配层自己这几句得补上：一份日志两种行首没人愿意读。
  const appendLog = (line: string): void => {
    try {
      sink.write(line);
    } catch {
      console.warn(`[core] 写 ${CORE_LOG_FILE} 失败`);
    }
  };
  const note = (text: string): void => {
    appendLog(`${new Date(now()).toISOString()} 装配 ${text}`);
  };

  const secretStore = createCoreSecretStore({ filePath: () => path.join(coreDir(), "secret") });

  /** 那本账每次现读（`readControllerConfig` 自带 mtime 缓存）：目录会在用户手上搬家。 */
  const vergeConfig = (): ControllerConfig | null => {
    const result = readControllerConfig(options.getConfigRoot());
    if (!result.ok) return null;
    if (result.config.secret) knownSecrets.add(result.config.secret);
    return result.config;
  };

  let secretSource: "verge" | "mochi" | "none" = "none";
  /** 这一班内核配置里真正写进去的那一枚；覆写给数据面的就是它，不会再解第二次。 */
  let injectedSecret = "";
  let runtimeConfigFile: string | null = null;

  const resolveSecret = (): string => {
    const declared = vergeConfig()?.secret?.trim();
    if (declared) {
      secretSource = "verge";
      injectedSecret = declared;
      return declared;
    }
    const fresh = secretStore();
    knownSecrets.add(fresh);
    secretSource = "mochi";
    injectedSecret = fresh;
    const warning = secretStore.warning();
    // 口令没落住只影响「下次重启会不会换一枚」，不值得拦住这一次起。
    if (warning) note(`警告：${warning}`);
    return fresh;
  };

  let cachedStore: { root: string; port: ProfileStorePort } | null = null;
  const profilePort = (): ProfileStorePort => {
    const root = options.getConfigRoot();
    if (root === null) throw new Error("没找到 Clash Verge 的数据目录，读不到订阅账本");
    if (!cachedStore || cachedStore.root !== root) {
      cachedStore = { root, port: createProfileStore({ configRoot: root, userData: options.userData }) };
    }
    return cachedStore.port;
  };

  const writeRuntimeConfig = (ports: CorePortPair): string => {
    const secret = resolveSecret();
    const built = buildCoreRuntime({ port: profilePort(), ports, secret });
    if (!built.ok) {
      // reason 排在最前：这一串会原样进 `detail`，页面按它给文案，日志按它排序。
      throw new Error(`${built.reason}：${built.detail}`);
    }
    for (const uid of built.warnings) {
      note(`merge 项 ${uid} 读不出来或不是 map，这一次没并进配置`);
    }
    runtimeConfigFile = built.file;
    note(
      `runtime 配置已写 ${path.basename(built.file)} 订阅=${built.uid}`
      + `${built.name ? `（${built.name}）` : ""} 口令来源=${secretSource}`,
    );
    return built.file;
  };

  const findInstalledExe = (): string | null => {
    for (const dir of installedCoreDirs(env)) {
      const name = pickInstalledBinary(readdir(dir));
      if (name) return path.join(dir, name);
    }
    return null;
  };

  const findBundledExe = (): string | null => {
    const file = bundledExePath(options.userData);
    return exists(file) ? file : null;
  };

  const manager = createCoreManager({
    isVergeRunning,
    // external 的地址只认那本账：没有它就没有「Verge 那一侧的控制器」这件事可言。
    externalController: () => vergeConfig()?.baseUrl ?? null,
    probeController,
    findInstalledExe,
    findBundledExe,
    usedPorts,
    preferredPorts: () => {
      const config = vergeConfig();
      if (!config) return null;
      const controller = controllerPortOf(config.baseUrl);
      if (controller === null && config.mixedPort === null) return null;
      return {
        mixed: config.mixedPort ?? DEFAULT_MIXED_PORT,
        controller: controller ?? DEFAULT_CONTROLLER_PORT,
      };
    },
    coreDir,
    writeRuntimeConfig,
    spawn: (exePath, args) => {
      // `-d` 不会自己造目录，而 geo/cache 必须落在我们这一侧；建不出来就交给 spawn，
      // cwd 无效那句错误比这里包一层重试更有说服力。
      const dir = coreDir();
      if (!exists(dir)) ensureCoreDir(dir);
      return spawnCore(exePath, args, dir, (detail) => note(`spawn error：${detail}`));
    },
    appendLog,
    now,
  });

  /** 我们自己那颗此刻落在哪一组端口上；不在跑就是 null。 */
  const ownPorts = (): CorePortPair | null => {
    const status = manager.status();
    if (status.state !== "running" || !isOwnCoreMode(status.mode)) return null;
    return status.ports;
  };

  return {
    manager,
    status: () => manager.status(),
    controllerOverride() {
      const ports = ownPorts();
      if (!ports) return null;
      return {
        // 与 `core-manager` 敲门那个地址同一个写法：主机段钉死在 loopback。
        baseUrl: `http://127.0.0.1:${ports.controller}`,
        secret: injectedSecret,
        mixedPort: ports.mixed,
        sourcePath: runtimeConfigFile ?? logFile(),
      };
    },
    secretSource: () => secretSource,
    runtimeFile: () => runtimeConfigFile,
    logFile,
    coreDir,
  };
}

/** `-d` 那一层：内核的 geo 库、缓存与临时文件都落在这里。 */
function ensureCoreDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* 交给 spawn 报 cwd 无效 */
  }
}

function defaultReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function defaultSpawnCore(
  exePath: string,
  args: string[],
  cwd: string,
  onError: (detail: string) => void,
): CoreChild {
  const child = spawn(exePath, args, {
    cwd,
    // 内核是控制台程序：不盖这一层，每次起内核都会在用户桌面上闪出一个黑窗口。
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return toCoreChild(child, onError);
}

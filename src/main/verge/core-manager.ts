/**
 * v1.26 内核宿主（Wave 3 T10）：起、停、重启与崩溃自愈。
 *
 * 四条戒律，都是「错了要赔用户机器」那一类，判定全在这层用注入的假端口钉死：
 * - **可达即不动手**：控制器答话就是 external，绝不 spawn 第二颗——两颗内核抢同一套端口，
 *   输的那颗会在 core.log 里留下一串「address already in use」，而用户只看到代理时好时坏。
 * - **没起过的不许停**：external 态的 `stop()` 只把我们自己的账清掉，不发 kill。
 *   那顆进程是 Verge 的服务在跑，杀它是替用户关掉他在用的东西。
 * - **闸门在 spawn 之前**：`isVergeRunning()` 挡住时报 `blocked` + `verge-running`，
 *   连 runtime config 都不写——写了就是一枚没人吃的孤儿文件。
 * - **自愈有预算**：最多 `MAX_SELF_HEAL` 次，打满之后 `self-heal-exhausted` 只报原因，不再无限重起；
 *   撑过 `CORE_HEAL_RESET_MS` 才补满预算，否则连跑三天之后的那次崩溃就没钱可花了。
 *
 * 日志只落 `<userData>/core.log`，且**绝不含密钥**：runtime config 里我们会给内核塞一个
 * 自己生成的 controller secret，那玩意儿进日志等于把控制面口令写在盘上。
 */
import {
  CORE_LOG_FILE,
  EMPTY_CORE_STATUS,
  FALLBACK_PORT_START,
  MAX_SELF_HEAL,
  isOwnCoreMode,
  type CoreMode,
  type CorePortPair,
  type CoreStatus,
} from "../../shared/core-types";
import {
  buildCoreArgs,
  pickPortPair,
  resolveCoreSource,
  type CoreSource,
} from "./core-source";

/** 撑过这么久才把自愈预算补满：崩溃循环与偶发一次崩溃得区分开。 */
export const CORE_HEAL_RESET_MS = 60_000;
/** 等控制器答话的窗口；到点不应＝ `not-ready`，不演成「起来了」。 */
export const CORE_READY_TIMEOUT_MS = 8_000;

export interface CoreChild {
  pid: number;
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface CoreManagerDeps {
  /** 单写者闸门（spec D1）：与订阅面共用同一个探针实现。 */
  isVergeRunning(): boolean;
  /** Verge 那侧发现出来的控制器地址；没有就谈不上 external。 */
  externalController(): string | null;
  probeController(url: string): Promise<boolean>;
  /** 目录里挑出来的那颗（`pickInstalledBinary` 的结果）；没有回 null。 */
  findInstalledExe(): string | null;
  /** 已经下载过的自托管内核路径；没下过回 null。 */
  findBundledExe(): string | null;
  usedPorts(): number[];
  /**
   * 首选那一组端口。不给就用默认档（7897/9097）。
   *
   * 装配层给的是 `clash-verge.yaml` 上声明的那一组：数据面按那本账找内核，
   * 我们起的这颗得落在它找得到的地方——否则「起来了但页面全瞎」，而且没有任何报错。
   */
  preferredPorts?(): CorePortPair | null;
  /** `-d`：内核自己的工作目录（缓存、geo 落这里），必须是 Mochi 的 userData，不能是 Verge 的目录。 */
  coreDir(): string;
  /** 喂给 `-f` 的那份配置由装配层写（它才知道当前订阅与 merge 链）；这里只要路径。 */
  writeRuntimeConfig(ports: { mixed: number; controller: number }): string;
  spawn(exePath: string, args: string[]): CoreChild;
  appendLog(line: string): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
  platform?: NodeJS.Platform;
  readyTimeoutMs?: number;
}

export interface CoreManager {
  start(): Promise<CoreStatus>;
  stop(): Promise<CoreStatus>;
  restart(): Promise<CoreStatus>;
  status(): CoreStatus;
  /** 自愈预算用尽后，人工再点一次「起」时清零用的。 */
  resetHealBudget(): void;
}

function stamp(at: number): string {
  return new Date(at).toISOString();
}

export function createCoreManager(deps: CoreManagerDeps): CoreManager {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readyTimeoutMs = deps.readyTimeoutMs ?? CORE_READY_TIMEOUT_MS;
  const platform = deps.platform ?? process.platform;

  let current: CoreStatus = { ...EMPTY_CORE_STATUS };
  let child: CoreChild | null = null;
  let stopping = false;
  /** 我们自己的那颗用的端口，外部态没有。 */
  let ownPorts: CoreStatus["ports"] = null;

  const log = (text: string): void => {
    try {
      deps.appendLog(`${stamp(now())} ${text}`);
    } catch {
      // core.log 写不动不该拖垮起内核这件事本身；这里静默是唯一选择，但静默要留痕：
      // 这一句至少还在 console 上，装配层的日志能捞到。
      console.warn(`[core] 写 ${CORE_LOG_FILE} 失败`);
    }
  };

  const settle = (patch: Partial<CoreStatus>): CoreStatus => {
    current = { ...current, ...patch };
    return status();
  };

  function status(): CoreStatus {
    return { ...current };
  }

  /** 只有真的把 kill 递出去了才算「我们停的」；external 走的是另一条出口。 */
  function killOwn(): void {
    if (!child) return;
    const target = child;
    child = null;
    try {
      target.kill();
    } catch (error) {
      log(`kill 失败 pid=${target.pid}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function waitReady(controller: string): Promise<boolean> {
    const deadline = now() + readyTimeoutMs;
    // 就绪判据只能是「控制器答话」——spawn 回来不等于内核在听，尤其端口撞车时。
    for (;;) {
      if (await deps.probeController(controller)) return true;
      if (now() >= deadline) return false;
      await sleep(200);
    }
  }

  function attach(childRef: CoreChild, mode: CoreMode): void {
    const sink = (stream: CoreChild["stdout"] | CoreChild["stderr"], prefix: string) => {
      stream?.on("data", (chunk: unknown) => {
        const text = typeof chunk === "string" ? chunk : String(chunk ?? "");
        const trimmed = text.trimEnd();
        if (trimmed) log(`${prefix} ${trimmed.replace(/\s*\n\s*/g, " | ")}`);
      });
    };
    sink(childRef.stdout, "out");
    sink(childRef.stderr, "err");

    childRef.on("exit", (code, signal) => {
      // 我们自己按下的停止，不参与自愈计数。
      if (stopping) {
        stopping = false;
        child = null;
        ownPorts = null;
        settle({ state: "stopped", pid: null, controller: null, reason: null, detail: null, startedAt: null });
        log(`已停止（我们发起的）mode=${mode}`);
        return;
      }
      if (child !== childRef) return;
      child = null;
      const detail = `code=${code ?? "null"} signal=${signal ?? "null"}`;
      // 活了多久要在清账之前量：startedAt 一被抹掉，「偶发一次崩溃」和「崩溃循环」就分不开了。
      const aliveMs = current.startedAt === null ? null : now() - current.startedAt;
      log(`内核退出 mode=${mode} ${detail}`);
      settle({ state: "exited", pid: null, controller: null, reason: "exited", detail, startedAt: null });
      void heal(mode, detail, aliveMs);
    });
  }

  async function heal(mode: CoreMode, lastDetail: string, aliveMs: number | null): Promise<void> {
    // 白名单而不是「不等于 external」：借来的那颗崩了重起是 Verge 的服务的事，不是我们的。
    if (!isOwnCoreMode(mode)) return;
    if (aliveMs !== null && aliveMs >= CORE_HEAL_RESET_MS) {
      // 撑过 CORE_HEAL_RESET_MS 才算「上一班是好的」，预算补满；否则连跑三天后那次崩溃就没钱可花。
      settle({ healAttempts: 0 });
      log(`上次存活 ${Math.round(aliveMs / 1000)}s ≥ ${CORE_HEAL_RESET_MS / 1000}s，自愈预算补满`);
    }
    if (current.healAttempts >= MAX_SELF_HEAL) {
      settle({ reason: "self-heal-exhausted", detail: `${MAX_SELF_HEAL} 次内已耗尽：${lastDetail}` });
      log(`自愈打满 ${MAX_SELF_HEAL} 次，不再重起；等人工点「起内核」`);
      return;
    }
    settle({ healAttempts: current.healAttempts + 1, reason: null, detail: lastDetail });
    log(`第 ${current.healAttempts}/${MAX_SELF_HEAL} 次自愈重起`);
    const ports = ownPorts;
    if (!ports) return;
    await launch(mode, ports);
  }

  async function launch(mode: CoreMode, ports: { mixed: number; controller: number }): Promise<CoreStatus> {
    const exePath = mode === "installed" ? deps.findInstalledExe() : deps.findBundledExe();
    if (!exePath) {
      settle({ state: "exited", mode, reason: "no-binary", detail: "没找到可借用的内核可执行文件" });
      log(`找不到 ${mode} 那颗内核`);
      return status();
    }
    // 配置这一步可能失败（没选订阅、正文坏了）。失败就不 spawn：一颗吃着一份坏配置的内核
    // 会在 core.log 里留下一句「配置解析失败」然后退出，看上去跟崩溃自愈一模一样——
    // 那是把用户的输入问题演成我们的进程问题。这里当场报 `no-config`，一个字节都不多写。
    let configPath: string;
    try {
      configPath = deps.writeRuntimeConfig(ports);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      settle({
        state: "blocked",
        mode,
        pid: null,
        controller: null,
        ports: null,
        reason: "no-config",
        detail,
        startedAt: null,
      });
      log(`runtime 配置写不出来，不起：${detail}`);
      return status();
    }
    settle({ state: "starting", mode, reason: null, detail: null });
    try {
      const spawned = deps.spawn(exePath, buildCoreArgs(deps.coreDir(), configPath));
      child = spawned;
      ownPorts = ports;
      attach(spawned, mode);
      log(`spawn pid=${spawned.pid} mode=${mode} mixed=${ports.mixed} controller=${ports.controller}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      settle({ state: "exited", mode, pid: null, reason: "spawn-failed", detail });
      log(`spawn 失败：${detail}`);
      return status();
    }
    const controller = `http://127.0.0.1:${ports.controller}`;
    if (!(await waitReady(controller))) {
      // 起来了但不应答：多半是端口或配置被内核拒了。kill 掉，别留一颗僵尸占着端口。
      log(`等控制器应答超时（${readyTimeoutMs}ms）`);
      stopping = true;
      killOwn();
      stopping = false;
      settle({
        state: "exited",
        mode,
        pid: null,
        controller: null,
        reason: "not-ready",
        detail: `内核起了但控制器不应答：${controller}`,
        startedAt: null,
      });
      return status();
    }
    const startedAt = now();
    // 活过 CORE_HEAL_RESET_MS 才补满预算，所以这里只记账、不清零。
    settle({ state: "running", mode, pid: child?.pid ?? null, controller, ports, reason: null, detail: null, startedAt });
    return status();
  }

  async function startCore(): Promise<CoreStatus> {
    // 已经有一颗我们起的、并且正在应答的内核：再点「起」不重起，只回报现状。
    if (child && current.state === "running") return status();
    if (platform !== "win32") {
      settle({ state: "blocked", mode: null, reason: "unsupported-platform", detail: platform });
      return status();
    }
    const external = deps.externalController();
    if (external && (await deps.probeController(external))) {
      // 可达即用：不启进程、不改端口、不写配置。
      ownPorts = null;
      settle({
        state: "running",
        mode: "external",
        pid: null,
        controller: external,
        ports: null,
        reason: null,
        detail: null,
        startedAt: now(),
        healAttempts: 0,
      });
      log(`控制器可达，用 external=${external}，不启进程`);
      return status();
    }
    if (deps.isVergeRunning()) {
      settle({
        state: "blocked",
        mode: null,
        pid: null,
        controller: null,
        ports: null,
        reason: "verge-running",
        detail: "Clash Verge 正在运行，先退出它再由我接管内核",
      });
      log("单写者闸门挡下：Verge 在跑，不起第二颗内核");
      return status();
    }
    const source: CoreSource = resolveCoreSource({
      controllerReachable: false,
      installedExe: deps.findInstalledExe(),
      bundledExe: deps.findBundledExe(),
    });
    if (source.needsDownload || !source.exePath) {
      settle({
        state: "blocked",
        mode: "bundled",
        pid: null,
        controller: null,
        ports: null,
        reason: "no-binary",
        detail: "本机没有可用的内核，需要先下载",
        startedAt: null,
      });
      log("本机没有内核：等用户点下载，不自动联网拉包");
      return status();
    }
    // 首选档由装配层给（`clash-verge.yaml` 上声明的那一对）：挤不上去才退到扫描段，
    // 退了这一次，网络页与桌宠就找不到这颗内核——端口照实在回执里报出去，不装作还在原位。
    const ports = pickPortPair(deps.usedPorts(), deps.preferredPorts?.() ?? undefined);
    if (!ports) {
      settle({
        state: "exited",
        mode: source.mode,
        pid: null,
        controller: null,
        ports: null,
        reason: "no-port",
        detail: `默认档与 ${FALLBACK_PORT_START} 起的扫描段都没找到一组空闲端口`,
        startedAt: null,
      });
      log("端口全被占，不起");
      return status();
    }
    stopping = false;
    return launch(source.mode, ports);
  }

  async function stopCore(): Promise<CoreStatus> {
    if (!isOwnCoreMode(current.mode) || !child) {
      // 不是我们起的那颗：只把账清掉，绝不 kill。
      settle({ state: "stopped", mode: null, pid: null, controller: null, ports: null, reason: null, detail: null, startedAt: null });
      log("external／无自有进程：只清账，不发 kill");
      return status();
    }
    stopping = true;
    killOwn();
    ownPorts = null;
    settle({ state: "stopped", mode: null, pid: null, controller: null, ports: null, reason: null, detail: null, startedAt: null });
    return status();
  }

  /**
   * 在途的起：一次点击还没走完，第二次点击不许再 spawn 一颗。
   * `state === "running"` 那道守卫只挡住「已经起来」的那段，`starting` 那 8s 里它挡不住。
   */
  let pendingStart: Promise<CoreStatus> | null = null;

  function startCoalesced(): Promise<CoreStatus> {
    if (pendingStart) return pendingStart;
    const run = startCore().finally(() => {
      if (pendingStart === run) pendingStart = null;
    });
    pendingStart = run;
    return run;
  }

  /** 停在起之后：先把在途的那次起等回来，否则「点了停止」会静默留下一颗正在起的内核。 */
  async function stopCoalesced(): Promise<CoreStatus> {
    if (pendingStart) await pendingStart.catch(() => undefined);
    return stopCore();
  }

  return {
    start: startCoalesced,
    stop: stopCoalesced,

    async restart(): Promise<CoreStatus> {
      await stopCoalesced();
      settle({ healAttempts: 0 });
      return startCoalesced();
    },

    status,

    resetHealBudget() {
      settle({ healAttempts: 0 });
    },
  };
}

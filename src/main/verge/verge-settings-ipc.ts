/**
 * Wave 3 T9-d：设置面的四条通道（verge.yaml 读写 + Windows 系统代理读写）。
 *
 * 这层唯一的智力活是**代理地址不归页面**：设置页只递 `{ enabled }`，地址由 main
 * 现问内核（`/configs` 的 mixed-port）→ 内核不在就退到 verge.yaml 的 `verge_mixed_port`
 * → 两头都说不出端口就 `no-port`，一个键都不写。让页面填地址等于给它一个
 * 「把全机流量指到任意主机」的口子，而例外列表同理（写进 WinINET 就被所有应用读到），
 * 所以那两样也一律从盘上来。
 *
 * 第二件活是**对齐 Verge 自己那把开关**：`enable_system_proxy` 不归我们写，
 * 用户下次开 Verge 时它会按自己账上的值重写 WinINET，把这里刚打开的代理关掉。
 * 对不齐不算失败（系统代理确实生效了），但必须说清是哪一种不齐。
 */
import { IPC } from "../../shared/ipc-channels";
import {
  DEFAULT_SYSTEM_PROXY_BYPASS,
  EMPTY_SYSTEM_PROXY_STATUS,
  type SystemProxyAlign,
  type SystemProxyRead,
  type SystemProxyReason,
  type SystemProxySetResult,
  type SystemProxyToggle,
} from "../../shared/system-proxy-types";
import {
  EMPTY_VERGE_SETTINGS_VIEW,
  type VergeSettingsRead,
  type VergeSettingsResult,
  type VergeSettingsView,
} from "../../shared/verge-settings-types";
import type { IpcScope } from "../application/ipc-scope";
import { applySystemProxy, buildProxyServer, readSystemProxy, type SystemProxyDeps } from "./system-proxy";
import type { VergeSettingsStore } from "./verge-settings";

/** 系统代理只许指向这台机器自己；非 loopback 由 `buildProxyServer` 当场拒。 */
const PROXY_HOST = "127.0.0.1";

export interface VergeSettingsIpcDeps {
  /** Verge 的数据目录可能在用户手上搬家，所以每次现查；没装过 Verge 时回 null。 */
  settings(): VergeSettingsStore | null;
  /** 内核报出来的 mixed-port；内核没在跑就回 null，**不许抛**（抛了页面只能看到一个 IPC 异常）。 */
  corePort(): Promise<number | null>;
  /** 注入给单测的 exec/平台；生产留空走真 PowerShell。 */
  proxy?: SystemProxyDeps;
}

function usablePort(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

/**
 * 例外列表跟着 verge.yaml 那两把键走，与 Verge 自己的算法一致。
 *
 * `use_default_bypass` 的 null 是「跟随默认」——Verge 出厂就是 true，所以只有明确的
 * false 才走自定义那一路。盘上读不出视图时回 `undefined`：那是不碰注册表里那一把键，
 * 不是把它清空（清空会连带抹掉别人配的豁免）。
 */
function bypassFromView(view: VergeSettingsView | null): string | null | undefined {
  if (!view) return undefined;
  if (view.useDefaultBypass !== false) return DEFAULT_SYSTEM_PROXY_BYPASS;
  const custom = view.systemProxyBypass;
  return typeof custom === "string" && custom.trim().length > 0 ? custom : null;
}

/** 没走到注册表就回绝：状态是三件套 null，不是「读回来是关着」。 */
function refused(reason: SystemProxyReason, detail: string): SystemProxySetResult {
  return {
    ok: false,
    reason,
    status: { ...EMPTY_SYSTEM_PROXY_STATUS },
    align: { state: "skipped", reason: "not-applied" },
    detail,
  };
}

function alignOf(write: VergeSettingsResult | null): SystemProxyAlign {
  if (!write) return { state: "skipped", reason: "no-file" };
  if (write.ok) return { state: "aligned" };
  if (write.reason === "verge-running") return { state: "skipped", reason: "verge-running" };
  if (write.reason === "not-found") return { state: "skipped", reason: "no-file" };
  return { state: "failed", ...(write.detail ? { detail: write.detail } : {}) };
}

export function registerVergeSettingsIpc(ipc: IpcScope, deps: VergeSettingsIpcDeps): () => void {
  const proxyDeps = deps.proxy ?? {};

  ipc.handle(IPC.VERGE_SETTINGS_GET, (): VergeSettingsRead => {
    const store = deps.settings();
    if (!store) return { view: { ...EMPTY_VERGE_SETTINGS_VIEW }, reason: "not-found", filePath: null };
    return store.read();
  });

  // 白名单与值的形状都在 store 里判；这层再判一遍只会多出第二份口径。
  ipc.handle(IPC.VERGE_SETTINGS_SET, (_event, patch: unknown): VergeSettingsResult => {
    const store = deps.settings();
    if (!store) {
      return {
        ok: false,
        reason: "not-found",
        view: { ...EMPTY_VERGE_SETTINGS_VIEW },
        detail: "没有找到 Clash Verge 的数据目录",
      };
    }
    return store.write(patch);
  });

  ipc.handle(IPC.VERGE_SYS_PROXY_GET, (): SystemProxyRead => readSystemProxy(proxyDeps));

  ipc.handle(IPC.VERGE_SYS_PROXY_SET, async (_event, input: unknown): Promise<SystemProxySetResult> => {
    const enabled = typeof input === "object" && input !== null
      ? (input as SystemProxyToggle).enabled
      : undefined;
    if (typeof enabled !== "boolean") return refused("bad-value", "系统代理开关需要一个布尔值");

    const store = deps.settings();
    const read = store?.read() ?? null;
    const view = read && read.reason === null ? read.view : null;

    let server: string | undefined;
    let bypass: string | null | undefined;
    if (enabled) {
      const fromCore = await deps.corePort();
      const port = usablePort(fromCore) ?? usablePort(view?.mixedPort);
      if (port === null) {
        return refused("no-port", "内核没在跑，verge.yaml 里也说不出混合端口——不知道该把系统代理指向哪个端口");
      }
      server = buildProxyServer(PROXY_HOST, port);
      bypass = bypassFromView(view);
    }

    const result = applySystemProxy({ enabled, server, bypass }, proxyDeps);
    if (!result.ok) return { ...result, align: { state: "skipped", reason: "not-applied" } };
    const write = store?.write({ enable_system_proxy: enabled }) ?? null;
    return { ...result, align: alignOf(write) };
  });

  return () => {
    ipc.removeHandler(IPC.VERGE_SETTINGS_GET);
    ipc.removeHandler(IPC.VERGE_SETTINGS_SET);
    ipc.removeHandler(IPC.VERGE_SYS_PROXY_GET);
    ipc.removeHandler(IPC.VERGE_SYS_PROXY_SET);
  };
}

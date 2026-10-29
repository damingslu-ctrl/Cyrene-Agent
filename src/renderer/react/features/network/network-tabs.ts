/**
 * 网络页的页签清单与纯函数：搜索/过滤/日志缓冲/设置补丁都在这里，
 * 组件只负责接线，判定口径可以被单测钉住。
 */
import type {
  CoreConfigPatch,
  CoreConfigView,
  LogEntry,
  LogLevel,
  RuleEntry,
} from "../../../../shared/network-detail-types";
import type { ProxyMode } from "../../../../shared/network-types";

/** 主进程 preload 暴露的完整网络接口（组件只用其中一部分）。 */
export type NetworkApi = Window["verge"]["network"];

export type NetworkTab =
  | "overview"
  | "nodes"
  | "rules"
  | "logs"
  | "connections"
  | "providers"
  | "settings";

/** 正文页签；设置是第七个，用页头齿轮打开。 */
export const NETWORK_TABS = [
  "overview",
  "nodes",
  "rules",
  "logs",
  "connections",
  "providers",
] as const;

export const NETWORK_TAB_KEY: Record<NetworkTab, string> = {
  overview: "network.tabOverview",
  nodes: "network.tabNodes",
  rules: "network.tabRules",
  logs: "network.tabLogs",
  connections: "network.tabConnections",
  providers: "network.tabProviders",
  settings: "network.tabSettings",
};

/** 模式名与一句话说明：概览页按钮与面板回执共用同一份字号。 */
export const MODE_KEY: Record<ProxyMode, string> = {
  rule: "network.modeRule",
  global: "network.modeGlobal",
  direct: "network.modeDirect",
};

export const MODE_HINT_KEY: Record<ProxyMode, string> = {
  rule: "network.modeRuleHint",
  global: "network.modeGlobalHint",
  direct: "network.modeDirectHint",
};

/** 与主进程的环形缓冲同口径：日志 500 行。 */
export const LOG_LIMIT = 500;
/** 连接明细最多画 200 条（再多也看不清，且 DOM 撑不住）。 */
export const CONNECTION_LIMIT = 200;

export function filterRules(rules: RuleEntry[], query: string): RuleEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return rules;
  return rules.filter((rule) =>
    `${rule.type} ${rule.payload} ${rule.proxy}`.toLocaleLowerCase().includes(needle),
  );
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

/** 级别是下限；未知级别不冒充任何档，只在「全部」里出现。 */
export function filterLogs(entries: LogEntry[], level: LogLevel | "all"): LogEntry[] {
  if (level === "all") return entries;
  const floor = LEVEL_RANK[level];
  return entries.filter((entry) => entry.type !== "unknown" && LEVEL_RANK[entry.type] >= floor);
}

/** 追加一条日志并裁到上限（从最老的开始丢），不改原数组。 */
export function pushLogEntry(entries: LogEntry[], entry: LogEntry, cap = LOG_LIMIT): LogEntry[] {
  const room = entries.length >= cap ? entries.slice(entries.length - cap + 1) : [...entries];
  room.push(entry);
  return room;
}

export interface ConfigDraft {
  mixedPort: string;
  port: string;
  socksPort: string;
  allowLan: boolean;
  ipv6: boolean;
  logLevel: LogLevel;
  tunEnabled: boolean;
  tunStack: string;
}

export type PortDraftKey = "mixedPort" | "port" | "socksPort";

function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 65535 ? value : null;
}

export function draftFromView(view: CoreConfigView): ConfigDraft {
  return {
    mixedPort: view.mixedPort === null ? "" : String(view.mixedPort),
    port: view.port === null ? "" : String(view.port),
    socksPort: view.socksPort === null ? "" : String(view.socksPort),
    allowLan: view.allowLan === true,
    ipv6: view.ipv6 === true,
    logLevel: view.logLevel ?? "info",
    tunEnabled: view.tunEnabled === true,
    tunStack: view.tunStack ?? "mixed",
  };
}

/** 非空但解析不出来的端口；空串表示「不知道/不改」，不算坏值。 */
export function invalidPorts(draft: ConfigDraft): PortDraftKey[] {
  return (["mixedPort", "port", "socksPort"] as const).filter(
    (key) => draft[key].trim() !== "" && parsePort(draft[key]) === null,
  );
}

function portStep(raw: string, current: number | null): number | null {
  const parsed = parsePort(raw);
  if (parsed === null || parsed === current) return null;
  return parsed;
}

/** 只把相对读到的配置改过的键变成补丁，顺序固定；0 是合法端口（关闭该入站）。 */
export function configSteps(view: CoreConfigView, draft: ConfigDraft): CoreConfigPatch[] {
  const steps: CoreConfigPatch[] = [];
  const mixed = portStep(draft.mixedPort, view.mixedPort);
  if (mixed !== null) steps.push({ "mixed-port": mixed });
  const http = portStep(draft.port, view.port);
  if (http !== null) steps.push({ port: http });
  const socks = portStep(draft.socksPort, view.socksPort);
  if (socks !== null) steps.push({ "socks-port": socks });
  if (draft.allowLan !== (view.allowLan === true)) steps.push({ "allow-lan": draft.allowLan });
  if (draft.ipv6 !== (view.ipv6 === true)) steps.push({ ipv6: draft.ipv6 });
  if (draft.logLevel !== (view.logLevel ?? "info")) steps.push({ "log-level": draft.logLevel });
  if (draft.tunEnabled !== (view.tunEnabled === true)) steps.push({ "tun.enable": draft.tunEnabled });
  if (draft.tunStack !== (view.tunStack ?? "mixed")) steps.push({ "tun.stack": draft.tunStack });
  return steps;
}

/** 保存后的读回比对：每个补丁键都要在内核返回值里对上，才算真的改了。 */
export function viewMatchesPatch(view: CoreConfigView, patch: CoreConfigPatch): boolean {
  if ("mixed-port" in patch) return view.mixedPort === patch["mixed-port"];
  if ("port" in patch) return view.port === patch.port;
  if ("socks-port" in patch) return view.socksPort === patch["socks-port"];
  if ("allow-lan" in patch) return view.allowLan === patch["allow-lan"];
  if ("ipv6" in patch) return view.ipv6 === patch.ipv6;
  if ("log-level" in patch) return view.logLevel === patch["log-level"];
  if ("tun.enable" in patch) return view.tunEnabled === patch["tun.enable"];
  return view.tunStack === patch["tun.stack"];
}

/** 连接已持续时间：秒 / 分秒 / 时分。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** 连接明细里的进程只显示可执行文件名。 */
export function processName(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

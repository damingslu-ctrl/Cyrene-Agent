/**
 * 网络页「明细」层与桌宠共用的只读类型：规则 / 日志 / 连接明细 / 入站 / 配置视图。
 *
 * 解析与容错全在 shared：主进程只负责请求，渲染端只负责画。坏一行就丢一行，
 * 不许让一条脏数据把整页读成异常——这些都是内核运行时数据，形状随版本漂。
 */
import type { NetworkReason, ProxyMode } from "./network-types";

export interface RuleEntry {
  type: string;
  payload: string;
  proxy: string;
  /** mihomo 给的是规则条数（-1 表示不适用），不是命中次数。 */
  size: number;
}

export interface ConnectionDetail {
  id: string;
  /** 域名优先；没有域名退回目标 IP。 */
  host: string;
  network: string;
  /** `IP:端口`（端口缺失时只有 IP）。 */
  destination: string;
  /** 发起进程的完整路径；拿不到时为空串。 */
  process: string;
  upload: number;
  download: number;
  startedAt: number;
  /** 出站链路，叶节点在前（chains[0] 就是实际去向）。 */
  chains: string[];
  rule: string;
  rulePayload: string;
}

export const LOG_LEVELS = ["debug", "info", "warning", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogEntryType = LogLevel | "unknown";

export interface LogEntry {
  type: LogEntryType;
  payload: string;
  /** epoch ms；内核没给时间时记 0，渲染端用收到的时间补。 */
  at: number;
}

export interface ProviderInfo {
  name: string;
  /** 载体：HTTP / File / Compatible；缺省空串。 */
  vehicle: string;
  nodeCount: number;
  aliveCount: number;
  updatedAt: number | null;
}

/** `/configs` 里页面能看、能改的键（其余一律不读不写，secret 也不许外泄）。 */
export const CONFIG_KEYS = [
  "mixed-port", "port", "socks-port", "allow-lan", "ipv6", "mode", "log-level", "tun",
] as const;

export interface CoreConfigView {
  mixedPort: number | null;
  port: number | null;
  socksPort: number | null;
  allowLan: boolean | null;
  ipv6: boolean | null;
  mode: ProxyMode | null;
  logLevel: LogLevel | null;
  tunEnabled: boolean | null;
  tunStack: string | null;
}

/** 明细读接口的统一回执：失败带回原因，页面不靠异常文案猜状态。 */
export type NetworkDetailResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: NetworkReason };

/** 没有返回值的写操作回执。 */
export type NetworkVoidResult =
  | { ok: true }
  | { ok: false; reason: NetworkReason };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** 日志页的整页读数：缓冲内容 + 流是否活着 + 上一次断流原因。 */
export interface NetworkLogsState {
  entries: LogEntry[];
  streaming: boolean;
  error: NetworkReason | null;
}

/** PATCH /configs 允许的键（扁平的 kebab-case，tun 走 `tun.enable`/`tun.stack`）。 */
export type CoreConfigPatch =
  | { "mixed-port": number }
  | { port: number }
  | { "socks-port": number }
  | { "allow-lan": boolean }
  | { ipv6: boolean }
  | { "log-level": LogLevel }
  | { "tun.enable": boolean }
  | { "tun.stack": string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseRules(raw: unknown): RuleEntry[] {
  const root = asRecord(raw);
  const list = root?.rules;
  if (!Array.isArray(list)) return [];
  const rules: RuleEntry[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    if (!entry) continue;
    if (typeof entry.type !== "string") continue;
    const size = typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : -1;
    rules.push({
      type: entry.type,
      payload: str(entry.payload),
      proxy: str(entry.proxy),
      size,
    });
  }
  return rules;
}

function destinationOf(metadata: Record<string, unknown>): string {
  const ip = str(metadata.destinationIP);
  const port = str(metadata.destinationPort);
  if (ip && port) return `${ip}:${port}`;
  return ip || str(metadata.host);
}

export function parseConnectionsDetail(raw: unknown): ConnectionDetail[] {
  const root = asRecord(raw);
  const list = root?.connections;
  if (!Array.isArray(list)) return [];
  const out: ConnectionDetail[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    if (!entry) continue;
    // 没有 id 的连接列出来也关不掉：点一下只会得到一次失败，不如不列。
    if (typeof entry.id !== "string" || !entry.id) continue;
    const metadata = asRecord(entry.metadata) ?? {};
    const chains = Array.isArray(entry.chains)
      ? entry.chains.filter((chain): chain is string => typeof chain === "string")
      : [];
    const start = typeof entry.start === "string" ? Date.parse(entry.start) : Number.NaN;
    out.push({
      id: entry.id,
      host: str(metadata.host) || str(metadata.destinationIP),
      network: str(metadata.network),
      destination: destinationOf(metadata),
      process: str(metadata.processPath),
      upload: typeof entry.upload === "number" && entry.upload > 0 ? entry.upload : 0,
      download: typeof entry.download === "number" && entry.download > 0 ? entry.download : 0,
      startedAt: Number.isFinite(start) ? start : 0,
      chains,
      rule: str(entry.rule),
      rulePayload: str(entry.rulePayload),
    });
  }
  return out;
}

function timeOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 秒与毫秒都出现过：小于 1e12 当秒。
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const entry = asRecord(parsed);
  if (!entry) return null;
  if (typeof entry.type !== "string") return null;
  if (typeof entry.payload !== "string") return null;
  const type = (LOG_LEVELS as readonly string[]).includes(entry.type)
    ? (entry.type as LogLevel)
    : "unknown";
  return { type, payload: entry.payload, at: timeOf(entry.time) };
}

export function parseProviders(raw: unknown): ProviderInfo[] {
  const root = asRecord(raw);
  const table = asRecord(root?.providers);
  if (!table) return [];
  const out: ProviderInfo[] = [];
  for (const [key, value] of Object.entries(table)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const proxies = Array.isArray(entry.proxies) ? entry.proxies : [];
    let aliveCount = 0;
    for (const proxy of proxies) {
      const p = asRecord(proxy);
      if (p && p.alive !== false) aliveCount += 1;
    }
    const updatedAt = entry.updatedAt === undefined ? 0 : timeOf(entry.updatedAt);
    out.push({
      name: str(entry.name) || key,
      vehicle: str(entry.vehicleType),
      nodeCount: proxies.length,
      aliveCount,
      // Go 零值时间与坏字符串都会解析成 ≤0：那是「没更新过」，不是 1/1/1 或 1970。
      updatedAt: updatedAt > 0 ? updatedAt : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const LOG_LEVEL_SET = new Set<string>(LOG_LEVELS);

export function pickConfigView(raw: unknown): CoreConfigView {
  const root = asRecord(raw) ?? {};
  const tun = asRecord(root.tun) ?? {};
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
  const mode = root.mode;
  return {
    mixedPort: num(root["mixed-port"]),
    port: num(root.port),
    socksPort: num(root["socks-port"]),
    allowLan: bool(root["allow-lan"]),
    ipv6: bool(root.ipv6),
    mode: mode === "rule" || mode === "global" || mode === "direct" ? mode : null,
    logLevel: LOG_LEVEL_SET.has(str(root["log-level"])) ? (root["log-level"] as LogLevel) : null,
    tunEnabled: bool(tun.enable),
    tunStack: str(tun.stack) || null,
  };
}

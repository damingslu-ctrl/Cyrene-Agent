/**
 * mihomo 外部控制器客户端（本机 loopback）。
 *
 * 读版本/模式/节点/连接/流量/规则/日志/入站/配置，写模式/选中节点/配置/重载/关连接。
 * `/traffic` 与 `/logs` 都是流式 NDJSON：前者只取第一帧就取消，后者的连接超时
 * 只在建连阶段有效——日志流要活多久由调用方的 AbortSignal 说了算。
 */
import {
  LOG_LEVELS,
  parseConnectionsDetail,
  parseLogLine,
  parseProviders,
  parseRules,
  pickConfigView,
} from "../../shared/network-detail-types";
import type {
  CoreConfigPatch,
  CoreConfigView,
  ConnectionDetail,
  LogEntry,
  LogLevel,
  ProviderInfo,
  RuleEntry,
} from "../../shared/network-detail-types";
import type {
  ConnectionSummary,
  NetworkReason,
  ProxyGroup,
  ProxyMode,
  ProxyNode,
  TrafficFrame,
} from "../../shared/network-types";

const DELAY_URL = "https://www.gstatic.com/generate_204";
const TUN_STACKS = new Set(["system", "gvisor", "mixed"]);
const PORT_KEYS = new Set(["mixed-port", "port", "socks-port"]);
const BOOL_KEYS = new Set(["allow-lan", "ipv6"]);

export class MihomoRequestError extends Error {
  constructor(
    readonly reason: NetworkReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MihomoRequestError";
  }
}

export interface LogStreamOptions {
  level?: LogLevel;
  signal?: AbortSignal;
}

export interface MihomoClient {
  version(): Promise<string | null>;
  mode(): Promise<ProxyMode | null>;
  groups(): Promise<ProxyGroup[]>;
  connections(): Promise<ConnectionSummary>;
  traffic(): Promise<TrafficFrame>;
  setMode(mode: ProxyMode): Promise<void>;
  selectNode(group: string, node: string): Promise<void>;
  groupDelay(group: string, timeoutMs?: number): Promise<Record<string, number>>;
  rules(): Promise<RuleEntry[]>;
  connectionsDetail(): Promise<ConnectionDetail[]>;
  closeConnection(id: string): Promise<void>;
  closeAllConnections(): Promise<void>;
  providers(): Promise<ProviderInfo[]>;
  providerHealthCheck(name: string): Promise<void>;
  configs(): Promise<CoreConfigView>;
  patchConfigs(patch: CoreConfigPatch): Promise<void>;
  reloadConfig(path: string): Promise<void>;
  nodeDelay(name: string, timeoutMs?: number): Promise<number | null>;
  /** 订阅日志流，直到 `signal` 中止或流被内核关闭；返回即代表已停流。 */
  logs(onEntry: (entry: LogEntry) => void, options?: LogStreamOptions): Promise<void>;
}

export interface MihomoClientOptions {
  baseUrl: string;
  secret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const GROUP_TYPES = new Set(["Selector", "URLTest", "Fallback", "LoadBalance", "Relay"]);
const BUILTIN_TYPES = new Set([
  "Direct", "Reject", "RejectDrop", "Compatible", "Pass", "Block", "Dns",
]);
const SWITCHABLE_GROUPS = new Set(["Selector", "URLTest", "Fallback"]);
const MODES = new Set(["rule", "global", "direct"]);

const VALID_NODE_TYPES = new Set([
  "Direct", "Reject", "RejectDrop", "Compatible", "Pass", "Block", "Dns",
]);

function lastDelay(history: unknown): number | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (typeof entry !== "object" || entry === null) continue;
    const delay = (entry as Record<string, unknown>).delay;
    if (typeof delay === "number" && Number.isFinite(delay) && delay > 0) return Math.round(delay);
  }
  return null;
}

function delayHistory(history: unknown): Array<number | null> {
  if (!Array.isArray(history)) return [];
  return history.slice(-10).map((entry) => {
    if (typeof entry !== "object" || entry === null) return null;
    const delay = (entry as Record<string, unknown>).delay;
    return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? Math.round(delay) : null;
  });
}

/**
 * 组里的 `all` 混着节点、子组和内置项（DIRECT/REJECT）。只有能真正承载流量的
 * 节点才进列表；组引用与伪节点会让「切过去」变成一次静默失败。
 */
export function parseProxies(raw: unknown): ProxyGroup[] {
  if (typeof raw !== "object" || raw === null) return [];
  const proxies = (raw as Record<string, unknown>).proxies;
  if (typeof proxies !== "object" || proxies === null) return [];
  const table = proxies as Record<string, unknown>;
  const groups: ProxyGroup[] = [];
  for (const [name, value] of Object.entries(table)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const type = typeof entry.type === "string" ? entry.type : "";
    if (!SWITCHABLE_GROUPS.has(type)) continue;
    if (name === "GLOBAL") continue;
    if (!Array.isArray(entry.all)) continue;
    const nodes: ProxyNode[] = [];
    for (const memberName of entry.all) {
      if (typeof memberName !== "string") continue;
      const member = table[memberName];
      if (typeof member !== "object" || member === null) continue;
      const m = member as Record<string, unknown>;
      const memberType = typeof m.type === "string" ? m.type : "";
      if (GROUP_TYPES.has(memberType) || VALID_NODE_TYPES.has(memberType)) continue;
      nodes.push({
        name: memberName,
        type: memberType,
        delay: lastDelay(m.history),
        history: delayHistory(m.history),
        alive: m.alive !== false,
      });
    }
    if (nodes.length === 0) continue;
    groups.push({
      name,
      type,
      now: typeof entry.now === "string" ? entry.now : "",
      nodes,
    });
  }
  return groups.sort((a, b) => b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
}

export function parseConnections(raw: unknown): ConnectionSummary {
  if (typeof raw !== "object" || raw === null) {
    return { total: 0, proxy: 0, direct: 0, reject: 0 };
  }
  const list = (raw as Record<string, unknown>).connections;
  if (!Array.isArray(list)) return { total: 0, proxy: 0, direct: 0, reject: 0 };
  const summary: ConnectionSummary = { total: list.length, proxy: 0, direct: 0, reject: 0 };
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const chains = (item as Record<string, unknown>).chains;
    const first = Array.isArray(chains) && typeof chains[0] === "string"
      ? chains[0].toUpperCase()
      : "";
    if (first === "DIRECT" || first === "PASS") summary.direct += 1;
    else if (first.startsWith("REJECT")) summary.reject += 1;
    else summary.proxy += 1;
  }
  return summary;
}

export function parseTrafficFrame(raw: unknown): TrafficFrame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const up = input.up;
  const down = input.down;
  if (typeof up !== "number" || typeof down !== "number") return null;
  return { up: Math.max(0, up), down: Math.max(0, down), at: Date.now() };
}

function mapError(error: unknown): MihomoRequestError {
  if (error instanceof MihomoRequestError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new MihomoRequestError("timeout", error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new MihomoRequestError("unreachable", message);
}

/**
 * PATCH /configs 的入参过滤：只认白名单键，值类型也要对。
 *
 * 这层校验放在发请求之前——`secret`、`external-controller` 这类键落进内核
 * 会直接把网络页自己的控制通道改掉，坏值则会 204 成功但内核行为异常。
 */
export function buildConfigPatch(patch: unknown): Record<string, unknown> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new MihomoRequestError("bad-response", "config patch must be an object");
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) {
    throw new MihomoRequestError("bad-response", "config patch is empty");
  }
  const body: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (PORT_KEYS.has(key)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 65535) {
        throw new MihomoRequestError("bad-response", `config patch ${key} must be a port`);
      }
      body[key] = value;
    } else if (BOOL_KEYS.has(key)) {
      if (typeof value !== "boolean") {
        throw new MihomoRequestError("bad-response", `config patch ${key} must be a boolean`);
      }
      body[key] = value;
    } else if (key === "log-level") {
      if (typeof value !== "string" || !(LOG_LEVELS as readonly string[]).includes(value)) {
        throw new MihomoRequestError("bad-response", "config patch log-level is not a level");
      }
      body[key] = value;
    } else if (key === "tun.enable" || key === "tun.stack") {
      const valid = key === "tun.enable"
        ? typeof value === "boolean"
        : typeof value === "string" && TUN_STACKS.has(value);
      if (!valid) {
        throw new MihomoRequestError("bad-response", `config patch ${key} is not valid`);
      }
      const tun = typeof body.tun === "object" ? (body.tun as Record<string, unknown>) : {};
      tun[key.slice(4)] = value;
      body.tun = tun;
    } else {
      throw new MihomoRequestError("bad-response", `config patch key ${key} is not allowed`);
    }
  }
  return body;
}

export function createMihomoClient(options: MihomoClientOptions): MihomoClient {
  const timeoutMs = options.timeoutMs ?? 2500;
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.secret) headers.Authorization = `Bearer ${options.secret}`;

  async function request(pathname: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${base}${pathname}`, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new MihomoRequestError("unauthorized", `controller rejected ${response.status}`, response.status);
      }
      if (!response.ok) {
        throw new MihomoRequestError("bad-response", `controller returned ${response.status}`, response.status);
      }
      return response;
    } catch (error) {
      throw mapError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(pathname: string, init?: RequestInit): Promise<unknown> {
    const response = await request(pathname, init);
    try {
      return await response.json();
    } catch {
      throw new MihomoRequestError("bad-response", "controller returned invalid json");
    }
  }

  /** 内核的写操作与健康检查回 204：不能按 JSON 读，否则成功也被当成坏回执。 */
  async function send(pathname: string, init?: RequestInit): Promise<void> {
    const response = await request(pathname, init);
    try {
      await response.body?.cancel();
    } catch {
      /* 已经被读完 */
    }
  }

  return {
    async version() {
      const data = await json("/version");
      if (typeof data !== "object" || data === null) return null;
      const version = (data as Record<string, unknown>).version;
      return typeof version === "string" ? version : null;
    },

    async mode() {
      const data = await json("/configs");
      if (typeof data !== "object" || data === null) return null;
      const mode = (data as Record<string, unknown>).mode;
      return typeof mode === "string" && MODES.has(mode) ? mode as ProxyMode : null;
    },

    async groups() {
      return parseProxies(await json("/proxies"));
    },

    async connections() {
      return parseConnections(await json("/connections"));
    },

    async traffic() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(`${base}/traffic`, { headers, signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          throw new MihomoRequestError("unauthorized", `controller rejected ${response.status}`, response.status);
        }
        if (!response.ok || !response.body) {
          throw new MihomoRequestError("bad-response", `traffic returned ${response.status}`, response.status);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            while (true) {
              const newline = buffer.indexOf("\n");
              if (newline < 0) break;
              const line = buffer.slice(0, newline).trim();
              // 必须吃掉已处理的行：空行/心跳留在 buffer 里会让下一帧永远排在这一行后面。
              buffer = buffer.slice(newline + 1);
              if (!line) continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(line);
              } catch {
                throw new MihomoRequestError("bad-response", "traffic stream had invalid json");
              }
              const frame = parseTrafficFrame(parsed);
              if (frame) return frame;
            }
          }
        } finally {
          void reader.cancel().catch(() => { /* 已断开 */ });
        }
      } catch (error) {
        throw mapError(error);
      } finally {
        clearTimeout(timer);
      }
      throw new MihomoRequestError("bad-response", "traffic stream had no frame");
    },

    async setMode(mode) {
      await send("/configs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
    },

    async selectNode(group, node) {
      await send(`/proxies/${encodeURIComponent(group)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: node }),
      });
    },

    async groupDelay(group, timeout = 5000) {
      const data = await json(
        `/group/${encodeURIComponent(group)}/delay?timeout=${timeout}&url=${encodeURIComponent(DELAY_URL)}`,
      );
      if (typeof data !== "object" || data === null) return {};
      const result: Record<string, number> = {};
      for (const [name, delay] of Object.entries(data)) {
        if (typeof delay === "number" && Number.isFinite(delay) && delay > 0) {
          result[name] = Math.round(delay);
        }
      }
      return result;
    },

    async rules() {
      return parseRules(await json("/rules"));
    },

    async connectionsDetail() {
      return parseConnectionsDetail(await json("/connections"));
    },

    async closeConnection(id) {
      await send(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async closeAllConnections() {
      await send("/connections", { method: "DELETE" });
    },

    async providers() {
      return parseProviders(await json("/providers/proxies"));
    },

    async providerHealthCheck(name) {
      await send(`/providers/proxies/${encodeURIComponent(name)}/healthcheck`);
    },

    async configs() {
      return pickConfigView(await json("/configs"));
    },

    async patchConfigs(patch) {
      const body = buildConfigPatch(patch);
      await send("/configs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    async reloadConfig(path) {
      await send("/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    },

    async nodeDelay(name, timeout = 5000) {
      try {
        const data = await json(
          `/proxies/${encodeURIComponent(name)}/delay?timeout=${timeout}&url=${encodeURIComponent(DELAY_URL)}`,
        );
        if (typeof data !== "object" || data === null) return null;
        const delay = (data as Record<string, unknown>).delay;
        return typeof delay === "number" && Number.isFinite(delay) && delay > 0
          ? Math.round(delay)
          : null;
      } catch (error) {
        // 内核超时探测会回 408/504：那是「这个节点不通」，不是「控制器坏了」。
        if (error instanceof MihomoRequestError && (error.status === 408 || error.status === 504)) {
          return null;
        }
        throw error;
      }
    },

    async logs(onEntry, options = {}) {
      const level = options.level ?? "info";
      const signal = options.signal;
      if (signal?.aborted) return;
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();
      signal?.addEventListener("abort", onOuterAbort, { once: true });
      const stopped = new Promise<null>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(null), { once: true });
      });
      try {
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await doFetch(`${base}/logs?level=${encodeURIComponent(level)}`, {
            headers,
            signal: controller.signal,
          });
        } catch (error) {
          if (signal?.aborted) return;
          throw mapError(error);
        } finally {
          // 连上就把连接超时撤掉：日志流要活多久是调用方的事。
          clearTimeout(timer);
        }
        if (response.status === 401 || response.status === 403) {
          throw new MihomoRequestError("unauthorized", `controller rejected ${response.status}`, response.status);
        }
        if (!response.ok || !response.body) {
          throw new MihomoRequestError("bad-response", `logs returned ${response.status}`, response.status);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const consume = (final: boolean) => {
          while (true) {
            const newline = buffer.indexOf("\n");
            if (newline < 0) break;
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            // 日志流里的坏行只丢这一行：一条脏数据不该让整页日志停摆。
            const entry = parseLogLine(line);
            if (entry) onEntry(entry);
          }
          if (!final) return;
          const trailing = buffer.trim();
          buffer = "";
          const entry = trailing ? parseLogLine(trailing) : null;
          if (entry) onEntry(entry);
        };
        try {
          while (true) {
            const read = reader.read().catch(() => null);
            const result = await Promise.race([read, stopped]);
            if (!result || result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            consume(false);
          }
          buffer += decoder.decode();
          consume(true);
        } finally {
          await reader.cancel().catch(() => { /* 已断开 */ });
        }
      } finally {
        signal?.removeEventListener("abort", onOuterAbort);
      }
    },
  };
}

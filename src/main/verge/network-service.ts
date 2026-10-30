/**
 * 网络页的聚合服务：轮询 mihomo、缓存快照、串行化写操作。
 *
 * 流量 1.5s 一帧（只推 traffic，避免每帧搬整棵节点树），完整快照 10s 一次；
 * 所有写操作完成后立刻回读一次，UI 不靠乐观值撑场面。
 * 明细（规则/日志/连接/入站/配置）按页签按需拉：规则与入站 5s 缓存，
 * 配置与连接明细不缓存——设置页的读回必须是真实当下值。
 */
import {
  EMPTY_TRAFFIC,
  emptyNetworkSnapshot,
  reasonOf,
  type NetworkSnapshot,
  type NetworkUpdate,
  type ProxyMode,
} from "../../shared/network-types";
import type {
  CoreConfigPatch,
  CoreConfigView,
  ConnectionDetail,
  LogEntry,
  LogLevel,
  NetworkLogsState,
  ProviderInfo,
  RuleEntry,
} from "../../shared/network-detail-types";
import { readControllerConfig, readSubscription, type ControllerConfig } from "./controller-config";
import { createMihomoClient, MihomoRequestError, type MihomoClient } from "./mihomo-client";

export type { NetworkUpdate };

/** 日志环形缓冲上限：翻得完一屏，也不至于把主进程内存吃穿。 */
export const LOG_BUFFER_LIMIT = 500;
const LOG_RETRY_MS = 3000;
const DETAIL_TTL_MS = 5000;

export interface AutoSelectResult {
  group: string;
  previous: string;
  best: string | null;
  switched: boolean;
}

export interface NetworkService {
  getSnapshot(): NetworkSnapshot;
  refresh(): Promise<NetworkSnapshot>;
  setMode(mode: ProxyMode): Promise<NetworkSnapshot>;
  selectNode(group: string, node: string): Promise<NetworkSnapshot>;
  testGroup(group: string): Promise<Record<string, number>>;
  autoSelect(group: string): Promise<AutoSelectResult>;
  fetchRules(force?: boolean): Promise<RuleEntry[]>;
  fetchConnections(): Promise<ConnectionDetail[]>;
  fetchProviders(force?: boolean): Promise<ProviderInfo[]>;
  fetchConfig(): Promise<CoreConfigView>;
  saveConfig(patch: CoreConfigPatch): Promise<CoreConfigView>;
  closeConnection(id: string): Promise<void>;
  closeAllConnections(): Promise<void>;
  providerCheck(name: string): Promise<ProviderInfo[]>;
  startLogs(level?: LogLevel): Promise<void>;
  stopLogs(): void;
  getLogs(): NetworkLogsState;
  subscribeLogs(listener: (entry: LogEntry) => void): () => void;
  start(): void;
  stop(): void;
  subscribe(listener: (update: NetworkUpdate) => void): () => void;
}

export interface NetworkServiceOptions {
  getConfigRoot: () => string | null;
  /**
   * 内核宿主那一侧的地址（Wave 3 T10b）。非 null 的条件只有一个：**这颗内核是我们自己起的、
   * 现在还活着**。没有它，「我们自己起内核」这件事会造出一个最难查的坏状态：进程在跑、
   * 端口在听，而页面还按 Verge 那本账上的旧口令敲门——一句错误都不报，只是全瞎。
   */
  coreController?: () => ControllerConfig | null;
  createClient?: (config: ControllerConfig) => MihomoClient;
  now?: () => number;
  fullIntervalMs?: number;
  trafficIntervalMs?: number;
  detailTtlMs?: number;
  logRetryMs?: number;
}

export function createNetworkService(options: NetworkServiceOptions): NetworkService {
  const now = options.now ?? Date.now;
  const makeClient = options.createClient ?? ((config) => createMihomoClient({
    baseUrl: config.baseUrl,
    secret: config.secret,
  }));
  const fullIntervalMs = options.fullIntervalMs ?? 10_000;
  const trafficIntervalMs = options.trafficIntervalMs ?? 1500;
  const detailTtlMs = options.detailTtlMs ?? DETAIL_TTL_MS;
  const logRetryMs = options.logRetryMs ?? LOG_RETRY_MS;

  let snapshot = emptyNetworkSnapshot();
  let client: MihomoClient | null = null;
  let clientKey = "";
  const listeners = new Set<(update: NetworkUpdate) => void>();
  let fullTimer: ReturnType<typeof setInterval> | null = null;
  let trafficTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let refreshing = false;
  let trafficBusy = false;

  let rulesCache: { at: number; entries: RuleEntry[] } | null = null;
  let providersCache: { at: number; entries: ProviderInfo[] } | null = null;

  let logEntries: LogEntry[] = [];
  const logListeners = new Set<(entry: LogEntry) => void>();
  let logsWanted = false;
  let logsLevel: LogLevel = "info";
  let logsAbort: AbortController | null = null;
  let logsStreaming = false;
  let logsError: ReturnType<typeof reasonOf> | null = null;
  let logsRetryTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(update: NetworkUpdate): void {
    for (const listener of listeners) {
      try {
        listener(update);
      } catch {
        // 订阅方的异常不许打断轮询
      }
    }
  }

  function publishSnapshot(): void {
    emit({ kind: "snapshot", snapshot });
  }

  function fail(reason: NetworkSnapshot["controller"]["reason"], baseUrl: string | null): void {
    snapshot = {
      ...snapshot,
      controller: { available: false, baseUrl, reason, version: null },
      groups: [],
    };
    publishSnapshot();
  }

  function ensureClient(config: ControllerConfig): MihomoClient {
    const key = `${config.baseUrl}\u0000${config.secret}`;
    if (!client || clientKey !== key) {
      client = makeClient(config);
      clientKey = key;
      rulesCache = null;
      providersCache = null;
    }
    return client;
  }

  async function refreshTraffic(): Promise<void> {
    if (!client || trafficBusy) return;
    trafficBusy = true;
    try {
      const frame = await client.traffic();
      snapshot = { ...snapshot, traffic: frame };
      emit({ kind: "traffic", traffic: frame });
    } catch (error) {
      if (error instanceof MihomoRequestError && error.reason === "unauthorized") {
        fail("unauthorized", snapshot.controller.baseUrl);
      }
      // 流量失败不抹掉已成功拉到的节点树：下一轮再判。
    } finally {
      trafficBusy = false;
    }
  }

  async function refresh(): Promise<NetworkSnapshot> {
    if (refreshing) return snapshot;
    refreshing = true;
    try {
      const root = options.getConfigRoot();
      // 我们自己那颗在跑时，盘上那本账（Verge 的）说的地址与口令可能是别人的——信当下的进程，别信账。
      const ours = options.coreController?.() ?? null;
      const result = ours
        ? ({ ok: true, config: ours } as const)
        : readControllerConfig(root);
      if (!result.ok) {
        client = null;
        clientKey = "";
        fail(result.reason, null);
        return snapshot;
      }
      const config = result.config;
      const active = ensureClient(config);
      try {
        const version = await active.version();
        const [mode, groups, connections] = await Promise.all([
          active.mode().catch(() => null),
          active.groups().catch(() => []),
          active.connections().catch(() => ({ total: 0, proxy: 0, direct: 0, reject: 0 })),
        ]);
        snapshot = {
          controller: { available: true, baseUrl: config.baseUrl, reason: null, version },
          mode,
          groups,
          connections,
          subscription: readSubscription(root),
          traffic: snapshot.traffic ?? { ...EMPTY_TRAFFIC },
          updatedAt: now(),
        };
        publishSnapshot();
        void refreshTraffic();
      } catch (error) {
        const reason = error instanceof MihomoRequestError ? error.reason : "unreachable";
        fail(reason, config.baseUrl);
      }
      return snapshot;
    } finally {
      refreshing = false;
    }
  }

  async function requireClient(): Promise<MihomoClient> {
    if (!client) await refresh();
    if (!client) throw new MihomoRequestError("no-controller", "controller unavailable");
    return client;
  }

  async function setMode(mode: ProxyMode): Promise<NetworkSnapshot> {
    const active = await requireClient();
    await active.setMode(mode);
    snapshot = { ...snapshot, mode };
    publishSnapshot();
    return refresh();
  }

  async function selectNode(group: string, node: string): Promise<NetworkSnapshot> {
    const active = await requireClient();
    await active.selectNode(group, node);
    snapshot = {
      ...snapshot,
      groups: snapshot.groups.map((entry) => entry.name === group ? { ...entry, now: node } : entry),
    };
    publishSnapshot();
    return refresh();
  }

  async function testGroup(group: string): Promise<Record<string, number>> {
    const active = await requireClient();
    const delays = await active.groupDelay(group);
    const at = now();
    snapshot = {
      ...snapshot,
      groups: snapshot.groups.map((entry) => entry.name !== group ? entry : {
        ...entry,
        nodes: entry.nodes.map((node) => {
          const delay = delays[node.name];
          if (delay === undefined) {
            return { ...node, delay: null, alive: false, history: [...node.history, null].slice(-10) };
          }
          return { ...node, delay, alive: true, history: [...node.history, delay].slice(-10) };
        }),
      }),
      updatedAt: at,
    };
    publishSnapshot();
    return delays;
  }

  async function autoSelect(group: string): Promise<AutoSelectResult> {
    const active = await requireClient();
    const target = snapshot.groups.find((entry) => entry.name === group);
    const previous = target?.now ?? "";
    const delays = await active.groupDelay(group);
    const best = Object.entries(delays)
      .filter(([, delay]) => delay > 0)
      .sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
    let switched = false;
    if (best && best !== previous) {
      await active.selectNode(group, best);
      // testGroup 会按快照重建组对象；不在这里同步 now，UI 会拿着旧选中项直到下一轮刷新。
      snapshot = {
        ...snapshot,
        groups: snapshot.groups.map((entry) => entry.name === group ? { ...entry, now: best } : entry),
      };
      switched = true;
    }
    await testGroup(group);
    return { group, previous, best, switched };
  }

  async function fetchRules(force = false): Promise<RuleEntry[]> {
    if (!force && rulesCache && now() - rulesCache.at < detailTtlMs) return rulesCache.entries;
    const active = await requireClient();
    const entries = await active.rules();
    rulesCache = { at: now(), entries };
    return entries;
  }

  async function fetchConnections(): Promise<ConnectionDetail[]> {
    const active = await requireClient();
    return active.connectionsDetail();
  }

  async function fetchProviders(force = false): Promise<ProviderInfo[]> {
    if (!force && providersCache && now() - providersCache.at < detailTtlMs) return providersCache.entries;
    const active = await requireClient();
    const entries = await active.providers();
    providersCache = { at: now(), entries };
    return entries;
  }

  async function fetchConfig(): Promise<CoreConfigView> {
    const active = await requireClient();
    return active.configs();
  }

  async function saveConfig(patch: CoreConfigPatch): Promise<CoreConfigView> {
    const active = await requireClient();
    await active.patchConfigs(patch);
    // 写后回读：页面只认内核真的落下去了什么，不认自己刚发出去的那份。
    return fetchConfig();
  }

  async function closeConnection(id: string): Promise<void> {
    const active = await requireClient();
    await active.closeConnection(id);
  }

  async function closeAllConnections(): Promise<void> {
    const active = await requireClient();
    await active.closeAllConnections();
  }

  async function providerCheck(name: string): Promise<ProviderInfo[]> {
    const active = await requireClient();
    await active.providerHealthCheck(name);
    return fetchProviders(true);
  }

  function clearLogRetry(): void {
    if (logsRetryTimer) clearTimeout(logsRetryTimer);
    logsRetryTimer = null;
  }

  function scheduleLogRetry(): void {
    if (!logsWanted || logsRetryTimer) return;
    logsRetryTimer = setTimeout(() => {
      logsRetryTimer = null;
      if (!logsWanted) return;
      void runLogs().catch(() => { /* runLogs 自己记错 */ });
    }, logRetryMs);
  }

  async function runLogs(): Promise<void> {
    const controller = new AbortController();
    logsAbort = controller;
    logsStreaming = true;
    try {
      const active = await requireClient();
      await active.logs((entry) => {
        if (!logsWanted) return;
        logEntries.push(entry);
        if (logEntries.length > LOG_BUFFER_LIMIT) {
          logEntries = logEntries.slice(-LOG_BUFFER_LIMIT);
        }
        for (const listener of logListeners) {
          try {
            listener(entry);
          } catch {
            // 订阅方的异常不许打断日志流
          }
        }
      }, { level: logsLevel, signal: controller.signal });
      if (logsWanted && logsAbort === controller) scheduleLogRetry();
    } catch (error) {
      if (logsAbort === controller) {
        logsError = reasonOf(error);
        scheduleLogRetry();
      }
    } finally {
      if (logsAbort === controller) {
        logsAbort = null;
        logsStreaming = false;
      }
    }
  }

  async function startLogs(level: LogLevel = "info"): Promise<void> {
    await requireClient();
    if (logsWanted && logsLevel === level && (logsStreaming || logsRetryTimer)) return;
    stopLogs();
    logsWanted = true;
    logsLevel = level;
    logsError = null;
    void runLogs();
    // 让「连上就失败」在 start 的回执里就能看见，页面不必等一拍。
    await Promise.resolve();
  }

  function stopLogs(): void {
    logsWanted = false;
    clearLogRetry();
    logsStreaming = false;
    const controller = logsAbort;
    logsAbort = null;
    controller?.abort();
  }

  function start(): void {
    if (running) return;
    running = true;
    void refresh();
    fullTimer = setInterval(() => { void refresh(); }, fullIntervalMs);
    trafficTimer = setInterval(() => { void refreshTraffic(); }, trafficIntervalMs);
  }

  function stop(): void {
    running = false;
    if (fullTimer) clearInterval(fullTimer);
    if (trafficTimer) clearInterval(trafficTimer);
    fullTimer = null;
    trafficTimer = null;
    stopLogs();
  }

  return {
    getSnapshot: () => snapshot,
    refresh,
    setMode,
    selectNode,
    testGroup,
    autoSelect,
    fetchRules,
    fetchConnections,
    fetchProviders,
    fetchConfig,
    saveConfig,
    closeConnection,
    closeAllConnections,
    providerCheck,
    startLogs,
    stopLogs,
    getLogs: () => ({ entries: [...logEntries], streaming: logsStreaming, error: logsError }),
    subscribeLogs: (listener) => {
      logListeners.add(listener);
      return () => logListeners.delete(listener);
    },
    start,
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

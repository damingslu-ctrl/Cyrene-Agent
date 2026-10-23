/**
 * 网络页的聚合服务：轮询 mihomo、缓存快照、串行化写操作。
 *
 * 流量 1.5s 一帧（只推 traffic，避免每帧搬整棵节点树），完整快照 10s 一次；
 * 所有写操作完成后立刻回读一次，UI 不靠乐观值撑场面。
 */
import {
  EMPTY_TRAFFIC,
  emptyNetworkSnapshot,
  type NetworkSnapshot,
  type NetworkUpdate,
  type ProxyMode,
} from "../../shared/network-types";
import { readControllerConfig, readSubscription, type ControllerConfig } from "./controller-config";
import { createMihomoClient, MihomoRequestError, type MihomoClient } from "./mihomo-client";

export type { NetworkUpdate };

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
  start(): void;
  stop(): void;
  subscribe(listener: (update: NetworkUpdate) => void): () => void;
}

export interface NetworkServiceOptions {
  getConfigRoot: () => string | null;
  createClient?: (config: ControllerConfig) => MihomoClient;
  now?: () => number;
  fullIntervalMs?: number;
  trafficIntervalMs?: number;
}

export function createNetworkService(options: NetworkServiceOptions): NetworkService {
  const now = options.now ?? Date.now;
  const makeClient = options.createClient ?? ((config) => createMihomoClient({
    baseUrl: config.baseUrl,
    secret: config.secret,
  }));
  const fullIntervalMs = options.fullIntervalMs ?? 10_000;
  const trafficIntervalMs = options.trafficIntervalMs ?? 1500;

  let snapshot = emptyNetworkSnapshot();
  let client: MihomoClient | null = null;
  let clientKey = "";
  const listeners = new Set<(update: NetworkUpdate) => void>();
  let fullTimer: ReturnType<typeof setInterval> | null = null;
  let trafficTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let refreshing = false;
  let trafficBusy = false;

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
      const result = readControllerConfig(root);
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
  }

  return {
    getSnapshot: () => snapshot,
    refresh,
    setMode,
    selectNode,
    testGroup,
    autoSelect,
    start,
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

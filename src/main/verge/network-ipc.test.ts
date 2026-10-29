import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { emptyNetworkSnapshot, type NetworkSnapshot, type ProxyMode } from "../../shared/network-types";
import type { IpcScope } from "../application/ipc-scope";
import { MihomoRequestError } from "./mihomo-client";
import { registerNetworkIpc } from "./network-ipc";
import type { NetworkService, NetworkUpdate } from "./network-service";

function makeScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const registered: string[] = [];
  const scope = {
    handlers,
    registered,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, listener);
      registered.push(channel);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

function makeService() {
  let snapshot: NetworkSnapshot = emptyNetworkSnapshot();
  let listener: ((update: NetworkUpdate) => void) | null = null;
  let unsubscribe = vi.fn(() => { listener = null; });
  let logListener: ((entry: unknown) => void) | null = null;
  const service = {
    getSnapshot: vi.fn(() => snapshot),
    refresh: vi.fn(async () => {
      snapshot = { ...snapshot, updatedAt: 42 };
      listener?.({ kind: "snapshot", snapshot });
      return snapshot;
    }),
    setMode: vi.fn(async (mode: ProxyMode) => {
      snapshot = { ...snapshot, mode, updatedAt: 43 };
      return snapshot;
    }),
    selectNode: vi.fn(async () => snapshot),
    testGroup: vi.fn(async () => ({ node1: 12 })),
    autoSelect: vi.fn(async () => ({ group: "G", previous: "a", best: "b", switched: true })),
    fetchRules: vi.fn(async () => []),
    fetchConnections: vi.fn(async () => []),
    fetchProviders: vi.fn(async () => []),
    fetchConfig: vi.fn(async () => ({ mixedPort: 7896 })),
    saveConfig: vi.fn(async () => ({ mixedPort: 7890 })),
    closeConnection: vi.fn(async () => {}),
    closeAllConnections: vi.fn(async () => {}),
    providerCheck: vi.fn(async () => [{ name: "机场" }]),
    startLogs: vi.fn(async () => {}),
    stopLogs: vi.fn(),
    getLogs: vi.fn(() => ({ entries: [], streaming: false, error: null })),
    subscribeLogs: vi.fn((next: (entry: unknown) => void) => {
      logListener = next;
      return () => { logListener = null; };
    }),
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn((next: (update: NetworkUpdate) => void) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    service: service as unknown as NetworkService & typeof service,
    emit: (update: NetworkUpdate) => listener?.(update),
    emitLog: (entry: unknown) => logListener?.(entry),
  };
}

function setup() {
  const scope = makeScope();
  const { service, emit, emitLog } = makeService();
  const broadcast = vi.fn();
  const dispose = registerNetworkIpc(scope, { service, broadcast });
  return { scope, service, broadcast, emit, emitLog, dispose };
}

describe("registerNetworkIpc", () => {
  it("注册六个 handle，GET 在从未成功拉过时顺手触发一次刷新", async () => {
    const { scope, service } = setup();
    expect(scope.registered.slice(0, 6)).toEqual([
      IPC.VERGE_NETWORK_GET,
      IPC.VERGE_NETWORK_REFRESH,
      IPC.VERGE_NETWORK_SET_MODE,
      IPC.VERGE_NETWORK_SELECT_NODE,
      IPC.VERGE_NETWORK_TEST_GROUP,
      IPC.VERGE_NETWORK_AUTO_SELECT,
    ]);
    const get = scope.handlers.get(IPC.VERGE_NETWORK_GET)!;
    const first = await get({});
    expect(first).toMatchObject({ updatedAt: 0 });
    expect(service.refresh).toHaveBeenCalledOnce();

    service.getSnapshot.mockReturnValue({ ...emptyNetworkSnapshot(), updatedAt: 7 });
    await get({});
    expect(service.refresh).toHaveBeenCalledOnce();
  });

  it("服务广播原样转成 VERGE_NETWORK_UPDATE；dispose 后退订且六个 handler 全摘", async () => {
    const { scope, broadcast, emit, dispose, service } = setup();
    const update: NetworkUpdate = { kind: "traffic", traffic: { up: 1, down: 2, at: 3 } };
    emit(update);
    expect(broadcast).toHaveBeenCalledWith(IPC.VERGE_NETWORK_UPDATE, update);
    dispose();
    expect(service.subscribe).toHaveBeenCalledOnce();
    emit(update);
    expect(broadcast).toHaveBeenCalledOnce();
    for (const channel of scope.registered) {
      expect(scope.removeHandler).toHaveBeenCalledWith(channel);
    }
    expect(scope.handlers.size).toBe(0);
  });

  it("SET_MODE：非法值不碰服务；合法值回快照；内核错误翻译成 reason", async () => {
    const { scope, service } = setup();
    const setMode = scope.handlers.get(IPC.VERGE_NETWORK_SET_MODE)!;
    expect(await setMode({}, "turbo")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(service.setMode).not.toHaveBeenCalled();

    expect(await setMode({}, "direct")).toMatchObject({ ok: true, snapshot: { mode: "direct" } });
    expect(service.setMode).toHaveBeenCalledWith("direct");

    service.setMode.mockRejectedValueOnce(new MihomoRequestError("unauthorized", "401"));
    expect(await setMode({}, "rule")).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("SELECT_NODE：组名/节点名必须是非空字符串；成功走服务", async () => {
    const { scope, service } = setup();
    const select = scope.handlers.get(IPC.VERGE_NETWORK_SELECT_NODE)!;
    expect(await select({}, "", "n")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await select({}, "G", "")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await select({}, "G", 2)).toMatchObject({ ok: false, reason: "bad-response" });
    expect(service.selectNode).not.toHaveBeenCalled();

    expect(await select({}, "Selector", "node1")).toMatchObject({ ok: true });
    expect(service.selectNode).toHaveBeenCalledWith("Selector", "node1");
  });

  it("TEST_GROUP 与 AUTO_SELECT：空组名拒绝，成功带回执", async () => {
    const { scope, service } = setup();
    const test = scope.handlers.get(IPC.VERGE_NETWORK_TEST_GROUP)!;
    const auto = scope.handlers.get(IPC.VERGE_NETWORK_AUTO_SELECT)!;
    expect(await test({}, " ")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await auto({}, null)).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await test({}, "Selector")).toMatchObject({ ok: true, delays: { node1: 12 } });
    expect(await auto({}, "Selector")).toMatchObject({
      ok: true, result: { best: "b", switched: true },
    });
    expect(service.autoSelect).toHaveBeenCalledWith("Selector");
  });
});

describe("网络页明细通道", () => {
  it("十一条通道全注册；日志上行以 VERGE_NETWORK_LOG 广播", () => {
    const { scope, emitLog, broadcast } = setup();
    expect(scope.registered.slice(6)).toEqual([
      IPC.VERGE_NETWORK_RULES,
      IPC.VERGE_NETWORK_CONNECTIONS,
      IPC.VERGE_NETWORK_CLOSE_CONNECTION,
      IPC.VERGE_NETWORK_CLOSE_ALL_CONNECTIONS,
      IPC.VERGE_NETWORK_PROVIDERS,
      IPC.VERGE_NETWORK_PROVIDER_CHECK,
      IPC.VERGE_NETWORK_CONFIG_GET,
      IPC.VERGE_NETWORK_CONFIG_SET,
      IPC.VERGE_NETWORK_LOGS_START,
      IPC.VERGE_NETWORK_LOGS_STOP,
      IPC.VERGE_NETWORK_LOGS_GET,
    ]);
    emitLog({ type: "info", payload: "x", at: 1 });
    expect(broadcast).toHaveBeenCalledWith(IPC.VERGE_NETWORK_LOG, { type: "info", payload: "x", at: 1 });
  });

  it("RULES 只有 === true 才穿透缓存", async () => {
    const { scope, service } = setup();
    const rules = scope.handlers.get(IPC.VERGE_NETWORK_RULES)!;
    expect(await rules({}, true)).toEqual({ ok: true, data: [] });
    expect(service.fetchRules).toHaveBeenLastCalledWith(true);
    await rules({}, "yes");
    expect(service.fetchRules).toHaveBeenLastCalledWith(false);
    service.fetchRules.mockRejectedValueOnce(new MihomoRequestError("timeout", "slow"));
    expect(await rules({})).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("写操作先校验：坏 id/空名/非白名单配置不碰服务", async () => {
    const { scope, service } = setup();
    const close = scope.handlers.get(IPC.VERGE_NETWORK_CLOSE_CONNECTION)!;
    const check = scope.handlers.get(IPC.VERGE_NETWORK_PROVIDER_CHECK)!;
    const setConfig = scope.handlers.get(IPC.VERGE_NETWORK_CONFIG_SET)!;
    expect(await close({}, "")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await close({}, "x".repeat(300))).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await check({}, "  ")).toMatchObject({ ok: false, reason: "bad-response" });
    expect(await setConfig({}, { secret: "x" })).toMatchObject({ ok: false, reason: "bad-response" });
    expect(service.closeConnection).not.toHaveBeenCalled();
    expect(service.providerCheck).not.toHaveBeenCalled();
    expect(service.saveConfig).not.toHaveBeenCalled();

    expect(await close({}, "c1")).toEqual({ ok: true });
    expect(service.closeConnection).toHaveBeenCalledWith("c1");
    expect(await scope.handlers.get(IPC.VERGE_NETWORK_CLOSE_ALL_CONNECTIONS)!({})).toEqual({ ok: true });
    expect(service.closeAllConnections).toHaveBeenCalledOnce();
    expect(await check({}, "机场")).toMatchObject({ ok: true, data: [{ name: "机场" }] });
    expect(await setConfig({}, { "mixed-port": 7890 })).toMatchObject({ ok: true, data: { mixedPort: 7890 } });
    expect(service.saveConfig).toHaveBeenCalledWith({ "mixed-port": 7890 });
  });

  it("日志三条：start 校验档位、get 原样回状态、stop 转发", async () => {
    const { scope, service } = setup();
    const start = scope.handlers.get(IPC.VERGE_NETWORK_LOGS_START)!;
    const get = scope.handlers.get(IPC.VERGE_NETWORK_LOGS_GET)!;
    const stop = scope.handlers.get(IPC.VERGE_NETWORK_LOGS_STOP)!;
    expect(await start({}, "trace")).toEqual({ ok: false, reason: "bad-response" });
    expect(service.startLogs).not.toHaveBeenCalled();

    expect(await start({})).toEqual({ ok: true });
    expect(service.startLogs).toHaveBeenLastCalledWith("info");
    expect(await start({}, "warning")).toEqual({ ok: true });
    expect(service.startLogs).toHaveBeenLastCalledWith("warning");

    service.getLogs.mockReturnValueOnce({ entries: [], streaming: true, error: null });
    expect(await get({})).toEqual({ ok: true, data: { entries: [], streaming: true, error: null } });
    expect(await stop({})).toEqual({ ok: true });
    expect(service.stopLogs).toHaveBeenCalledOnce();
  });
});

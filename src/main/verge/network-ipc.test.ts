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
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn((next: (update: NetworkUpdate) => void) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return { service: service as unknown as NetworkService & typeof service, emit: (update: NetworkUpdate) => listener?.(update) };
}

function setup() {
  const scope = makeScope();
  const { service, emit } = makeService();
  const broadcast = vi.fn();
  const dispose = registerNetworkIpc(scope, { service, broadcast });
  return { scope, service, broadcast, emit, dispose };
}

describe("registerNetworkIpc", () => {
  it("注册六个 handle，GET 在从未成功拉过时顺手触发一次刷新", async () => {
    const { scope, service } = setup();
    expect(scope.registered).toEqual([
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

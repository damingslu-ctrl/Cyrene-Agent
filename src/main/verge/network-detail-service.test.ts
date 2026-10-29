import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../shared/network-detail-types";
import { clearConfigCache } from "./controller-config";
import { MihomoRequestError, type MihomoClient } from "./mihomo-client";
import { createNetworkService, type NetworkService } from "./network-service";

const tempDirs: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mochi-net-detail-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "clash-verge.yaml"), "external-controller: 127.0.0.1:9097\nmixed-port: 7896\n");
  return dir;
}

interface LogHandle {
  onEntry: (entry: LogEntry) => void;
  signal?: AbortSignal;
}

function fakeClient() {
  const logHandles: LogHandle[] = [];
  const client = {
    version: vi.fn(async () => "alpha"),
    mode: vi.fn(async () => "rule" as const),
    groups: vi.fn(async () => []),
    connections: vi.fn(async () => ({ total: 0, proxy: 0, direct: 0, reject: 0 })),
    traffic: vi.fn(async () => ({ up: 0, down: 0, at: 1 })),
    setMode: vi.fn(async () => {}),
    selectNode: vi.fn(async () => {}),
    groupDelay: vi.fn(async () => ({})),
    rules: vi.fn(async () => [
      { type: "Domain", payload: "a.com", proxy: "n1", size: -1 },
      { type: "Match", payload: "", proxy: "DIRECT", size: -1 },
    ]),
    connectionsDetail: vi.fn(async () => [{
      id: "c1", host: "a.com", network: "tcp", destination: "1.2.3.4:443", process: "",
      upload: 1, download: 2, startedAt: 0, chains: ["n1"], rule: "Domain", rulePayload: "a.com",
    }]),
    closeConnection: vi.fn(async () => {}),
    closeAllConnections: vi.fn(async () => {}),
    providers: vi.fn(async () => [
      { name: "机场", vehicle: "HTTP", nodeCount: 3, aliveCount: 2, updatedAt: null },
    ]),
    providerHealthCheck: vi.fn(async () => {}),
    configs: vi.fn(async () => ({
      mixedPort: 7896, port: null, socksPort: null, allowLan: null, ipv6: null,
      mode: "rule" as const, logLevel: "info" as const, tunEnabled: false, tunStack: null,
    })),
    patchConfigs: vi.fn(async () => {}),
    reloadConfig: vi.fn(async () => {}),
    nodeDelay: vi.fn(async () => 120),
    logs: vi.fn((onEntry: (entry: LogEntry) => void, options?: { signal?: AbortSignal }) => {
      logHandles.push({ onEntry, signal: options?.signal });
      return new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }),
  };
  return { client, logHandles };
}

function makeService(
  handle: ReturnType<typeof fakeClient>,
  clock: { value: number },
): NetworkService {
  return createNetworkService({
    getConfigRoot: makeRoot,
    createClient: () => handle.client as unknown as MihomoClient,
    now: () => clock.value,
    fullIntervalMs: 10_000_000,
    trafficIntervalMs: 10_000_000,
  });
}

async function ready(handle: ReturnType<typeof fakeClient>, clock = { value: 1_700_000_000_000 }) {
  const service = makeService(handle, clock);
  await service.refresh();
  return service;
}

beforeEach(() => clearConfigCache());
afterEach(() => {
  vi.useRealTimers();
  clearConfigCache();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("明细读接口的缓存口径", () => {
  it("规则与入站有 5s 缓存，force 才穿透", async () => {
    const handle = fakeClient();
    const clock = { value: 1_700_000_000_000 };
    const service = await ready(handle, clock);

    await service.fetchRules();
    await service.fetchRules();
    expect(handle.client.rules).toHaveBeenCalledOnce();

    clock.value += 4_999;
    await service.fetchRules();
    expect(handle.client.rules).toHaveBeenCalledOnce();

    clock.value += 2;
    expect((await service.fetchRules())[0].payload).toBe("a.com");
    expect(handle.client.rules).toHaveBeenCalledTimes(2);

    await service.fetchRules(true);
    expect(handle.client.rules).toHaveBeenCalledTimes(3);

    await service.fetchProviders();
    await service.fetchProviders();
    expect(handle.client.providers).toHaveBeenCalledOnce();
    await service.fetchProviders(true);
    expect(handle.client.providers).toHaveBeenCalledTimes(2);
  });

  it("配置与连接明细不缓存：设置页读回必须是真的当下值", async () => {
    const handle = fakeClient();
    const service = await ready(handle);
    await service.fetchConfig();
    await service.fetchConfig();
    await service.fetchConnections();
    await service.fetchConnections();
    expect(handle.client.configs).toHaveBeenCalledTimes(2);
    expect(handle.client.connectionsDetail).toHaveBeenCalledTimes(2);
  });

  it("saveConfig 写后回读；入站测速后重读列表；关连接原样转发", async () => {
    const handle = fakeClient();
    const service = await ready(handle);
    await service.fetchProviders();

    const view = await service.saveConfig({ "mixed-port": 7890 });
    expect(handle.client.patchConfigs).toHaveBeenCalledWith({ "mixed-port": 7890 });
    expect(view.mixedPort).toBe(7896);
    expect(handle.client.configs).toHaveBeenCalledOnce();

    await service.providerCheck("机场");
    expect(handle.client.providerHealthCheck).toHaveBeenCalledWith("机场");
    expect(handle.client.providers).toHaveBeenCalledTimes(2);

    await service.closeConnection("c1");
    await service.closeAllConnections();
    expect(handle.client.closeConnection).toHaveBeenCalledWith("c1");
    expect(handle.client.closeAllConnections).toHaveBeenCalledOnce();
  });

  it("控制器不可用时抛 no-controller（页面拿到的是原因，不是空数组）", async () => {
    const handle = fakeClient();
    const service = createNetworkService({
      getConfigRoot: () => null,
      createClient: () => handle.client as unknown as MihomoClient,
      now: () => 1,
    });
    await expect(service.fetchRules()).rejects.toMatchObject({ reason: "no-controller" });
    await expect(service.saveConfig({ ipv6: true })).rejects.toMatchObject({ reason: "no-controller" });
  });
});

describe("日志流", () => {
  it("startLogs 收行、500 行封顶、订阅者同步收到；同一档重复 start 不重开", async () => {
    const handle = fakeClient();
    const service = await ready(handle);
    const seen: LogEntry[] = [];
    service.subscribeLogs((entry) => seen.push(entry));

    await service.startLogs("info");
    await service.startLogs("info");
    expect(handle.client.logs).toHaveBeenCalledOnce();
    expect(handle.client.logs.mock.calls[0][1]).toMatchObject({ level: "info" });
    expect(service.getLogs().streaming).toBe(true);

    for (let i = 0; i < 520; i += 1) {
      handle.logHandles[0].onEntry({ type: "info", payload: `e${i}`, at: i });
    }
    const logs = service.getLogs();
    expect(logs.entries).toHaveLength(500);
    expect(logs.entries[0].payload).toBe("e20");
    expect(logs.entries[499].payload).toBe("e519");
    expect(seen).toHaveLength(520);
  });

  it("换档重开；stopLogs 中止流并保留已收行；再 start 从新流继续", async () => {
    const handle = fakeClient();
    const service = await ready(handle);
    await service.startLogs("info");
    handle.logHandles[0].onEntry({ type: "info", payload: "old", at: 1 });

    await service.startLogs("warning");
    expect(handle.client.logs).toHaveBeenCalledTimes(2);
    expect(handle.client.logs.mock.calls[1][1]).toMatchObject({ level: "warning" });
    expect(handle.logHandles[0].signal?.aborted).toBe(true);
    expect(handle.logHandles[1].signal?.aborted).toBe(false);

    service.stopLogs();
    expect(handle.logHandles[1].signal?.aborted).toBe(true);
    expect(service.getLogs()).toMatchObject({ streaming: false });
    expect(service.getLogs().entries.map((entry) => entry.payload)).toEqual(["old"]);

    await service.startLogs();
    expect(handle.client.logs).toHaveBeenCalledTimes(3);
    expect(handle.client.logs.mock.calls[2][1]).toMatchObject({ level: "info" });
    service.stop();
    expect(handle.logHandles[2].signal?.aborted).toBe(true);
  });

  it("流异常先记错，3s 后自动重连；stopLogs 之后不再重连", async () => {
    vi.useFakeTimers();
    const handle = fakeClient();
    const service = await ready(handle);
    handle.client.logs.mockRejectedValueOnce(new MihomoRequestError("unreachable", "boom"));

    await service.startLogs("info");
    expect(service.getLogs()).toMatchObject({ streaming: false, error: "unreachable" });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(handle.client.logs).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(handle.client.logs).toHaveBeenCalledTimes(2);

    service.stopLogs();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handle.client.logs).toHaveBeenCalledTimes(2);
  });
});

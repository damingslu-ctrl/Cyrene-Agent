import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxyGroup, ProxyMode, TrafficFrame } from "../../shared/network-types";
import { clearConfigCache } from "./controller-config";
import { MihomoRequestError, type MihomoClient } from "./mihomo-client";
import { createNetworkService } from "./network-service";

const tempDirs: string[] = [];

function makeRoot(controller = "127.0.0.1:9097", extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mochi-net-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "clash-verge.yaml"), `external-controller: ${controller}\nmixed-port: 7896\n`);
  for (const [name, content] of Object.entries(extra)) writeFileSync(path.join(dir, name), content);
  return dir;
}

function group(now = "node1"): ProxyGroup {
  const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return {
    name: "Selector",
    type: "Selector",
    now,
    nodes: [
      { name: "node1", type: "Shadowsocks", delay: 10, history, alive: true },
      { name: "node2", type: "Trojan", delay: 20, history, alive: true },
      { name: "node3", type: "Hysteria2", delay: null, history: [], alive: true },
    ],
  };
}

function fakeClient(seed: {
  mode?: ProxyMode;
  groups?: ProxyGroup[];
  delays?: Record<string, number>;
  traffic?: TrafficFrame;
} = {}) {
  const state = {
    mode: seed.mode ?? "rule",
    groups: seed.groups ?? [group()],
  };
  return {
    version: vi.fn(async () => "alpha-e4dd968"),
    mode: vi.fn(async () => state.mode),
    groups: vi.fn(async () => state.groups),
    connections: vi.fn(async () => ({ total: 3, proxy: 2, direct: 1, reject: 0 })),
    traffic: vi.fn(async () => seed.traffic ?? { up: 10, down: 20, at: 1 }),
    setMode: vi.fn(async (mode: ProxyMode) => { state.mode = mode; }),
    selectNode: vi.fn(async (name: string, node: string) => {
      const target = state.groups.find((entry) => entry.name === name);
      if (target) target.now = node;
    }),
    groupDelay: vi.fn(async () => seed.delays ?? { node1: 300, node2: 50, node3: 0 }),
  };
}

function makeService(root: string | null, client: ReturnType<typeof fakeClient>, overrides: {
  now?: () => number;
  fullIntervalMs?: number;
  trafficIntervalMs?: number;
} = {}) {
  return createNetworkService({
    getConfigRoot: () => root,
    createClient: () => client as MihomoClient,
    now: overrides.now ?? (() => 1_700_000_000_000),
    fullIntervalMs: overrides.fullIntervalMs,
    trafficIntervalMs: overrides.trafficIntervalMs,
  });
}

beforeEach(() => clearConfigCache());
afterEach(() => {
  vi.useRealTimers();
  clearConfigCache();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("快照刷新", () => {
  it("成功：控制器/模式/组/连接/订阅/流量都进快照并广播", async () => {
    const root = makeRoot("127.0.0.1:9097", {
      "profiles.yaml": "current: x\nitems:\n  - uid: x\n    name: plain\n    extra: { upload: 1, download: 2, total: 3 }\n",
    });
    const client = fakeClient();
    const service = makeService(root, client);
    const updates: unknown[] = [];
    service.subscribe((update) => updates.push(update));

    const snapshot = await service.refresh();
    expect(snapshot.controller).toMatchObject({
      available: true, baseUrl: "http://127.0.0.1:9097", reason: null, version: "alpha-e4dd968",
    });
    expect(snapshot.mode).toBe("rule");
    expect(snapshot.groups[0].name).toBe("Selector");
    expect(snapshot.connections).toEqual({ total: 3, proxy: 2, direct: 1, reject: 0 });
    expect(snapshot.subscription).toMatchObject({ name: "plain", user: "", upload: 1, download: 2, total: 3 });
    expect(snapshot.updatedAt).toBe(1_700_000_000_000);
    expect(updates).toContainEqual({ kind: "snapshot", snapshot });

    await vi.waitFor(() => expect(client.traffic).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(service.getSnapshot().traffic).toEqual({ up: 10, down: 20, at: 1 }));
    expect(updates).toContainEqual({ kind: "traffic", traffic: { up: 10, down: 20, at: 1 } });
  });

  it("没有配置 → no-config；版本请求失败按错误原因落账（可用性为假、组清空）", async () => {
    const service = makeService(null, fakeClient());
    const snapshot = await service.refresh();
    expect(snapshot.controller).toMatchObject({ available: false, reason: "no-config", baseUrl: null });
    expect(snapshot.groups).toEqual([]);
    expect(snapshot.updatedAt).toBe(0);

    const client = fakeClient();
    client.version.mockRejectedValueOnce(new MihomoRequestError("unauthorized", "401"));
    const failing = makeService(makeRoot(), client);
    expect((await failing.refresh()).controller).toMatchObject({
      available: false, reason: "unauthorized", baseUrl: "http://127.0.0.1:9097",
    });
  });

  it("控制器地址变了会重建客户端（不拿旧密钥连新地址）", async () => {
    const rootA = makeRoot("127.0.0.1:9097");
    const rootB = makeRoot("127.0.0.1:9098");
    let current = rootA;
    const a = fakeClient();
    const b = fakeClient();
    const created: string[] = [];
    const service = createNetworkService({
      getConfigRoot: () => current,
      createClient: (config) => {
        created.push(config.baseUrl);
        return (config.baseUrl.endsWith("9097") ? a : b) as MihomoClient;
      },
    });
    await service.refresh();
    current = rootB;
    await service.refresh();
    expect(created).toEqual(["http://127.0.0.1:9097", "http://127.0.0.1:9098"]);
    expect(service.getSnapshot().controller.baseUrl).toBe("http://127.0.0.1:9098");
  });

  it("流量 401 会把控制器降级；其它流量错误不抹掉已拉到的节点树", async () => {
    const client = fakeClient();
    const service = makeService(makeRoot(), client);
    await service.refresh();
    await vi.waitFor(() => expect(client.traffic).toHaveBeenCalledOnce());

    client.traffic.mockRejectedValueOnce(new Error("ECONNRESET"));
    await service.refresh();
    await vi.waitFor(() => expect(client.traffic).toHaveBeenCalledTimes(2));
    expect(service.getSnapshot().groups[0].name).toBe("Selector");

    client.traffic.mockRejectedValueOnce(new MihomoRequestError("unauthorized", "401"));
    await service.refresh();
    await vi.waitFor(() => expect(service.getSnapshot().controller.available).toBe(false));
    expect(service.getSnapshot().controller.reason).toBe("unauthorized");
    expect(service.getSnapshot().groups).toEqual([]);
  });
});

describe("写操作", () => {
  it("切模式：先写内核、快照立刻反映，再回读一次", async () => {
    const client = fakeClient();
    const service = makeService(makeRoot(), client);
    await service.refresh();
    const snapshot = await service.setMode("global");
    expect(client.setMode).toHaveBeenCalledWith("global");
    expect(snapshot.mode).toBe("global");
    expect(client.mode).toHaveBeenCalledTimes(2);
  });

  it("切节点：走内核后按组名把 now 改成新节点（同名组以外不动）", async () => {
    const second: ProxyGroup = { name: "Other", type: "Selector", now: "node1", nodes: [] };
    const client = fakeClient({ groups: [group(), second] });
    const service = makeService(makeRoot(), client);
    await service.refresh();
    const snapshot = await service.selectNode("Selector", "node2");
    expect(client.selectNode).toHaveBeenCalledWith("Selector", "node2");
    expect(snapshot.groups.find((entry) => entry.name === "Selector")?.now).toBe("node2");
    expect(snapshot.groups.find((entry) => entry.name === "Other")?.now).toBe("node1");
  });

  it("测速：命中的节点更新延迟与历史；未返回的记失败（null + alive false），历史只留 10 条", async () => {
    // 客户端契约保证只回正数；这里故意带一个不在列表里的名字，验证服务不凭空造节点。
    const client = fakeClient({ delays: { node1: 99, ghost: 12 } });
    const service = makeService(makeRoot(), client);
    await service.refresh();
    const delays = await service.testGroup("Selector");
    expect(delays).toEqual({ node1: 99, ghost: 12 });
    const nodes = service.getSnapshot().groups[0].nodes;
    expect(nodes[0]).toMatchObject({ delay: 99, alive: true });
    expect(nodes[0].history).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 99]);
    expect(nodes[1]).toMatchObject({ delay: null, alive: false });
    expect(nodes[1].history.at(-1)).toBeNull();
    expect(nodes[2]).toMatchObject({ delay: null, alive: false });
    expect(service.getSnapshot().updatedAt).toBe(1_700_000_000_000);
  });

  it("自动择优：选最快且与当前不同才切；已经最快/全失败都不切", async () => {
    const client = fakeClient({ delays: { node1: 300, node2: 120, node3: 0 } });
    const service = makeService(makeRoot(), client);
    await service.refresh();
    expect(await service.autoSelect("Selector")).toEqual({
      group: "Selector", previous: "node1", best: "node2", switched: true,
    });
    expect(client.selectNode).toHaveBeenCalledWith("Selector", "node2");
    // 选完立刻可用：不等下一轮 10s 刷新，页面上的「当前节点」就是刚切过去的那个。
    expect(service.getSnapshot().groups[0].now).toBe("node2");

    client.groupDelay.mockResolvedValueOnce({ node1: 1, node2: 120, node3: 0 });
    expect(await service.autoSelect("Selector")).toMatchObject({ best: "node1", switched: true });

    client.groupDelay.mockResolvedValueOnce({ node1: 0, node2: 0 });
    const before = client.selectNode.mock.calls.length;
    expect(await service.autoSelect("Selector")).toMatchObject({ best: null, switched: false });
    expect(client.selectNode).toHaveBeenCalledTimes(before);

    client.groupDelay.mockResolvedValueOnce({ node1: 50, node2: 99 });
    const calls = client.selectNode.mock.calls.length;
    expect(await service.autoSelect("Selector")).toMatchObject({ previous: "node1", best: "node1", switched: false });
    expect(client.selectNode).toHaveBeenCalledTimes(calls);
  });
});

describe("轮询与订阅", () => {
  it("start 立刻拉一次、两个定时器各走各的；stop 后不再拉", async () => {
    vi.useFakeTimers();
    const root = makeRoot();
    const client = fakeClient();
    const service = makeService(root, client, { fullIntervalMs: 1000, trafficIntervalMs: 500 });
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.version).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(client.traffic).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(500);
    expect(client.traffic).toHaveBeenCalledTimes(2);
    expect(client.version).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(client.version).toHaveBeenCalledTimes(2);

    service.stop();
    const versions = client.version.mock.calls.length;
    const traffics = client.traffic.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.version).toHaveBeenCalledTimes(versions);
    expect(client.traffic).toHaveBeenCalledTimes(traffics);
  });

  it("一个订阅者抛错不影响其他订阅者；退订后不再收", async () => {
    const service = makeService(null, fakeClient());
    const received: string[] = [];
    const unsubscribe = service.subscribe(() => { throw new Error("boom"); });
    service.subscribe(() => received.push("ok"));
    await service.refresh();
    expect(received).toContain("ok");
    unsubscribe();
    received.length = 0;
    await service.refresh();
    expect(received).toEqual(["ok"]);
  });
});

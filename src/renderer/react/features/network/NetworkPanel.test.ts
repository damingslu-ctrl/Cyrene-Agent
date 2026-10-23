// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NetworkActionResult,
  NetworkAutoSelectResult,
  NetworkSnapshot,
  NetworkTestResult,
  NetworkUpdate,
  ProxyMode,
} from "../../../../shared/network-types";
import { NetworkPanel } from "./NetworkPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

type Listener = (update: NetworkUpdate) => void;

function makeSnapshot(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  const now = Date.now();
  return {
    controller: { available: true, baseUrl: "http://127.0.0.1:9097", reason: null, version: "alpha-e4dd968" },
    mode: "rule",
    groups: [
      {
        name: "GLOBAL",
        type: "Selector",
        now: "香港 01",
        nodes: [
          { name: "香港 01", type: "Shadowsocks", delay: 88, history: [90, 88, 86], alive: true },
          { name: "日本 02", type: "Trojan", delay: 210, history: [200, null, 220], alive: true },
          { name: "美国 03", type: "Vmess", delay: null, history: [], alive: false },
        ],
      },
      {
        name: "节点选择",
        type: "Selector",
        now: "备用 01",
        nodes: [{ name: "备用 01", type: "Hysteria2", delay: 120, history: [120], alive: true }],
      },
    ],
    connections: { total: 44, proxy: 30, direct: 12, reject: 2 },
    subscription: {
      name: "sub",
      user: "cyrene",
      expireAt: now + 5 * 86_400_000,
      updatedAt: now - 3_600_000,
      upload: 1024,
      download: 2048,
      total: 100 * 1024 * 1024,
    },
    traffic: { up: 512, down: 1536, at: now },
    updatedAt: now,
    ...overrides,
  };
}

function withCurrent(snapshot: NetworkSnapshot, group: string, node: string): NetworkSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups.map((entry) => entry.name === group ? { ...entry, now: node } : entry),
  };
}

function createApi(initial: NetworkSnapshot) {
  let listener: Listener | null = null;
  const unsubscribe = vi.fn(() => { listener = null; });
  const setMode = vi.fn(async (mode: ProxyMode): Promise<NetworkActionResult> => ({
    ok: true,
    snapshot: { ...initial, mode },
  }));
  const selectNode = vi.fn(async (group: string, node: string): Promise<NetworkActionResult> => ({
    ok: true,
    snapshot: withCurrent(initial, group, node),
  }));
  const testGroup = vi.fn(async (): Promise<NetworkTestResult> => ({
    ok: true,
    delays: { "香港 01": 88 },
    snapshot: initial,
  }));
  const autoSelect = vi.fn(async (group: string): Promise<NetworkAutoSelectResult> => ({
    ok: true,
    result: { group, previous: "香港 01", best: "日本 02", switched: true },
    snapshot: withCurrent(initial, group, "日本 02"),
  }));
  const api = {
    get: vi.fn(async () => initial),
    refresh: vi.fn(async () => initial),
    setMode,
    selectNode,
    testGroup,
    autoSelect,
    onUpdate: vi.fn((callback: Listener) => {
      listener = callback;
      return unsubscribe;
    }),
  };
  return {
    api,
    unsubscribe,
    emit: (update: NetworkUpdate) => listener?.(update),
  };
}

async function renderPanel(api: ReturnType<typeof createApi>["api"]) {
  Object.assign(window, { verge: { network: api } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(createElement(NetworkPanel)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

function nodeNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".net-node__name")].map((node) => node.textContent ?? "");
}

function buttonWithText(host: HTMLElement, selector: string, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>(selector)]
    .find((entry) => entry.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${selector} ${text}`);
  return button;
}

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.length = 0;
  document.body.replaceChildren();
  delete (window as Window & { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("NetworkPanel", () => {
  it("打开即刷新，并渲染流量、订阅、连接构成与按延迟排好的节点", async () => {
    const { api } = createApi(makeSnapshot());
    const host = await renderPanel(api);

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("网络");
    expect(host.textContent).toContain("内核已连接");
    expect(host.textContent).toContain("alpha-e4dd968");
    expect(host.querySelector(".net-rate__value")?.textContent).toBe("1.5 KB/s");
    expect(host.textContent).toContain("512 B/s");
    expect(host.textContent).toContain("cyrene");
    expect(host.textContent).toContain("44 条");
    expect(host.textContent).toContain("代理 30");
    expect(host.textContent).toContain("直连 12");
    expect(host.textContent).toContain("拦截 2");
    expect(host.textContent).toContain("香港 01");
    expect(nodeNames(host)).toEqual(["香港 01", "日本 02", "美国 03"]);
    expect(host.querySelector(".net-node.is-current .net-node__name")?.textContent).toBe("香港 01");
    expect(host.textContent).toContain("稳定 100%");
    expect(host.textContent).toContain("不可用");
  });

  it("切组与排序只改视图，点节点才发 selectNode 并采纳回执", async () => {
    const { api } = createApi(makeSnapshot());
    const host = await renderPanel(api);

    await act(async () => { buttonWithText(host, ".net-group", "节点选择").click(); });
    expect(nodeNames(host)).toEqual(["备用 01"]);
    expect(host.textContent).toContain("当前 备用 01");

    await act(async () => { buttonWithText(host, ".net-group", "GLOBAL").click(); });
    await act(async () => { buttonWithText(host, ".net-sort button", "名").click(); });
    expect(nodeNames(host)).toEqual(["美国 03", "日本 02", "香港 01"]);

    await act(async () => { buttonWithText(host, ".net-node", "日本 02").click(); });
    expect(api.selectNode).toHaveBeenCalledWith("GLOBAL", "日本 02");
    expect(host.querySelector(".net-node.is-current .net-node__name")?.textContent).toBe("日本 02");
  });

  it("自动选择最快给出明确回执；测速失败按原因说人话", async () => {
    const { api } = createApi(makeSnapshot());
    const host = await renderPanel(api);

    await act(async () => { buttonWithText(host, ".net-primary-button", "自动选择最快").click(); });
    expect(api.autoSelect).toHaveBeenCalledWith("GLOBAL");
    expect(host.querySelector(".net-notice--ok")?.textContent).toContain("已切换到 日本 02");

    api.testGroup.mockResolvedValueOnce({
      ok: false,
      reason: "unauthorized",
      snapshot: makeSnapshot(),
    });
    await act(async () => { buttonWithText(host, ".net-ghost-button", "测速").click(); });
    expect(host.querySelector(".net-notice--error")?.textContent).toContain("测速失败：控制器密钥不正确");
  });

  it("流量帧只改速率与曲线，连接构成随快照一起换", async () => {
    const { api, emit } = createApi(makeSnapshot());
    const host = await renderPanel(api);
    expect(host.querySelector(".net-sparkline svg")).toBeNull();

    await act(async () => {
      emit({ kind: "traffic", traffic: { up: 2048, down: 4096, at: Date.now() } });
    });
    expect(host.querySelector(".net-rate__value")?.textContent).toBe("4.0 KB/s");
    expect(host.textContent).toContain("2.0 KB/s");
    expect(host.querySelector(".net-sparkline svg")).toBeNull();

    await act(async () => {
      emit({ kind: "traffic", traffic: { up: 1024, down: 2048, at: Date.now() } });
    });
    expect(host.querySelector(".net-sparkline svg")).not.toBeNull();
    expect(host.querySelector(".net-sparkline__line")?.getAttribute("d")).toContain("M");

    await act(async () => {
      emit({
        kind: "snapshot",
        snapshot: makeSnapshot({
          groups: [{ name: "GLOBAL", type: "Selector", now: "日本 02", nodes: makeSnapshot().groups[0].nodes }],
          connections: { total: 10, proxy: 6, direct: 4, reject: 0 },
        }),
      });
    });
    expect(host.textContent).toContain("10 条");
    expect(host.textContent).toContain("代理 6");
    expect(host.textContent).toContain("直连 4");
    expect(nodeNames(host)).toContain("日本 02");
  });

  it("内核不可达时给原因、控制器地址与禁用的操作", async () => {
    const { api } = createApi(makeSnapshot({
      controller: {
        available: false,
        baseUrl: "http://127.0.0.1:9097",
        reason: "unauthorized",
        version: null,
      },
      mode: null,
      groups: [],
      subscription: null,
      connections: { total: 0, proxy: 0, direct: 0, reject: 0 },
    }));
    const host = await renderPanel(api);

    expect(host.querySelector(".net-offline")?.textContent).toContain("控制器密钥不正确");
    expect(host.querySelector(".net-offline code")?.textContent).toBe("http://127.0.0.1:9097");
    expect(host.textContent).toContain("没有可切换的策略组");
    const modes = [...host.querySelectorAll<HTMLButtonElement>(".net-mode")];
    expect(modes).toHaveLength(3);
    expect(modes.every((mode) => mode.disabled)).toBe(true);
  });

  it("卸载时退订内核更新", async () => {
    const { api, unsubscribe } = createApi(makeSnapshot());
    const host = await renderPanel(api);
    expect(host.querySelector(".net-node")).not.toBeNull();
    const root = roots.pop()!;
    await act(async () => { root.unmount(); });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

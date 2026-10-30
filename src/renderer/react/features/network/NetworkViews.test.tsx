// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionDetail,
  CoreConfigPatch,
  CoreConfigView,
  LogEntry,
  NetworkDetailResult,
  NetworkLogsState,
  ProviderInfo,
  RuleEntry,
} from "../../../../shared/network-detail-types";
import type { NetworkSnapshot } from "../../../../shared/network-types";
import type { ProfileResult, ProfileRow } from "../../../../shared/subscription-types";
import { ConnectionsView } from "./ConnectionsView";
import { LogsView } from "./LogsView";
import { NetworkPanel } from "./NetworkPanel";
import { ProvidersView } from "./ProvidersView";
import { RulesView } from "./RulesView";
import { SettingsView } from "./SettingsView";
import { SubscriptionsView } from "./SubscriptionsView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

async function mount(element: ReactElement): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(element); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function chooseSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonWithText(host: HTMLElement, selector: string, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>(selector)]
    .find((entry) => entry.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${selector} ${text}`);
  return button;
}

const RULES: RuleEntry[] = [
  { type: "DomainSuffix", payload: "google.com", proxy: "节点选择", size: 3 },
  { type: "IPCIDR", payload: "10.0.0.0/8", proxy: "DIRECT", size: 1 },
];

const CONNECTIONS: ConnectionDetail[] = [
  {
    id: "c1", host: "example.com", network: "tcp", destination: "1.2.3.4:443",
    process: "C:\\Apps\\chrome.exe", upload: 100, download: 2048, startedAt: 1,
    chains: ["节点 A", "GLOBAL"], rule: "DomainSuffix", rulePayload: "example.com",
  },
  {
    id: "c2", host: "", network: "udp", destination: "8.8.8.8:53",
    process: "", upload: 10, download: 20, startedAt: 0,
    chains: ["DIRECT"], rule: "GEOIP", rulePayload: "CN",
  },
];

const PROVIDERS: ProviderInfo[] = [
  { name: "机场 A", vehicle: "HTTP", nodeCount: 10, aliveCount: 8, updatedAt: 1_700_000_000_000 },
  { name: "本地", vehicle: "File", nodeCount: 0, aliveCount: 0, updatedAt: null },
];

const CONFIG: CoreConfigView = {
  mixedPort: 7896,
  port: 7897,
  socksPort: 7898,
  allowLan: false,
  ipv6: false,
  mode: "rule",
  logLevel: "info",
  tunEnabled: false,
  tunStack: "mixed",
};

function entry(type: LogEntry["type"], payload: string): LogEntry {
  return { type, payload, at: 1_700_000_000_000 };
}

/** ProfileRow 的出厂形状：`null` 与 `false`/`0` 是两种盘上状态，测试里不许靠省略字段蒙过去。 */
function profile(uid: string, patch: Partial<ProfileRow> = {}): ProfileRow {
  return {
    uid, type: "remote", label: uid, url: `https://example.test/${uid}`, desc: null,
    updatedAt: 1_700_000_000_000, current: false, builtin: false, selectable: true,
    withProxy: null, updateInterval: null, ...patch,
  };
}

type SubResult = ProfileResult;

function okRows(rows: ProfileRow[], extra: { warnings?: string[]; uid?: string; proxyCount?: number } = {}): SubResult {
  return { ok: true, rows, warnings: extra.warnings ?? [], uid: extra.uid, proxyCount: extra.proxyCount };
}

function makeSubApi(rows: ProfileRow[], overrides: Record<string, unknown> = {}) {
  const changed: Array<(rows: ProfileRow[]) => void> = [];
  const api = {
    list: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    importUrl: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    pickFile: vi.fn(async () => ({ path: null as string | null })),
    importFile: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    update: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    select: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    remove: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    setOption: vi.fn(async (): Promise<SubResult> => okRows(rows)),
    onChanged: vi.fn((callback: (next: ProfileRow[]) => void) => {
      changed.push(callback);
      return () => { changed.splice(changed.indexOf(callback), 1); };
    }),
    ...overrides,
  };
  return Object.assign(api, { __changed: changed });
}

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("规则页", () => {
  it("加载中先给转圈，成功后按总数显示", async () => {
    const gate = deferred<NetworkDetailResult<RuleEntry[]>>();
    const host = await mount(createElement(RulesView, { api: { rules: vi.fn(() => gate.promise) } }));
    expect(host.querySelector(".net-loading")).not.toBeNull();
    await act(async () => { gate.resolve({ ok: true, data: RULES }); await gate.promise; });
    expect(host.querySelector(".net-loading")).toBeNull();
    expect(host.textContent).toContain("共 2 条规则");
    expect(host.querySelectorAll(".net-rule")).toHaveLength(2);
    expect(host.textContent).toContain("DomainSuffix");
    expect(host.textContent).toContain("节点选择");
  });

  it("搜索防抖 200ms：期间不动，时间到了才收窄", async () => {
    vi.useFakeTimers();
    const rules = vi.fn(async () => ({ ok: true as const, data: RULES }));
    const host = await mount(createElement(RulesView, { api: { rules } }));
    const search = host.querySelector<HTMLInputElement>(".net-search")!;
    expect(search).not.toBeNull();

    await act(async () => { setInput(search, "ipcidr"); });
    expect(host.querySelectorAll(".net-rule")).toHaveLength(2);

    await act(async () => { vi.advanceTimersByTime(199); });
    expect(host.querySelectorAll(".net-rule")).toHaveLength(2);

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(host.querySelectorAll(".net-rule")).toHaveLength(1);
    expect(host.textContent).toContain("显示 1 条");
  });

  it("空态分两种：没有规则 vs 搜索没命中", async () => {
    const empty = await mount(createElement(RulesView, { api: { rules: vi.fn(async () => ({ ok: true as const, data: [] })) } }));
    expect(empty.textContent).toContain("内核还没有规则");

    const host = await mount(createElement(RulesView, { api: { rules: vi.fn(async () => ({ ok: true as const, data: RULES })) } }));
    await act(async () => { setInput(host.querySelector<HTMLInputElement>(".net-search")!, "zzz"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(host.textContent).toContain("没有匹配的规则");
  });

  it("读取失败给原因，重试能恢复", async () => {
    const rules = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: "unauthorized" })
      .mockResolvedValueOnce({ ok: true, data: RULES });
    const host = await mount(createElement(RulesView, { api: { rules } }));
    expect(host.textContent).toContain("读取失败：控制器密钥不正确");
    await act(async () => { buttonWithText(host, ".net-view__error button", "重试").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelectorAll(".net-rule")).toHaveLength(2);
    expect(rules).toHaveBeenLastCalledWith(true);
  });
});

describe("日志页", () => {
  function makeLogsApi(initial: NetworkLogsState = { entries: [], streaming: true, error: null }, startOk = true) {
    let listener: ((entry: LogEntry) => void) | null = null;
    const api = {
      getLogs: vi.fn(async () => ({ ok: true as const, data: initial })),
      startLogs: vi.fn(async () => (startOk ? { ok: true as const } : { ok: false as const, reason: "unauthorized" as const })),
      stopLogs: vi.fn(async () => ({ ok: true as const })),
      onLog: vi.fn((callback: (entry: LogEntry) => void) => {
        listener = callback;
        return () => { listener = null; };
      }),
    };
    return { api, emit: (next: LogEntry) => listener?.(next) };
  }

  it("先读缓冲再接流；卸载时停流", async () => {
    const { api, emit } = makeLogsApi({ entries: [entry("info", "启动完成")], streaming: true, error: null });
    const host = await mount(createElement(LogsView, { api }));
    expect(host.textContent).toContain("启动完成");
    expect(host.textContent).toContain("实时");

    await act(async () => { emit(entry("info", "新的一条")); });
    expect(host.querySelectorAll(".net-log")).toHaveLength(2);

    const root = roots.pop()!;
    await act(async () => { root.unmount(); });
    expect(api.stopLogs).toHaveBeenCalledOnce();
  });

  it("暂停时不再追加，只记条数；继续后恢复", async () => {
    const { api, emit } = makeLogsApi();
    const host = await mount(createElement(LogsView, { api }));

    await act(async () => { emit(entry("info", "a")); });
    await act(async () => { emit(entry("info", "b")); });
    expect(host.querySelectorAll(".net-log")).toHaveLength(2);

    await act(async () => { buttonWithText(host, ".net-ghost-button", "暂停").click(); });
    await act(async () => { emit(entry("info", "c")); });
    expect(host.querySelectorAll(".net-log")).toHaveLength(2);
    expect(host.textContent).toContain("暂停中，1 条新日志");

    await act(async () => { buttonWithText(host, ".net-ghost-button", "继续").click(); });
    expect(host.textContent).not.toContain("暂停中");
    await act(async () => { emit(entry("info", "d")); });
    expect(host.querySelectorAll(".net-log")).toHaveLength(3);
  });

  it("级别是下限，换级别同时重启主进程那条流", async () => {
    const { api } = makeLogsApi({
      entries: [entry("debug", "d"), entry("info", "i"), entry("warning", "w"), entry("error", "e")],
      streaming: true,
      error: null,
    });
    const host = await mount(createElement(LogsView, { api }));
    expect(host.querySelectorAll(".net-log")).toHaveLength(3);

    await act(async () => { chooseSelect(host.querySelector<HTMLSelectElement>(".net-select")!, "warning"); });
    expect(host.querySelectorAll(".net-log")).toHaveLength(2);
    expect(api.startLogs).toHaveBeenLastCalledWith("warning");
  });

  it("流起不来时说明原因，标题显示已断开", async () => {
    const { api } = makeLogsApi({ entries: [], streaming: false, error: null }, false);
    const host = await mount(createElement(LogsView, { api }));
    expect(host.textContent).toContain("读取失败：控制器密钥不正确");
    expect(host.textContent).toContain("已断开");
    expect(host.textContent).toContain("还没有日志");
  });
});

describe("连接页", () => {
  function makeApi() {
    return {
      connections: vi.fn(async () => ({ ok: true as const, data: [...CONNECTIONS] })),
      closeConnection: vi.fn(async () => ({ ok: true as const })),
      closeAllConnections: vi.fn(async () => ({ ok: true as const })),
    };
  }

  it("列出主机、进程名与去向；空值有说法", async () => {
    const host = await mount(createElement(ConnectionsView, { api: makeApi() }));
    expect(host.querySelectorAll(".net-conn")).toHaveLength(2);
    expect(host.textContent).toContain("example.com");
    expect(host.textContent).toContain("chrome.exe");
    expect(host.textContent).toContain("节点 A");
    expect(host.textContent).toContain("8.8.8.8:53");
    expect(host.textContent).toContain("未知进程");
    expect(host.textContent).toContain("2 条");
  });

  it("关一条：按 id 发请求，成功后重新读列表", async () => {
    const api = makeApi();
    api.connections.mockResolvedValueOnce({ ok: true as const, data: [...CONNECTIONS] });
    api.connections.mockResolvedValueOnce({ ok: true as const, data: [CONNECTIONS[1]] });
    const host = await mount(createElement(ConnectionsView, { api }));

    await act(async () => {
      host.querySelectorAll<HTMLButtonElement>(".net-conn__close")[0].click();
    });
    expect(api.closeConnection).toHaveBeenCalledWith("c1");
    expect(api.connections).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll(".net-conn")).toHaveLength(1);
    expect(host.textContent).toContain("已关闭一条连接");
  });

  it("关全部要二次确认：先问、可取消，确认后才发", async () => {
    const api = makeApi();
    const host = await mount(createElement(ConnectionsView, { api }));

    await act(async () => { buttonWithText(host, ".net-ghost-button", "关闭全部").click(); });
    expect(host.textContent).toContain("确认关闭全部 2 条连接？");
    expect(api.closeAllConnections).not.toHaveBeenCalled();

    await act(async () => { buttonWithText(host, ".net-confirm button", "取消").click(); });
    expect(host.textContent).not.toContain("确认关闭全部");
    expect(api.closeAllConnections).not.toHaveBeenCalled();

    await act(async () => { buttonWithText(host, ".net-ghost-button", "关闭全部").click(); });
    await act(async () => { buttonWithText(host, ".net-confirm button", "确认关闭").click(); });
    expect(api.closeAllConnections).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("已关闭全部连接");
  });

  it("关闭失败按原因说人话", async () => {
    const api = makeApi();
    api.closeConnection.mockResolvedValueOnce({ ok: false, reason: "unreachable" });
    const host = await mount(createElement(ConnectionsView, { api }));
    await act(async () => { host.querySelectorAll<HTMLButtonElement>(".net-conn__close")[0].click(); });
    expect(host.textContent).toContain("关闭连接失败：无法连接内核");
  });

  it("空态与错误态", async () => {
    const empty = await mount(createElement(ConnectionsView, { api: { connections: vi.fn(async () => ({ ok: true as const, data: [] })) } }));
    expect(empty.textContent).toContain("现在还没有活动连接");

    const failing = await mount(createElement(ConnectionsView, { api: { connections: vi.fn(async () => ({ ok: false as const, reason: "unauthorized" })) } }));
    expect(failing.textContent).toContain("读取失败：控制器密钥不正确");
  });
});

describe("入站页", () => {
  it("列出载体、可用数与更新时间；从未更新有说法", async () => {
    const host = await mount(createElement(ProvidersView, { api: { providers: vi.fn(async () => ({ ok: true as const, data: PROVIDERS })) } }));
    expect(host.querySelectorAll(".net-provider")).toHaveLength(2);
    expect(host.textContent).toContain("机场 A");
    expect(host.textContent).toContain("HTTP");
    expect(host.textContent).toContain("8/10 可用");
    expect(host.textContent).toContain("从未更新");
  });

  it("单个测速用返回的读数替换列表", async () => {
    const providers = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, data: PROVIDERS })
      .mockResolvedValueOnce({ ok: true as const, data: [{ ...PROVIDERS[0], aliveCount: 9 }, PROVIDERS[1]] });
    const host = await mount(createElement(ProvidersView, { api: { providers, providerCheck: vi.fn(async () => ({ ok: true as const, data: [{ ...PROVIDERS[0], aliveCount: 9 }, PROVIDERS[1]] })) } }));
    await act(async () => { host.querySelectorAll<HTMLButtonElement>(".net-provider__check")[0].click(); });
    expect(host.textContent).toContain("9/10 可用");
    expect(host.textContent).toContain("机场 A 已刷新");
  });

  it("测速失败给原因；空态与错误态", async () => {
    const host = await mount(createElement(ProvidersView, {
      api: {
        providers: vi.fn(async () => ({ ok: true as const, data: PROVIDERS })),
        providerCheck: vi.fn(async () => ({ ok: false as const, reason: "unreachable" })),
      },
    }));
    await act(async () => { host.querySelectorAll<HTMLButtonElement>(".net-provider__check")[0].click(); });
    expect(host.textContent).toContain("刷新失败：无法连接内核");

    const empty = await mount(createElement(ProvidersView, { api: { providers: vi.fn(async () => ({ ok: true as const, data: [] })) } }));
    expect(empty.textContent).toContain("内核没有入站配置");

    const failing = await mount(createElement(ProvidersView, { api: { providers: vi.fn(async () => ({ ok: false as const, reason: "timeout" })) } }));
    expect(failing.textContent).toContain("读取失败：内核响应超时");
  });
});

describe("设置页", () => {
  function makeApi(view: CoreConfigView = CONFIG) {
    const state = { view };
    const setConfig = vi.fn(async (patch: CoreConfigPatch) => {
      state.view = applyPatch(state.view, patch);
      return { ok: true as const, data: state.view };
    });
    return {
      state,
      getConfig: vi.fn(async () => ({ ok: true as const, data: state.view })),
      setConfig,
    };
  }

  function applyPatch(view: CoreConfigView, patch: CoreConfigPatch): CoreConfigView {
    if ("mixed-port" in patch) return { ...view, mixedPort: patch["mixed-port"] };
    if ("port" in patch) return { ...view, port: patch.port };
    if ("socks-port" in patch) return { ...view, socksPort: patch["socks-port"] };
    if ("allow-lan" in patch) return { ...view, allowLan: patch["allow-lan"] };
    if ("ipv6" in patch) return { ...view, ipv6: patch.ipv6 };
    if ("log-level" in patch) return { ...view, logLevel: patch["log-level"] };
    if ("tun.enable" in patch) return { ...view, tunEnabled: patch["tun.enable"] };
    return { ...view, tunStack: patch["tun.stack"] };
  }

  it("读到的值直接落在输入框里；没改时保存不可点", async () => {
    const host = await mount(createElement(SettingsView, { api: makeApi() }));
    expect(host.querySelector<HTMLInputElement>('input[name="mixed-port"]')!.value).toBe("7896");
    expect(host.querySelector<HTMLInputElement>('input[name="allow-lan"]')!.checked).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('select[name="log-level"]')!.value).toBe("info");
    expect(buttonWithText(host, ".net-primary-button", "保存").disabled).toBe(true);
    expect(host.textContent).toContain("模式切换在「概览」页");
  });

  it("只把改过的键逐个写进内核，并以读回为准", async () => {
    const api = makeApi();
    const host = await mount(createElement(SettingsView, { api }));
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="mixed-port"]')!, "7899"); });
    await act(async () => { host.querySelector<HTMLInputElement>('input[name="allow-lan"]')!.click(); });

    await act(async () => { buttonWithText(host, ".net-primary-button", "保存").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.setConfig.mock.calls.map(([patch]) => patch)).toEqual([
      { "mixed-port": 7899 },
      { "allow-lan": true },
    ]);
    expect(host.textContent).toContain("已保存 2 项");
    expect(host.querySelector<HTMLInputElement>('input[name="mixed-port"]')!.value).toBe("7899");
    expect(buttonWithText(host, ".net-primary-button", "保存").disabled).toBe(true);
  });

  it("读回和写入不一致时点出来，不假装成功", async () => {
    const api = makeApi();
    api.setConfig.mockResolvedValueOnce({ ok: true as const, data: CONFIG });
    const host = await mount(createElement(SettingsView, { api }));
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="mixed-port"]')!, "7899"); });
    await act(async () => { buttonWithText(host, ".net-primary-button", "保存").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("保存后读回不一致：mixed-port");
  });

  it("坏端口就地报错并挡住保存", async () => {
    const host = await mount(createElement(SettingsView, { api: makeApi() }));
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="port"]')!, "70000"); });
    expect(host.textContent).toContain("端口必须是 0–65535 的整数");
    expect(buttonWithText(host, ".net-primary-button", "保存").disabled).toBe(true);
  });

  it("保存失败按原因说人话", async () => {
    const api = makeApi();
    api.setConfig.mockResolvedValueOnce({ ok: false as const, reason: "unauthorized" });
    const host = await mount(createElement(SettingsView, { api }));
    await act(async () => { host.querySelector<HTMLInputElement>('input[name="ipv6"]')!.click(); });
    await act(async () => { buttonWithText(host, ".net-primary-button", "保存").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("保存失败：控制器密钥不正确");
  });

  it("内核给了正文就把原话一起说：TUN 起不来不许只剩「无法识别的数据」", async () => {
    const api = makeApi();
    api.setConfig.mockResolvedValueOnce({
      ok: false as const,
      reason: "bad-response",
      detail: "error creating tun device: open wintun: The system cannot find the file specified.",
    });
    const host = await mount(createElement(SettingsView, { api }));
    await act(async () => { host.querySelector<HTMLInputElement>('input[name="tun.enable"]')!.click(); });
    await act(async () => { buttonWithText(host, ".net-primary-button", "保存").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("保存失败：内核返回了无法识别的数据");
    expect(host.textContent).toContain("内核说：error creating tun device: open wintun");
  });

  it("没有正文时不给用户留一个空的「内核说：」", async () => {
    const api = makeApi();
    api.setConfig.mockResolvedValueOnce({ ok: false as const, reason: "bad-response" });
    const host = await mount(createElement(SettingsView, { api }));
    await act(async () => { host.querySelector<HTMLInputElement>('input[name="ipv6"]')!.click(); });
    await act(async () => { buttonWithText(host, ".net-primary-button", "保存").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("保存失败：内核返回了无法识别的数据");
    expect(host.textContent).not.toContain("内核说");
  });

  it("读取失败给原因，重试能恢复", async () => {
    const api = makeApi();
    const getConfig = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: "timeout" })
      .mockResolvedValueOnce({ ok: true, data: CONFIG });
    const host = await mount(createElement(SettingsView, { api: { getConfig, setConfig: api.setConfig } }));
    expect(host.textContent).toContain("读取失败：内核响应超时");
    await act(async () => { buttonWithText(host, ".net-view__error button", "重试").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector<HTMLInputElement>('input[name="mixed-port"]')!.value).toBe("7896");
  });
});

describe("页签外壳", () => {
  function makePanelApi() {
    const snapshot: NetworkSnapshot = {
      controller: { available: true, baseUrl: "http://127.0.0.1:9097", reason: null, version: "v1" },
      mode: "rule",
      groups: [{ name: "G", type: "Selector", now: "n1", nodes: [{ name: "n1", type: "SS", delay: 20, history: [20], alive: true }] }],
      connections: { total: 1, proxy: 1, direct: 0, reject: 0 },
      subscription: null,
      traffic: { up: 1, down: 2, at: 1 },
      updatedAt: 1,
    };
    return {
      get: vi.fn(async () => snapshot),
      refresh: vi.fn(async () => snapshot),
      setMode: vi.fn(),
      selectNode: vi.fn(),
      testGroup: vi.fn(),
      autoSelect: vi.fn(),
      onUpdate: vi.fn(() => () => {}),
      rules: vi.fn(async () => ({ ok: true as const, data: RULES })),
      connections: vi.fn(async () => ({ ok: true as const, data: CONNECTIONS })),
      closeConnection: vi.fn(async () => ({ ok: true as const })),
      closeAllConnections: vi.fn(async () => ({ ok: true as const })),
      providers: vi.fn(async () => ({ ok: true as const, data: PROVIDERS })),
      providerCheck: vi.fn(async () => ({ ok: true as const, data: PROVIDERS })),
      getConfig: vi.fn(async () => ({ ok: true as const, data: CONFIG })),
      setConfig: vi.fn(async () => ({ ok: true as const, data: CONFIG })),
      startLogs: vi.fn(async () => ({ ok: true as const })),
      stopLogs: vi.fn(async () => ({ ok: true as const })),
      getLogs: vi.fn(async () => ({ ok: true as const, data: { entries: [], streaming: true, error: null } })),
      onLog: vi.fn(() => () => {}),
    };
  }

  it("八个页签都能打开，默认概览；正文七页签 + 齿轮设置", async () => {
    const api = makePanelApi();
    Object.assign(window, { verge: { network: api, subscriptions: makeSubApi([profile("A", { current: true })]) } });
    const host = await mount(createElement(NetworkPanel));

    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".net-tabs [role='tab']")];
    expect(tabs).toHaveLength(8);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["概览", "节点", "规则", "日志", "连接", "入站", "订阅", ""]);
    expect(host.querySelector(".net-hero")).not.toBeNull();

    await act(async () => { buttonWithText(host, ".net-tab", "节点").click(); });
    expect(host.querySelector(".net-node-list")).not.toBeNull();

    await act(async () => { buttonWithText(host, ".net-tab", "规则").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.rules).toHaveBeenCalledOnce();
    expect(host.querySelectorAll(".net-rule").length).toBeGreaterThan(0);

    await act(async () => { buttonWithText(host, ".net-tab", "日志").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.startLogs).toHaveBeenCalledOnce();

    await act(async () => { buttonWithText(host, ".net-tab", "连接").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.connections).toHaveBeenCalledOnce();
    expect(host.querySelectorAll(".net-conn")).toHaveLength(2);

    await act(async () => { buttonWithText(host, ".net-tab", "入站").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.providers).toHaveBeenCalledOnce();
    expect(host.querySelectorAll(".net-provider")).toHaveLength(2);

    await act(async () => { buttonWithText(host, ".net-tab", "订阅").click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".net-prof")).not.toBeNull();
    expect(host.querySelectorAll(".net-prof-row")).toHaveLength(1);

    await act(async () => { host.querySelector<HTMLButtonElement>(".net-tab--icon")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".net-settings")).not.toBeNull();

    await act(async () => { buttonWithText(host, ".net-tab", "概览").click(); });
    expect(host.querySelector(".net-hero")).not.toBeNull();
    expect(host.textContent).toContain("内核已连接");
    delete (window as Window & { verge?: unknown }).verge;
  });
});

describe("订阅页", () => {
  function profRows(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>(".net-prof-row")];
  }

  function buttonIn(row: HTMLElement, text: string): HTMLButtonElement {
    const button = [...row.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.textContent?.includes(text));
    if (!button) throw new Error(`row button not found: ${text}`);
    return button;
  }

  function hasButton(row: HTMLElement, text: string): boolean {
    return [...row.querySelectorAll<HTMLButtonElement>("button")].some((entry) => entry.textContent?.includes(text));
  }

  function noticeText(host: HTMLElement): string {
    return host.querySelector(".net-notice")?.textContent ?? "";
  }

  const LEDGER: ProfileRow[] = [
    profile("Merge", { type: "merge", label: "Merge", url: null, builtin: true, selectable: false }),
    profile("AttachRules", { type: "rules", label: "AttachRules", url: null, selectable: false }),
    profile("OldUid1", { label: "机场 A", current: true }),
    profile("NewUid2", { label: "机场 B" }),
  ];

  it("账本形状照画：内置项连删除键都不给，附件项不给切换，当前项写明是谁", async () => {
    const host = await mount(createElement(SubscriptionsView, { api: makeSubApi(LEDGER) }));
    const rows = profRows(host);
    expect(rows).toHaveLength(4);

    expect(rows[0].textContent).toContain("内置");
    expect(rows[0].querySelectorAll("button")).toHaveLength(0);

    expect(rows[1].textContent).toContain("附件");
    expect(hasButton(rows[1], "切换")).toBe(false);
    expect(hasButton(rows[1], "更新")).toBe(false);

    expect(rows[2].className).toContain("is-current");
    expect(rows[2].textContent).toContain("当前");
    expect(hasButton(rows[2], "切换")).toBe(false);
    expect(hasButton(rows[2], "更新")).toBe(true);
    expect(hasButton(rows[3], "切换")).toBe(true);

    // 地址只报主机名：token 在 query 里，一行都不许上屏。
    expect(host.textContent).not.toContain("example.test/OldUid1");
    expect(rows[2].textContent).toContain("example.test");
    expect(host.querySelector(".net-hint")?.textContent).toContain("当前：机场 A");
  });

  it("主进程的单写者闸门说成「等 Clash Verge 退出」，不演成普通操作失败", async () => {
    const api = makeSubApi([], {
      list: vi.fn(async (): Promise<SubResult> => ({ ok: false, reason: "verge-running", rows: [] })),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    expect(host.querySelector(".net-notice--error")?.textContent).toContain("Clash Verge");
    expect(host.querySelector(".net-notice--error")?.textContent).not.toContain("操作失败");
    expect(host.querySelector(".net-empty")).not.toBeNull();
  });

  it("写失败也采纳带回来的列表：当前标记跟着账本走，话照样说失败", async () => {
    const after = [profile("OldUid1", { label: "机场 A" }), profile("NewUid2", { label: "机场 B", current: true })];
    const api = makeSubApi(LEDGER.slice(2), {
      select: vi.fn(async (): Promise<SubResult> => ({ ok: false, reason: "write-failed", rows: after })),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));

    await act(async () => { buttonIn(profRows(host)[1], "切换").click(); });
    expect(noticeText(host)).toContain("操作失败");
    expect(noticeText(host)).toContain("写盘失败");
    expect(profRows(host)[1].className).toContain("is-current");
    expect(profRows(host)[0].className).not.toContain("is-current");
  });

  it("失败时列表读不出来就先用现有的顶着，页面不许塌成空白", async () => {
    const api = makeSubApi(LEDGER.slice(2), {
      select: vi.fn(async (): Promise<SubResult> => ({ ok: false, reason: "write-failed", rows: [] })),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    await act(async () => { buttonIn(profRows(host)[1], "切换").click(); });
    expect(profRows(host)).toHaveLength(2);
    expect(host.querySelector(".net-empty")).toBeNull();
  });

  it("删除两步走：垃圾桶只摊出确认条，取消不发请求", async () => {
    const api = makeSubApi(LEDGER.slice(2), {
      remove: vi.fn(async (): Promise<SubResult> => okRows([LEDGER[2]])),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    const row = () => profRows(host)[1];

    await act(async () => { row().querySelector<HTMLButtonElement>(".net-icon-button")!.click(); });
    expect(row().querySelector(".net-confirm")).not.toBeNull();
    expect(row().querySelector(".net-confirm")?.textContent).toContain("机场 B");
    expect(api.remove).not.toHaveBeenCalled();

    await act(async () => { row().querySelector<HTMLButtonElement>(".net-confirm .net-ghost-button")!.click(); });
    expect(row().querySelector(".net-confirm")).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();

    await act(async () => { row().querySelector<HTMLButtonElement>(".net-icon-button")!.click(); });
    await act(async () => { row().querySelector<HTMLButtonElement>(".net-danger-button")!.click(); });
    expect(api.remove).toHaveBeenCalledWith("NewUid2");
    expect(profRows(host)).toHaveLength(1);
    expect(noticeText(host)).toContain("已删除「机场 B」");
  });

  it("一次只允许一笔写：前一笔没落定时其余按钮全按下去没反应", async () => {
    const gate = deferred<SubResult>();
    const api = makeSubApi(LEDGER.slice(2), {
      select: vi.fn(() => gate.promise),
      update: vi.fn(async (): Promise<SubResult> => okRows(LEDGER.slice(2))),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));

    const switched = profRows(host)[1];
    const updated = profRows(host)[0];
    await act(async () => { buttonIn(switched, "切换").click(); });
    expect(buttonIn(updated, "更新").disabled).toBe(true);

    await act(async () => { gate.resolve(okRows(LEDGER.slice(2))); });
    expect(api.update).not.toHaveBeenCalled();
    expect(buttonIn(updated, "更新").disabled).toBe(false);
    expect(noticeText(host)).toContain("已切到「机场 B」");
  });

  it("链接不合法不给导入；导入成功清空表单并回账本上的名字", async () => {
    const added = profile("Fresh9", { label: "备用机场" });
    const api = makeSubApi([added], {
      importUrl: vi.fn(async (): Promise<SubResult> => okRows([added], { uid: "Fresh9" })),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    const urlInput = host.querySelector<HTMLInputElement>(".net-prof__url")!;
    const descInput = host.querySelector<HTMLInputElement>(".net-prof__desc")!;
    const submit = host.querySelector<HTMLButtonElement>(".net-primary-button")!;

    await act(async () => { setInput(urlInput, "订阅地址 不对"); });
    expect(submit.disabled).toBe(true);
    expect(api.importUrl).not.toHaveBeenCalled();

    await act(async () => { setInput(urlInput, "  https://user:tok@example.test/sub?a=1  "); });
    await act(async () => { setInput(descInput, "  "); });
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.click(); });
    expect(api.importUrl).toHaveBeenCalledWith("https://user:tok@example.test/sub?a=1", undefined);
    expect(urlInput.value).toBe("");
    expect(noticeText(host)).toContain("已导入「备用机场」");
    expect(host.textContent).not.toContain("tok");
  });

  it("从本地文件导入：取消对话框什么都不说，选中的文件走 importFile", async () => {
    const pick = makeSubApi([]);
    const cancelHost = await mount(createElement(SubscriptionsView, { api: pick }));
    await act(async () => { buttonWithText(cancelHost, ".net-ghost-button", "从本地文件").click(); });
    expect(pick.importFile).not.toHaveBeenCalled();
    expect(cancelHost.querySelector(".net-notice")).toBeNull();

    const api = makeSubApi([], {
      pickFile: vi.fn(async () => ({ path: "D:\\subs\\airport.yaml" })),
      importFile: vi.fn(async (): Promise<SubResult> => okRows([profile("Local1", { type: "local", url: null })])),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    await act(async () => { buttonWithText(host, ".net-ghost-button", "从本地文件").click(); });
    expect(api.importFile).toHaveBeenCalledWith("D:\\subs\\airport.yaml", undefined);
    expect(noticeText(host)).toContain("已导入");
  });

  it("档位跟着盘走：写过的 720 秒自成一行，没写过时只能显示不能当选", async () => {
    const rows = [profile("OldUid1", { label: "机场 A", updateInterval: 720 }), profile("NewUid2", { label: "机场 B" })];
    const api = makeSubApi(rows);
    const host = await mount(createElement(SubscriptionsView, { api }));
    const selects = [...host.querySelectorAll<HTMLSelectElement>(".net-prof-row__options select")];
    expect(selects).toHaveLength(2);

    expect(selects[0].value).toBe("720");
    expect([...selects[0].options].map((option) => option.textContent)).toEqual([
      "未设置", "12 分钟", "30 分钟", "1 小时", "3 小时", "12 小时", "24 小时",
    ]);
    expect(selects[0].options[0].disabled).toBe(true);
    expect(selects[1].value).toBe("");
    expect(profRows(host)[1].querySelector(".net-prof-row__note")?.textContent).toContain("跟随默认");

    await act(async () => { chooseSelect(selects[0], "3600"); });
    expect(api.setOption).toHaveBeenCalledWith("OldUid1", { update_interval: 3600 });

    const checkbox = profRows(host)[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await act(async () => { checkbox.click(); });
    expect(api.setOption).toHaveBeenCalledWith("OldUid1", { with_proxy: true });
  });

  it("增强没生效的警告与成功回执是两条：回执 5 秒会走，警告不许一起消失", async () => {
    const api = makeSubApi(LEDGER.slice(2), {
      select: vi.fn(async (): Promise<SubResult> => okRows(LEDGER.slice(2), { warnings: ["AttachRules", "AttachMerge"] })),
    });
    const host = await mount(createElement(SubscriptionsView, { api }));
    await act(async () => { buttonIn(profRows(host)[1], "切换").click(); });

    const bars = [...host.querySelectorAll(".net-notice")];
    expect(bars).toHaveLength(2);
    expect(bars[0].className).toContain("net-notice--ok");
    expect(bars[1].className).toContain("net-notice--error");
    expect(bars[1].textContent).toContain("有 2 项增强没能生效");
    expect(bars[1].textContent).toContain("AttachRules / AttachMerge");
  });

  it("任一次写成功之后主进程推来的新列表直接上屏", async () => {
    const api = makeSubApi([LEDGER[2]]);
    const host = await mount(createElement(SubscriptionsView, { api }));
    expect(profRows(host)).toHaveLength(1);
    await act(async () => { api.__changed[0]([LEDGER[2], LEDGER[3], LEDGER[0]]); });
    expect(profRows(host)).toHaveLength(3);
    expect(host.querySelector(".net-card__count")?.textContent).toContain("共 3 项");
  });

  it("刷新按钮重读账本并回执；桥不在就说不通，不画一张假列表", async () => {
    const api = makeSubApi(LEDGER.slice(2));
    const host = await mount(createElement(SubscriptionsView, { api }));
    await act(async () => { host.querySelector<HTMLButtonElement>(".net-view__tools .net-icon-button")!.click(); });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(noticeText(host)).toContain("已重新读取");

    const orphan = await mount(createElement(SubscriptionsView, {}));
    expect(orphan.querySelector(".net-notice--error")?.textContent).toContain("订阅接口不可用");
    expect(profRows(orphan)).toHaveLength(0);
  });
});

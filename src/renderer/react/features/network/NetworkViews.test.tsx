// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_CORE_STATUS,
  type CoreStatus,
  type CoreUpdateState,
  type CoreView,
} from "../../../../shared/core-types";
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
import type {
  SystemProxyRead,
  SystemProxySetResult,
  SystemProxyStatus,
} from "../../../../shared/system-proxy-types";
import { EMPTY_SYSTEM_PROXY_STATUS } from "../../../../shared/system-proxy-types";
import {
  EMPTY_VERGE_SETTINGS_VIEW,
  VERGE_SETTING_KEYS,
  type VergeSettingKey,
  type VergeSettingsPatch,
  type VergeSettingsRead,
  type VergeSettingsResult,
  type VergeSettingsView,
} from "../../../../shared/verge-settings-types";
import { ConnectionsView } from "./ConnectionsView";
import { CoreSection } from "./CoreSection";
import type { CoreApi } from "./core-view";
import { LogsView } from "./LogsView";
import { NetworkPanel } from "./NetworkPanel";
import { ProvidersView } from "./ProvidersView";
import { RulesView } from "./RulesView";
import { SettingsView } from "./SettingsView";
import { SubscriptionsView } from "./SubscriptionsView";
import { VergeSettingsSection } from "./VergeSettingsSection";
import type { VergeSettingsApi } from "./verge-settings-view";

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

describe("设置页的 Verge 两张卡", () => {
  const YAML_PATH = "C:\\Users\\me\\AppData\\Roaming\\cyrene\\verge.yaml";

  const PROXY_ON: SystemProxyStatus = { enabled: true, server: "127.0.0.1:7896", bypass: "localhost;127.*" };
  const PROXY_OFF: SystemProxyStatus = { enabled: false, server: null, bypass: null };
  const PROXY_UNSET: SystemProxyStatus = { enabled: null, server: null, bypass: null };

  const VIEW: VergeSettingsView = {
    enableSystemProxy: false,
    systemProxyBypass: null,
    useDefaultBypass: true,
    enableTunMode: null,
    mixedPort: 7896,
    socksPort: 0,
    httpPort: null,
  };

  const FIELD_OF: Record<VergeSettingKey, keyof VergeSettingsView> = {
    enable_system_proxy: "enableSystemProxy",
    system_proxy_bypass: "systemProxyBypass",
    use_default_bypass: "useDefaultBypass",
    enable_tun_mode: "enableTunMode",
    verge_mixed_port: "mixedPort",
    verge_socks_port: "socksPort",
    verge_port: "httpPort",
  };

  interface VergeState {
    view: VergeSettingsView;
    proxy: SystemProxyStatus;
  }

  function makeVergeApi(options: {
    view?: VergeSettingsView;
    readReason?: VergeSettingsRead["reason"];
    proxy?: SystemProxyStatus;
    proxyReason?: SystemProxyRead["reason"];
    proxyDetail?: string;
    align?: SystemProxySetResult["align"];
    write?: (patch: VergeSettingsPatch, state: VergeState) => VergeSettingsResult;
    toggle?: (toggle: { enabled: boolean }, state: VergeState) => SystemProxySetResult;
  } = {}) {
    const state: VergeState = {
      // 读不出盘时 main 回的是 EMPTY_VERGE_SETTINGS_VIEW：拿一份真值配着失败原因返回，等于让用户照着猜。
      view: options.readReason ? { ...EMPTY_VERGE_SETTINGS_VIEW } : { ...VIEW, ...options.view },
      proxy: options.proxy ?? PROXY_OFF,
    };
    const api: VergeSettingsApi = {
      get: vi.fn(async (): Promise<VergeSettingsRead> => ({
        view: state.view,
        reason: options.readReason ?? null,
        // 「没发现 Verge」时编一个路径出来，等于告诉用户盘上有这么个文件。
        filePath: options.readReason === "not-found" ? null : YAML_PATH,
      })),
      set: vi.fn(async (patch: VergeSettingsPatch): Promise<VergeSettingsResult> => {
        if (options.write) return options.write(patch, state);
        const changed: VergeSettingKey[] = [];
        for (const key of VERGE_SETTING_KEYS) {
          if (patch[key] === undefined) continue;
          changed.push(key);
          // 替身不做形状校验：那由 main 那侧的写面负责，这里只保证「发什么就读回什么」。
          state.view[FIELD_OF[key]] = patch[key] as never;
        }
        return { ok: true, view: state.view, changed };
      }),
      proxyGet: vi.fn(async (): Promise<SystemProxyRead> => ({
        status: state.proxy,
        reason: options.proxyReason ?? null,
        ...(options.proxyDetail ? { detail: options.proxyDetail } : {}),
      })),
      proxySet: vi.fn(async (toggle: { enabled: boolean }): Promise<SystemProxySetResult> => {
        if (options.toggle) return options.toggle(toggle, state);
        state.proxy = toggle.enabled ? { ...PROXY_ON } : { ...PROXY_OFF };
        return { ok: true, status: state.proxy, align: options.align ?? { state: "aligned" } };
      }),
    };
    return { state, api };
  }

  async function mountVerge(api: VergeSettingsApi): Promise<HTMLElement> {
    const host = await mount(createElement(VergeSettingsSection, { api }));
    // 初值要走完 get()+proxyGet() 的 Promise.all，比单页多一拍。
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    return host;
  }

  const proxySwitch = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[name="enable_system_proxy"]')!;
  const saveButton = (host: HTMLElement) => buttonWithText(host, ".net-primary-button", "保存");

  function setArea(area: HTMLTextAreaElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("开关只递一个布尔：代理地址从来不由页面递", async () => {
    const { api } = makeVergeApi();
    const host = await mountVerge(api);
    await act(async () => { proxySwitch(host).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.proxySet).toHaveBeenCalledOnce();
    const [toggle] = api.proxySet.mock.calls[0];
    // toStrictEqual：多一个 server 键（哪怕值是 undefined）都要红——那是把全机流量指到别处的口子。
    expect(toggle).toStrictEqual({ enabled: true });

    expect(host.textContent).toContain("已开启");
    expect(host.textContent).toContain("指向 127.0.0.1:7896");
    expect(host.textContent).toContain("系统里的例外：localhost;127.*");
    expect(host.textContent).toContain("Verge 那本账记的是：关着");
    expect(host.textContent).toContain("两处已对齐");
  });

  it("注册表里没这把键时不许冒充「已关闭」", async () => {
    const host = await mountVerge(makeVergeApi({ proxy: PROXY_UNSET }).api);
    expect(host.textContent).toContain("没配过");
    expect(host.textContent).not.toContain("已关闭");
    expect(host.textContent).not.toContain("已开启");
    expect(proxySwitch(host).checked).toBe(false);
    // 这一次注册表是读成功的：「读回来没有值」是可以如实列出来的事实，跟「读不到」是两回事。
    expect(host.querySelector(".net-verge__facts")).not.toBeNull();
    expect(host.textContent).toContain("没有可读的地址");
    expect(host.textContent).toContain("系统里没有例外列表");
  });

  it("保存只发真改过的键，回执按白名单标签点名", async () => {
    const { api } = makeVergeApi();
    const host = await mountVerge(api);
    expect(saveButton(host).disabled).toBe(true);

    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!, "7899"); });
    await act(async () => { chooseSelect(host.querySelector<HTMLSelectElement>('select[name="enable_tun_mode"]')!, "on"); });
    expect(saveButton(host).disabled).toBe(false);

    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.set).toHaveBeenCalledOnce();
    expect(api.set.mock.calls[0][0]).toStrictEqual({ enable_tun_mode: true, verge_mixed_port: 7899 });
    expect(host.textContent).toContain("已写入 2 项：");
    expect(host.textContent).toContain("混合端口");
    expect(host.textContent).toContain("TUN 模式");
    // 写完之后基线跟着盘走：同一份值不该还能再点一次保存。
    expect(saveButton(host).disabled).toBe(true);
  });

  it("TUN 选「跟随内核」写的是 null，不是 false", async () => {
    const { api } = makeVergeApi({ view: { enableTunMode: true } });
    const host = await mountVerge(api);
    expect(host.querySelector<HTMLSelectElement>('select[name="enable_tun_mode"]')!.value).toBe("on");
    await act(async () => { chooseSelect(host.querySelector<HTMLSelectElement>('select[name="enable_tun_mode"]')!, "follow"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.set.mock.calls[0][0]).toStrictEqual({ enable_tun_mode: null });
  });

  it("例外清空是删掉那把键，不是写一条都不豁免的空串", async () => {
    const { api } = makeVergeApi();
    const host = await mountVerge(api);
    const area = host.querySelector<HTMLTextAreaElement>('textarea[name="system_proxy_bypass"]')!;
    expect(area.disabled).toBe(true); // 默认例外在生效时，自定义那一栏不该能点

    await act(async () => { host.querySelector<HTMLInputElement>('input[name="use_default_bypass"]')!.click(); });
    expect(area.disabled).toBe(false);
    await act(async () => { setArea(area, "baidu.com;192.168.*"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.set.mock.calls[0][0]).toStrictEqual({
      system_proxy_bypass: "baidu.com;192.168.*",
      use_default_bypass: false,
    });

    await act(async () => { setArea(host.querySelector<HTMLTextAreaElement>('textarea[name="system_proxy_bypass"]')!, ""); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.set.mock.calls[1][0]).toStrictEqual({ system_proxy_bypass: null });
  });

  it("写被拒时把原话说出来，用户的输入与草稿都不许被吃掉", async () => {
    const { api, state } = makeVergeApi({
      write: (_patch, current) => ({ ok: false, reason: "verge-running", view: current.view }),
    });
    const host = await mountVerge(api);
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!, "7899"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain("Clash Verge 正在运行，先退出它我才改得动 verge.yaml");
    expect(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!.value).toBe("7899");
    expect(saveButton(host).disabled).toBe(false);
    expect(state.view.mixedPort).toBe(7896);
    // 拒了也要重读盘：闸门可能在两次点击之间就换了。
    expect(api.get.mock.calls.length).toBeGreaterThan(1);
  });

  it("说不出端口时（no-port）注册表一个键都不该被写，页面上要敢点名", async () => {
    const { api } = makeVergeApi({
      proxy: PROXY_UNSET,
      toggle: () => ({
        ok: false,
        reason: "no-port",
        status: PROXY_UNSET,
        align: { state: "skipped", reason: "not-applied" },
        detail: "mixed-port unset",
      }),
    });
    const host = await mountVerge(api);
    await act(async () => { proxySwitch(host).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain("说不出该指向哪个端口：内核没在跑，verge.yaml 里也没有混合端口");
    expect(host.textContent).toContain("详情：mixed-port unset");
    expect(host.textContent).toContain("系统代理没写成，还没到对齐这一步");
    expect(proxySwitch(host).checked).toBe(false);
    expect(host.textContent).toContain("没配过");
  });

  it("Verge 在跑时对齐会被跳过：回执要说「它下次启动可能把你拨回去」", async () => {
    const { api } = makeVergeApi({ align: { state: "skipped", reason: "verge-running" } });
    const host = await mountVerge(api);
    await act(async () => { proxySwitch(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".net-verge__align")!.className).toContain("is-skipped");
    expect(host.textContent).toContain("它自己那把键没跟着改——它下次启动可能把你刚改的拨回去");
  });

  it("没装 Verge 的机器：verge.yaml 那栏禁写，系统代理照拨", async () => {
    const { api } = makeVergeApi({ readReason: "not-found" });
    const host = await mountVerge(api);
    expect(host.textContent).toContain("没有找到 verge.yaml（这台机器可能没装过 Clash Verge）");
    // 不给编一个不存在的文件路径。
    expect(host.textContent).not.toContain(YAML_PATH);
    expect(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!.value).toBe("");
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!, "7899"); });
    expect(saveButton(host).disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[name="enable_tun_mode"]')!.disabled).toBe(true);

    expect(proxySwitch(host).disabled).toBe(false);
    await act(async () => { proxySwitch(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.proxySet).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("已开启");
  });

  it("坏端口就地报错并挡住保存", async () => {
    const { api } = makeVergeApi();
    const host = await mountVerge(api);
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="verge_socks_port"]')!, "70000"); });
    expect(host.textContent).toContain("端口必须是 0–65535 的整数");
    expect(saveButton(host).disabled).toBe(true);
    expect(api.set).not.toHaveBeenCalled();
  });

  it("拨开关不许冲掉没保存的草稿，但状态必须按注册表读回来", async () => {
    const { api } = makeVergeApi();
    const host = await mountVerge(api);
    await act(async () => { setInput(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!, "7899"); });

    await act(async () => { proxySwitch(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector<HTMLInputElement>('input[name="verge_mixed_port"]')!.value).toBe("7899");
    expect(saveButton(host).disabled).toBe(false);
    // 草稿保住了，开关本身却必须跟着读回走——不许停在「按下去时以为的那一版」。
    expect(host.textContent).toContain("已开启");
    expect(host.textContent).toContain("指向 127.0.0.1:7896");
  });

  it("盘上没写过的端口画成空，不拿 0 冒充", async () => {
    const host = await mountVerge(makeVergeApi({ view: { mixedPort: null, socksPort: null, httpPort: null } }).api);
    for (const name of ["verge_mixed_port", "verge_socks_port", "verge_port"]) {
      const field = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      expect(field.value, name).toBe("");
      // placeholder 是属性不是文字：空框必须自己说清「空」是什么意思。
      expect(field.placeholder, name).toBe("留空 = 不改");
    }
  });

  it("读回注册表失败时不端读回清单，徽标也不许冒充「没配过」", async () => {
    const host = await mountVerge(makeVergeApi({ proxyReason: "read-failed" }).api);
    expect(host.textContent).toContain("读系统代理失败");
    // 「没配过」是对注册表的判断，读失败时我们没资格下这个结论。
    expect(host.textContent).not.toContain("没配过");
    expect(host.querySelector(".net-verge__facts")).toBeNull();
    // 没有正文时不给用户留一个空的「详情：」。
    expect(host.textContent).not.toContain("详情：");

    const withDetail = await mountVerge(makeVergeApi({ proxyReason: "read-failed", proxyDetail: "reg.exe 拒绝访问" }).api);
    expect(withDetail.querySelector(".net-verge__read-failed")!.textContent).toBe("详情：reg.exe 拒绝访问");
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

  it("齿轮页在内核卡下面接上更新卡与 Verge 两张卡；preload 没带 settings 通道时也不空转", async () => {
    const api = makePanelApi();
    const settings: VergeSettingsApi = {
      get: vi.fn(async () => ({ view: EMPTY_VERGE_SETTINGS_VIEW, reason: null, filePath: null })),
      set: vi.fn(async () => ({ ok: true as const, view: EMPTY_VERGE_SETTINGS_VIEW, changed: [] })),
      proxyGet: vi.fn(async () => ({ status: { ...EMPTY_SYSTEM_PROXY_STATUS }, reason: null })),
      proxySet: vi.fn(async () => ({
        ok: true as const,
        status: { ...EMPTY_SYSTEM_PROXY_STATUS },
        align: { state: "aligned" as const },
      })),
    };
    Object.assign(window, { verge: { network: api, subscriptions: makeSubApi([]), settings } });
    const host = await mount(createElement(NetworkPanel));
    await act(async () => { host.querySelector<HTMLButtonElement>(".net-tab--icon")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".net-settings")).not.toBeNull();
    // 顺序也是契约：内核宿主排最前（内核配置那张卡读的就是它的控制面），紧跟的是「客户端更新」
    // ——它拦安装的那道闸门就是上面那张卡的「在跑」；再往下才是本机设置与 Verge 那两张。
    const cards = [...host.querySelectorAll<HTMLElement>(".net-panel__inner > .net-card")].map((c) => c.className);
    expect(cards).toEqual([
      "net-card net-section net-verge",
      "net-card net-section net-client",
      "net-card net-section net-settings",
      "net-card net-section net-verge",
      "net-card net-section net-verge",
    ]);
    // 这一趟 mount 压根没给 window.verge.clientUpdate：卡片必须说出「接口不可用」，不许空转成一块白。
    expect(host.querySelector(".net-client .net-hint")?.textContent).toContain("接口不可用");

    // 反例：老 preload / 别的窗口没挂上 settings 时，页面要说出「接口不可用」，不许抛错留一块白。
    delete (window as Window & { verge?: unknown }).verge;
    Object.assign(window, { verge: { network: api, subscriptions: makeSubApi([]) } });
    const bare = await mount(createElement(NetworkPanel));
    await act(async () => { bare.querySelector<HTMLButtonElement>(".net-tab--icon")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(bare.querySelectorAll(".net-verge")).toHaveLength(3);
    expect(bare.textContent).toContain("设置接口不可用");
    expect(bare.textContent).toContain("内核接口不可用");
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

describe("内核卡片（Wave 3 T10b/T11）", () => {
  /** 钉死表针：「已运行」与「上次更新」两行量的都是 `now - at`，跟着真实时钟走就永远对不上。 */
  const CORE_NOW = 1_700_000_100_000;

  function coreView(
    patch: Partial<CoreStatus>,
    secretSource: CoreView["secretSource"] = "mochi",
    update: CoreView["update"] = null,
  ): CoreView {
    return { status: { ...EMPTY_CORE_STATUS, ...patch }, secretSource, update };
  }

  const STOPPED = coreView({});
  const OWN_RUNNING = coreView({
    state: "running", mode: "installed", pid: 4321,
    ports: { mixed: 17890, controller: 17891 },
    controller: "127.0.0.1:17891", healAttempts: 2,
    startedAt: CORE_NOW - 90_000,
  });
  /** 借用 Verge 那颗时更新仍归我们管：`core/mihomo.exe` 不在它手上。 */
  const EXTERNAL_RUNNING = coreView(
    {
      state: "running", mode: "external", controller: "127.0.0.1:9097",
      startedAt: CORE_NOW - 90_000,
    },
    "verge",
  );
  const UPDATE_INSTALLED: CoreUpdateState = {
    outcome: "installed", tag: "v1.19.33", asset: "mihomo-windows-amd64-v1.19.33.zip",
    reason: null, detail: null, at: CORE_NOW - 40_000,
  };
  /** 内核照旧在跑、账上多了一条更新记录——这一份就是「装上了但还没生效」那个形状。 */
  const OWN_RUNNING_UPDATED = { ...OWN_RUNNING, update: UPDATE_INSTALLED };

  function makeCoreApi(
    initial: CoreView,
    after: Partial<Record<"start" | "stop" | "restart" | "update", CoreView>> = {},
  ) {
    return {
      status: vi.fn(async () => initial),
      start: vi.fn(async () => after.start ?? initial),
      stop: vi.fn(async () => after.stop ?? initial),
      restart: vi.fn(async () => after.restart ?? initial),
      update: vi.fn(async () => after.update ?? initial),
    };
  }

  function mountCore(api?: ReturnType<typeof makeCoreApi>) {
    return mount(createElement(CoreSection, api ? { api: api as unknown as CoreApi } : {}));
  }

  function buttonOf(host: HTMLElement, action: "start" | "stop" | "restart" | "update" | "refresh"): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(`button[name="core_${action}"]`);
    if (!button) throw new Error(`core button not found: ${action}`);
    return button;
  }

  /** 这张卡允许两条红字并存（回执一条、账上原因一条），所以按集合读，不按第一条读。 */
  function errorText(host: HTMLElement): string {
    return [...host.querySelectorAll(".net-notice--error")].map((bar) => bar.textContent).join(" / ");
  }

  /** 「上次更新」那一条常驻历史：按标签找到那一行，别拿整张卡的文本比。 */
  function updateLine(host: HTMLElement): string | undefined {
    return [...host.querySelectorAll(".net-verge__facts li")]
      .find((row) => row.textContent?.includes("上次更新"))
      ?.textContent;
  }

  it("桥不在就说接口不可用，不画一张看起来还在跑的账", async () => {
    const host = await mountCore();
    expect(host.textContent).toContain("内核接口不可用");
    expect(host.textContent).toContain("还没读到");
    expect(host.querySelector(".net-status.is-online")).toBeNull();
    expect(host.querySelector(".net-verge__facts")).toBeNull();
    for (const action of ["start", "stop", "restart", "update", "refresh"] as const) {
      expect(buttonOf(host, action).disabled, action).toBe(true);
    }
  });

  it("起被闸门挡下：绿字不许亮，红字端出原因，状态词不是「运行中」", async () => {
    const blocked = coreView({
      state: "blocked", mode: "bundled", reason: "verge-running", detail: "先退出 Clash Verge",
    });
    const api = makeCoreApi(STOPPED, { start: blocked });
    const host = await mountCore(api);
    expect(host.textContent).toContain("已停止");
    expect(host.textContent).toContain("现在没有内核归我管");

    await act(async () => { buttonOf(host, "start").click(); });
    expect(api.start).toHaveBeenCalledWith();
    expect(errorText(host)).toContain("单写者闸门不让我起第二颗内核");
    expect(errorText(host)).toContain("详情：先退出 Clash Verge");
    expect(host.querySelector(".net-notice--ok")).toBeNull();
    expect(host.querySelector(".net-status.is-online")).toBeNull();
    expect(host.textContent).toContain("没让它起");
    expect(host.textContent).not.toContain("运行中");
    expect(buttonOf(host, "start").disabled).toBe(false);
  });

  it("自己起的那颗：端口、PID、口令来处、自愈次数全按账上画", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const host = await mountCore(makeCoreApi(OWN_RUNNING));
    expect(host.querySelector(".net-status.is-online")).not.toBeNull();
    expect(host.textContent).toContain("运行中");
    expect(host.textContent).toContain("这一颗是我起的");
    expect(host.textContent).toContain("Verge 安装目录里那颗（我起的进程）");
    expect(host.textContent).toContain("我自己生成的一把");
    expect(host.textContent).toContain("127.0.0.1:17891");
    expect(host.textContent).toContain("17890 / 17891");
    expect(host.textContent).toContain("4321");
    expect(host.textContent).toContain("1m 30s");
    expect(host.textContent).toContain("2/3");
    expect(buttonOf(host, "start").disabled).toBe(true);
    expect(buttonOf(host, "stop").disabled).toBe(false);
    expect(buttonOf(host, "restart").disabled).toBe(false);
  });

  it("借用 Verge 那颗：绿点敢亮，但端口／PID／已运行一个都不许凭空造，三颗按钮全灰", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const host = await mountCore(makeCoreApi(EXTERNAL_RUNNING));
    expect(host.querySelector(".net-status.is-online")).not.toBeNull();
    expect(host.textContent).toContain("Verge 正在跑的那颗");
    expect(host.textContent).toContain("读的是 Verge 账上那把");
    expect(host.textContent).toContain("127.0.0.1:9097");
    expect(host.textContent).toContain("现在吃的是 Verge 那颗内核的控制器");
    expect(host.textContent).toContain("要停 Verge 那颗，请回 Clash Verge");
    for (const action of ["start", "stop", "restart"] as const) {
      expect(buttonOf(host, action).disabled, action).toBe(true);
    }
    expect(host.textContent).not.toContain("混合 / 控制器端口");
    expect(host.textContent).not.toContain("PID");
    expect(host.textContent).not.toContain("已运行");
    expect(host.textContent).not.toContain("本轮自愈");
  });

  it("启动中不许画成运行中，但这一档的「停止」就得能按", async () => {
    const starting = coreView({ state: "starting", mode: "installed" });
    const host = await mountCore(makeCoreApi(starting));
    expect(host.querySelector(".net-status.is-online")).toBeNull();
    expect(host.textContent).toContain("启动中");
    expect(host.textContent).toContain("在等控制器答话");
    expect(buttonOf(host, "start").disabled).toBe(true);
    expect(buttonOf(host, "stop").disabled).toBe(false);
  });

  it("按下停止之后账上还在跑：不许报成停成功了", async () => {
    const api = makeCoreApi(OWN_RUNNING, { stop: OWN_RUNNING });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "stop").click(); });
    expect(api.stop).toHaveBeenCalledWith();
    expect(errorText(host)).toContain("别把它当成停成功了");
    expect(host.querySelector(".net-notice--ok")).toBeNull();
  });

  it("一次点击还在路上时四颗一起按住：不许点出第二颗内核，也不许并发开两趟下载", async () => {
    const gate = deferred<CoreView>();
    const api = { ...makeCoreApi(STOPPED), start: vi.fn(() => gate.promise) };
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "start").click(); });
    expect(buttonOf(host, "start").textContent).toContain("处理中…");
    expect(buttonOf(host, "stop").disabled).toBe(true);
    expect(buttonOf(host, "restart").disabled).toBe(true);
    expect(buttonOf(host, "update").disabled).toBe(true);
    expect(host.textContent).toContain("上一次点击还在路上");

    gate.resolve(OWN_RUNNING);
    await act(async () => { await gate.promise; });
    expect(buttonOf(host, "start").textContent).toContain("起内核");
    expect(buttonOf(host, "update").disabled).toBe(false);
    expect(host.querySelector(".net-notice--ok")).not.toBeNull();
    expect(host.textContent).not.toContain("上一次点击还在路上");
  });

  it("更新在路上时「处理中…」只写在自己那颗上：四颗一起按住，落定后各回各的词", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const gate = deferred<CoreView>();
    const api = { ...makeCoreApi(OWN_RUNNING), update: vi.fn(() => gate.promise) };
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    expect(buttonOf(host, "update").textContent).toContain("处理中…");
    expect(buttonOf(host, "start").textContent).toContain("起内核");
    expect(buttonOf(host, "stop").textContent).toContain("停止");
    for (const action of ["start", "stop", "restart", "update", "refresh"] as const) {
      expect(buttonOf(host, action).disabled, action).toBe(true);
    }

    gate.resolve({ ...OWN_RUNNING, update: UPDATE_INSTALLED });
    await act(async () => { await gate.promise; });
    expect(buttonOf(host, "update").textContent).toContain("更新内核");
    expect(buttonOf(host, "stop").disabled).toBe(false);
    expect(buttonOf(host, "refresh").disabled).toBe(false);
  });

  it("每 10 秒重读一次账：内核在页面看不见的时候崩了又自愈，也不用重开页面", async () => {
    vi.useFakeTimers();
    const healed = coreView({
      state: "running", mode: "installed", pid: 9999,
      ports: { mixed: 17890, controller: 17891 }, controller: "127.0.0.1:17891",
      healAttempts: 1, startedAt: CORE_NOW,
    });
    const status = vi.fn(async () => OWN_RUNNING);
    const api = { ...makeCoreApi(OWN_RUNNING), status };
    const host = await mountCore(api);
    expect(status).toHaveBeenCalledTimes(1);

    status.mockResolvedValueOnce(healed);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith();
    expect(host.textContent).toContain("9999");
    expect(host.textContent).toContain("1/3");
    expect(host.textContent).not.toContain("加载中");
    expect(host.textContent).not.toContain("内核接口不可用");

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status).toHaveBeenCalledTimes(4);

    await act(async () => { buttonOf(host, "refresh").click(); });
    expect(status).toHaveBeenCalledTimes(5);
  });

  it("更新装上了：绿字说的是文件，状态徽标不许跟着亮成「运行中」", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const api = makeCoreApi(STOPPED, { update: coreView({}, "mochi", UPDATE_INSTALLED) });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    expect(api.update).toHaveBeenCalledWith();
    const ok = host.querySelector(".net-notice--ok");
    expect(ok?.textContent).toContain("新版已经放进 core 目录（下一次起内核吃它）");
    expect(errorText(host)).toBe("");
    expect(host.querySelector(".net-status.is-online")).toBeNull();
    expect(host.textContent).toContain("已停止");
    expect(host.textContent).not.toContain("运行中");
    // 回执之外还有一条常驻历史：这一行是「上次更新」的账，不随 5 秒回执一起消失。
    const line = updateLine(host);
    expect(line).toContain("上次更新");
    expect(line).toContain("v1.19.33");
    expect(line).toContain("40s前");
    expect(host.querySelector(".net-core-update--ok")).not.toBeNull();
    expect(host.textContent).not.toContain("还没试过更新");
  });

  it("更新被 busy 挡下：既不是绿也不是红，neutral 那一档只留给这一种败", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const busy = { ...UPDATE_INSTALLED, outcome: "busy" as const, tag: null, detail: null, at: CORE_NOW - 5_000 };
    const api = makeCoreApi(OWN_RUNNING, { update: coreView(OWN_RUNNING.status, "mochi", busy) });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    const neutral = host.querySelector(".net-notice--neutral");
    expect(neutral?.textContent).toContain("我自己起的那颗内核还在跑");
    expect(host.querySelector(".net-notice--ok")).toBeNull();
    expect(errorText(host)).toBe("");
    expect(host.querySelector(".net-core-update--neutral")).not.toBeNull();
    expect(buttonOf(host, "update").textContent).toContain("更新内核");
    // busy 不是「更新失败」：内核那颗还在跑，绿点该照旧亮着。
    expect(host.querySelector(".net-status.is-online")).not.toBeNull();
  });

  it("更新败在摘要上：红字端出的是 reason 那句，不是泛泛一句「失败」", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const failed: CoreUpdateState = {
      outcome: "failed", tag: "v1.19.34", asset: "mihomo-windows-amd64-v1.19.34.zip",
      reason: "digest-mismatch", detail: "期望 sha256 aaa，实际 bbb", at: CORE_NOW - 12_000,
    };
    const api = makeCoreApi(STOPPED, { update: coreView({}, "mochi", failed) });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    expect(errorText(host)).toContain("下回来的内容与发布页说的 sha256 对不上，这份包我没往里装");
    expect(errorText(host)).toContain("详情：期望 sha256 aaa，实际 bbb");
    expect(host.querySelector(".net-notice--ok")).toBeNull();
    expect(host.querySelector(".net-core-update--error")).not.toBeNull();
    expect(updateLine(host)).toContain("v1.19.34");
    // 现有那颗没被动过——这一句是「更新失败」与「更新把内核弄没了」的分界。
    expect(host.textContent).not.toContain("新版已经放进");
  });

  it("「已是最新」也走绿字：文件没动是一件要如实说的事，不是失败", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const latest = { ...UPDATE_INSTALLED, outcome: "latest" as const, detail: "core 里那颗与 v1.19.33 逐字节相同" };
    const api = makeCoreApi(STOPPED, { update: coreView({}, "mochi", latest) });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    expect(host.querySelector(".net-notice--ok")?.textContent).toContain("逐字节相同，文件没动");
    expect(errorText(host)).toBe("");
    expect(host.querySelector(".net-core-update--ok")).not.toBeNull();
  });

  it("账上没有更新的记录：一个字的回执都不许编", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const api = makeCoreApi(STOPPED, { update: STOPPED });
    const host = await mountCore(api);
    await act(async () => { buttonOf(host, "update").click(); });
    expect(host.querySelector(".net-notice--ok")).toBeNull();
    expect(errorText(host)).toBe("");
    expect(updateLine(host)).toBeUndefined();
    expect(buttonOf(host, "update").textContent).toContain("更新内核");
    expect(buttonOf(host, "update").disabled).toBe(false);
  });

  it("没试过更新才教一句「这一颗会干什么」，有账之后不再念", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const before = await mountCore(makeCoreApi(STOPPED));
    expect(before.textContent).toContain("还没试过更新");
    expect(before.textContent).toContain("发布页给了 sha256 我才下载");
    expect(updateLine(before)).toBeUndefined();

    const after = await mountCore(makeCoreApi(OWN_RUNNING_UPDATED));
    expect(after.textContent).not.toContain("还没试过更新");
    expect(updateLine(after)).toContain("上次更新");
  });

  it("借 Verge 那颗在跑也挡不住更新：文件不在它手上，只有起停三颗灰", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const host = await mountCore(makeCoreApi(EXTERNAL_RUNNING));
    for (const action of ["start", "stop", "restart"] as const) {
      expect(buttonOf(host, action).disabled, action).toBe(true);
    }
    expect(buttonOf(host, "update").disabled).toBe(false);
  });

  it("时钟倒着走的时候不报「多久之前」：宁可少一格，不报一个负数", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CORE_NOW);
    const skewed = { ...UPDATE_INSTALLED, at: CORE_NOW + 60_000 };
    const host = await mountCore(makeCoreApi(coreView({}, "mochi", skewed)));
    const line = updateLine(host);
    expect(line).toContain("上次更新");
    expect(line).toContain("v1.19.33");
    expect(line).not.toMatch(/\d+s前/);
  });
});

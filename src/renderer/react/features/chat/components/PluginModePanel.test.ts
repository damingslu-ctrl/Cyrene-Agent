// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MarketPluginEntry,
  PluginListEntry,
  PluginManagementApi,
} from "../../../../../shared/plugin-management";

vi.mock("../../../i18n", () => {
  const labels: Record<string, string> = {
        "common.loading": "加载中…",
        "common.retry": "重试",
        "pluginPanel.title": "功能插件",
        "pluginPanel.subtitle": "管理已安装的功能插件",
        "pluginPanel.searchPlaceholder": "搜索插件名称、描述或开发者…",
        "pluginPanel.refresh": "刷新插件",
        "pluginPanel.add": "添加插件",
        "pluginPanel.emptyHint": "暂无插件",
        "pluginPanel.noMatch": "无匹配插件",
        "pluginPanel.open": "打开",
        "pluginPanel.enable": "启用",
        "pluginPanel.disable": "停用",
        "pluginPanel.delete": "删除",
        "pluginPanel.status.running": "运行中",
        "pluginPanel.status.disabled": "已停用",
        "pluginPanel.status.starting": "启动中",
        "pluginPanel.status.stopping": "停用中",
        "pluginPanel.status.failed": "启动失败",
        "pluginPanel.builtinCannotDelete": "内置插件不可删除",
        "pluginPanel.market.title": "本地插件目录",
        "pluginPanel.market.subtitle": "直接读取本机插件目录；把插件文件夹放进该目录后点刷新即可看到。",
        "pluginPanel.market.toggle": "本地插件目录",
        "pluginPanel.market.back": "返回插件管理",
        "pluginPanel.market.directoryLabel": "目录：",
        "pluginPanel.market.localBadge": "本机",
        "pluginPanel.market.emptyHint": "本地插件目录为空",
        "pluginPanel.market.loadFailed": "读取本地插件目录失败：{{error}}",
      };
  const t = (key: string, values?: Record<string, string>) => {
      if (key === "pluginPanel.developer") return `开发者：${values?.author}`;
      if (key === "pluginPanel.deleteConfirm") return `删除 ${values?.name}`;
      const template = labels[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
  };
  return { useTranslation: () => ({ t }) };
});

// 统一反馈入口的稳定 spy：断言删除插件走危险确认而非浏览器默认弹窗
const feedbackSpies = vi.hoisted(() => ({
  notice: vi.fn(),
  alert: vi.fn(() => Promise.resolve()),
  confirm: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../components/feedback/FeedbackProvider", () => ({
  useFeedback: () => feedbackSpies,
}));

import { PluginModePanel, pluginToggleTarget } from "./PluginModePanel";

function plugin(overrides: Partial<PluginListEntry> = {}): PluginListEntry {
  return {
    id: "system-status",
    name: "系统状态",
    version: "0.1.0",
    description: "查询本机系统状态",
    author: "Mochi",
    entry: "index.cjs",
    apiVersion: 1,
    source: "user",
    path: "C:\\plugins\\system-status",
    defaultEnabled: false,
    configuredEnabled: true,
    enabled: true,
    status: "running",
    hasUnregister: true,
    canOpen: true,
    icon: "data:image/png;base64,AA==",
    ...overrides,
  };
}

function marketEntry(overrides: Partial<MarketPluginEntry> = {}): MarketPluginEntry {
  return {
    id: "market-demo",
    name: "市场演示",
    version: "1.2.0",
    description: "市场里的演示插件",
    author: "Mochi",
    path: "C:\\plugins\\market-demo",
    ...overrides,
  };
}

function apiFor(items: PluginListEntry[]): PluginManagementApi {
  return {
    list: vi.fn(async () => ({ plugins: items, issues: [] })),
    setEnabled: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    rescan: vi.fn(async () => ({ plugins: items, issues: [] })),
    importZip: vi.fn(async () => ({ ok: false, canceled: true })),
    uninstall: vi.fn(async () => ({ ok: true, overview: { plugins: [], issues: [] } })),
    marketList: vi.fn(async () => ({ ok: true, plugins: [] })),
  };
}

const LOCAL_PLUGINS_DIR = "C:\\Users\\demo\\AppData\\Roaming\\cyrene-verge\\plugins";

describe("PluginModePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    feedbackSpies.notice.mockClear();
    feedbackSpies.alert.mockClear().mockReturnValue(Promise.resolve());
    feedbackSpies.confirm.mockClear().mockReturnValue(Promise.resolve(true));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderPanel(api: PluginManagementApi): Promise<void> {
    await act(async () => {
      root.render(createElement(PluginModePanel, { api }));
    });
  }

  async function clickMarketToggle(): Promise<void> {
    const toggle = container.querySelector<HTMLButtonElement>(".plugin-panel__header-actions button");
    expect(toggle).toBeDefined();
    await act(async () => toggle?.click());
  }

  it("shows icon, plugin metadata, developer, and the three requested actions", async () => {
    const api = apiFor([plugin()]);
    await renderPanel(api);

    expect(container.textContent).toContain("系统状态");
    expect(container.textContent).toContain("查询本机系统状态");
    expect(container.textContent).toContain("开发者：Mochi");
    expect(container.querySelector<HTMLImageElement>(".plugin-card-ui__icon img")?.src).toContain("data:image/png");
    const cardButtons = [...container.querySelectorAll<HTMLButtonElement>(".plugin-card-ui__actions button")];
    expect(cardButtons.map((button) => button.textContent)).toEqual(["打开", "停用", "删除"]);
  });

  it("hides the open action when the plugin has no interface", async () => {
    const api = apiFor([plugin({ canOpen: false })]);
    await renderPanel(api);

    const cardButtons = [...container.querySelectorAll<HTMLButtonElement>(".plugin-card-ui__actions button")];
    expect(cardButtons.map((button) => button.textContent)).toEqual(["停用", "删除"]);
  });

  it("enables a disabled plugin and refreshes its state", async () => {
    const disabledPlugin = plugin({ configuredEnabled: false, enabled: false, status: "disabled" });
    const api = apiFor([disabledPlugin]);
    await renderPanel(api);
    const enable = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "启用");
    expect(enable).toBeDefined();

    await act(async () => enable?.click());

    expect(api.setEnabled).toHaveBeenCalledWith("system-status", true);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("keeps delete disabled for built-in plugins", async () => {
    const api = apiFor([plugin({ source: "builtin" })]);
    await renderPanel(api);

    const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "删除");
    expect(deleteButton?.disabled).toBe(true);
    expect(deleteButton?.title).toBe("内置插件不可删除");
  });

  it("删除插件先走危险确认，确认后才卸载", async () => {
    const api = apiFor([plugin()]);
    await renderPanel(api);

    const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "删除");
    expect(deleteButton?.disabled).toBe(false);

    await act(async () => deleteButton?.click());

    // 危险确认：标题为删除、dangerous 标记、默认聚焦取消
    expect(feedbackSpies.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除",
      dangerous: true,
    }));
    expect(api.uninstall).toHaveBeenCalledWith("system-status");
  });

  it("危险确认取消时不卸载插件", async () => {
    feedbackSpies.confirm.mockReturnValue(Promise.resolve(false));
    const api = apiFor([plugin()]);
    await renderPanel(api);

    const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "删除");
    await act(async () => deleteButton?.click());

    expect(feedbackSpies.confirm).toHaveBeenCalledTimes(1);
    expect(api.uninstall).not.toHaveBeenCalled();
  });

  it("切换到本地插件目录视图列出磁盘条目，切回后恢复插件视图", async () => {
    const api = apiFor([]);
    (api.marketList as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      plugins: [marketEntry()],
      directory: LOCAL_PLUGINS_DIR,
    });
    await renderPanel(api);
    expect(api.marketList).not.toHaveBeenCalled();

    await clickMarketToggle();

    expect(api.marketList).toHaveBeenCalledTimes(1);
    expect(api.marketList).toHaveBeenCalledWith();
    expect(container.textContent).toContain("本地插件目录");
    expect(container.textContent).toContain(LOCAL_PLUGINS_DIR);
    expect(container.textContent).toContain("市场演示");
    expect(container.textContent).toContain("本机");
    // 本地目录视图隐藏搜索框
    expect(container.querySelector(".plugin-panel__search")).toBeNull();
    // 安装动作已退化成「把插件放进目录」：卡片上不再有下载/安装/详情按钮
    expect(container.querySelector(".plugin-card-ui__actions")).toBeNull();

    await clickMarketToggle();

    expect(container.querySelector(".plugin-panel__search")).not.toBeNull();
    expect(container.textContent).toContain("管理已安装的功能插件");
  });

  it("渲染出的条目等于 props 给的本地条目", async () => {
    const entries = [
      marketEntry({ id: "alpha", name: "Alpha", version: "1.0.0", author: "Mochi" }),
      marketEntry({ id: "beta", name: "Beta", version: "2.1.0", author: "Mochi" }),
    ];
    const api = apiFor([]);
    (api.marketList as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      plugins: entries,
      directory: LOCAL_PLUGINS_DIR,
    });
    await renderPanel(api);
    await clickMarketToggle();

    const cards = [...container.querySelectorAll<HTMLElement>(".plugin-card-ui")];
    expect(cards).toHaveLength(entries.length);
    expect(cards.map((card) => card.querySelector(".plugin-card-ui__name")?.textContent))
      .toEqual(entries.map((entry) => entry.name));
    expect(cards.map((card) => card.querySelector(".plugin-card-ui__version")?.textContent))
      .toEqual(entries.map((entry) => `v${entry.version}`));
    expect(cards.map((card) => card.querySelector(".plugin-card-ui__developer")?.textContent))
      .toEqual(entries.map((entry) => `开发者：${entry.author}`));
  });

  it("读取本地插件目录失败时展示错误信息", async () => {
    const api = apiFor([]);
    (api.marketList as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "目录不可读",
      plugins: [],
    });
    await renderPanel(api);
    await clickMarketToggle();

    expect(container.textContent).toContain("读取本地插件目录失败：目录不可读");
  });

  it("本地目录视图里点刷新会重新读取目录", async () => {
    const api = apiFor([]);
    const marketList = api.marketList as ReturnType<typeof vi.fn>;
    marketList.mockResolvedValueOnce({
      ok: true,
      plugins: [marketEntry({ name: "Alpha" })],
      directory: LOCAL_PLUGINS_DIR,
    });
    await renderPanel(api);
    await clickMarketToggle();
    expect(container.textContent).toContain("Alpha");

    // 用户在此期间往目录里放了一个插件
    marketList.mockResolvedValueOnce({
      ok: true,
      plugins: [marketEntry({ name: "Alpha" }), marketEntry({ id: "beta", name: "Beta" })],
      directory: LOCAL_PLUGINS_DIR,
    });
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="刷新插件"]');
    expect(refresh).not.toBeNull();
    await act(async () => refresh?.click());

    expect(api.rescan).toHaveBeenCalledTimes(1);
    expect(marketList).toHaveBeenCalledTimes(2);
    expect(marketList).toHaveBeenLastCalledWith();
    expect(container.textContent).toContain("Beta");
  });

  it("插件视图里点刷新只重扫本地插件，不读取本地目录", async () => {
    const api = apiFor([plugin()]);
    await renderPanel(api);
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="刷新插件"]');
    await act(async () => refresh?.click());

    expect(api.rescan).toHaveBeenCalledTimes(1);
    expect(api.marketList).not.toHaveBeenCalled();
  });
});

describe("pluginToggleTarget", () => {
  it("retries failed plugins and disables running plugins", () => {
    expect(pluginToggleTarget(plugin({ status: "failed" }))).toBe(true);
    expect(pluginToggleTarget(plugin({ status: "running" }))).toBe(false);
  });
});

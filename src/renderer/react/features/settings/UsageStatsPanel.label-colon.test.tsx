// @vitest-environment jsdom
/**
 * 界面语言那颗冒号的**现场**尺（承 `label-colon.test.ts`）。
 *
 * 那把尺扫的是源码形状，这里量的是渲染出来的 `title` 字符串：`ui.labelColon` 到底解析成什么、
 * 换语言时住在 `useMemo` 里的那两条 tooltip 会不会跟着翻。
 * `UsageStatsPanel` 这两颗冒号长在模板字符串里（热力图单元格、周列），是第一把尺的形状盲区，
 * 也是英文界面真写过全角冒号的地方——`This machine：` 那一类的第二现场。
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { setUiLocale } from "../../i18n";
import { UsageStatsPanel } from "./UsageStatsPanel";
import type { UsageDay, UsageReport } from "./usageStatsViewModel";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const FULLWIDTH = "：";
const HALFWIDTH = ": ";

/** 这颗冒号在这条 title 里是哪一档：全角 / 半角 / 压根没有。 */
function colonKind(value: string): "full" | "half" | "none" {
  if (value.includes(FULLWIDTH)) return "full";
  if (value.includes(HALFWIDTH)) return "half";
  return "none";
}

function usageDay(input: number, output: number, requests: number): UsageDay {
  return {
    date: "01-01", // 视图模型按「最后一项是今天」重排日期，这里只占位
    weekday: "",
    input,
    output,
    hit: 0,
    miss: 0,
    cacheCreation: 0,
    requests,
    attemptedRequests: requests,
    cacheUsageRequests: 0,
  };
}

// models 留空：趋势图与甜甜圈的 config 因此为 null，jsdom 里没有 canvas 上下文也不会炸。
function usageReport(): UsageReport {
  return { days: [usageDay(1200, 300, 4), usageDay(0, 0, 0), usageDay(90, 10, 1)], models: [] };
}

let host: HTMLDivElement;
let root: Root | undefined;

async function mountPanel(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(UsageStatsPanel)); });
}

async function switchLocale(next: string): Promise<void> {
  await act(async () => { setUiLocale(next); });
  expect(i18next.language, "语言真切过去了").toBe(next);
}

async function pickHeatMode(index: number): Promise<void> {
  const inputs = [...host.querySelectorAll<HTMLInputElement>(".cy-usage-heatmap__mode-selector input")];
  expect(inputs.length, "热力图三档模式选择器").toBe(3);
  await act(async () => { inputs[index].click(); });
}

function usedCellTitles(): string[] {
  return [...host.querySelectorAll("span.cy-usage-heat-cell--used")].map((node) => node.getAttribute("title") ?? "");
}

function columnTitles(): string[] {
  return [...host.querySelectorAll("[data-testid='usage-heatmap'] .cy-usage-heatmap__column")]
    .map((node) => node.getAttribute("title") ?? "")
    .filter((title) => title.length > 0);
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  });
  Object.assign(window, { tokenUsage: { get: async () => usageReport(), clear: async () => {} } });
  setUiLocale("zh-CN");
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  document.body.innerHTML = "";
  delete (window as Window & { tokenUsage?: unknown }).tokenUsage;
  setUiLocale("zh-CN");
});

describe("用量面板：标签后的冒号（渲染现场）", () => {
  it("中文档：热力图单元格的 title 上屏的是全角冒号（正对照——尺不是空扫）", async () => {
    await mountPanel();
    const titles = usedCellTitles();
    expect(titles.length, "有用量的格子数").toBeGreaterThan(0);
    for (const title of titles) {
      expect(colonKind(title), `zh-CN 的 title：${title}`).toBe("full");
      expect(title.includes("ui.labelColon"), "缺 key 时 i18next 会把键名原样画上屏").toBe(false);
    }
  });

  it("同一格换到英文档：冒号跟着翻成半角，全角不许留在屏上", async () => {
    await mountPanel();
    const before = usedCellTitles();
    expect(before.length, "有用量的格子数").toBeGreaterThan(0);
    expect(colonKind(before[0]), "换语言前").toBe("full");

    await switchLocale("en");
    const after = usedCellTitles();
    expect(after.length, "换语言后格子数不变（不是重画成空表）").toBe(before.length);
    for (const title of after) expect(colonKind(title), `en 的 title：${title}`).toBe("half");

    // 整个面板的 tooltip 都要干净，不只那几格。
    const dirty = [...host.querySelectorAll("[title]")]
      .map((node) => node.getAttribute("title") ?? "")
      .filter((title) => title.includes(FULLWIDTH));
    expect(dirty, `en 档仍带全角冒号的 title：${JSON.stringify(dirty)}`).toEqual([]);
  });

  it("周／累计模式的列 tooltip 走同一颗冒号（那是模板字符串里第二处）", async () => {
    await mountPanel();
    await switchLocale("en");

    await pickHeatMode(1); // weekly
    const weekly = columnTitles();
    expect(weekly.length, "周模式带 tooltip 的列数").toBeGreaterThan(0);
    for (const title of weekly) expect(colonKind(title), `weekly 的 title：${title}`).toBe("half");

    await pickHeatMode(2); // cumulative
    const cumulative = columnTitles();
    expect(cumulative.length, "累计模式带 tooltip 的列数").toBeGreaterThan(0);
    for (const title of cumulative) expect(colonKind(title), `cumulative 的 title：${title}`).toBe("half");
  });

  it("中日两档照自己的语体走：搬进语言文件不是把它们一起改成半角", async () => {
    await mountPanel();
    for (const locale of ["zh-CN", "ja-JP"] as const) {
      await switchLocale(locale);
      const titles = usedCellTitles();
      expect(titles.length, `${locale} 有用量的格子数`).toBeGreaterThan(0);
      for (const title of titles) expect(colonKind(title), `${locale} 的 title：${title}`).toBe("full");
    }
  });
});

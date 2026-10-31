// @vitest-environment jsdom
/**
 * 界面语言的**现场**尺：屏上不许出现「长得像 i18n 键」的字符串。
 *
 * 静态那把尺量的是源码里的键名，那里的动态键腿（`` t(`settingsPage.usage.range${x}`) ``）判的是「有没有叶子
 * 以静态段开头」——于是 `range` 写成 `rang` 它一声不响：`rang` 仍是 `range7/range30/range90` 的前缀。
 * 可在屏幕上这件事没有歧义：三份表都指不到时，`parseMissingKeyHandler`（`i18n/index.ts:29`）把键名
 * **原样画上屏**，用户看见的就是 `settingsPage.usage.rang7`。静态那边要分辨截断，就得猜动态尾巴长什么形状；
 * 现场这边不用猜——键名形状本身就是罪证。
 *
 * 与静态那把的分工（各看得见对面看不见的东西，别把一把当成另一把的替代品）：
 * - **只缺一份表**的键在这里看不见，也不该在这里找：`fallbackLng`（`i18n/index.ts:21` = `zh-CN`，
 *   `src/shared/ui-language.ts:12`）会兜住，症状是「英文界面画中文」而不是键名上屏（实测：en 缺 `ui.labelColon`
 *   时，英文 tooltip 画的是 `October 29, 2026：1,500 Token`）。按**值**的那把现场尺（`UsageStatsPanel.label-colon.test.tsx`）
 *   会跟着红，但那只是碰巧这颗键的中文值有语体差别——多数键缺一份表时现场什么形状都不留。那归
 *   `i18n/used-keys.test.ts` 要求三份表齐的那条腿。
 * - 三份表一起缺（漏抽、截断、段名换错）才会把键名画上屏，两把尺一起响。
 *
 * 口径：
 * - 「表根段」不写死名单，运行时取 `zh-CN.json` 的顶层键（46 枚），新增一节自动进射程。
 * - 必须**紧跟一颗点再接一段标识符**才算：`sidebar.` （句号后有空格）这类正常句子不算。
 * - 三档语言各扫一遍 `textContent` 与全部元素属性值（`title`／`aria-label`／`placeholder` 这些才是用户看得见的地方）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { setUiLocale } from "../../i18n";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
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

const ROOTS = Object.keys(zhCN as Record<string, unknown>);

/** `(?:^|[^\\w.])` 是左边界：`v1.15.0` 那种前导点、`xxxui.foo` 那种黏在词里的，都不算一颗键。 */
const KEY_SHAPE = new RegExp(`(?:^|[^\\w.])((?:${ROOTS.join("|")})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)`, "g");

function keyShapes(value: string): string[] {
  return [...value.matchAll(KEY_SHAPE)].map((match) => match[1]);
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

/** 屏幕上真正可见的一切：正文 + 每个元素的每个属性值。 */
function onScreenStrings(): string[] {
  const out: string[] = [host.textContent ?? ""];
  for (const node of host.querySelectorAll<HTMLElement>("*")) {
    for (const attr of [...node.attributes]) if (attr.value) out.push(attr.value);
  }
  return out;
}

function offenders(): string[] {
  const found: string[] = [];
  for (const value of onScreenStrings()) found.push(...keyShapes(value));
  return found;
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
  document.body.replaceChildren();
  delete (window as Window & { tokenUsage?: unknown }).tokenUsage;
  setUiLocale("zh-CN");
});

describe("用量面板：屏上不许出现未翻译的键名（渲染现场）", () => {
  it("表根名单不是空的，而且认得截断那种形状（正对照——尺不是空扫）", async () => {
    expect(ROOTS.length, "zh-CN 顶层节数").toBeGreaterThan(30); // 实测 46
    expect(ROOTS).toContain("settingsPage");
    // 静态那把尺看不见的形状，这里必须看得见：截断前缀拼出来的键名。
    expect(keyShapes("Last 7 days settingsPage.usage.rang7"), "截断形状").toEqual(["settingsPage.usage.rang7"]);
    // 正常文案里的句号、版本号、以及黏在词里的同名串都不算。
    expect(keyShapes("Open the sidebar. Then pick a node."), "句号后有空格").toEqual([]);
    expect(keyShapes("本机 v1.15.0 已就绪"), "版本号").toEqual([]);
    expect(keyShapes("重画后的 subsettingsPage.usage 段不计入"), "左边界").toEqual([]);
    expect(keyShapes("settingsPage.usage.range7 与 ui.labelColon 两种段数都认"), "单段与多段").toEqual([
      "settingsPage.usage.range7",
      "ui.labelColon",
    ]);
  });

  it("三档语言渲染完，屏上没有任何键名形状", async () => {
    await mountPanel();
    for (const locale of ["zh-CN", "en", "ja-JP"] as const) {
      await switchLocale(locale);
      const screen = onScreenStrings();
      expect(screen[0].length, `${locale} 面板有正文（不是空渲染）`).toBeGreaterThan(150); // 实测 186：区间标签 + 热力图标题 + 汇总行
      expect(offenders(), `${locale} 档上屏的键名形状：${JSON.stringify(offenders())}`).toEqual([]);
    }
  });

  it("趋势区间那三档的表值真的在屏上（被漏检的动态键就住在这里）", async () => {
    // 期望值直接取自三份 JSON 表本身，不走 i18next——否则「解析得出」这条断言就成了自证。
    const labels = {
      "zh-CN": [zhCN.settingsPage.usage.range7, zhCN.settingsPage.usage.range30, zhCN.settingsPage.usage.range90],
      en: [en.settingsPage.usage.range7, en.settingsPage.usage.range30, en.settingsPage.usage.range90],
      "ja-JP": [jaJP.settingsPage.usage.range7, jaJP.settingsPage.usage.range30, jaJP.settingsPage.usage.range90],
    } as Record<string, string[]>;
    await mountPanel();
    for (const locale of ["zh-CN", "en", "ja-JP"] as const) {
      await switchLocale(locale);
      const text = host.textContent ?? "";
      for (const label of labels[locale]) {
        expect(text, `${locale} 档区间标签「${label}」`).toContain(label);
      }
    }
  });
});

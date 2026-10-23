// 搜索档位的文案锁：设置面板的标签是 `t("settingsPage.tools.search" + id)` 拼出来的，
// 注册表加一档而三份语言没跟上，界面上就会出现「settingsPage.tools.searchxxx」这种
// 直接拼给用户看的串。i18n 的三份互检（resources.test.ts）抓不到它——三份一起漏也算一致。

import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
import { SEARCH_ENGINES, searchEngineOptionIds, type SearchEngineProvider } from "../../../../shared/search-engines";

type Tools = Record<string, unknown>;

function toolsOf(resource: unknown): Tools {
  return (resource as { settingsPage: { tools: Tools } }).settingsPage.tools;
}

const LOCALES: Array<[string, Tools]> = [
  ["zh-CN", toolsOf(zhCN)],
  ["en", toolsOf(en)],
  ["ja-JP", toolsOf(jaJP)],
];

const providerIds = Object.keys(SEARCH_ENGINES) as SearchEngineProvider[];

describe("搜索档位文案", () => {
  it("注册表里确有档位（空数组会让下面两条读成 PASS）", () => {
    expect(providerIds.length).toBeGreaterThanOrEqual(7);
    expect(searchEngineOptionIds()).toEqual(["off", ...providerIds]);
  });

  it.each(providerIds)("档位 %s 在三种语言里都有下拉标签", (id) => {
    for (const [locale, tools] of LOCALES) {
      const label = tools[`search${id}`];
      expect(label, `${locale} 缺 settingsPage.tools.search${id}`).toBeTypeOf("string");
      expect((label as string).trim().length, `${locale} 的 search${id} 是空串`).toBeGreaterThan(0);
    }
  });

  it("免密钥档位（keyField=null）有对应的说明文案", () => {
    const keyless = providerIds.filter((id) => SEARCH_ENGINES[id].keyField === null);
    expect(keyless.length, "本次加的 bing 应落在免密钥一档").toBeGreaterThan(0);
    for (const [, tools] of LOCALES) {
      expect(tools.searchNoKey).toBeTypeOf("string");
      expect(tools.searchNoKeyDescription).toBeTypeOf("string");
    }
  });

  it("需要密钥的档位标签不许写「免密钥」", () => {
    // 界面写出来的就是承诺：说免密钥的那一档必须真的不取 key。
    for (const id of providerIds) {
      const label = String(toolsOf(zhCN)[`search${id}`] ?? "");
      if (SEARCH_ENGINES[id].keyField !== null) {
        expect(label, `${id} 需要 key 却在标签里写了免密钥`).not.toContain("免密钥");
      } else {
        expect(label, `${id} 免密钥但标签没告诉用户`).toContain("免密钥");
      }
    }
  });
});

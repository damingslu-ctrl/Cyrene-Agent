/**
 * 搜索档位 × 设置层的漂移锁。
 *
 * 这两处历史上各有一份档位清单，且都是**静默**失效的面：
 * - `normalizeGeneralSettings` 里的白名单漏一档 → 用户存的档位被悄悄改回 off；
 * - 白名单漏一个 key 字段 → 保存时那把 key 直接消失，用户每次重开都要重填。
 * 所以判据全部从注册表取：加一档即自动覆盖，不用记得回来补用例。
 */
import { describe, expect, it } from "vitest";
import { normalizeGeneralSettings } from "./settings-facade";
import { SEARCH_ENGINES, searchEngineOptionIds, type SearchEngineProvider } from "../../shared/search-engines";

const providerIds = Object.keys(SEARCH_ENGINES) as SearchEngineProvider[];
const baseline = normalizeGeneralSettings({});

describe("搜索档位与设置归一化一致", () => {
  it("档位清单非空且含本次新增的三档", () => {
    expect(providerIds.length).toBeGreaterThanOrEqual(7);
    for (const id of ["bing", "baidu", "deepseek"] as const) {
      expect(searchEngineOptionIds(), `注册表缺 ${id}`).toContain(id);
    }
  });

  it.each(providerIds)("%s 存进设置后读回来还是它自己", (id) => {
    expect(normalizeGeneralSettings({ ...baseline, searchEngine: id }).searchEngine).toBe(id);
  });

  it("未知档位归一化成 off（而不是崩或原样留着）", () => {
    expect(normalizeGeneralSettings({ ...baseline, searchEngine: "notAnEngine" as never }).searchEngine).toBe("off");
    expect(normalizeGeneralSettings({}).searchEngine).toBe("off");
  });

  it("每个 keyField 都真实存在且能存回读回", () => {
    const fields = providerIds
      .map((id) => SEARCH_ENGINES[id].keyField)
      .filter((field): field is NonNullable<typeof field> => field !== null);
    expect(fields.length).toBe(providerIds.length - 1); // 只有 bing 免密钥，其余都要落字段
    for (const field of fields) {
      expect(baseline, `档位字段 ${field} 在归一化结果里不存在`).toHaveProperty(field);
      expect(baseline[field], `${field} 默认值必须是空串`).toBe("");
      const saved = normalizeGeneralSettings({ ...baseline, [field]: "sk-测试值" });
      expect(saved[field], `保存 ${field} 后被归一化吞掉`).toBe("sk-测试值");
    }
  });

  it("minimax 档仍按「走 MCP、内置工具不执行」建模", () => {
    // 这条改了必须同时改 syncVolcanoSearchMcp 与工具过滤，不然模型会看到两个搜索口。
    expect(SEARCH_ENGINES.minimax.builtIn).toBe(false);
    expect(SEARCH_ENGINES.minimax.keyField).toBe("searchMinimaxKey");
  });
});

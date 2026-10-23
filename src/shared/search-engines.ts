/**
 * 联网搜索后端的单一事实源（与 `shared/local-models.ts` 同形）。
 *
 * 为什么要抽这一层：同一个「有哪些搜索源」的事实在四个地方各自维护过一份——
 * `SearchBackend` 联合类型、`GeneralSettings.searchEngine` 联合类型、设置面板
 * 保存时的白名单、设置面板的下拉选项。漏掉任意一处的后果都不是编译错误：
 * 漏 `shouldExposeSearchTool` 的判定，web_search 会**静默**从模型工具表里消失
 * （用户只看到「搜不到」）；漏 sanitizer 白名单，用户存的档位会被悄悄改回 off。
 *
 * 新增档位 id 一律全小写：`anySearch` 是历史遗留，它那种大小写混排会让
 * 「id → 字段名 → i18n key」的派生链再繁殖一份特例，不再添加第四个。
 */

export const SEARCH_ENGINE_IDS = [
  "off",
  "bocha",
  "tavily",
  "minimax",
  "anySearch",
  "bing",
  "baidu",
  "deepseek",
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number];

/** 除「关闭」外的档位。设置面板的选中态、执行器的键都用这个。 */
export type SearchEngineProvider = Exclude<SearchEngineId, "off">;

/** `GeneralSettings` 里存放搜索 key 的字段名。 */
export type SearchKeyField =
  | "searchBochaKey"
  | "searchTavilyKey"
  | "searchMinimaxKey"
  | "searchAnySearchKey"
  | "searchBaiduKey"
  | "searchDeepseekKey";

export interface SearchEngineSpec {
  readonly id: SearchEngineProvider;
  /**
   * 由内置 `web_search` 工具执行。false = 这一档的搜索能力来自别处
   * （minimax 走 MCP 工具），此时内置工具必须被隐藏，否则模型同时看到两个搜索口。
   */
  readonly builtIn: boolean;
  /** key 为空时硬失败（报 E_SEARCH_KEY_MISSING）。与 keyField 是两回事：见 anySearch。 */
  readonly requiresKey: boolean;
  /**
   * 存 key 的设置字段；null = 这条链路上完全不带凭据（bing 抓公开结果页）。
   * anySearch 是「有 key 就带上、没有也照常搜」，所以 keyField 非空而 requiresKey=false。
   */
  readonly keyField: SearchKeyField | null;
  /**
   * 内置工具实际打的地址；null = 这一档不走内置请求。
   * minimax 走 stdio MCP 子进程（host 在 general-settings-lifecycle.ts 的 env 里），
   * 这里再抄一份就是第二个事实源，改一处就会和另一处不一致。
   */
  readonly endpoint: string | null;
}

export const SEARCH_ENGINES: Record<SearchEngineProvider, SearchEngineSpec> = {
  bocha: {
    id: "bocha",
    builtIn: true,
    requiresKey: true,
    keyField: "searchBochaKey",
    endpoint: "https://api.bochaai.com/v1/web-search",
  },
  tavily: {
    id: "tavily",
    builtIn: true,
    requiresKey: true,
    keyField: "searchTavilyKey",
    endpoint: "https://api.tavily.com/search",
  },
  minimax: {
    id: "minimax",
    builtIn: false,
    requiresKey: true,
    keyField: "searchMinimaxKey",
    endpoint: null,
  },
  anySearch: {
    id: "anySearch",
    builtIn: true,
    requiresKey: false,
    keyField: "searchAnySearchKey",
    endpoint: "https://api.anysearch.com/v1/search",
  },
  bing: {
    id: "bing",
    builtIn: true,
    requiresKey: false,
    keyField: null,
    endpoint: "https://www.bing.com/search",
  },
  baidu: {
    id: "baidu",
    builtIn: true,
    requiresKey: true,
    keyField: "searchBaiduKey",
    endpoint: "https://qianfan.baidubce.com/v2/ai_search/web_search",
  },
  deepseek: {
    id: "deepseek",
    builtIn: true,
    requiresKey: true,
    keyField: "searchDeepseekKey",
    endpoint: "https://api.deepseek.com/v1/tools/search",
  },
};

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return (SEARCH_ENGINE_IDS as readonly string[]).includes(String(value));
}

/** 当前档位是否应该暴露内置 web_search 工具（`off` 与 minimax 都不暴露）。 */
export function usesBuiltinSearchTool(activeEngine: SearchEngineId): boolean {
  if (activeEngine === "off") return false;
  return SEARCH_ENGINES[activeEngine].builtIn;
}

/** 设置面板的下拉选项（含「关闭」），顺序即 SEARCH_ENGINE_IDS 的顺序。 */
export function searchEngineOptionIds(): SearchEngineId[] {
  return [...SEARCH_ENGINE_IDS];
}

// web_search 工具测试：缓存行为 + 各档请求/解析。全部用 stub 的 fetch 桩，不发真实网络请求。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWebSearchCache,
  getSearchExecutors,
  parseBingResults,
  setSearchConfig,
  webSearchTool,
  type SearchConfigSnapshot,
} from "./web-search-tool";
import { SEARCH_ENGINES, type SearchEngineId, type SearchKeyField } from "../../../../shared/search-engines";

/** 构造博查 API 形状的 fetch 桩 */
function makeBochaResp(results: Array<{ name: string; url: string; snippet: string }>): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ webPages: { value: results } }),
  } as unknown as Response;
}

function makeJsonResp(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

function makeTextResp(text: string): Response {
  return { ok: true, status: 200, statusText: "OK", text: async () => text } as unknown as Response;
}

const ALL_KEYS: Record<SearchKeyField, string> = {
  searchBochaKey: "bocha-key",
  searchTavilyKey: "tavily-key",
  searchMinimaxKey: "minimax-key",
  searchAnySearchKey: "",
  searchBaiduKey: "baidu-key",
  searchDeepseekKey: "deepseek-key",
};

/** 指定档位与 key（未覆盖的 key 用 ALL_KEYS 的默认值）。 */
function useEngine(engine: SearchEngineId, keys: Partial<Record<SearchKeyField, string>> = {}): void {
  const snapshot: SearchConfigSnapshot = { engine, keys: { ...ALL_KEYS, ...keys } };
  setSearchConfig(() => snapshot);
}

beforeEach(() => {
  clearWebSearchCache();
  useEngine("bocha");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("web_search 结果缓存", () => {
  it("同一查询两次只搜一次，第二次带 cached/cachedAt 标注", async () => {
    const fetchMock = vi.fn(async () => makeBochaResp([
      { name: "结果一", url: "https://example.com/1", snippet: "摘要一" },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const first = JSON.parse(await webSearchTool.execute({ query: "AI 新闻" })) as Record<string, unknown>;
    expect(first.cached).toBeUndefined();
    expect(first.resultCount).toBe(1);

    const second = JSON.parse(await webSearchTool.execute({ query: "AI 新闻" })) as Record<string, unknown>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(typeof second.cachedAt).toBe("string");
    expect(second.resultCount).toBe(1);
  });

  it("不同查询各自请求", async () => {
    const fetchMock = vi.fn(async () => makeBochaResp([]));
    vi.stubGlobal("fetch", fetchMock);

    await webSearchTool.execute({ query: "AI 新闻" });
    await webSearchTool.execute({ query: "游戏热点" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("关键词空白差异视为同一查询（压空白后同 key）", async () => {
    const fetchMock = vi.fn(async () => makeBochaResp([]));
    vi.stubGlobal("fetch", fetchMock);

    await webSearchTool.execute({ query: "AI  新闻" });
    const second = JSON.parse(await webSearchTool.execute({ query: "AI 新闻" })) as Record<string, unknown>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it("搜索失败不进缓存：第一次报错，第二次成功则正常返回", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (fail) return { ok: false, status: 500, statusText: "Server Error" } as unknown as Response;
      return makeBochaResp([{ name: "恢复结果", url: "https://example.com/ok", snippet: "ok" }]);
    }));

    await expect(webSearchTool.execute({ query: "股价" })).rejects.toThrow("搜索失败");

    fail = false;
    const second = JSON.parse(await webSearchTool.execute({ query: "股价" })) as Record<string, unknown>;
    expect(second.cached).toBeUndefined();
    expect(second.resultCount).toBe(1);
  });

  it("超过 30 分钟缓存过期，重新搜索", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => makeBochaResp([]));
    vi.stubGlobal("fetch", fetchMock);

    await webSearchTool.execute({ query: "今日新闻" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31 * 60_000);
    const second = JSON.parse(await webSearchTool.execute({ query: "今日新闻" })) as Record<string, unknown>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.cached).toBeUndefined();
  });
});

// ── 注册表一致性（漂移锁）──────────────────
// 加一档而忘在这里补执行器，运行时会走 E_SEARCH_ENGINE_NOT_SUPPORTED 而不是编译错误；
// 反过来「有执行器但 builtIn=false」会让内置工具和 MCP 工具同时暴露给模型。
// 两条都必须当场红。

describe("注册表与执行器一致", () => {
  const providers = Object.keys(SEARCH_ENGINES) as Array<keyof typeof SEARCH_ENGINES>;

  it("每个档位都有明确表态（执行器或 null），且与 builtIn 一致", () => {
    const executors = getSearchExecutors();
    for (const id of providers) {
      expect(executors, `档位 ${id} 缺执行器分支`).toHaveProperty(id);
      expect((executors[id] !== null), `档位 ${id} 的 builtIn 与执行器不一致`).toBe(SEARCH_ENGINES[id].builtIn);
    }
  });

  it("requiresKey=true 的档位必须有 keyField（否则永远取不到 key）", () => {
    for (const id of providers) {
      if (SEARCH_ENGINES[id].requiresKey) {
        expect(SEARCH_ENGINES[id].keyField, `档位 ${id} 要 key 却没有存放字段`).not.toBeNull();
      }
    }
  });

  it("内置工具执行的档位必须有 endpoint（null 只允许给非内置档）", () => {
    for (const id of providers) {
      if (SEARCH_ENGINES[id].builtIn) {
        expect(SEARCH_ENGINES[id].endpoint, `档位 ${id} 是内置执行但没有地址`).not.toBeNull();
      }
    }
  });
});

// ── 必应：免密钥 + 抓结果页 ────────────────

/** 按 cn.bing.com 实测结构（b_algo 块、h2>a 取标题与直链、p 取摘要）构造的最小夹具。 */
const BING_HTML = `
<main><ol id="b_results">
<li class="b_algo" data-async-context="x"><div class="b_titleWithInformation"><h2 class=""><a h="13" href="https://example.org/a">&amp; 实体 &lt;A&gt; 标题</a></h2><div class="b_caption"><p class="b_lineclamp2">2026年1月1日&ensp;&#0183;&ensp;第一条摘要<span class="sim">忽略</span></p></div></div></li>
<li class="b_algo"><h2><a href="https://example.org/b">第二条</a></h2><p>第二条摘要</p></li>
<li class="b_ans"><h2><a href="https://example.org/not-result">不该进结果</a></h2><p>知识卡</p></li>
<li class="b_algo"><h2><span>没有链接的一条</span></h2><p>跳过</p></li>
</ol></main>`;

describe("web_search 必应档", () => {
  it("免密钥可用，并带桌面 UA 抓结果页", async () => {
    useEngine("bing");
    const fetchMock = vi.fn(async () => makeTextResp(BING_HTML));
    vi.stubGlobal("fetch", fetchMock);

    const out = JSON.parse(await webSearchTool.execute({ query: "OpenAI 最新模型" })) as {
      resultCount: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://www.bing.com/search?");
    expect(url).toContain("q=OpenAI");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("Chrome");
    expect(out.resultCount).toBe(2);
    expect(out.results[0].title).toBe("& 实体 <A> 标题");
    expect(out.results[0].url).toBe("https://example.org/a");
    // &ensp;&#0183;&ensp; 解码成中点，不再以实体形式喂给模型
    expect(out.results[0].snippet).toBe("2026年1月1日 · 第一条摘要忽略");
  });

  it("版面变化解析不到结果时如实返回 0 条，而不是报错", async () => {
    useEngine("bing");
    vi.stubGlobal("fetch", vi.fn(async () => makeTextResp("<html><body>验证你的人类身份</body></html>")));
    const out = JSON.parse(await webSearchTool.execute({ query: "任意" })) as { resultCount: number };
    expect(out.resultCount).toBe(0);
  });

  it("parseBingResults 只认 b_algo 且有直链的块", () => {
    const parsed = parseBingResults(BING_HTML);
    expect(parsed.map((r) => r.url)).toEqual(["https://example.org/a", "https://example.org/b"]);
  });
});

// ── 百度千帆 ──────────────────────────────

describe("web_search 百度档", () => {
  it("按千帆契约发 POST，并把 references 映射成结果", async () => {
    useEngine("baidu");
    const fetchMock = vi.fn(async () => makeJsonResp({
      references: [
        { id: 1, type: "web", title: "河北天气", url: "https://www.weather.com.cn/x", content: "及时准确发布中央气象台天气信息" },
        { id: 2, type: "web", title: "无正文的一条", url: "https://example.org/y", web_anchor: "兜底锚文本" },
      ],
      request_id: "req-1",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = JSON.parse(await webSearchTool.execute({ query: "河北天气" })) as {
      resultCount: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://qianfan.baidubce.com/v2/ai_search/web_search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer baidu-key");
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: "user", content: "河北天气" }],
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: 8 }],
    });
    expect(out.resultCount).toBe(2);
    expect(out.results[1].snippet).toBe("兜底锚文本");
  });

  it("HTTP 200 但正文带 code 时报错（欠费/无权限不能读成「没搜到」）", async () => {
    useEngine("baidu");
    vi.stubGlobal("fetch", vi.fn(async () => makeJsonResp({ code: "InternalAPIError", message: "账号欠费", references: [] })));
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("搜索失败：InternalAPIError 账号欠费");
  });

  it("缺 key 报 E_SEARCH_KEY_MISSING", async () => {
    useEngine("baidu", { searchBaiduKey: "   " });
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("E_SEARCH_KEY_MISSING");
  });
});

// ── DeepSeek ──────────────────────────────

describe("web_search DeepSeek 档", () => {
  it("按 /v1/tools/search 契约发请求，优先用 summary 当摘要", async () => {
    useEngine("deepseek");
    const fetchMock = vi.fn(async () => makeJsonResp({
      results: [
        { title: "长摘要那条", url: "https://example.org/1", snippet: "短", summary: "给模型看的长摘要", site_name: "示例站" },
        { title: "只有 snippet", url: "https://example.org/2", snippet: "短摘要" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = JSON.parse(await webSearchTool.execute({ query: "DeepSeek 价格" })) as {
      resultCount: number;
      results: Array<{ title: string; snippet: string; source?: string }>;
    };
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/tools/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer deepseek-key");
    expect(JSON.parse(String(init.body))).toEqual({ query: "DeepSeek 价格", count: 8 });
    expect(out.resultCount).toBe(2);
    expect(out.results[0].snippet).toBe("给模型看的长摘要");
    expect(out.results[0].source).toBe("示例站");
    expect(out.results[1].source).toBeUndefined();
  });

  it("缺 key 报 E_SEARCH_KEY_MISSING", async () => {
    useEngine("deepseek", { searchDeepseekKey: "" });
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("E_SEARCH_KEY_MISSING");
  });
});

// ── 档位分派 ──────────────────────────────

describe("web_search 档位分派", () => {
  it("minimax 走 MCP，内置工具拒绝执行（否则模型同时看到两个搜索口）", async () => {
    useEngine("minimax");
    vi.stubGlobal("fetch", vi.fn(async () => makeJsonResp({})));
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("E_SEARCH_ENGINE_NOT_SUPPORTED:minimax");
  });

  it("关闭态报 E_SEARCH_NOT_ENABLED", async () => {
    useEngine("off");
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("E_SEARCH_NOT_ENABLED");
  });

  it("anySearch 无 key 也照常搜（该档 key 可选）", async () => {
    useEngine("anySearch", { searchAnySearchKey: "" });
    const fetchMock = vi.fn(async () => makeJsonResp({ data: { results: [{ title: "t", url: "https://e.org", content: "c", snippet: "s" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const out = JSON.parse(await webSearchTool.execute({ query: "任意" })) as { resultCount: number };
    expect(out.resultCount).toBe(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Authorization");
  });

  it("tavily 缺 key 报 E_SEARCH_KEY_MISSING", async () => {
    useEngine("tavily", { searchTavilyKey: "" });
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("E_SEARCH_KEY_MISSING");
  });

  it("上游站点被逐跳闸门拦下时，报错里带上那个地址", async () => {
    useEngine("bing");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://raw.githubusercontent.com/x/y" }),
      body: { cancel: async () => {} },
    }) as unknown as Response));
    await expect(webSearchTool.execute({ query: "任意" })).rejects.toThrow("raw.githubusercontent.com");
  });
});

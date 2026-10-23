// ── 工具：web_search（多后端联网搜索）─────────────────────────
// 联网搜索：给关键词，返回搜索结果（标题/链接/摘要）。
// key 通过 setSearchConfig 注入（避免 import index.ts 造成循环依赖）。
//
// 原样迁自 built-in-tools.ts（纯搬移，逻辑未改）。注册方式调整：本模块导出
// webSearchTool 常量，由 built-in-tools.ts facade 在原注册位置统一 toolRegistry.register，
// 显式保证 registry 插入顺序（= 工具目录 prompt 生成顺序，门禁见
// built-in-tools.snapshot.test.ts）。

import type { ToolDefinition } from "../registry/tool-registry";
import type { ToolContext } from "../registry/tool-context";
import { TtlResultCache } from "./ttl-result-cache";
import { fetchWithoutUpstreamRedirects } from "../../../egress/safe-fetch";
import {
  SEARCH_ENGINES,
  type SearchEngineId,
  type SearchEngineProvider,
  type SearchKeyField,
} from "../../../../shared/search-engines";

// ── 配置注入 ──────────────────────────────

/** 每轮执行时实时读取的搜索配置快照。 */
export interface SearchConfigSnapshot {
  engine: SearchEngineId;
  /**
   * 键集合由注册表穷尽（不是 Partial）：装配处漏填一个字段 = 编译不过，
   * 而不是那一档永远报 key 缺失——后者只会让用户以为自己的 key 填错了。
   */
  keys: Record<SearchKeyField, string>;
}

/** 注入的搜索配置获取器。 */
let searchConfigGetter: (() => SearchConfigSnapshot) | null = null;

/** index.ts 启动时调用，注入「当前搜索后端 + 各源 key」的读取器。 */
export function setSearchConfig(getter: () => SearchConfigSnapshot): void {
  searchConfigGetter = getter;
}

// ── 结果结构 ──────────────────────────────

/** 搜索结果统一结构 */
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

/** 搜索输出统一结构（ToolCallResult.output 的 JSON） */
interface WebSearchOutput {
  success: true;
  query: string;
  resultCount: number;
  results: WebSearchResult[];
}

/** snippet 最大长度 */
const MAX_SNIPPET_LEN = 500;
/** 单次搜索请求的结果条数（各档参数名不同，但都对齐这个数）。 */
const RESULT_COUNT = 8;
const SEARCH_TIMEOUT_MS = 20_000;

// ── 搜索结果缓存 ─────────────────────────────────────────
// 模型经常在同一会话里反复搜同一关键词（每轮 17~19 个工具调用中就有重复），
// 30 分钟内同引擎同关键词直接复用上次结果。固定 TTL 不续期：新闻/股价类
// 查询的结果不会因频繁访问而保持新鲜，到期必须重搜。
const SEARCH_CACHE_TTL_MS = 30 * 60_000;
const searchCache = new TtlResultCache<WebSearchOutput>(SEARCH_CACHE_TTL_MS);

/** 清空搜索缓存（测试隔离用） */
export function clearWebSearchCache(): void {
  searchCache.clear();
}

/** 截断 snippet */
function truncateSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_SNIPPET_LEN ? clean.slice(0, MAX_SNIPPET_LEN) + "..." : clean;
}

function buildOutput(query: string, results: WebSearchResult[]): WebSearchOutput {
  return { success: true, query, resultCount: results.length, results };
}

interface SearchRequest {
  query: string;
  /** 已 trim 的 key；requiresKey=false 的档位可能是空串。 */
  key: string;
  /** 注册表里的地址，写请求体/URL 时用它，不再各处硬编码。 */
  endpoint: string;
  signal?: AbortSignal;
}

/**
 * 统一的取数入口：超时、父 signal 组合、逐跳上游闸门、HTTP 状态判定只写一遍。
 * 解析回调留在 try 内，正文读取同样受超时约束（原来的六份复制代码就是这个形状）。
 */
async function fetchParsed<T>(
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  parse: (resp: Response) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
  try {
    const resp = await fetchWithoutUpstreamRedirects(endpoint, { ...init, signal: combinedSignal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await parse(resp);
  } finally {
    clearTimeout(timer);
  }
}

// ── 各档执行器 ────────────────────────────

/** 博查搜索：调 /v1/web-search，返回结构化结果。 */
async function bochaSearch({ query, key, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const raw = await fetchParsed(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, count: RESULT_COUNT, summary: true }),
    },
    signal,
    (resp) => resp.json() as Promise<{
      webPages?: { value?: BochaResult[] };
      data?: { webPages?: { value?: BochaResult[] } };
    }>,
  );
  const bochaResults = raw.data?.webPages?.value ?? raw.webPages?.value ?? [];
  return buildOutput(
    query,
    bochaResults.map((r) => ({
      title: r.name,
      url: r.url,
      snippet: truncateSnippet(r.summary || r.snippet || ""),
      ...(r.siteName ? { source: r.siteName } : {}),
    })),
  );
}

interface BochaResult {
  name: string;
  url: string;
  snippet: string;
  summary?: string;
  siteName?: string;
}

/** Tavily 搜索：调 /search，返回结构化结果。 */
async function tavilySearch({ query, key, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const data = await fetchParsed(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: RESULT_COUNT, include_answer: true }),
    },
    signal,
    (resp) => resp.json() as Promise<{
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    }>,
  );
  const tavilyResults = data.results ?? [];
  return buildOutput(
    query,
    tavilyResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: truncateSnippet(data.answer && r.content ? `${data.answer}\n${r.content}` : r.content || ""),
    })),
  );
}

/** AnySearch 搜索：调 /v1/search，返回结构化结果。key 可选，有就带上。 */
async function anySearchSearch({ query, key, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const data = await fetchParsed(
    endpoint,
    { method: "POST", headers, body: JSON.stringify({ query, max_results: RESULT_COUNT }) },
    signal,
    (resp) => resp.json() as Promise<{
      data?: { results?: Array<{ title: string; url: string; content: string; snippet: string }> };
    }>,
  );
  const rawResults = data.data?.results ?? [];
  return buildOutput(
    query,
    rawResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: truncateSnippet(r.content || r.snippet || ""),
    })),
  );
}

/**
 * 百度千帆「联网搜索」：/v2/ai_search/web_search 收 messages 数组（按对话式接口设计），
 * 结果在 references[]。平台欠费/无权限时 HTTP 仍可能是 200 而正文带 code，
 * 所以正文里的 code 要当成失败说出去，否则用户只看到「搜不到」。
 */
async function baiduSearch({ query, key, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const data = await fetchParsed(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: query }],
        search_source: "baidu_search_v2",
        resource_type_filter: [{ type: "web", top_k: RESULT_COUNT }],
      }),
    },
    signal,
    (resp) => resp.json() as Promise<{
      code?: string;
      message?: string;
      references?: Array<{ title?: string; url?: string; content?: string; web_anchor?: string }>;
    }>,
  );
  if (data.code) {
    throw new Error(data.message ? `${data.code} ${data.message}` : String(data.code));
  }
  const references = data.references ?? [];
  return buildOutput(
    query,
    references.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: truncateSnippet(r.content || r.web_anchor || ""),
    })),
  );
}

/**
 * DeepSeek 搜索：/v1/tools/search 返回 results[]（已按 rerank_score 排好）。
 * summary 是给模型看的长摘要，snippet 是给人看的短摘要，优先用前者。
 */
async function deepseekSearch({ query, key, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const data = await fetchParsed(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, count: RESULT_COUNT }),
    },
    signal,
    (resp) => resp.json() as Promise<{
      results?: Array<{ title?: string; url?: string; snippet?: string; summary?: string; site_name?: string }>;
    }>,
  );
  const results = data.results ?? [];
  return buildOutput(
    query,
    results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: truncateSnippet(r.summary || r.snippet || ""),
      ...(r.site_name ? { source: r.site_name } : {}),
    })),
  );
}

// ── 必应：抓公开结果页 ────────────────────
// 微软的 Bing Search API 已下架，公开结果页是唯一免密钥可走的口，代价是它按 HTML
// 解析——版面一改就退化成 resultCount=0（「没搜到」和「解析不到」在这里同形）。
// 免密钥意味着这条链路没有配额、没有 SLA，把它做成「可选后端」而不是兜底。
const BING_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 实体解码。`&amp;` 必须最后换，否则 `&amp;lt;` 会被提前解成 `<`。 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => stringFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => stringFromCodePoint(parseInt(hex, 16)))
    .replace(/&(nbsp|ensp|emsp);/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stringFromCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ""));
}

/**
 * 解析 b_algo 结果块。块级正则用非贪婪 `</li>` 收尾：实测 cn.bing.com 的 10 条结果
 * 里 b_algo 不含嵌套 li，所以第一条 `</li>` 就是块尾。
 */
export function parseBingResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const block of html.matchAll(/<li class="b_algo[\s\S]*?<\/li>/g)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block[0]);
    if (!link) continue;
    const url = decodeHtmlEntities(link[1]).trim();
    if (!url.startsWith("http")) continue;
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block[0]);
    results.push({
      title: truncateSnippet(stripTags(link[2])),
      url,
      snippet: truncateSnippet(paragraph ? stripTags(paragraph[1]) : ""),
    });
  }
  return results;
}

async function bingSearch({ query, endpoint, signal }: SearchRequest): Promise<WebSearchOutput> {
  const searchUrl = `${endpoint}?${new URLSearchParams({
    q: query,
    setlang: "zh-hans",
    count: String(RESULT_COUNT),
  }).toString()}`;
  const html = await fetchParsed(
    searchUrl,
    { headers: { "User-Agent": BING_USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9" } },
    signal,
    (resp) => resp.text(),
  );
  return buildOutput(query, parseBingResults(html));
}

/**
 * 每个档位都必须在这里表态：加档不写执行器 = 编译不过；
 * 写 null 但注册表标了 builtIn = `web-search-tool.test.ts` 的一致性锁当场红。
 */
type SearchExecutor = (request: SearchRequest) => Promise<WebSearchOutput>;

const SEARCH_EXECUTORS: Record<SearchEngineProvider, SearchExecutor | null> = {
  bocha: bochaSearch,
  tavily: tavilySearch,
  minimax: null,
  anySearch: anySearchSearch,
  bing: bingSearch,
  baidu: baiduSearch,
  deepseek: deepseekSearch,
};

export function getSearchExecutors(): Readonly<Record<SearchEngineProvider, SearchExecutor | null>> {
  return SEARCH_EXECUTORS;
}

async function executeWebSearch(args: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
  const config = searchConfigGetter?.();
  const engine = config?.engine ?? "off";
  if (engine === "off") {
    throw new Error("E_SEARCH_NOT_ENABLED");
  }

  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new Error("E_SEARCH_QUERY_EMPTY");
  }

  // 缓存命中：标注 cached/cachedAt，让模型自知结果的新鲜度，
  // 回答时效类问题时会带"截至 xx 时间"而不是拿旧缓存当最新
  const cacheKey = engine + "|" + query.replace(/\s+/g, " ");
  const hit = searchCache.get(cacheKey);
  if (hit) {
    return JSON.stringify({
      ...hit.value,
      cached: true,
      cachedAt: new Date(hit.at).toISOString(),
    });
  }

  const spec = SEARCH_ENGINES[engine];
  const executor = SEARCH_EXECUTORS[engine];
  if (!spec || !executor) {
    throw new Error(`E_SEARCH_ENGINE_NOT_SUPPORTED:${engine}`);
  }
  const key = (spec.keyField ? config?.keys?.[spec.keyField] ?? "" : "").trim();
  if (spec.requiresKey && !key) {
    throw new Error("E_SEARCH_KEY_MISSING");
  }

  let output: WebSearchOutput;
  try {
    output = await executor({ query, key, endpoint: spec.endpoint ?? "", signal: ctx?.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`搜索失败：${msg}`);
  }

  // 只有成功走到这里才写缓存；上面的执行器失败时会 throw，不会污染缓存
  searchCache.set(cacheKey, output);
  return JSON.stringify(output);
}

export const webSearchTool: ToolDefinition = {
  id: "web_search",
  name: "联网搜索",
  description:
    "搜索互联网获取实时信息。返回搜索结果的标题、链接和摘要。\n\n" +
    "何时用：\n" +
    "- 用户问'最近有什么新闻''搜一下 xxx 怎么用''xxx 是什么'\n" +
    "- 用户问的事需要联网才能知道（股价、赛事、最新技术）\n" +
    "- 用户只给关键词，没给具体网址\n\n" +
    "不要用于：\n" +
    "- 用户已经给了明确网址 -> 用 fetch_url\n" +
    "- 用户问本机文件 -> Read / Glob\n" +
    "- 能凭已有知识直接回答的简单问题\n\n" +
    "参数：query（必填，搜索关键词）。",
  enabled: true,
  risk: "network",
  effectKind: "read" as const,
  verificationPolicy: "none" as const,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
    },
    required: ["query"],
  },
  execute: executeWebSearch,
};

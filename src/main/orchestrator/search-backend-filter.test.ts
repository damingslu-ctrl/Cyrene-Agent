import { describe, expect, it } from "vitest";
import {
  shouldExposeSearchTool,
  filterToolsBySearchBackend,
  BUILTIN_SEARCH_TOOL_ID,
  MINIMAX_SEARCH_TOOL_PREFIX,
  type SearchBackend,
} from "./search-backend-filter";
import { SEARCH_ENGINES, type SearchEngineProvider } from "../../shared/search-engines";

// ── 搜索工具过滤 ──────────────────────────

describe("shouldExposeSearchTool", () => {
  it("exposes built-in web_search for bocha backend", () => {
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "bocha")).toBe(true);
  });

  it("exposes built-in web_search for tavily backend", () => {
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "tavily")).toBe(true);
  });

  it("exposes built-in web_search for anySearch backend", () => {
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "anySearch")).toBe(true);
  });

  it("hides built-in web_search for minimax backend", () => {
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "minimax")).toBe(false);
  });

  it("hides built-in web_search for off backend", () => {
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "off")).toBe(false);
  });

  it("exposes minimax MCP tool for minimax backend", () => {
    expect(shouldExposeSearchTool("minimax-web-search-web_search", "minimax")).toBe(true);
  });

  it("hides minimax MCP tool for bocha backend", () => {
    expect(shouldExposeSearchTool("minimax-web-search-web_search", "bocha")).toBe(false);
  });

  it("hides minimax MCP tool for tavily backend", () => {
    expect(shouldExposeSearchTool("minimax-web-search-web_search", "tavily")).toBe(false);
  });

  it("hides minimax MCP tool for off backend", () => {
    expect(shouldExposeSearchTool("minimax-web-search-web_search", "off")).toBe(false);
  });

  it("always exposes non-search tools", () => {
    expect(shouldExposeSearchTool("weather", "off")).toBe(true);
    expect(shouldExposeSearchTool("music_search", "minimax")).toBe(true);
    expect(shouldExposeSearchTool("file_create", "bocha")).toBe(true);
  });

  // 注册表驱动的穷尽覆盖：逐条硬写用例时，新增一档不会自动出现在这里，
  // 而「忘改判定」的表现恰好是 web_search 静默消失——所以判定的覆盖面必须来自注册表。
  it("内置 web_search 的暴露判定与注册表 builtIn 逐档一致", () => {
    const providers = Object.keys(SEARCH_ENGINES) as SearchEngineProvider[];
    expect(providers.length).toBeGreaterThan(0); // 空遍历会读成 PASS，先钉住有东西可测
    for (const id of providers) {
      expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, id), `档位 ${id}`).toBe(SEARCH_ENGINES[id].builtIn);
    }
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "off")).toBe(false);
  });

  it("MiniMax MCP 工具只在 minimax 档暴露", () => {
    for (const id of Object.keys(SEARCH_ENGINES) as SearchEngineProvider[]) {
      expect(shouldExposeSearchTool("minimax-web-search-web_search", id), `档位 ${id}`).toBe(id === "minimax");
    }
  });

  it("新增的免密钥/需密钥档都能把内置工具递给模型", () => {
    // 这三档是本次加的；判定退回旧的 OR 列表时，这里三行全红。
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "bing")).toBe(true);
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "baidu")).toBe(true);
    expect(shouldExposeSearchTool(BUILTIN_SEARCH_TOOL_ID, "deepseek")).toBe(true);
  });
});

describe("filterToolsBySearchBackend", () => {
  const tools = [
    { id: "weather" },
    { id: "web_search" },
    { id: "minimax-web-search-web_search" },
    { id: "music_search" },
  ];

  it("minimax backend: only exposes minimax search + non-search tools", () => {
    const filtered = filterToolsBySearchBackend(tools, "minimax");
    expect(filtered.map((t) => t.id)).toEqual(["weather", "minimax-web-search-web_search", "music_search"]);
  });

  it("bocha backend: only exposes built-in search + non-search tools", () => {
    const filtered = filterToolsBySearchBackend(tools, "bocha");
    expect(filtered.map((t) => t.id)).toEqual(["weather", "web_search", "music_search"]);
  });

  it("tavily backend: only exposes built-in search + non-search tools", () => {
    const filtered = filterToolsBySearchBackend(tools, "tavily");
    expect(filtered.map((t) => t.id)).toEqual(["weather", "web_search", "music_search"]);
  });

  it("off backend: hides all search tools", () => {
    const filtered = filterToolsBySearchBackend(tools, "off");
    expect(filtered.map((t) => t.id)).toEqual(["weather", "music_search"]);
  });

  it("stale minimax tool in registry is hidden when backend is bocha", () => {
    const toolsWithStale = [
      { id: "web_search" },
      { id: "minimax-web-search-web_search" }, // stale, should be hidden
    ];
    const filtered = filterToolsBySearchBackend(toolsWithStale, "bocha");
    expect(filtered.map((t) => t.id)).toEqual(["web_search"]);
  });

  it("empty tools list returns empty", () => {
    expect(filterToolsBySearchBackend([], "bocha")).toEqual([]);
  });
});

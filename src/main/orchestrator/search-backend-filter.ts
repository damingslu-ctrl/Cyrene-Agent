/**
 * 搜索后端工具过滤。
 *
 * 每轮根据当前搜索后端设置，决定暴露哪些搜索工具给模型。
 * 搜索后端互斥：同一时间只暴露一个搜索后端的工具。
 * Key 校验不在这里——那是凭据层的通用判据，住在 `shared/api-key.ts`。
 */
import { usesBuiltinSearchTool, type SearchEngineId } from "../../shared/search-engines";

// ── 搜索工具过滤 ──────────────────────────

export const BUILTIN_SEARCH_TOOL_ID = "web_search";
export const MINIMAX_SEARCH_TOOL_PREFIX = "minimax-web-search-";

/** 搜索后端档位。联合类型本身住在 shared 注册表里，这里只做别名，不再抄第二份。 */
export type SearchBackend = SearchEngineId;

/**
 * 判断一个工具是否应该根据当前搜索后端设置被暴露。
 * 返回 true = 暴露，false = 隐藏。
 */
export function shouldExposeSearchTool(
  toolId: string,
  activeBackend: SearchBackend,
): boolean {
  if (toolId === BUILTIN_SEARCH_TOOL_ID) {
    return usesBuiltinSearchTool(activeBackend);
  }
  if (toolId.startsWith(MINIMAX_SEARCH_TOOL_PREFIX)) {
    return activeBackend === "minimax";
  }
  return true; // 非搜索工具正常暴露
}

/**
 * 从工具列表中过滤出当前搜索后端对应的搜索工具。
 * 非搜索工具不受影响。
 */
export function filterToolsBySearchBackend<T extends { id: string }>(
  tools: T[],
  activeBackend: SearchBackend,
): T[] {
  return tools.filter((tool) => shouldExposeSearchTool(tool.id, activeBackend));
}

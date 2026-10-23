/**
 * 内置浏览器的地址闸门 —— 所有「要让某个 WebContents 去 loadURL」的入口都从这里过。
 *
 * 两条判据：
 * 1. 只放行完整的 http(s) 地址（file/javascript:/data: 一律 unsupported_protocol）；
 * 2. 上游域名（GitHub / Gitee / 官方站及其子域）一律拒绝 —— 与用户点击外链的闸门同一张表，
 *    否则模型只要调用 `browser_open_url` 就能把已切断的更新源重新装回客户端。
 *
 * 只做判定，不做导航；`will-navigate` / `will-redirect` / 弹窗 / 右键菜单都复用它，
 * 保证「地址栏能进的」和「页面里能跳的」是同一条边界。
 */

import { isUpstreamUrl } from "../../shared/upstream-hosts";

export type BrowserNavigationError = "invalid_url" | "unsupported_protocol" | "blocked_upstream_host";

export type BrowserNavigationResult =
  | { ok: true; url: URL }
  | { ok: false; error: BrowserNavigationError };

export function parseBrowserNavigation(input: string): BrowserNavigationResult {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported_protocol" };
  }
  if (isUpstreamUrl(parsed.href)) return { ok: false, error: "blocked_upstream_host" };
  return { ok: true, url: parsed };
}

/** 页内跳转用：目标地址是否属于已切断的上游（解析失败交给协议判据处理，不在这里拦）。 */
export function isBlockedBrowserUrl(raw: string): boolean {
  return isUpstreamUrl(raw);
}

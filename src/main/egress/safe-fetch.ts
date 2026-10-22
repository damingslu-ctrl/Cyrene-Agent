/**
 * 主进程 fetch 的上游闸门（B-1 的补洞）：手动跟重定向，每一跳都过 `isUpstreamUrl`。
 *
 * 直接用 `redirect: "follow"` 时，一个非上游短链可以 302 到 GitHub raw——入口闸门
 * 只看得见第一跳，真正的请求已经发出去了。这里逐跳校验：命中上游立即抛
 * `UpstreamRedirectBlockedError`，且**不会**对上游地址发起请求。
 */
import { isUpstreamUrl } from "../../shared/upstream-hosts";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export class UpstreamRedirectBlockedError extends Error {
  constructor(readonly url: string) {
    super(`重定向到已切断的上游站点：${url}`);
    this.name = "UpstreamRedirectBlockedError";
  }
}

export async function fetchWithoutUpstreamRedirects(
  input: string,
  init: RequestInit = {},
  maxRedirects = MAX_REDIRECTS,
): Promise<Response> {
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUS.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error(`无效的重定向地址：${location}`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error(`不支持的重定向协议：${next.protocol}`);
    }
    if (isUpstreamUrl(next.href)) throw new UpstreamRedirectBlockedError(next.href);
    try {
      await response.body?.cancel();
    } catch {
      // 取消响应体失败不影响下一跳；连接由 undici 回收。
    }
    current = next.href;
  }
  throw new Error(`重定向次数超过 ${maxRedirects} 次`);
}

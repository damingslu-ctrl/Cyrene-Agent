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

/** 重定向响应不读正文；不取消的话 undici 会攥着连接直到 GC。 */
async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 取消失败不影响判定，连接由 undici 回收。
  }
}

/**
 * 303 与 301/302 上的 POST 会改成 GET（浏览器语义）；307/308 保留原方法。
 * 本仓库目前两处调用都是 GET，但 helper 是通用出口，不把语义写在调用方心里。
 */
function redirectInit(status: number, init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const becomesGet = status === 303 || ((status === 301 || status === 302) && method === "POST");
  if (!becomesGet) return init;
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  return { ...init, method: "GET", body: undefined, headers };
}

export async function fetchWithoutUpstreamRedirects(
  input: string,
  init: RequestInit = {},
  maxRedirects = MAX_REDIRECTS,
): Promise<Response> {
  // 入口本身就是上游：一个字节都不发（调用方通常已拦过一次，这里是兜底）。
  if (isUpstreamUrl(input)) throw new UpstreamRedirectBlockedError(input);

  let current = input;
  let currentInit = init;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(current, { ...currentInit, redirect: "manual" });
    if (!REDIRECT_STATUS.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) {
      await cancelBody(response);
      return response;
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      await cancelBody(response);
      throw new Error(`无效的重定向地址：${location}`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      await cancelBody(response);
      throw new Error(`不支持的重定向协议：${next.protocol}`);
    }
    if (isUpstreamUrl(next.href)) {
      await cancelBody(response);
      throw new UpstreamRedirectBlockedError(next.href);
    }
    await cancelBody(response);
    currentInit = redirectInit(response.status, currentInit);
    current = next.href;
  }
  throw new Error(`重定向次数超过 ${maxRedirects} 次`);
}

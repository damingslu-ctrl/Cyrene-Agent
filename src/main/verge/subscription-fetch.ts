/**
 * 订阅下载：只管"把一份订阅正文安全地拿回来"，落盘与账本在 profile-service。
 *
 * 四条闸都是照 Clash Verge 的行为抄的，缺一条就会把用户带进坑里：
 * - UA 用 Verge 那一份（`clash-verge/v2.4.2`）：不少机场认 UA，空 UA 直接吐登录页 HTML；
 * - 重定向自己管、最多 5 跳：跟到底可能被引到 `file://`，那是读用户磁盘；
 * - 16MB 上限在**流式读**的路上判：content-length 能提前拦，撒谎的服务器就靠边读边算；
 * - 20s 超时用 AbortSignal，不靠"等它自己回来"。
 *
 * 拿到正文还要验一次：必须是一份能 parse 的 map，且含 `proxies` 或 `proxy-providers`——
 * 否则一份 HTML/端口配置也会被当成"订阅"写进 profiles 目录，切过去内核当场起不来。
 */
import { parse as parseYaml } from "yaml";

export const SUB_USER_AGENT = "clash-verge/v2.4.2";
export const SUB_TIMEOUT_MS = 20_000;
export const SUB_MAX_BYTES = 16 * 1024 * 1024;
export const SUB_MAX_REDIRECTS = 5;

export interface HeadersLike {
  get(name: string): string | null;
}

export interface ReaderLike {
  read(): Promise<{ done?: boolean; value?: Uint8Array | string }>;
  cancel?: (reason?: unknown) => Promise<void> | void;
  releaseLock?: () => void;
}

/** 够用的最小 Response：真 fetch 的返回结构与它兼容，测试可以直接塞一个 Map 当 headers。 */
export interface ResponseLike {
  ok: boolean;
  status: number;
  headers: HeadersLike;
  text(): Promise<string>;
  body?: { getReader(): ReaderLike } | null;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;

export interface SubscriptionFetchDeps {
  fetch: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type SubscriptionFailReason =
  | "bad-url"
  | "too-many-redirects"
  | "bad-redirect"
  | "http-status"
  | "too-large"
  | "bad-yaml"
  | "no-proxies"
  | "timeout"
  | "network";

export type SubscriptionFetchResult =
  | { ok: true; text: string; doc: Record<string, unknown>; proxyCount: number; hops: number }
  | { ok: false; reason: SubscriptionFailReason; status?: number };

function httpError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 被我们自己的定时器掐掉算超时，别混进"网络不通"。 */
function isAbort(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return /abort|timed out|timeout/i.test(httpError(error));
}

/**
 * 正文 → 可切换的配置。`<!doctype html>` 那种登录页在 YAML 里是**纯量**，parse 不报错，
 * 所以这里要求一定是一张 map，再看有没有节点来源。
 */
export function parseSubscriptionBody(text: string): { doc: Record<string, unknown> } | { reason: SubscriptionFailReason } {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return { reason: "bad-yaml" };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { reason: "bad-yaml" };
  const record = doc as Record<string, unknown>;
  const hasProxies = Array.isArray(record.proxies) && record.proxies.length > 0;
  const providers = record["proxy-providers"];
  const hasProviders = (Array.isArray(providers) && providers.length > 0)
    || (typeof providers === "object" && providers !== null && !Array.isArray(providers)
      && Object.keys(providers).length > 0);
  if (!hasProxies && !hasProviders) return { reason: "no-proxies" };
  return { doc: record };
}

async function readBounded(res: ResponseLike, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const buf = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    total += buf.length;
    if (total > maxBytes) {
      // 先取消再收手：连接留着会继续吃用户的下行带宽。
      // cancel 在假 Response 上可能同步返回，所以用 try/await 而不是 .catch()。
      try {
        await reader.cancel?.();
      } catch {
        // 取消失败也要走：超预算的正文已经不可能被安全用上了。
      }
      reader.releaseLock?.();
      return null;
    }
    chunks.push(buf);
  }
  reader.releaseLock?.();
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchSubscription(
  url: string,
  deps: SubscriptionFetchDeps,
): Promise<SubscriptionFetchResult> {
  const maxBytes = deps.maxBytes ?? SUB_MAX_BYTES;
  const maxRedirects = deps.maxRedirects ?? SUB_MAX_REDIRECTS;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, reason: "bad-url" };
  }
  if (current.protocol !== "http:" && current.protocol !== "https:") return { ok: false, reason: "bad-url" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SUB_TIMEOUT_MS);
  let text: string | null = null;
  // 数的是"跟了几次跳转"，不是"发了几次请求"：首请求不算跳，跟到 5 跳还不落地就判死。
  let redirects = 0;
  let requests = 0;
  try {
    for (;;) {
      let res: ResponseLike;
      requests += 1;
      try {
        res = await deps.fetch(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": SUB_USER_AGENT, accept: "*/*" },
        });
      } catch (error) {
        if (isAbort(error)) return { ok: false, reason: "timeout" };
        return { ok: false, reason: "network" };
      }
      if (res.status >= 300 && res.status < 400) {
        if (redirects >= maxRedirects) return { ok: false, reason: "too-many-redirects", status: res.status };
        const location = res.headers.get("location");
        if (!location) return { ok: false, reason: "bad-redirect" };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, reason: "bad-redirect" };
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") return { ok: false, reason: "bad-redirect" };
        current = next;
        redirects += 1;
        continue;
      }
      if (!res.ok) return { ok: false, reason: "http-status", status: res.status };
      text = await readBounded(res, maxBytes);
      break;
    }
  } finally {
    clearTimeout(timer);
  }
  if (text === null) return { ok: false, reason: "too-large" };

  const parsed = parseSubscriptionBody(text);
  if ("reason" in parsed) return { ok: false, reason: parsed.reason };
  const proxies = parsed.doc.proxies;
  return {
    ok: true,
    text,
    doc: parsed.doc,
    proxyCount: Array.isArray(proxies) ? proxies.length : 0,
    hops: requests,
  };
}

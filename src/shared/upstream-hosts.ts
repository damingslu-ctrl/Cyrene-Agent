/**
 * 上游域名黑名单。与 `src/main/egress/upstream-off.test.ts` 的静态锁同源：
 * 静态锁管「代码里不出现这些字符串」，这张表管「运行时用户点到也拦得住」。
 * 两条判据都不放行 `playaagentcyrene.online` —— 那是上游官网，不是用户的。
 */
export const UPSTREAM_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "gitee.com",
  "playaagentcyrene.online",
] as const;

/** 命中上游仓库/官网的精确前缀；github.com 只拦上游仓与用户明确要断的 release/raw 路径。 */
export const UPSTREAM_URL_PREFIXES = [
  "https://github.com/Playa-Cyrene/",
  "https://github.com/Playa-0v0/",
  "https://raw.githubusercontent.com/Playa-0v0/",
  "https://gitee.com/playa0/",
  "https://playaagentcyrene.online",
] as const;

export function isUpstreamUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (UPSTREAM_URL_PREFIXES.some((prefix) => raw.startsWith(prefix))) return true;
  return (UPSTREAM_HOSTS as readonly string[]).includes(url.hostname);
}

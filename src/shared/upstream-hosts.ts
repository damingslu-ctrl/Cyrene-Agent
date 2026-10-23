/**
 * 上游域名黑名单。与 `src/main/egress/upstream-off.test.ts` 的静态锁同源：
 * 静态锁管「代码里不出现这些字符串」，这张表管「运行时用户点到也拦得住」。
 * 两条判据都不放行 `playaagentcyrene.online` —— 那是上游官网，不是用户的。
 *
 * 命中的是**整域 + 它的所有子域**：`github.com` 同时挡住 `www.github.com`、
 * `gist.github.com`。只比 `===` 会漏掉这些别名；而直接 `endsWith("github.com")`
 * 又会误伤 `notgithub.com`，所以子域判据必须带上点号。
 */
export const UPSTREAM_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "gitee.com",
  "playaagentcyrene.online",
] as const;

/** 主机名是否命中上游域名（整域或子域；大小写不敏感）。 */
export function isUpstreamHost(hostname: string): boolean {
  // 绝对域名可以带尾点（`github.com.` 与 `github.com` 在 DNS 上等价），
  // URL 解析不会替我们去掉；不归一化的话 `https://github.com./x` 会整条绕过闸门。
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return (UPSTREAM_HOSTS as readonly string[]).some(
    (banned) => host === banned || host.endsWith(`.${banned}`),
  );
}

export function isUpstreamUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return isUpstreamHost(url.hostname);
}

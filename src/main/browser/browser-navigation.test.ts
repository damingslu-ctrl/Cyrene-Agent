import { describe, expect, it } from "vitest";
import { UPSTREAM_HOSTS } from "../../shared/upstream-hosts";
import { isBlockedBrowserUrl, parseBrowserNavigation } from "./browser-navigation";

/** 官方站域名从黑名单表派生：A4 静态锁不允许源码里出现该字面量（表本身有豁免）。 */
const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

describe("parseBrowserNavigation", () => {
  it("放行普通 http(s) 站点（含 localhost 与端口）", () => {
    for (const input of ["https://example.com/a?b=1", "http://localhost:3000/", "https://例子.中国/"]) {
      const result = parseBrowserNavigation(input);
      expect(result.ok, input).toBe(true);
      if (result.ok) expect(result.url.href).toBe(new URL(input.trim()).href);
    }
  });

  it("上游域名整域与子域全部拒绝", () => {
    const blocked = [
      "https://github.com/foo/bar",
      "https://www.github.com/",
      "https://api.github.com/repos/a/b",
      "https://gist.github.com/x/1",
      "https://raw.githubusercontent.com/a/b/main/c",
      "https://gitee.com/someone/repo",
      `https://${OFFICIAL_HOST}/`,
      "HTTPS://GITHUB.COM/x",
    ];
    for (const input of blocked) {
      expect(parseBrowserNavigation(input), input).toEqual({ ok: false, error: "blocked_upstream_host" });
    }
  });

  it("只是长得像上游的域名不受误伤", () => {
    for (const input of ["https://evilgithub.com/", "https://github.com.evil.example/", "https://notgitee.com/"]) {
      expect(parseBrowserNavigation(input).ok, input).toBe(true);
    }
  });

  it("非 http(s) 协议与根本不成立的地址分开报", () => {
    expect(parseBrowserNavigation("file:///etc/passwd")).toEqual({ ok: false, error: "unsupported_protocol" });
    expect(parseBrowserNavigation("javascript:alert(1)")).toEqual({ ok: false, error: "unsupported_protocol" });
    expect(parseBrowserNavigation("cyrene-exam://paper/x")).toEqual({ ok: false, error: "unsupported_protocol" });
    expect(parseBrowserNavigation("github.com/foo/bar")).toEqual({ ok: false, error: "invalid_url" });
    expect(parseBrowserNavigation("   ")).toEqual({ ok: false, error: "invalid_url" });
  });
});

describe("isBlockedBrowserUrl", () => {
  it("页内跳转边界与地址栏一致", () => {
    expect(isBlockedBrowserUrl("https://api.github.com/repos/a/b")).toBe(true);
    expect(isBlockedBrowserUrl("https://gitee.com/a/b")).toBe(true);
    expect(isBlockedBrowserUrl("https://example.com/")).toBe(false);
    expect(isBlockedBrowserUrl("not a url")).toBe(false);
  });
});

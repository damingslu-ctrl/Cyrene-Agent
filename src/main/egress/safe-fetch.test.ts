import { afterEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_HOSTS } from "../../shared/upstream-hosts";
import { UpstreamRedirectBlockedError, fetchWithoutUpstreamRedirects } from "./safe-fetch";

const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("重定向逐跳过上游闸门", () => {
  it("普通 200 原样返回，且用 manual 模式（follow 会把闸门甩在第一跳之后）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const resp = await fetchWithoutUpstreamRedirects("https://example.com/a");
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/a",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it.each([
    "https://github.com/foo/bar",
    "https://api.github.com/repos/foo/bar",
    "https://raw.githubusercontent.com/foo/bar/main/x",
    "https://gitee.com/foo/bar",
    `https://${OFFICIAL_HOST}/`,
    "https://GITHUB.com/foo/bar",
  ])("302 到上游 %s：抛 UpstreamRedirectBlockedError，且不对该地址发请求", async (target) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect(302, target))
      .mockResolvedValueOnce(new Response("should not happen", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithoutUpstreamRedirects("https://short.example/x")).rejects.toBeInstanceOf(
      UpstreamRedirectBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("非上游链式重定向照常跟（正对照：不是把所有 302 都拦掉）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect(302, "/step-2"))
      .mockResolvedValueOnce(redirect(307, "https://cdn.example/final"))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const resp = await fetchWithoutUpstreamRedirects("https://example.com/start");
    expect(await resp.text()).toBe("done");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/start",
      "https://example.com/step-2",
      "https://cdn.example/final",
    ]);
  });

  it("重定向到非 http(s) 协议直接拒绝", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(redirect(302, "ftp://example.com/x")));
    await expect(fetchWithoutUpstreamRedirects("https://example.com/a")).rejects.toThrow(/协议/);
  });

  it("超过跳数上限就停，不许无限跟", async () => {
    const fetchMock = vi.fn().mockResolvedValue(redirect(302, "https://example.com/loop"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithoutUpstreamRedirects("https://example.com/a", {}, 2)).rejects.toThrow(
      /重定向次数超过 2/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

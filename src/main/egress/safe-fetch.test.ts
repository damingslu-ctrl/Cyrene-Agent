import { afterEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_HOSTS } from "../../shared/upstream-hosts";
import { UpstreamRedirectBlockedError, fetchWithoutUpstreamRedirects } from "./safe-fetch";

const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

/** 带可观测 body.cancel 的重定向响应（原生 Response(null) 没有 body）。 */
function redirectWithBody(status: number, location: string | null): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const headers = new Headers();
  if (location) headers.set("location", location);
  return { response: { status, headers, body: { cancel } } as unknown as Response, cancel };
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
    "https://github.com./foo/bar",
    "https://raw.githubusercontent.com./foo/bar",
    `https://${OFFICIAL_HOST}./`,
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

  it("重定向到非 http(s) 协议直接拒绝，并取消该跳响应体", async () => {
    const { response, cancel } = redirectWithBody(302, "ftp://example.com/x");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
    await expect(fetchWithoutUpstreamRedirects("https://example.com/a")).rejects.toThrow(/协议/);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("入口本身就是上游：一个请求都不发", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithoutUpstreamRedirects("https://github.com./x")).rejects.toBeInstanceOf(
      UpstreamRedirectBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("命中上游时先取消这一跳的响应体再抛", async () => {
    const { response, cancel } = redirectWithBody(302, "https://gitee.com./x");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
    await expect(fetchWithoutUpstreamRedirects("https://short.example/x")).rejects.toBeInstanceOf(
      UpstreamRedirectBlockedError,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("3xx 没有 Location：取消响应体后原样返回，交给调用方按非 ok 处理", async () => {
    const { response, cancel } = redirectWithBody(302, null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
    const resp = await fetchWithoutUpstreamRedirects("https://example.com/a");
    expect(resp.status).toBe(302);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303])("%i + POST：下一跳改成 GET、丢掉 body 与实体头", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect(status, "/next"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithoutUpstreamRedirects("https://example.com/post", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain", "content-length": "7", "x-keep": "1" },
    });
    const next = fetchMock.mock.calls[1][1] as RequestInit;
    expect(next.method).toBe("GET");
    expect(next.body).toBeUndefined();
    const headers = new Headers(next.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("x-keep")).toBe("1");
  });

  it.each([307, 308])("%i + POST：保留原方法与 body", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect(status, "/next"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithoutUpstreamRedirects("https://example.com/post", {
      method: "POST",
      body: "payload",
    });
    const next = fetchMock.mock.calls[1][1] as RequestInit;
    expect(next.method).toBe("POST");
    expect(next.body).toBe("payload");
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

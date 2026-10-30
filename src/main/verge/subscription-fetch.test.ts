import { describe, expect, it } from "vitest";
import {
  fetchSubscription,
  SUB_MAX_BYTES,
  SUB_MAX_REDIRECTS,
  SUB_TIMEOUT_MS,
  SUB_USER_AGENT,
  type ResponseLike,
  type SubscriptionFetchDeps,
} from "./subscription-fetch";

const GOOD = `proxies:
- name: 节点A
  type: ss
  server: 1.2.3.4
proxy-groups:
- name: 🚀 节点选择
  type: select
  proxies:
  - 节点A
`;

function yamlResponse(text: string, init: Partial<ResponseLike> = {}): ResponseLike {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: init.headers ?? new Map([["content-type", "text/yaml"]]),
    text: async () => text,
    ...init,
  } as ResponseLike;
}

/** 只给 text()：正文按整体读，尺寸闸门走字节计数那条路。 */
function fakeFetch(responses: ResponseLike[], calls: Array<{ url: string; init: RequestInit }> = []) {
  let i = 0;
  const fetch: SubscriptionFetchDeps["fetch"] = async (url, init) => {
    calls.push({ url, init });
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return next as unknown as ResponseLike;
  };
  return { fetch, calls, urls: () => calls.map((c) => c.url) };
}

describe("subscription-fetch 基础闸门", () => {
  it("UA 用 Verge 那一份、重定向自己管、带超时信号", async () => {
    const f = fakeFetch([yamlResponse(GOOD)]);
    const res = await fetchSubscription("https://example.test/sub", { fetch: f.fetch });
    expect(res.ok).toBe(true);
    const init = f.calls[0].init;
    expect(new Headers(init.headers as HeadersInit).get("user-agent")).toBe(SUB_USER_AGENT);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeDefined();
  });

  it("常量与 spec 对齐：16MB / 20s / 5 跳", () => {
    expect(SUB_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(SUB_TIMEOUT_MS).toBe(20_000);
    expect(SUB_MAX_REDIRECTS).toBe(5);
  });

  it("非 http(s) 的地址不开口：file:// 能读用户磁盘，https 以外的 scheme 一律拒", async () => {
    const f = fakeFetch([yamlResponse(GOOD)]);
    for (const url of ["file:///C:/Windows/win.ini", "javascript:alert(1)", ""]) {
      const res = await fetchSubscription(url, { fetch: f.fetch });
      expect(res.ok, url).toBe(false);
      expect((res as { reason: string }).reason).toBe("bad-url");
    }
    expect(f.calls).toHaveLength(0);
  });

  it("解析出的正文必须含 proxies 或 proxy-providers，否则不当订阅收", async () => {
    const bare = await fetchSubscription("https://example.test/x", {
      fetch: fakeFetch([yamlResponse("port: 7890\n")]).fetch,
    });
    expect(bare.ok).toBe(false);
    expect((bare as { reason: string }).reason).toBe("no-proxies");

    const providers = await fetchSubscription("https://example.test/x", {
      fetch: fakeFetch([yamlResponse("proxy-providers:\n  p1:\n    url: https://example.test/p1\n")]).fetch,
    });
    expect(providers.ok).toBe(true);

    const broken = await fetchSubscription("https://example.test/x", {
      fetch: fakeFetch([yamlResponse("proxies: [unclosed")]).fetch,
    });
    expect(broken.ok).toBe(false);
    expect((broken as { reason: string }).reason).toBe("bad-yaml");

    const html = await fetchSubscription("https://example.test/x", {
      fetch: fakeFetch([yamlResponse("<!doctype html>\n<html>登录页</html>")]).fetch,
    });
    expect(html.ok).toBe(false);
    expect(["bad-yaml", "no-proxies"]).toContain((html as { reason: string }).reason);
  });

  it("HTML 登录页不许被当成 YAML 里的一个标量收下来：只认对象账本", async () => {
    // `<!doctype html>` 起首的行在 YAML 里是纯量，parse 不报错；
    // 上一轮的"登录页"因此可能被当成订阅正文写进盘里。账本必须是 map。
    const res = await fetchSubscription("https://example.test/x", {
      fetch: fakeFetch([yamlResponse("<html>登录页</html>")]).fetch,
    });
    expect(res.ok).toBe(false);
  });
});

describe("subscription-fetch 重定向", () => {
  it("302 跟到 Location，最多 " + SUB_MAX_REDIRECTS + " 跳；相对地址按上一跳解析", async () => {
    const redirect = (to: string): ResponseLike => ({
      ok: false,
      status: 302,
      headers: new Map([["location", to]]),
      text: async () => "",
    });
    const f = fakeFetch([redirect("/sub2"), redirect("https://cdn.example.test/sub3"), yamlResponse(GOOD)]);
    const res = await fetchSubscription("https://api.example.test/sub", { fetch: f.fetch });
    expect(res.ok).toBe(true);
    expect(f.urls()).toEqual([
      "https://api.example.test/sub",
      "https://api.example.test/sub2",
      "https://cdn.example.test/sub3",
    ]);
  });

  it("跳转次数超过上限就断，不当成「内核慢」处理", async () => {
    const loop = (n: number) => Array.from({ length: n }, (_, i) => ({
      ok: false,
      status: 307,
      headers: new Map([["location", `https://example.test/hop${i}`]]),
      text: async () => "",
    }) as ResponseLike);
    const f = fakeFetch(loop(SUB_MAX_REDIRECTS + 2));
    const res = await fetchSubscription("https://example.test/sub", { fetch: f.fetch });
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("too-many-redirects");
    // 数的是"跟了几跳"：首请求不算跳，所以跟满 5 跳后是 6 次请求，第 6 次仍是跳转就判死。
    expect(f.calls).toHaveLength(SUB_MAX_REDIRECTS + 1);
  });

  it("3xx 没带 Location 直接判死，不拿空地址再跑一趟", async () => {
    const f = fakeFetch([{ ok: false, status: 301, headers: new Map(), text: async () => "" } as unknown as ResponseLike]);
    const res = await fetchSubscription("https://example.test/sub", { fetch: f.fetch });
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("bad-redirect");
  });

  it("跳到非 http(s) 的 Location 不跟（防止订阅源把请求引到 file://）", async () => {
    const f = fakeFetch([
      { ok: false, status: 302, headers: new Map([["location", "file:///C:/x.yaml"]]), text: async () => "" } as unknown as ResponseLike,
      yamlResponse(GOOD),
    ]);
    const res = await fetchSubscription("https://example.test/sub", { fetch: f.fetch });
    expect(res.ok).toBe(false);
    expect(f.calls).toHaveLength(1);
  });
});

describe("subscription-fetch 失败与上限", () => {
  it("4xx/5xx 报状态码，不静悄悄回一份旧正文", async () => {
    for (const status of [401, 404, 500]) {
      const res = await fetchSubscription("https://example.test/sub", {
        fetch: fakeFetch([{ ok: false, status, headers: new Map(), text: async () => "nope" } as unknown as ResponseLike]).fetch,
      });
      expect(res.ok, String(status)).toBe(false);
      expect((res as { status?: number }).status).toBe(status);
      expect((res as { reason: string }).reason).toBe("http-status");
    }
  });

  it("超过 16MB 的响应在流式读的时候就断，不把整包搬进内存", async () => {
    const chunk = Buffer.alloc(1024 * 1024, "a");
    let reads = 0;
    const body = {
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads > SUB_MAX_BYTES / chunk.length + 4) return { done: true, value: undefined };
          return { done: false, value: chunk };
        },
        cancel: async () => {},
        releaseLock: () => {},
      }),
    };
    const res = await fetchSubscription("https://example.test/big", {
      fetch: fakeFetch([{ ok: true, status: 200, headers: new Map(), text: async () => "unused", body }] as unknown as ResponseLike).fetch,
    });
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("too-large");
    // 只多读一点点就收手：读了 20MB 才判死等于把闸门当摆设。
    expect(reads).toBeLessThanOrEqual(SUB_MAX_BYTES / chunk.length + 2);
  });

  it("content-length 已经写明超大就别再收 body", async () => {
    let textCalled = false;
    const res = await fetchSubscription("https://example.test/big", {
      fetch: fakeFetch([{
        ok: true,
        status: 200,
        headers: new Map([["content-length", String(SUB_MAX_BYTES + 1)]]),
        text: async () => { textCalled = true; return GOOD; },
      } as unknown as ResponseLike]).fetch,
    });
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("too-large");
    expect(textCalled).toBe(false);
  });

  it("超时用 AbortController 说话：信号在 fetch 前就挂上，到点 aborted", async () => {
    let aborted = false;
    const res = await fetchSubscription("https://example.test/slow", {
      timeoutMs: 5,
      fetch: (url, init) => new Promise((_resolve, reject) => {
        void url;
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("This operation was aborted"));
        });
      }),
    });
    expect(aborted).toBe(true);
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("timeout");
  });

  it("网络本身炸了（DNS/连接被重置）报 network，不当成坏订阅", async () => {
    const res = await fetchSubscription("https://example.test/sub", {
      fetch: async () => { throw new Error("getaddrinfo ENOTFOUND example.test"); },
    });
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("network");
  });

  it("拿回来的节点名要在结果里：UI 要说「收到了 N 个节点」", async () => {
    const res = await fetchSubscription("https://example.test/sub", { fetch: fakeFetch([yamlResponse(GOOD)]).fetch });
    expect(res.ok).toBe(true);
    expect((res as { proxyCount: number }).proxyCount).toBe(1);
  });
});

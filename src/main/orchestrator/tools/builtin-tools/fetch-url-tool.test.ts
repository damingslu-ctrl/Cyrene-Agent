// fetch_url 工具行为测试：正文提取 + 上游域名闸门。
// 全部用 stub 的 fetch 桩，不发真实网络请求。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_HOSTS } from "../../../../shared/upstream-hosts";
import { clearFetchUrlCache, fetchUrlTool } from "./fetch-url-tool";

/** 官方站域名从黑名单表派生：A4 静态锁不允许源码里出现该字面量（表本身有豁免）。 */
const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

/** 构造 fetch Response 形状的桩（工具只用到 ok/status/statusText/headers/arrayBuffer/json） */
function makeResp(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  body?: string;
  json?: unknown;
}): Response {
  const body = opts.body ?? "";
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? opts.contentType ?? "" : null),
    },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    json: async () => (opts.json !== undefined ? opts.json : JSON.parse(body)),
  } as unknown as Response;
}

/** 构造 3xx + Location 的桩（逐跳闸门只用到 status / headers / body.cancel）。 */
function makeRedirect(location: string): Response {
  return {
    ok: false,
    status: 302,
    statusText: "Found",
    headers: {
      get: (name: string) => (name.toLowerCase() === "location" ? location : null),
    },
    body: { cancel: async () => undefined },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 每个用例清空抓取缓存：多个用例复用同一 URL 但期望不同的桩响应
beforeEach(() => {
  clearFetchUrlCache();
});

describe("上游域名闸门", () => {
  it.each([
    "https://github.com/foo/bar",
    "https://www.github.com/foo/bar",
    "https://api.github.com/repos/foo/bar",
    "https://gist.github.com/foo/bar",
    "https://raw.githubusercontent.com/foo/bar/main/README.md",
    "https://gitee.com/foo/bar",
    `https://${OFFICIAL_HOST}/`,
  ])("%s 被拒绝且一次网络请求都不发", async (url) => {
    const fetchMock = vi.fn(async () => makeResp({ contentType: "text/plain", body: "不应被取到" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUrlTool.execute({ url });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("上游");
    expect(out).not.toContain("不应被取到");
  });

  it("format=raw 也过同一道闸门", async () => {
    const fetchMock = vi.fn(async () => makeResp({ contentType: "text/html", body: "raw" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUrlTool.execute({ url: "https://github.com/foo/bar", format: "raw" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("上游");
  });

  it("正对照：长得像上游但不是子域的站点仍可抓取", async () => {
    const fetchMock = vi.fn(async () => makeResp({ contentType: "text/plain", body: "正常站点正文" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUrlTool.execute({ url: "https://evilgithub.com/page" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toContain("正常站点正文");
  });

  it("非上游短链 302 到上游：只请求短链一次，不跟到上游", async () => {
    const fetchMock = vi.fn(async () => makeRedirect("https://github.com/foo/bar"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUrlTool.execute({ url: "https://short.example/x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toContain("跳转到了已切断的上游站点");
    expect(out).not.toContain("HTTP 302");
  });

  it("正对照：非上游重定向照常跟到最终页面", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeRedirect("https://example.com/final"))
      .mockResolvedValueOnce(makeResp({ contentType: "text/plain", body: "重定向后的正文" }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchUrlTool.execute({ url: "https://short.example/x" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toContain("重定向后的正文");
  });
});

describe("普通网页正文提取", () => {
  /** 足够长的正文段落（超过最小文字量阈值，避免被判成空壳容器） */
  const longText = "这是一段足够长的正文内容，用来通过正文区域的最小文字量校验。".repeat(8);

  it("剥掉导航/页头/页脚/侧栏，保留 article 正文", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResp({
      contentType: "text/html",
      body: `<html><body>
        <header>站点标题 登录 注册</header>
        <nav>首页 文档 社区</nav>
        <article><h1>正文标题</h1><p>${longText}</p></article>
        <aside>相关推荐 广告</aside>
        <footer>版权所有 备案号</footer>
      </body></html>`,
    })));

    const out = await fetchUrlTool.execute({ url: "https://example.com/post" });

    expect(out).toContain("正文标题");
    expect(out).toContain(longText.slice(0, 20));
    expect(out).not.toContain("登录");
    expect(out).not.toContain("首页");
    expect(out).not.toContain("相关推荐");
    expect(out).not.toContain("版权所有");
  });

  it("article 是空壳时改用 main", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResp({
      contentType: "text/html",
      body: `<html><body>
        <article>小挂件</article>
        <main><h1>主区域标题</h1><p>${longText}</p></main>
      </body></html>`,
    })));

    const out = await fetchUrlTool.execute({ url: "https://example.com/docs" });

    expect(out).toContain("主区域标题");
    expect(out).toContain(longText.slice(0, 20));
    expect(out).not.toContain("小挂件");
  });

  it("没有 article/main 时回退整页（骨架区块仍被剥掉）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResp({
      contentType: "text/html",
      body: `<html><body>
        <nav>导航链接</nav>
        <div><h1>div 里的正文</h1><p>${longText}</p></div>
      </body></html>`,
    })));

    const out = await fetchUrlTool.execute({ url: "https://example.com/page" });

    expect(out).toContain("div 里的正文");
    expect(out).not.toContain("导航链接");
  });

  it("纯文本内容原样返回，不做 HTML 清洗", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResp({
      contentType: "text/plain",
      body: "plain text body",
    })));

    const out = await fetchUrlTool.execute({ url: "https://example.com/a.txt" });
    expect(out).toContain("plain text body");
  });
});

describe("fetch_url 结果缓存", () => {
  it("同一 URL 两次只抓一次，第二次带 [缓存] 标注直接复用", async () => {
    const fetchMock = vi.fn(async () => makeResp({
      contentType: "text/plain",
      body: "cached page body",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchUrlTool.execute({ url: "https://cache-test.example.com/page" });
    expect(first).toContain("cached page body");
    expect(first.startsWith("[缓存]")).toBe(false);

    const second = await fetchUrlTool.execute({ url: "https://cache-test.example.com/page" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.startsWith("[缓存]")).toBe(true);
    expect(second).toContain("cached page body");
  });

  it("同 URL 不同 format 分开缓存", async () => {
    const fetchMock = vi.fn(async () => makeResp({
      contentType: "text/plain",
      body: "raw or md body",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchUrlTool.execute({ url: "https://cache-test.example.com/dual" });
    await fetchUrlTool.execute({ url: "https://cache-test.example.com/dual", format: "raw" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("抓取失败的 [错误] 结果不进缓存", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (fail) return makeResp({ ok: false, status: 500, statusText: "Server Error" });
      return makeResp({ contentType: "text/plain", body: "recovered body" });
    }));

    const first = await fetchUrlTool.execute({ url: "https://cache-test.example.com/flaky" });
    expect(first.startsWith("[错误]")).toBe(true);

    fail = false;
    const second = await fetchUrlTool.execute({ url: "https://cache-test.example.com/flaky" });
    expect(second).toContain("recovered body");
    expect(second.startsWith("[缓存]")).toBe(false);
  });
});

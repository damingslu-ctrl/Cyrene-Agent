import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMihomoClient,
  parseConnections,
  parseProxies,
  parseTrafficFrame,
} from "./mihomo-client";

type Call = { url: string; init: RequestInit };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(handler: (url: string, init: RequestInit) => Promise<Response>, secret = "s3cret") {
  const calls: Call[] = [];
  const client = createMihomoClient({
    baseUrl: "http://127.0.0.1:9097/",
    secret,
    timeoutMs: 30,
    fetchImpl: ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch,
  });
  return { client, calls };
}

function failedWith(reason: string): MihomoRequestError {
  return new MihomoRequestError(reason as MihomoRequestError["reason"], reason);
}

afterEach(() => vi.useRealTimers());

describe("请求层", () => {
  it("带 Bearer 与 Accept，baseUrl 尾斜杠被吃掉", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({ version: "alpha-e4dd968" }));
    expect(await client.version()).toBe("alpha-e4dd968");
    expect(calls[0].url).toBe("http://127.0.0.1:9097/version");
    expect(calls[0].init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer s3cret",
    });
  });

  it("没有 secret 时不发 Authorization（别把空密钥写进头）", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({ version: "v" }), "");
    await client.version();
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("401/403 → unauthorized；其它非 2xx → bad-response", async () => {
    await expect(makeClient(async () => jsonResponse({}, 401)).client.version())
      .rejects.toMatchObject({ reason: "unauthorized", status: 401 });
    await expect(makeClient(async () => jsonResponse({}, 403)).client.version())
      .rejects.toMatchObject({ reason: "unauthorized", status: 403 });
    await expect(makeClient(async () => jsonResponse({}, 500)).client.version())
      .rejects.toMatchObject({ reason: "bad-response", status: 500 });
  });

  it("AbortError → timeout；断网类异常 → unreachable", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(makeClient(async () => { throw abort; }).client.version())
      .rejects.toMatchObject({ reason: "timeout" });
    await expect(makeClient(async () => { throw new Error("ECONNREFUSED"); }).client.version())
      .rejects.toMatchObject({ reason: "unreachable" });
  });

  it("version/mode 的坏负载不猜值", async () => {
    expect(await makeClient(async () => jsonResponse({ version: 1 })).client.version()).toBeNull();
    expect(await makeClient(async () => jsonResponse({ mode: "Rule" })).client.mode()).toBeNull();
    expect(await makeClient(async () => jsonResponse({ mode: "rule" })).client.mode()).toBe("rule");
  });

  it("写模式/切节点带 JSON 体，组名与节点名原样（组名要 URL 编码）", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({}));
    await client.setMode("global");
    await client.selectNode("Selector A", "香港 01");
    expect(calls[0].url).toBe("http://127.0.0.1:9097/configs");
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.body).toBe(JSON.stringify({ mode: "global" }));
    expect(calls[1].url).toBe("http://127.0.0.1:9097/proxies/Selector%20A");
    expect(calls[1].init.method).toBe("PUT");
    expect(calls[1].init.body).toBe(JSON.stringify({ name: "香港 01" }));
    expect(calls[1].init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("组测速：超时/探测地址进查询串，只留正数并取整", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({ a: 120.4, b: 0, c: -1, d: "88", e: null }));
    expect(await client.groupDelay("Selector A", 7000)).toEqual({ a: 120 });
    expect(calls[0].url).toBe(
      "http://127.0.0.1:9097/group/Selector%20A/delay?timeout=7000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204",
    );
  });
});

describe("节点树解析", () => {
  const proxies = {
    proxies: {
      GLOBAL: { type: "Selector", all: ["Selector A", "DIRECT"], now: "Selector A" },
      "Selector A": {
        type: "Selector",
        all: ["node1", "node2", "url-group", "DIRECT", "REJECT", "missing"],
        now: "node1",
      },
      "url-group": { type: "URLTest", all: ["node1", "node2", "node3"], now: "node2" },
      "load-balance": { type: "LoadBalance", all: ["node1"] },
      node1: { type: "Shadowsocks", history: [{ delay: 0 }, { delay: 120.4 }, { delay: 80 }], alive: true },
      node2: {
        type: "Trojan",
        history: [
          { delay: 10 }, { delay: 11 }, { delay: 12 }, { delay: 13 }, { delay: 14 },
          { delay: 15 }, { delay: 16 }, { delay: 17 }, { delay: 18 }, { delay: 19 },
          { delay: 20 }, { delay: 21 },
        ],
        alive: false,
      },
      node3: { type: "Hysteria2", history: [{ delay: 0 }], alive: true },
      DIRECT: { type: "Direct" },
      REJECT: { type: "Reject" },
    },
  };

  it("只留可切换的组与真节点：GLOBAL/子组/伪节点/负载均衡组都不进列表", () => {
    const groups = parseProxies(proxies);
    expect(groups.map((group) => group.name)).toEqual(["url-group", "Selector A"]);
    expect(groups[1]).toMatchObject({ type: "Selector", now: "node1" });
    expect(groups[1].nodes.map((node) => node.name)).toEqual(["node1", "node2"]);
    expect(groups[0].nodes.map((node) => node.name)).toEqual(["node1", "node2", "node3"]);
  });

  it("延迟取最近一次正值；history 只留 10 条失败记 null；alive 原样", () => {
    const groups = parseProxies(proxies);
    const selector = groups.find((group) => group.name === "Selector A")!;
    expect(selector.nodes[0]).toEqual({
      name: "node1", type: "Shadowsocks", delay: 80, history: [null, 120, 80], alive: true,
    });
    const node2 = selector.nodes[1];
    expect(node2.delay).toBe(21);
    expect(node2.history).toHaveLength(10);
    expect(node2.history[0]).toBe(12);
    expect(node2.alive).toBe(false);
    const node3 = groups[0].nodes.find((node) => node.name === "node3")!;
    expect(node3).toMatchObject({ delay: null, history: [null], alive: true });
  });

  it("坏文档/空组返回空表（页面落空态而不是抛）", () => {
    expect(parseProxies(null)).toEqual([]);
    expect(parseProxies({ proxies: null })).toEqual([]);
    expect(parseProxies({ proxies: { g: { type: "Selector", all: ["missing"] } } })).toEqual([]);
    expect(parseProxies({ proxies: { g: { type: "URLTest" } } })).toEqual([]);
  });
});

describe("连接构成解析", () => {
  it("按 chains[0] 分代理/直连/拦截，DIRECT 与 PASS 都算直连", () => {
    expect(parseConnections({
      connections: [
        { chains: ["DIRECT"] },
        { chains: ["PASS"] },
        { chains: ["REJECT"] },
        { chains: ["REJECT-DROP"] },
        { chains: ["node2", "Selector A"] },
        { chains: [] },
        null,
      ],
    })).toEqual({ total: 7, proxy: 2, direct: 2, reject: 2 });
  });

  it("坏文档落全零", () => {
    expect(parseConnections(null)).toEqual({ total: 0, proxy: 0, direct: 0, reject: 0 });
    expect(parseConnections({ connections: "nope" })).toEqual({ total: 0, proxy: 0, direct: 0, reject: 0 });
  });
});

describe("流量帧", () => {
  it("只收数字、负值夹到 0，at 用采样时刻", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(parseTrafficFrame({ up: 12.6, down: 34 })).toEqual({ up: 12.6, down: 34, at: 1_700_000_000_000 });
    expect(parseTrafficFrame({ up: -5, down: 0 })).toMatchObject({ up: 0, down: 0 });
    expect(parseTrafficFrame({ up: "1", down: 2 })).toBeNull();
    expect(parseTrafficFrame({ up: 1 })).toBeNull();
    expect(parseTrafficFrame(null)).toBeNull();
  });
});

describe("流量流", () => {
  function streamBody(chunks: string[]) {
    let canceled = false;
    const encoder = new TextEncoder();
    const body = {
      getReader() {
        let index = 0;
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
          async cancel() {
            canceled = true;
          },
        };
      },
    };
    return { body: body as unknown as ReadableStream<Uint8Array>, wasCanceled: () => canceled };
  }

  function trafficClient(chunks: string[], status = 200) {
    const stream = streamBody(chunks);
    const client = createMihomoClient({
      baseUrl: "http://127.0.0.1:9097",
      secret: "s",
      timeoutMs: 50,
      fetchImpl: (async () => ({
        ok: status >= 200 && status < 300,
        status,
        body: stream.body,
      })) as unknown as typeof fetch,
    });
    return { client, stream };
  }

  it("跨分片拼行、跳过空行，只取第一帧并取消连接", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { client, stream } = trafficClient(["  \n", '{"up":1,', '"down":2}\n{"up":9,"down":9}\n']);
    expect(await client.traffic()).toEqual({ up: 1, down: 2, at: 1_700_000_000_000 });
    expect(stream.wasCanceled()).toBe(true);
  });

  it("流里没有可解析帧 → bad-response；401 → unauthorized", async () => {
    await expect(trafficClient(["not-json\n"]).client.traffic()).rejects.toMatchObject({ reason: "bad-response" });
    await expect(trafficClient([], 200).client.traffic()).rejects.toMatchObject({ reason: "bad-response" });
    await expect(trafficClient([], 401).client.traffic()).rejects.toMatchObject({ reason: "unauthorized" });
  });
});

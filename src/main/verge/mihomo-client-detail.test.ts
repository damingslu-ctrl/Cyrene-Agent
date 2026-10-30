import { describe, expect, it } from "vitest";
import { createMihomoClient } from "./mihomo-client";

type Call = { url: string; init: RequestInit };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
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

function openStream(chunks: string[]) {
  let canceled = false;
  const encoder = new TextEncoder();
  let index = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (index < chunks.length) return { done: false, value: encoder.encode(chunks[index++]) };
          // 日志流不会自己结束：abort 之前一直挂着。
          return new Promise<never>(() => {});
        },
        async cancel() {
          canceled = true;
        },
      };
    },
  };
  return { body: body as unknown as ReadableStream<Uint8Array>, wasCanceled: () => canceled };
}

function logsClient(chunks: string[], status = 200, secret = "s") {
  const stream = openStream(chunks);
  const calls: Call[] = [];
  let seenSignal: AbortSignal | undefined;
  const client = createMihomoClient({
    baseUrl: "http://127.0.0.1:9097",
    secret,
    timeoutMs: 30,
    fetchImpl: ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      seenSignal = init.signal ?? undefined;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        body: stream.body,
      } as Response);
    }) as unknown as typeof fetch,
  });
  return { client, stream, calls, signal: () => seenSignal };
}

describe("只读明细接口", () => {
  it("rules/connectionsDetail/providers/configs 走各自路径并解析", async () => {
    const { client, calls } = makeClient(async (url) => {
      if (url.endsWith("/rules")) {
        return jsonResponse({ rules: [{ type: "Domain", payload: "a.com", proxy: "n1", size: -1 }] });
      }
      if (url.endsWith("/connections")) {
        return jsonResponse({
          connections: [{
            id: "c1",
            metadata: { host: "a.com", destinationIP: "1.2.3.4", destinationPort: "443", network: "tcp" },
            upload: 10, download: 20, start: "2026-10-29T00:00:00Z", chains: ["n1", "G"], rule: "DomainSuffix",
          }],
        });
      }
      if (url.endsWith("/providers/proxies")) {
        return jsonResponse({ providers: { p: { name: "p", vehicleType: "HTTP", proxies: [{ alive: true }] } } });
      }
      return jsonResponse({ "mixed-port": 7897, mode: "rule", tun: { enable: false } });
    });
    expect(await client.rules()).toEqual([{ type: "Domain", payload: "a.com", proxy: "n1", size: -1 }]);
    expect((await client.connectionsDetail())[0]).toMatchObject({ id: "c1", host: "a.com", chains: ["n1", "G"] });
    expect(await client.providers()).toEqual([
      { name: "p", vehicle: "HTTP", nodeCount: 1, aliveCount: 1, updatedAt: null },
    ]);
    expect(await client.configs()).toMatchObject({ mixedPort: 7897, mode: "rule", tunEnabled: false });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:9097/rules",
      "http://127.0.0.1:9097/connections",
      "http://127.0.0.1:9097/providers/proxies",
      "http://127.0.0.1:9097/configs",
    ]);
  });

  it("关连接/关全部/健康检查用 DELETE 与 GET，名字要编码", async () => {
    const { client, calls } = makeClient(async () => noContent());
    await client.closeConnection("a b/c");
    await client.closeAllConnections();
    await client.providerHealthCheck("机场 一");
    expect(calls.map((call) => [call.init.method ?? "GET", call.url])).toEqual([
      ["DELETE", "http://127.0.0.1:9097/connections/a%20b%2Fc"],
      ["DELETE", "http://127.0.0.1:9097/connections"],
      ["GET", "http://127.0.0.1:9097/providers/proxies/%E6%9C%BA%E5%9C%BA%20%E4%B8%80/healthcheck"],
    ]);
  });

  it("重载配置 PUT 带 path；节点测速超时/负数落 null，408/504 也落 null", async () => {
    const { client, calls } = makeClient(async (url) => {
      if (url.includes("/proxies/bad/")) return jsonResponse({ message: "timeout" }, 504);
      if (url.includes("/delay")) return jsonResponse({ delay: 120.4 });
      return noContent();
    });
    await client.reloadConfig("D:/cfg/runtime.yaml");
    expect(calls[0]).toMatchObject({
      url: "http://127.0.0.1:9097/configs",
      init: { method: "PUT", body: JSON.stringify({ path: "D:/cfg/runtime.yaml" }) },
    });
    expect(await client.nodeDelay("香港 01", 3000)).toBe(120);
    expect(calls[1].url).toBe(
      "http://127.0.0.1:9097/proxies/%E9%A6%99%E6%B8%AF%2001/delay?timeout=3000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204",
    );
    expect(await client.nodeDelay("bad")).toBeNull();
  });

  it("节点测速 0 与缺字段都落 null（失败不是一个 0 毫秒的节点）", async () => {
    expect(await makeClient(async () => jsonResponse({ delay: 0 })).client.nodeDelay("n")).toBeNull();
    expect(await makeClient(async () => jsonResponse({})).client.nodeDelay("n")).toBeNull();
  });
});

describe("patchConfigs 白名单", () => {
  it("单键原样发；tun 的点号键展开成嵌套对象", async () => {
    const { client, calls } = makeClient(async () => noContent());
    await client.patchConfigs({ "mixed-port": 7890 });
    await client.patchConfigs({ "tun.enable": true });
    await client.patchConfigs({ "tun.stack": "gvisor" });
    await client.patchConfigs({ "log-level": "warning" });
    expect(calls.map((call) => call.init.body)).toEqual([
      JSON.stringify({ "mixed-port": 7890 }),
      JSON.stringify({ tun: { enable: true } }),
      JSON.stringify({ tun: { stack: "gvisor" } }),
      JSON.stringify({ "log-level": "warning" }),
    ]);
    expect(calls.every((call) => call.init.method === "PATCH")).toBe(true);
  });

  it("白名单外的键、坏值、空对象都拒绝，且一个请求都不发", async () => {
    const { client, calls } = makeClient(async () => noContent());
    const bad: unknown[] = [
      { secret: "x" },
      { "mixed-port": "7890" },
      { "mixed-port": 70000 },
      { "log-level": "trace" },
      { "tun.stack": "openvpn" },
      { "tun.enable": "yes" },
      {},
      { "mixed-port": 7890, secret: "x" },
    ];
    for (const patch of bad) {
      await expect(client.patchConfigs(patch as never)).rejects.toMatchObject({ reason: "bad-response" });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("内核的失败正文", () => {
  it("PATCH /configs 非 2xx 时把内核那句话原样带回来（TUN 打不开不许说成「未知错误」）", async () => {
    const body = "error creating tun device: open wintun: The system cannot find the file specified.";
    const { client } = makeClient(async () => new Response(body, { status: 400 }));
    await expect(client.patchConfigs({ "tun.enable": true })).rejects.toMatchObject({
      reason: "bad-response",
      status: 400,
      detail: body,
      message: expect.stringContaining("open wintun"),
    });
  });

  it("正文折成一行；超长截到 400 字；没有正文时不编造", async () => {
    const folded = makeClient(async () => new Response("line one\n  line two\r\n", { status: 500 }));
    const error = await folded.client.patchConfigs({ ipv6: true }).catch((e: unknown) => e);
    expect((error as { detail: string }).detail).toBe("line one line two");

    const long = makeClient(async () => new Response("啊".repeat(500), { status: 500 }));
    const far = await long.client.patchConfigs({ ipv6: true }).catch((e: unknown) => e);
    const text = (far as { detail: string }).detail;
    expect([...text].length).toBe(401); // 400 字 + 一个省略号
    expect(text.endsWith("…")).toBe(true);

    const empty = makeClient(async () => new Response(null, { status: 502 }));
    const none = await empty.client.patchConfigs({ ipv6: true }).catch((e: unknown) => e);
    expect((none as { detail?: string }).detail).toBeUndefined();
    expect((none as Error).message).toContain("502");
  });

  it("读正文这一步自己坏了也不能把回执弄丢（内核回 200 才算成功这条不许漂）", async () => {
    const broken = new Response("boom", { status: 400 });
    broken.text = () => Promise.reject(new Error("stream closed"));
    const { client } = makeClient(async () => broken);
    await expect(client.patchConfigs({ ipv6: true })).rejects.toMatchObject({
      reason: "bad-response",
      status: 400,
      message: expect.stringContaining("400"),
    });
  });
});

describe("204 回执", () => {
  it("setMode / selectNode / reloadConfig 遇到 204 不算坏 JSON", async () => {
    const { client } = makeClient(async () => noContent());
    await expect(client.setMode("global")).resolves.toBeUndefined();
    await expect(client.selectNode("G", "n1")).resolves.toBeUndefined();
    await expect(client.reloadConfig("D:/cfg.yaml")).resolves.toBeUndefined();
    await expect(client.patchConfigs({ ipv6: true })).resolves.toBeUndefined();
  });
});

describe("日志流", () => {
  it("默认 info、显式级别进查询串，逐行回调", async () => {
    const first = logsClient(['{"type":"info","payload":"a","time":"2026-10-29T00:00:00Z"}\n'], 200);
    const controller = new AbortController();
    const seen: unknown[] = [];
    const run = first.client.logs((entry) => {
      seen.push(entry);
      controller.abort();
    }, { signal: controller.signal });
    await run;
    expect(first.calls[0].url).toBe("http://127.0.0.1:9097/logs?level=info");
    expect(seen).toEqual([{ type: "info", payload: "a", at: Date.parse("2026-10-29T00:00:00Z") }]);

    const second = logsClient([], 200);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    await second.client.logs(() => {}, { level: "warning", signal: stop.signal });
    expect(second.calls[0].url).toBe("http://127.0.0.1:9097/logs?level=warning");
  });

  it("跨分片拼行、坏行与缺 type 的行跳过但流不断", async () => {
    const stream = logsClient([
      '  \n{"type":"debug","payload":"a"}\nnot-json\n{"payload":"no-type"}\n',
      '{"type":"warning","payload":"跨',
      '分片"}\n',
    ]);
    const controller = new AbortController();
    const seen: Array<{ type: string; payload: string }> = [];
    const run = stream.client.logs(
      (entry) => {
        seen.push({ type: entry.type, payload: entry.payload });
        if (seen.length === 2) controller.abort();
      },
      { level: "debug", signal: controller.signal },
    );
    await run;
    expect(seen).toEqual([
      { type: "debug", payload: "a" },
      { type: "warning", payload: "跨分片" },
    ]);
    expect(stream.stream.wasCanceled()).toBe(true);
  });

  it("连接超时不跟着流走：首帧之后隔 60ms 的下一帧照样收到", async () => {
    const encoder = new TextEncoder();
    const chunks: Array<{ text: string; afterMs: number }> = [
      { text: '{"type":"info","payload":"a"}\n', afterMs: 0 },
      { text: '{"type":"info","payload":"b"}\n', afterMs: 60 },
    ];
    let index = 0;
    const client = createMihomoClient({
      baseUrl: "http://127.0.0.1:9097",
      secret: "s",
      timeoutMs: 30,
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              if (index >= chunks.length) return new Promise<never>(() => {});
              const item = chunks[index++];
              return new Promise((resolve) => {
                setTimeout(() => resolve({ done: false, value: encoder.encode(item.text) }), item.afterMs);
              });
            },
            cancel: async () => {},
          }),
        },
      })) as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const seen: string[] = [];
    await client.logs(
      (entry) => {
        seen.push(entry.payload);
        if (seen.length === 2) controller.abort();
      },
      { signal: controller.signal },
    );
    expect(seen).toEqual(["a", "b"]);
  });

  it("401 → unauthorized；没有 body → bad-response", async () => {
    const unauthorized = logsClient([], 401);
    await expect(unauthorized.client.logs(() => {})).rejects.toMatchObject({ reason: "unauthorized" });
    const empty = makeClient(async () => new Response(null, { status: 200 }));
    await expect(empty.client.logs(() => {})).rejects.toMatchObject({ reason: "bad-response" });
  });
});

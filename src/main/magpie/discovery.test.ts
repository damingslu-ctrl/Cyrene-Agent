import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAGPIE_DEFAULT_GATEWAY_URL } from "../../shared/magpie";
import { discoverMagpieModels, readMagpieGatewayUrl } from "./discovery";

const PAYLOAD = {
  object: "list",
  data: [
    {
      id: "group/never-stuck",
      display_name: "永不卡住",
      context_window: 1048576,
      modalities: { input: ["text", "image"] },
      reasoning: true,
      reasoning_levels: ["low", "high"],
    },
    {
      id: "opencode-zen/text-only",
      context_window: 200000,
      modalities: { input: ["text"] },
      reasoning_levels: [],
    },
  ],
};

const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  })));
});

describe("Magpie 网关发现", () => {
  it("优先读取 ~/.cache/magpie 的 gateway.url，并规范化去尾斜杠", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-magpie-home-"));
    fs.mkdirSync(path.join(home, ".cache", "magpie"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".cache", "magpie", "providers-state.json"),
      JSON.stringify({ version: 1, providers: { gateway: { url: "http://127.0.0.1:5123/", running: true } } }),
      "utf8",
    );
    expect(readMagpieGatewayUrl(home)).toBe("http://127.0.0.1:5123");
  });

  it("缓存状态缺失或损坏时回退到 ~/.config/magpie", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-magpie-home-"));
    fs.mkdirSync(path.join(home, ".cache", "magpie"), { recursive: true });
    fs.writeFileSync(path.join(home, ".cache", "magpie", "providers-state.json"), "{oops", "utf8");
    fs.mkdirSync(path.join(home, ".config", "magpie"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "magpie", "providers-state.json"),
      JSON.stringify({ providers: { gateway: { url: "http://localhost:6000" } } }),
      "utf8",
    );
    expect(readMagpieGatewayUrl(home)).toBe("http://localhost:6000");
  });

  it("状态文件指向非回环地址时拒绝采用", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-magpie-home-"));
    fs.mkdirSync(path.join(home, ".cache", "magpie"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".cache", "magpie", "providers-state.json"),
      JSON.stringify({ providers: { gateway: { url: "http://192.168.1.8:3425" } } }),
      "utf8",
    );
    expect(readMagpieGatewayUrl(home)).toBeUndefined();
  });

  it("GET /v1/models 并解析模型，不带 Authorization", async () => {
    let seenUrl = "";
    let seenAuth: string | undefined;
    const base = await listen((req, res) => {
      seenUrl = req.url ?? "";
      seenAuth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(PAYLOAD));
    });

    const result = await discoverMagpieModels({ gatewayUrl: base });
    expect(result.error).toBeUndefined();
    expect(result.gatewayUrl).toBe(base);
    expect(result.models.map((model) => model.id)).toEqual(["group/never-stuck", "opencode-zen/text-only"]);
    expect(seenUrl).toBe("/v1/models");
    expect(seenAuth).toBeUndefined();
  });

  it("网关无响应时返回错误而不是抛异常", async () => {
    const base = await listen((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(PAYLOAD));
      }, 300);
    });
    const result = await discoverMagpieModels({ gatewayUrl: base, timeoutMs: 40 });
    expect(result.models).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("HTTP 非 2xx 时返回状态码", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(503);
      res.end("nope");
    });
    const result = await discoverMagpieModels({ gatewayUrl: base });
    expect(result.models).toEqual([]);
    expect(result.error).toContain("503");
  });

  it("显式传入非回环地址时不发请求", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverMagpieModels({
      gatewayUrl: "http://203.0.113.10:3425",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.models).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("没有任何状态文件时尝试默认回环端口", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-magpie-home-"));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const result = await discoverMagpieModels({ homeDir: home, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(MAGPIE_DEFAULT_GATEWAY_URL).toBe("http://127.0.0.1:3425");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:3425/v1/models");
    expect(result.gatewayUrl).toBe("http://127.0.0.1:3425");
  });
});

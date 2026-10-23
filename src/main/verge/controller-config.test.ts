import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  decodeSubscriptionUser,
  discoverConfigRoot,
  normalizeControllerBase,
  parseSubscription,
  readControllerConfig,
  readSubscription,
} from "./controller-config";

const tempDirs: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mochi-cfg-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

function token(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

beforeEach(() => clearConfigCache());
afterEach(() => {
  clearConfigCache();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("normalizeControllerBase", () => {
  it("常见写法归一：裸 host:port / 只给端口 / 带协议与尾斜杠", () => {
    expect(normalizeControllerBase("127.0.0.1:9097")).toBe("http://127.0.0.1:9097");
    expect(normalizeControllerBase("localhost:9090")).toBe("http://localhost:9090");
    // mihomo 允许 `:9097`，主机留空表示本机；不能因为 URL 解析不了就当成没配置。
    expect(normalizeControllerBase(":9097")).toBe("http://127.0.0.1:9097");
    expect(normalizeControllerBase("http://127.0.0.1:9097/")).toBe("http://127.0.0.1:9097");
  });

  it("通配/回环 v6 都落到 127.0.0.1；缺端口时用默认值", () => {
    expect(normalizeControllerBase("0.0.0.0:9090")).toBe("http://127.0.0.1:9090");
    expect(normalizeControllerBase("[::1]:9097")).toBe("http://127.0.0.1:9097");
    expect(normalizeControllerBase("127.0.0.1")).toBe("http://127.0.0.1:9090");
    expect(normalizeControllerBase("127.0.0.1", 7070)).toBe("http://127.0.0.1:7070");
  });

  it("非本机主机与非 http(s) 协议一律拒绝（控制面不能把密钥发出去）", () => {
    expect(normalizeControllerBase("192.168.1.5:9090")).toBeNull();
    expect(normalizeControllerBase("https://example.com:9090")).toBeNull();
    expect(normalizeControllerBase("ftp://127.0.0.1:9090")).toBeNull();
    expect(normalizeControllerBase("")).toBeNull();
    expect(normalizeControllerBase("   ")).toBeNull();
    expect(normalizeControllerBase(9090)).toBeNull();
    expect(normalizeControllerBase(null)).toBeNull();
  });

  it("https 回环仍接受（用户自己开了 TLS 控制面）", () => {
    expect(normalizeControllerBase("https://localhost:9443")).toBe("https://localhost:9443");
  });
});

describe("discoverConfigRoot", () => {
  it("按 APPDATA → LOCALAPPDATA、候选目录顺序找 clash-verge.yaml", () => {
    const seen: string[] = [];
    const root = discoverConfigRoot({
      appData: "C:/Roaming",
      localAppData: "C:/Local",
      exists: (file) => {
        seen.push(file);
        return file === path.join("C:/Local", "clash-verge-rev", "clash-verge.yaml");
      },
    });
    expect(root).toBe(path.join("C:/Local", "clash-verge-rev"));
    expect(seen[0]).toBe(path.join("C:/Roaming", "io.github.clash-verge-rev.clash-verge-rev", "clash-verge.yaml"));
  });

  it("一个都没有时返回 null（负判据）", () => {
    expect(discoverConfigRoot({ appData: "C:/Roaming", localAppData: "C:/Local", exists: () => false })).toBeNull();
    expect(discoverConfigRoot({ exists: () => true })).toBeNull();
  });
});

describe("readControllerConfig", () => {
  it("读出控制器地址、密钥与混合端口", () => {
    const root = makeRoot({
      "clash-verge.yaml": [
        "mixed-port: 7896",
        "external-controller: 127.0.0.1:9097",
        "secret: s3cret",
      ].join("\n"),
    });
    const result = readControllerConfig(root);
    expect(result).toEqual({
      ok: true,
      config: {
        baseUrl: "http://127.0.0.1:9097",
        secret: "s3cret",
        mixedPort: 7896,
        sourcePath: path.join(root, "clash-verge.yaml"),
      },
    });
  });

  it("缺 secret / mixed-port 是可用的控制器（空密钥与 null 端口）", () => {
    const root = makeRoot({ "clash-verge.yaml": "external-controller: :9097\n" });
    expect(readControllerConfig(root)).toMatchObject({
      ok: true,
      config: { baseUrl: "http://127.0.0.1:9097", secret: "", mixedPort: null },
    });
  });

  it("根不存在 → no-config；文件不是映射 → bad-response；没有可用的本机控制器 → no-controller", () => {
    expect(readControllerConfig(null)).toEqual({ ok: false, reason: "no-config" });
    expect(readControllerConfig(path.join(tmpdir(), "mochi-missing-root"))).toEqual({ ok: false, reason: "no-config" });
    expect(readControllerConfig(makeRoot({ "clash-verge.yaml": "just-a-string\n" })))
      .toEqual({ ok: false, reason: "bad-response" });
    expect(readControllerConfig(makeRoot({ "clash-verge.yaml": "external-controller: 10.0.0.2:9090\n" })))
      .toEqual({ ok: false, reason: "no-controller" });
  });

  it("文件变了（mtime/size 变）会重读，不吃旧缓存", () => {
    const root = makeRoot({ "clash-verge.yaml": "external-controller: 127.0.0.1:9097\n" });
    expect(readControllerConfig(root)).toMatchObject({ ok: true, config: { baseUrl: "http://127.0.0.1:9097" } });
    writeFileSync(path.join(root, "clash-verge.yaml"), "external-controller: 127.0.0.1:9098\n# pad\n");
    expect(readControllerConfig(root)).toMatchObject({ ok: true, config: { baseUrl: "http://127.0.0.1:9098" } });
  });
});

describe("订阅解析", () => {
  it("base64url 订阅名解出用户名；普通名字/坏串/缺 u 都是空串", () => {
    expect(decodeSubscriptionUser(token({ u: " defond ", e: 1 }))).toBe("defond");
    expect(decodeSubscriptionUser("机场订阅")).toBe("");
    expect(decodeSubscriptionUser("!!!not-base64!!!")).toBe("");
    expect(decodeSubscriptionUser(token({ e: 1 }))).toBe("");
    expect(decodeSubscriptionUser(token({ u: "   " }))).toBe("");
    expect(decodeSubscriptionUser(null)).toBe("");
  });

  it("只取 current 指向的那一项，extra 秒级时间戳转毫秒", () => {
    const root = makeRoot({
      "profiles.yaml": [
        "current: b",
        "items:",
        "  - uid: a",
        "    name: old",
        "    updated: 100",
        "  - uid: b",
        `    name: ${token({ u: "defond", e: 1794189959398 })}`,
        "    updated: 1700000000",
        "    extra:",
        "      upload: 1000",
        "      download: 2000",
        "      total: 3000",
        "      expire: 1800000000",
      ].join("\n"),
    });
    expect(readSubscription(root)).toEqual({
      name: token({ u: "defond", e: 1794189959398 }),
      user: "defond",
      expireAt: 1_800_000_000_000,
      updatedAt: 1_700_000_000_000,
      upload: 1000,
      download: 2000,
      total: 3000,
    });
  });

  it("extra 没带 expire 时退回订阅 token 的 e（毫秒）；缺字段按 0/null", () => {
    const name = token({ u: "defond", e: 1794189959398 });
    expect(parseSubscription({ current: "x", items: [{ uid: "x", name, extra: {} }] })).toEqual({
      name,
      user: "defond",
      expireAt: 1794189959398,
      updatedAt: null,
      upload: 0,
      download: 0,
      total: 0,
    });
  });

  it("current 不存在 / 文档坏掉 → null（不猜最后一条）", () => {
    expect(parseSubscription({ current: "missing", items: [{ uid: "a", name: "x" }] })).toBeNull();
    expect(parseSubscription({ items: [{ uid: "a", name: "x" }] })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(readSubscription(null)).toBeNull();
    expect(readSubscription(makeRoot({ "profiles.yaml": "not-a-map\n" }))).toBeNull();
  });
});

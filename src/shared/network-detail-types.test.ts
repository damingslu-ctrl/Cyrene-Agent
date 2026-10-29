import { describe, expect, it } from "vitest";
import {
  CONFIG_KEYS,
  LOG_LEVELS,
  parseConnectionsDetail,
  parseLogLine,
  parseProviders,
  parseRules,
  pickConfigView,
} from "./network-detail-types";

describe("parseRules", () => {
  it("按数组顺序原样搬 type/payload/proxy/size，不动内容", () => {
    const rules = parseRules({
      rules: [
        { type: "DomainSuffix", payload: "google.com", proxy: "节点选择", size: -1 },
        { type: "MATCH", payload: "", proxy: "DIRECT", size: 0 },
      ],
    });
    expect(rules).toEqual([
      { type: "DomainSuffix", payload: "google.com", proxy: "节点选择", size: -1 },
      { type: "MATCH", payload: "", proxy: "DIRECT", size: 0 },
    ]);
  });

  it("缺 rules / 不是数组 → 空数组（页面读成 0 条，不是异常）", () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules({})).toEqual([]);
    expect(parseRules({ rules: "nope" })).toEqual([]);
  });

  it("坏条目跳过，不许让一条坏数据吞掉整页", () => {
    const rules = parseRules({
      rules: [null, 1, { type: 1, payload: "x", proxy: "DIRECT" }, { type: "MATCH", payload: "", proxy: "DIRECT" }],
    });
    expect(rules).toEqual([{ type: "MATCH", payload: "", proxy: "DIRECT", size: -1 }]);
  });
});

describe("parseConnectionsDetail", () => {
  const raw = {
    connections: [
      {
        id: "c-1",
        metadata: {
          network: "tcp",
          host: "api.example.com",
          destinationIP: "1.2.3.4",
          destinationPort: "443",
          processPath: "C:\\Program Files\\App\\app.exe",
        },
        upload: 1024,
        download: 2048,
        start: "2026-10-29T10:00:00+08:00",
        chains: ["专享-节点", "节点选择"],
        rule: "DomainSuffix",
        rulePayload: "example.com",
      },
      {
        id: "c-2",
        metadata: { network: "udp", destinationIP: "8.8.8.8", destinationPort: "53" },
        upload: 0,
        download: 0,
        start: "2026-10-29T10:01:00Z",
        chains: ["DIRECT"],
        rule: "MATCH",
        rulePayload: "",
      },
    ],
  };

  it("进程/主机/链路/规则四组字段都搬出来，host 缺省时退回目标 IP", () => {
    const list = parseConnectionsDetail(raw);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: "c-1",
      host: "api.example.com",
      network: "tcp",
      destination: "1.2.3.4:443",
      process: "C:\\Program Files\\App\\app.exe",
      upload: 1024,
      download: 2048,
      chains: ["专享-节点", "节点选择"],
      rule: "DomainSuffix",
      rulePayload: "example.com",
    });
    expect(list[0].startedAt).toBe(Date.parse("2026-10-29T10:00:00+08:00"));
    expect(list[1].host).toBe("8.8.8.8");
    expect(list[1].process).toBe("");
  });

  it("没有 id 的连接不列（列出来也关不掉，点一下只会失败）", () => {
    const list = parseConnectionsDetail({
      connections: [{ metadata: { host: "x" }, chains: ["DIRECT"] }],
    });
    expect(list).toEqual([]);
  });

  it("坏形状一律空数组", () => {
    expect(parseConnectionsDetail(null)).toEqual([]);
    expect(parseConnectionsDetail({ connections: {} })).toEqual([]);
  });
});

describe("parseLogLine", () => {
  it("标准行：type/payload 原样，time 缺失记 0（渲染端自己补时钟）", () => {
    expect(parseLogLine('{"type":"info","payload":"[TCP] 1.2.3.4:443 --> 5.6.7.8:443"}')).toEqual({
      type: "info",
      payload: "[TCP] 1.2.3.4:443 --> 5.6.7.8:443",
      at: 0,
    });
  });

  it("time 支持 RFC3339 与秒/毫秒数字", () => {
    expect(parseLogLine('{"type":"warning","payload":"x","time":"2026-10-29T02:00:00Z"}')?.at)
      .toBe(Date.parse("2026-10-29T02:00:00Z"));
    expect(parseLogLine('{"type":"error","payload":"x","time":1730167200000}')?.at)
      .toBe(1730167200000);
  });

  it("坏 JSON / 缺 payload / 空行 → null（流里跳过，不算断流）", () => {
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine("{")).toBeNull();
    expect(parseLogLine('{"type":"info"}')).toBeNull();
    expect(parseLogLine('{"payload":"x"}')).toBeNull();
  });

  it("未知级别收成 unknown，不把整行丢掉", () => {
    expect(parseLogLine('{"type":"trace","payload":"x"}')?.type).toBe("unknown");
    expect(LOG_LEVELS).toEqual(["debug", "info", "warning", "error"]);
  });
});

describe("parseProviders", () => {
  it("name/载体/节点数/存活数/更新时间，按名字排序", () => {
    const list = parseProviders({
      providers: {
        b: { name: "b", vehicleType: "HTTP", proxies: [{ alive: true }, { alive: false }, {}], updatedAt: "2026-10-29T01:00:00Z" },
        a: { name: "a", vehicleType: "File", proxies: [{ alive: true }], updatedAt: "2026-10-28T01:00:00Z" },
      },
    });
    expect(list.map((p) => p.name)).toEqual(["a", "b"]);
    expect(list[1]).toMatchObject({ vehicle: "HTTP", nodeCount: 3, aliveCount: 2 });
    expect(list[1].updatedAt).toBe(Date.parse("2026-10-29T01:00:00Z"));
  });

  it("proxies 不是数组 → 0 个节点（不抛）", () => {
    const list = parseProviders({ providers: { a: { name: "a", proxies: null } } });
    expect(list[0]).toMatchObject({ nodeCount: 0, aliveCount: 0, vehicle: "" });
  });

  it("更新时间的零值/坏值读成 null，界面才不会印出「1/1/1」或「1970/1/1」", () => {
    // 真机实测：mihomo 对从没更新过的 provider 给 Go 零值时间；
    // 直接 toLocaleString 会印成「1/1/1 08:05:43」，而坏字符串会印成 1970。
    const list = parseProviders({
      providers: {
        goZero: { name: "goZero", proxies: [], updatedAt: "0001-01-01T00:00:00Z" },
        broken: { name: "broken", proxies: [], updatedAt: "not-a-date" },
        epoch: { name: "epoch", proxies: [], updatedAt: 0 },
      },
    });
    for (const p of list) expect(p.updatedAt, p.name).toBeNull();
  });

  it("空/坏形状 → 空数组", () => {
    expect(parseProviders(null)).toEqual([]);
    expect(parseProviders({ providers: [] })).toEqual([]);
  });
});

describe("pickConfigView", () => {
  it("只取白名单键；tun 只取 enable/stack", () => {
    const view = pickConfigView({
      "mixed-port": 7896,
      port: 0,
      "socks-port": 0,
      "allow-lan": true,
      ipv6: false,
      mode: "rule",
      "log-level": "info",
      tun: { enable: false, stack: "gvisor", device: "Mihomo", "auto-route": true },
      secret: "should-not-leak",
      "external-controller": "127.0.0.1:9097",
    });
    expect(view).toEqual({
      mixedPort: 7896,
      port: 0,
      socksPort: 0,
      allowLan: true,
      ipv6: false,
      mode: "rule",
      logLevel: "info",
      tunEnabled: false,
      tunStack: "gvisor",
    });
    expect(CONFIG_KEYS).toEqual([
      "mixed-port", "port", "socks-port", "allow-lan", "ipv6", "mode", "log-level", "tun",
    ]);
  });

  it("缺键用 null，模式不认识也用 null（不猜）", () => {
    expect(pickConfigView({ mode: "weird", tun: {} })).toMatchObject({
      mixedPort: null, allowLan: null, mode: null, tunEnabled: null, tunStack: null,
    });
  });
});

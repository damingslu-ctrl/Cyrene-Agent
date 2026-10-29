import { describe, expect, it } from "vitest";
import type { CoreConfigView, LogEntry, RuleEntry } from "../../../../shared/network-detail-types";
import {
  CONNECTION_LIMIT,
  LOG_LIMIT,
  NETWORK_TABS,
  NETWORK_TAB_KEY,
  configSteps,
  draftFromView,
  filterLogs,
  filterRules,
  formatDuration,
  invalidPorts,
  processName,
  pushLogEntry,
  viewMatchesPatch,
} from "./network-tabs";

function rule(type: string, payload: string, proxy: string, size = 1): RuleEntry {
  return { type, payload, proxy, size };
}

function log(type: LogEntry["type"], payload = "x"): LogEntry {
  return { type, payload, at: 1 };
}

function view(overrides: Partial<CoreConfigView> = {}): CoreConfigView {
  return {
    mixedPort: 7896,
    port: 7897,
    socksPort: 7898,
    allowLan: false,
    ipv6: false,
    mode: "rule",
    logLevel: "info",
    tunEnabled: false,
    tunStack: "mixed",
    ...overrides,
  };
}

describe("页签清单", () => {
  it("六个正文页签按约定顺序，设置是第七个（齿轮入口）", () => {
    expect(NETWORK_TABS).toEqual(["overview", "nodes", "rules", "logs", "connections", "providers"]);
    expect(Object.keys(NETWORK_TAB_KEY)).toEqual([...NETWORK_TABS, "settings"]);
    expect(new Set(Object.values(NETWORK_TAB_KEY)).size).toBe(7);
  });

  it("每条日志最多 500 行、连接最多 200 条（与主进程同口径）", () => {
    expect(LOG_LIMIT).toBe(500);
    expect(CONNECTION_LIMIT).toBe(200);
  });
});

describe("filterRules", () => {
  const rules = [
    rule("DomainSuffix", "google.com", "节点选择"),
    rule("IPCIDR", "10.0.0.0/8", "DIRECT"),
    rule("DOMAIN", "Google.CN", "REJECT"),
  ];

  it("空查询原样返回；查询去空白后大小写不敏感", () => {
    expect(filterRules(rules, "   ")).toEqual(rules);
    expect(filterRules(rules, "google").map((entry) => entry.payload)).toEqual(["google.com", "Google.CN"]);
    expect(filterRules(rules, " GOOGLE ").map((entry) => entry.payload)).toEqual(["google.com", "Google.CN"]);
  });

  it("类型与出口也参与匹配；没有命中给空数组", () => {
    expect(filterRules(rules, "ipcidr")).toHaveLength(1);
    expect(filterRules(rules, "direct").map((entry) => entry.payload)).toEqual(["10.0.0.0/8"]);
    expect(filterRules(rules, "missing")).toEqual([]);
  });
});

describe("filterLogs", () => {
  const entries = [log("debug"), log("info"), log("warning"), log("error"), log("unknown")];

  it("全部级别不过滤，未知级别照常显示", () => {
    expect(filterLogs(entries, "all")).toHaveLength(5);
  });

  it("级别是下限：warning 只留 warning 及以上；未知级别不冒充任何档", () => {
    expect(filterLogs(entries, "info").map((entry) => entry.type)).toEqual(["info", "warning", "error"]);
    expect(filterLogs(entries, "warning").map((entry) => entry.type)).toEqual(["warning", "error"]);
    expect(filterLogs(entries, "error").map((entry) => entry.type)).toEqual(["error"]);
    expect(filterLogs(entries, "debug")).toHaveLength(4);
  });
});

describe("pushLogEntry", () => {
  it("追加不改原数组", () => {
    const base = [log("info", "a")];
    const next = pushLogEntry(base, log("info", "b"));
    expect(base).toHaveLength(1);
    expect(next.map((entry) => entry.payload)).toEqual(["a", "b"]);
  });

  it("超过上限从最老的开始丢，长度钉在上限", () => {
    const full = Array.from({ length: 3 }, (_, index) => log("info", String(index)));
    const next = pushLogEntry(full, log("info", "3"), 3);
    expect(next.map((entry) => entry.payload)).toEqual(["1", "2", "3"]);
    expect(pushLogEntry([log("info", "a")], log("info", "b"), 1).map((entry) => entry.payload)).toEqual(["b"]);
  });
});

describe("设置草稿与补丁", () => {
  it("draftFromView：端口转字符串，缺值留空，布尔与级别给安全默认", () => {
    expect(draftFromView(view())).toEqual({
      mixedPort: "7896",
      port: "7897",
      socksPort: "7898",
      allowLan: false,
      ipv6: false,
      logLevel: "info",
      tunEnabled: false,
      tunStack: "mixed",
    });
    expect(draftFromView(view({
      mixedPort: null, port: null, socksPort: null, allowLan: null, ipv6: null,
      logLevel: null, tunEnabled: null, tunStack: null,
    }))).toEqual({
      mixedPort: "",
      port: "",
      socksPort: "",
      allowLan: false,
      ipv6: false,
      logLevel: "info",
      tunEnabled: false,
      tunStack: "mixed",
    });
  });

  it("只把真正改过的键变成补丁，顺序固定，值做类型转换", () => {
    const base = view();
    expect(configSteps(base, draftFromView(base))).toEqual([]);

    const draft = { ...draftFromView(base), mixedPort: "7899", allowLan: true, logLevel: "warning" as const };
    expect(configSteps(base, draft)).toEqual([
      { "mixed-port": 7899 },
      { "allow-lan": true },
      { "log-level": "warning" },
    ]);

    const tun = { ...draftFromView(base), tunEnabled: true, tunStack: "gvisor" };
    expect(configSteps(base, tun)).toEqual([
      { "tun.enable": true },
      { "tun.stack": "gvisor" },
    ]);
  });

  it("坏端口不进补丁，由 invalidPorts 单独报出来挡住保存", () => {
    const base = view();
    const draft = { ...draftFromView(base), mixedPort: "70x", socksPort: "70000", port: "" };
    expect(configSteps(base, draft)).toEqual([]);
    expect(invalidPorts(draft)).toEqual(["mixedPort", "socksPort"]);

    expect(invalidPorts({ ...draftFromView(base), port: "0" })).toEqual([]);
    expect(configSteps(base, { ...draftFromView(base), port: "0" })).toEqual([{ port: 0 }]);
  });

  it("viewMatchesPatch：读回值逐键比对，tun 走扁平键映射", () => {
    expect(viewMatchesPatch(view(), { "mixed-port": 7896 })).toBe(true);
    expect(viewMatchesPatch(view(), { "mixed-port": 7897 })).toBe(false);
    expect(viewMatchesPatch(view(), { "allow-lan": false })).toBe(true);
    expect(viewMatchesPatch(view({ allowLan: null }), { "allow-lan": false })).toBe(false);
    expect(viewMatchesPatch(view({ tunEnabled: true }), { "tun.enable": true })).toBe(true);
    expect(viewMatchesPatch(view({ tunStack: "system" }), { "tun.stack": "mixed" })).toBe(false);
    expect(viewMatchesPatch(view({ logLevel: "debug" }), { "log-level": "debug" })).toBe(true);
    expect(viewMatchesPatch(view(), { port: 1 })).toBe(false);
    expect(viewMatchesPatch(view(), { "socks-port": 7898 })).toBe(true);
    expect(viewMatchesPatch(view({ ipv6: true }), { ipv6: true })).toBe(true);
  });
});

describe("读数小工具", () => {
  it("formatDuration：秒 / 分秒 / 时分，坏值落 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(9_400)).toBe("9s");
    expect(formatDuration(200_000)).toBe("3m 20s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });

  it("processName：两种路径分隔符都认，空串原样", () => {
    expect(processName("C:\\Program Files\\Chrome\\chrome.exe")).toBe("chrome.exe");
    expect(processName("/usr/local/bin/curl")).toBe("curl");
    expect(processName("")).toBe("");
    expect(processName("chrome.exe")).toBe("chrome.exe");
  });
});

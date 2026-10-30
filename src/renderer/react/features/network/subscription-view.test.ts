import { describe, expect, it } from "vitest";
import type { ProfileResult, ProfileRow } from "../../../../shared/subscription-types";
import {
  UPDATE_INTERVAL_CHOICES,
  failureOf,
  intervalChoiceValues,
  intervalDuration,
  rowActions,
  rowsAfter,
  urlFormValid,
  urlHost,
  warningsText,
} from "./subscription-view";

/** 只写这一页用得着的字段；其余行由 row() 补安全默认。 */
function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    uid: "Sub00000001",
    type: "remote",
    label: "机场 A",
    url: "https://api.example.test/sub",
    desc: null,
    updatedAt: 1_700_000_000_000,
    current: false,
    builtin: false,
    selectable: true,
    withProxy: null,
    updateInterval: null,
    ...overrides,
  };
}

function fail(overrides: Partial<Extract<ProfileResult, { ok: false }>> = {}): ProfileResult {
  return { ok: false, reason: "invalid", rows: [], ...overrides };
}

/** 测试用的 translate：把键与参数原样拼出来，好断言选中的是哪条文案。 */
const tr = (key: string, options?: Record<string, unknown>) =>
  `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

describe("rowActions：每行能点什么，只在一处判", () => {
  it("当前订阅不再给自己「切换到」；别的远端订阅四条全开", () => {
    expect(rowActions(row({ current: true }))).toEqual({ select: false, update: true, remove: true, options: true });
    expect(rowActions(row())).toEqual({ select: true, update: true, remove: true, options: true });
  });

  it("本地文件没有可下载的地址，所以没有「更新」，也没有自动更新间隔这回事", () => {
    expect(rowActions(row({ type: "local", url: null }))).toEqual({
      select: true, update: false, remove: true, options: false,
    });
  });

  it("内置项（Merge/Script）既不能切也不能删——删了 Verge 自己也起不来", () => {
    expect(rowActions(row({ uid: "Merge", type: "merge", url: null, builtin: true, selectable: false })))
      .toEqual({ select: false, update: false, remove: false, options: false });
  });

  it("附件（rules/proxies/groups/script）不能当当前订阅，但用户自己加的附件删得掉", () => {
    expect(rowActions(row({ uid: "AttachRules", type: "rules", url: null, selectable: false })))
      .toEqual({ select: false, update: false, remove: true, options: false });
  });
});

describe("urlHost：地址只以主机名示人", () => {
  it("去掉协议、端口、路径与查询——token 不该出现在界面上", () => {
    expect(urlHost("https://api.example.test:8443/sub?token=abc")).toBe("api.example.test");
    expect(urlHost("https://user:pass@example.test/a")).toBe("example.test");
    expect(urlHost("http://127.0.0.1:9090/sub")).toBe("127.0.0.1");
  });

  it("解析不出来就给 null，绝不把整条 URL 当主机名印出来", () => {
    expect(urlHost(null)).toBeNull();
    expect(urlHost("")).toBeNull();
    expect(urlHost("订阅地址")).toBeNull();
    expect(urlHost("ftp://example.test")).toBeNull();
  });
});

describe("自动更新间隔的档位", () => {
  it("预设五档，且盘上的野值也能被选中（不能让下拉框把它演成「跟随默认」）", () => {
    expect(UPDATE_INTERVAL_CHOICES).toEqual([1800, 3600, 10800, 43200, 86400]);
    expect(intervalChoiceValues(null)).toEqual(UPDATE_INTERVAL_CHOICES);
    expect(intervalChoiceValues(720)).toEqual([720, 1800, 3600, 10800, 43200, 86400]);
    expect(intervalChoiceValues(86400)).toEqual(UPDATE_INTERVAL_CHOICES);
  });

  it("整小时按小时说，其余按分钟说；一小时以下不冒充「0 分钟」", () => {
    expect(intervalDuration(1800)).toEqual({ unit: "minutes", n: 30 });
    expect(intervalDuration(720)).toEqual({ unit: "minutes", n: 12 });
    expect(intervalDuration(60)).toEqual({ unit: "minutes", n: 1 });
    expect(intervalDuration(3600)).toEqual({ unit: "hours", n: 1 });
    expect(intervalDuration(86400)).toEqual({ unit: "hours", n: 24 });
  });
});

describe("rowsAfter：失败不许把列表洗白", () => {
  const kept = [row()];
  it("成功照单全收，哪怕新列表是空的", () => {
    expect(rowsAfter({ ok: true, rows: [], warnings: [] }, kept)).toEqual([]);
    expect(rowsAfter({ ok: true, rows: [row({ uid: "Other" })], warnings: [] }, kept)[0]!.uid).toBe("Other");
  });

  it("失败带回了旧列表就用它；一条都没有才保留页面上现有的", () => {
    expect(rowsAfter(fail({ rows: [row({ uid: "FromDisk" })] }), kept)[0]!.uid).toBe("FromDisk");
    expect(rowsAfter(fail({ rows: [] }), kept)).toEqual(kept);
  });
});

describe("failureOf：失败要说得出下一步，且不硬凑一句", () => {
  it("成功没有失败可说", () => {
    expect(failureOf({ ok: true, rows: [], warnings: [] })).toBeNull();
  });

  it("单写者闸门单独一条：不是「失败了」，是「等 Clash Verge 退出」", () => {
    expect(failureOf(fail({ reason: "verge-running" }))).toEqual({ kind: "gated" });
  });

  it("「正文已换新、内核没吃下去」这个旗子必须原样递出去", () => {
    expect(failureOf(fail({ reason: "reload-failed", detail: "controller rejected", replaced: true }))).toEqual({
      kind: "failure",
      reasonKey: "network.sub.reason.reload-failed",
      detail: "controller rejected",
      replaced: true,
    });
  });

  it("有 detail 就以它为主（主进程那句话比字典更准），没写才回退到原因文案", () => {
    expect(failureOf(fail({ reason: "invalid", detail: "只接受 with_proxy / update_interval" })))
      .toEqual({
        kind: "failure",
        reasonKey: "network.sub.reason.invalid",
        detail: "只接受 with_proxy / update_interval",
        replaced: false,
      });
    expect(failureOf(fail({ reason: "no-proxies" }))).toEqual({
      kind: "failure",
      reasonKey: "network.sub.reason.no-proxies",
      detail: null,
      replaced: false,
    });
  });

  it("http-status 带上状态码：403 与 500 是两件不同的事", () => {
    expect(failureOf(fail({ reason: "http-status", status: 403 })))
      .toMatchObject({ kind: "failure", reasonKey: "network.sub.reason.http-status", status: 403 });
  });
});

describe("urlFormValid：导入按钮的可用性", () => {
  it("首尾空白不算，http(s) 之外的协议不算，中间有空格不算", () => {
    expect(urlFormValid("  https://example.test/sub  ")).toBe(true);
    expect(urlFormValid("http://example.test")).toBe(true);
    expect(urlFormValid("")).toBe(false);
    expect(urlFormValid("   ")).toBe(false);
    expect(urlFormValid("ftp://example.test")).toBe(false);
    expect(urlFormValid("https://exam ple.test")).toBe(false);
  });
});

describe("warningsText：merge 链里少一份附件要说得清是哪一份", () => {
  it("没有警告就一个字都不加；有就逐条列出 uid", () => {
    expect(warningsText([], tr)).toBe("");
    expect(warningsText(["Merge"], tr)).toBe('network.sub.mergeMissing {"uids":"Merge","n":1}');
    expect(warningsText(["Merge", "Script"], tr)).toBe('network.sub.mergeMissing {"uids":"Merge / Script","n":2}');
  });
});

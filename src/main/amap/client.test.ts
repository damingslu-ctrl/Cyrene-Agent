// 高德统一出口的测试：请求拼装 / 两套信封 / 错误码翻译 / 空值归一 / 超时与脱敏。
// 全部走 stub 的 fetch，不发真实请求。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amapGet,
  amapList,
  amapObj,
  amapText,
  describeAmapError,
} from "./client";

function jsonResp(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

/** 取第 N 次 fetch 的 URL（默认第一次）。 */
function fetchUrl(fetchMock: ReturnType<typeof vi.fn>, hop = 0): string {
  return String(fetchMock.mock.calls[hop][0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("amapGet 请求拼装", () => {
  it("参数逐条编码后落到 restapi.amap.com，key 排在最后", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1", infocode: "10000", info: "OK" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await amapGet("/v3/config/district", { keywords: "无 锡", subdistrict: 0 }, "k-e-y");
    expect(result.ok).toBe(true);

    const url = new URL(fetchUrl(fetchMock));
    expect(url.origin + url.pathname).toBe("https://restapi.amap.com/v3/config/district");
    expect(url.searchParams.get("keywords")).toBe("无 锡");
    expect(url.searchParams.get("subdistrict")).toBe("0");
    expect([...url.searchParams.keys()].at(-1)).toBe("key");
  });

  it("带 & 的 key 只会污染自己那一段，不会开出第二个参数", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await amapGet("/v3/geocode/geo", { address: "北京" }, "evil&output=txt&x");

    const url = fetchUrl(fetchMock);
    expect(url).not.toContain("&output=txt");
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll("key")).toHaveLength(1);
    expect(parsed.searchParams.get("key")).toBe("evil&output=txt&x");
  });

  it("undefined 的参数不发出去，空串照发", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await amapGet("/v3/place/text", { keywords: "咖啡", city: undefined, types: "" }, "key");

    const params = new URL(fetchUrl(fetchMock)).searchParams;
    expect(params.has("city")).toBe(false);
    expect(params.get("types")).toBe("");
  });

  it("非 ASCII 的 key 就地拦下：一个请求都不发", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await amapGet("/v3/geocode/geo", { address: "北京" }, "key-中文");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("key");
      expect(result.error).toContain("非 ASCII");
      expect(result.infocode).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("两端空格被剥掉后才是真正发出去的 key", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await amapGet("/v3/geocode/geo", { address: "北京" }, "  spaced-key  ");
    expect(new URL(fetchUrl(fetchMock)).searchParams.get("key")).toBe("spaced-key");
  });
});

describe("amapGet 信封判定", () => {
  it("v3 的 status=1 算成功，哪怕 infocode 缺席", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "1", regeoCode: { city: "无锡" } })));
    const result = await amapGet<{ regeoCode?: { city?: string } }>("/v3/geocode/regeo", { location: "1,1" }, "k");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.regeoCode?.city).toBe("无锡");
  });

  it("v4 骑行的 errcode=0 也算成功（这套接口不回 status）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ errcode: 0, errmsg: "OK", data: { paths: [] } })));
    const result = await amapGet("/v4/direction/bicycling", { origin: "1,1" }, "k");
    expect(result.ok).toBe(true);
  });

  it("v4 的 errcode 非 0 会被翻成人话并保留原始码", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ errcode: 10004, errmsg: "ACCESS_TOO_FREQUENT" })));
    const result = await amapGet("/v4/direction/bicycling", { origin: "1,1" }, "k");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.infocode).toBe("10004");
      expect(result.kind).toBe("rate");
      expect(result.error).toContain("过于频繁");
    }
  });

  it("status=0 + 10001 报的是 key 问题，不是「找不到城市」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "0", infocode: "10001", info: "INVALID_USER_KEY" })));
    const result = await amapGet("/v3/weather/weatherInfo", { city: "320200" }, "no-such-key");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("key");
      expect(result.error).toContain("Key 不正确或已过期");
    }
  });

  it("HTTP 500 归到 service，且不谎报错误码", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({}, { ok: false, status: 500 })));
    const result = await amapGet("/v3/geocode/geo", { address: "北京" }, "k");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("service");
      expect(result.infocode).toBeNull();
      expect(result.error).toContain("HTTP 500");
    }
  });

  it("status 是数字 1 也认（高德偶尔回非字符串）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: 1 })));
    const result = await amapGet("/v3/geocode/geo", { address: "北京" }, "k");
    expect(result.ok).toBe(true);
  });
});

describe("describeAmapError", () => {
  it("10013 归 key、40000 归 quota、20001 归 params", () => {
    expect(describeAmapError("10013").kind).toBe("key");
    expect(describeAmapError("40000").kind).toBe("quota");
    expect(describeAmapError("20001").kind).toBe("params");
  });

  it("300xx 整段族按服务失败认，不逐个列举", () => {
    const result = describeAmapError("30001", "ENGINE_RESPONSE_DATA_ERROR");
    expect(result.kind).toBe("service");
    expect(result.error).toContain("30001");
  });

  it("表外的码只回高德给的文字，不编造语义", () => {
    const result = describeAmapError("12345", "SOMETHING_ODD");
    expect(result.kind).toBe("unknown");
    expect(result.error).toBe("高德返回码 12345（SOMETHING_ODD）");
    expect(describeAmapError("12345").error).toBe("高德返回码 12345");
  });

  it("没有码的时候用 info 兜底，两者都没有也不空转", () => {
    expect(describeAmapError(null, "网关超时").error).toBe("高德返回「网关超时」");
    expect(describeAmapError("").kind).toBe("unknown");
  });
});

describe("高德空值形状", () => {
  it("空字段回的是 [] 而不是空串，取文本一律归一成空串", () => {
    expect(amapText([])).toBe("");
    expect(amapText(undefined)).toBe("");
    expect(amapText(null)).toBe("");
    expect(amapText("无锡")).toBe("无锡");
    expect(amapText(12)).toBe("12");
  });

  it("列表字段缺省与非数组都归一成空数组", () => {
    expect(amapList(undefined)).toEqual([]);
    expect(amapList({ a: 1 })).toEqual([]);
    expect(amapList([{ adcode: "320200" }])).toEqual([{ adcode: "320200" }]);
  });

  it("区级的 city 字段是 []，拼进文案不会变成 [object Object]", () => {
    const district = { name: "北京市", city: [] as unknown as string };
    expect(`${amapText(district.city)}`).toBe("");
  });

  it("对象字段用 amapObj 取：[] 不能当成空对象，数组与标量一律 undefined", () => {
    expect(amapObj({ name: "中关村" })).toEqual({ name: "中关村" });
    // 高德对缺失的对象字段回 []，直接当对象读会把「没有」误判成「有一个空对象」
    expect(amapObj([])).toBeUndefined();
    expect(amapObj("[]")).toBeUndefined();
    expect(amapObj(0)).toBeUndefined();
    expect(amapObj(null)).toBeUndefined();
    expect(amapObj(undefined)).toBeUndefined();
  });
});

describe("超时与脱敏", () => {
  it("15 秒不到回的是超时话术，归 network 且不编造错误码", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
        })),
    );

    const pending = amapGet("/v3/geocode/geo", { address: "北京" }, "k", { timeoutMs: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.infocode).toBeNull();
      expect(result.error).toContain("超时");
    }
  });

  it("底层抛出的整条 URL 里 key 换成掩码，正文不出现原文", async () => {
    const key = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        throw new Error(`connect ECONNREFUSED ${url}`);
      }),
    );

    const result = await amapGet("/v3/geocode/geo", { address: "北京" }, key);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(key);
      expect(result.error).toContain("a1b2…(32)");
    }
  });

  it("高德回的错误文字里意外带 key 也会被抹掉", async () => {
    const key = "secretkey1234567";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({
      status: "0",
      infocode: "99999",
      info: `your key ${key} is bad`,
    })));

    const result = await amapGet("/v3/geocode/geo", { address: "北京" }, key);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(key);
      expect(result.error).toContain("secr…(16)");
    }
  });
});

describe("重定向闸门", () => {
  it("第一跳 302 指向 GitHub 时请求停在这里，不跟过去", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("restapi.amap.com")) {
        return { ok: true, status: 302, headers: new Headers({ location: "https://github.com/x" }) } as unknown as Response;
      }
      throw new Error(`不该请求 ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await amapGet<{ nope?: string }>("/v3/geocode/geo", { address: "北京" }, "k");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("restapi.amap.com");
  });
});

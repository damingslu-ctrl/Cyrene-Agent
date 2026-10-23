// 高德 Key 自检的测试：只打一次 `/v3/config/district`，通过时带样本、失败时给人话，
// 返回体永不含 Key 原文。全部走 stub 的 fetch，不发真实请求。

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAmapKey } from "./key-check";

const KEY = "amapkey0123456789abcdef";

function jsonResp(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => jsonResp(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkAmapKey", () => {
  it("打最便宜的一次行政区查询，返回行政区名做样本", async () => {
    const fetchMock = stubFetch({
      status: "1",
      infocode: "10000",
      info: "OK",
      districts: [{ name: "北京市", adcode: "110000" }],
    });

    const result = await checkAmapKey(KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://restapi.amap.com/v3/config/district");
    expect(url.searchParams.get("subdistrict")).toBe("0");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(result.ok).toBe(true);
    expect(result.sample).toBe("北京市");
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("status=1 但没有行政区时也算通过，只是不带样本", async () => {
    stubFetch({ status: "1", infocode: "10000", districts: [] });

    const result = await checkAmapKey(KEY);

    expect(result).toEqual({ ok: true, latency: expect.any(Number) });
  });

  it("Key 无效时回高德的人话，且不回显 Key", async () => {
    stubFetch({ status: "0", infocode: "10001", info: "INVALID_USER_KEY" });

    const result = await checkAmapKey(KEY);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("高德 Key 不正确或已过期");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("空 Key 在发请求前就被拦下，一次网络请求都不发", async () => {
    const fetchMock = stubFetch({ status: "1" });

    const result = await checkAmapKey("   ");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("高德 Key不能为空");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("从控制台复制带全角空格的 Key 时，错误话术点明原因且不发请求", async () => {
    const fetchMock = stubFetch({ status: "1" });

    const result = await checkAmapKey("amap\u00a0key");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("非 ASCII");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("表外错误码把高德原文带出来时，Key 原文仍被掩码", async () => {
    // 10001 等表内码会丢掉 info，只有表外码才会把 info 拼进话术——用它才验得到脱敏。
    stubFetch({ status: "0", infocode: "12345", info: `bad key ${KEY}` });

    const result = await checkAmapKey(KEY);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("12345");
    expect(result.error).not.toContain(KEY);
    expect(result.error).toContain("amap…(23)");
  });
});

// plan_trip 的地理编码链路测试：geocode 命中不兜底、召回空才兜底到 v5 地点搜索、
// key/配额这类失败不兜底（第二把工具只会撞同一堵墙，白烧一次调用量）。
// 全部走 stub 的 fetch，不发真实请求。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTravelTools, setTravelConfig } from "./travel-tools";
import { toolRegistry } from "./registry/tool-registry";

registerTravelTools();

const AMAP_KEY = "travelkey0123456789abcd";

function jsonResp(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

const GEO_TIANANMEN = { status: "1", infocode: "10000", geocodes: [{ location: "116.397428,39.90923" }] };
const GEO_EMPTY = { status: "1", infocode: "10000", count: "0", geocodes: [] };
const POI_STARBUCKS = { status: "1", infocode: "10000", pois: [{ name: "星巴克(中关村店)", location: "116.481008,39.996717" }] };
const DRIVING_OK = {
  status: "1",
  route: { paths: [{ distance: "12345", duration: "1800", tolls: "0", toll_distance: "0", traffic_lights: "5" }] },
};

/** 按「地址参数命中与否」回地理编码结果，其余接口照常；返回本次跑过的全部 URL。 */
function stubAmap(options: {
  geocode: (address: string) => unknown;
  poi?: unknown;
  driving?: unknown;
}): string[] {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    if (url.pathname === "/v3/geocode/geo") return jsonResp(options.geocode(url.searchParams.get("address") ?? ""));
    if (url.pathname === "/v5/place/text") return jsonResp(options.poi ?? POI_STARBUCKS);
    if (url.pathname === "/v3/direction/driving") return jsonResp(options.driving ?? DRIVING_OK);
    return jsonResp({ status: "0", infocode: "20003", info: "UNEXPECTED_PATH" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return urls;
}

function queryOf(urls: string[], pathname: string, param: string): string | null {
  const hit = urls.find((url) => new URL(url).pathname === pathname);
  if (!hit) return null;
  return new URL(hit).searchParams.get(param);
}

const trip = () => toolRegistry.getById("plan_trip")!;

beforeEach(() => {
  setTravelConfig(() => AMAP_KEY, () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plan_trip 的地理编码兜底", () => {
  it("geocode 命中时不打地点搜索", async () => {
    const urls = stubAmap({ geocode: () => GEO_TIANANMEN });

    const output = await trip().execute({ origin: "北京市天安门", destination: "北京市故宫" });

    expect(output).toContain("🚗 驾车路线");
    expect(urls.filter((url) => url.includes("/v5/place/text"))).toHaveLength(0);
    expect(queryOf(urls, "/v3/direction/driving", "origin")).toBe("116.397428,39.90923");
  });

  it("geocode 回空列表时用地点搜索兜底，路线照旧", async () => {
    const urls = stubAmap({ geocode: (address) => (address.includes("天安门") ? GEO_TIANANMEN : GEO_EMPTY) });

    const output = await trip().execute({ origin: "星巴克(中关村店)", destination: "北京市天安门" });

    expect(output).toContain("🚗 驾车路线");
    expect(queryOf(urls, "/v5/place/text", "keywords")).toBe("星巴克(中关村店)");
    expect(queryOf(urls, "/v3/direction/driving", "origin")).toBe("116.481008,39.996717");
  });

  it("两边都要兜底时各兜一次", async () => {
    const urls = stubAmap({ geocode: () => GEO_EMPTY });

    await trip().execute({ origin: "甲店", destination: "乙店" });

    expect(urls.filter((url) => url.includes("/v5/place/text"))).toHaveLength(2);
  });

  it("key 错 / 配额满这类失败不兜底，直接把高德的原因报出来", async () => {
    const urls = stubAmap({ geocode: () => ({ status: "0", infocode: "10001", info: "INVALID_USER_KEY" }) });

    const output = await trip().execute({ origin: "甲地", destination: "乙地" });

    expect(output).toContain("高德 Key 不正确或已过期");
    expect(urls.filter((url) => url.includes("/v5/place/text"))).toHaveLength(0);
  });

  it("兜底也查不到时，文案指向 poi_search 而不是让用户瞎改地名", async () => {
    stubAmap({ geocode: () => GEO_EMPTY, poi: { status: "1", infocode: "10000", pois: [] } });

    const output = await trip().execute({ origin: "不存在的路", destination: "北京市天安门" });

    expect(output).toContain("poi_search");
    expect(output).toContain("不存在的路");
  });

  it("公交模式缺 city 时报错，且不发任何请求", async () => {
    const fetchMock = vi.fn(async () => jsonResp(DRIVING_OK));
    vi.stubGlobal("fetch", fetchMock);

    const output = await trip().execute({ origin: "A", destination: "B", mode: "公交" });

    expect(output).toContain("必须提供城市");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("出行方式打错字时在地理编码之前就挡下（不然白烧两次调用量）", async () => {
    const fetchMock = vi.fn(async () => jsonResp(DRIVING_OK));
    vi.stubGlobal("fetch", fetchMock);

    const output = await trip().execute({ origin: "A", destination: "B", mode: "电动滑板车" });

    expect(output).toContain("不支持的出行方式");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

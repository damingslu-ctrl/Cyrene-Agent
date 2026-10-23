// weather 工具的测试：Open-Meteo 分支验缓存行为（城市解析 24h + 天气结果 30 分钟），
// 高德分支验 adcode 解析 → 实况天气 → 缓存 → 失败话术。
// 全部走 stub 的 fetch，不发真实网络请求。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWeatherCaches, setWeatherConfig, weatherTool } from "./weather-tool";

// ── Open-Meteo 分支的桩 ────────────────────────────────

/** 构造 fetch Response 形状的桩 */
function makeResp(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
  } as unknown as Response;
}

/** Open-Meteo 城市解析桩数据 */
const OM_CITY = { name: "上海", latitude: 31.23, longitude: 121.47, country: "中国", admin1: "上海市" };

/** Open-Meteo 天气预报桩数据 */
const OM_FORECAST = {
  current: {
    temperature_2m: 22.5, relative_humidity_2m: 60, apparent_temperature: 21.8,
    precipitation: 0, weather_code: 1, wind_speed_10m: 12, wind_direction_10m: 135,
    surface_pressure: 1013, uv_index: 3, visibility: 10000,
  },
  daily: {
    time: ["2026-09-17"],
    temperature_2m_max: [26], temperature_2m_min: [18],
    weather_code: [1], wind_speed_10m_max: [15], wind_direction_10m_dominant: [135],
  },
};

/** 装一个记录调用次数的 Open-Meteo 双 API 桩 */
function stubOpenMeteo() {
  const fetchCalls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("geocoding-api")) return makeResp({ results: [OM_CITY] });
    return makeResp(OM_FORECAST);
  }));
  return fetchCalls;
}

// ── 高德分支的桩 ────────────────────────────────────────

const KEY = "amapkey0123456789abcdef";

function jsonResp(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>, hop: number): URL {
  return new URL(String(fetchMock.mock.calls[hop][0]));
}

const DISTRICT_OK = {
  status: "1",
  infocode: "10000",
  info: "OK",
  districts: [{ name: "无锡市", adcode: "320200", level: "city" }],
};

const WEATHER_OK = {
  status: "1",
  infocode: "10000",
  info: "OK",
  lives: [{
    province: "江苏",
    city: "无锡市",
    weather: "晴",
    temperature: "26",
    winddirection: "东南",
    windpower: "3",
    humidity: "58",
    reporttime: "2026-10-23 08:00:00",
  }],
};

function configure(source: string, key = KEY): void {
  setWeatherConfig(() => "无锡", () => source, () => key, () => true);
}

beforeEach(() => {
  clearWeatherCaches();
  // 默认走 Open-Meteo；高德分支的用例在用例体内显式改配置。
  setWeatherConfig(() => "上海", () => "open-meteo", () => "", () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearWeatherCaches();
});

describe("weather 结果缓存", () => {
  it("同城市两次：解析 + 预报各只请求一次，第二次返回 cached 标注", async () => {
    const fetchCalls = stubOpenMeteo();

    const first = JSON.parse(await weatherTool.execute({ city: "上海" })) as Record<string, unknown>;
    expect(first.cached).toBeUndefined();

    const second = JSON.parse(await weatherTool.execute({ city: "上海" })) as Record<string, unknown>;
    expect(fetchCalls).toHaveLength(2); // geocoding 1 次 + forecast 1 次，没有新请求
    expect(second.cached).toBe(true);
    expect(typeof second.cachedAt).toBe("string");
  });

  it("不同城市各自请求", async () => {
    const fetchCalls = stubOpenMeteo();

    await weatherTool.execute({ city: "上海" });
    await weatherTool.execute({ city: "北京" });
    expect(fetchCalls).toHaveLength(4);
  });

  it("天气结果过期后重查，但城市解析 24h 内仍命中缓存", async () => {
    vi.useFakeTimers();
    const fetchCalls = stubOpenMeteo();

    await weatherTool.execute({ city: "上海" });
    expect(fetchCalls).toHaveLength(2);

    // 过 31 分钟：天气缓存过期，但城市解析缓存（24h）仍在
    vi.advanceTimersByTime(31 * 60_000);
    const second = JSON.parse(await weatherTool.execute({ city: "上海" })) as Record<string, unknown>;

    // 只重新请求了 forecast，没有再打 geocoding
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[2]).toContain("api.open-meteo.com/v1/forecast");
    expect(second.cached).toBeUndefined();
  });
});

describe("weather 工具的高德分支", () => {
  it("先解析 adcode 再查实况，两次请求都带同一个 Key", async () => {
    configure("amap");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp(DISTRICT_OK))
      .mockResolvedValueOnce(jsonResp(WEATHER_OK));
    vi.stubGlobal("fetch", fetchMock);

    const output = JSON.parse(await weatherTool.execute({ city: "无锡" })) as Record<string, unknown>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock, 0).pathname).toBe("/v3/config/district");
    expect(urlOf(fetchMock, 0).searchParams.get("keywords")).toBe("无锡");
    expect(urlOf(fetchMock, 1).pathname).toBe("/v3/weather/weatherInfo");
    expect(urlOf(fetchMock, 1).searchParams.get("city")).toBe("320200");
    expect(urlOf(fetchMock, 1).searchParams.get("extensions")).toBe("base");
    expect(urlOf(fetchMock, 1).searchParams.get("key")).toBe(KEY);

    expect(output).toMatchObject({
      city: "无锡市",
      region: "江苏",
      weather: "晴",
      temperature: 26,
      humidity: 58,
      windDirection: "东南",
      windSpeed: "3级",
      source: "高德天气",
    });
    expect(output.updateTime).toBe("08:00");
    expect(JSON.stringify(output)).not.toContain(KEY);
  });

  it("30 分钟内再问同城：命中缓存，不发新请求且标注 cached", async () => {
    configure("amap");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp(DISTRICT_OK))
      .mockResolvedValueOnce(jsonResp(WEATHER_OK));
    vi.stubGlobal("fetch", fetchMock);

    await weatherTool.execute({ city: "无锡" });
    const second = JSON.parse(await weatherTool.execute({ city: "无锡" })) as Record<string, unknown>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(true);
    expect(typeof second.cachedAt).toBe("string");
  });

  it("行政区查不到：说清是城市名对不上，且不去查天气", async () => {
    configure("amap");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      status: "1", infocode: "10000", districts: [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "没有这个城市" });

    expect(output).toContain("找不到城市");
    expect(output).toContain("高德查不到");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Key 无效：把高德的人话透出来，且不回显 Key", async () => {
    configure("amap");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      status: "0", infocode: "10001", info: "INVALID_USER_KEY",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "无锡" });

    expect(output).toContain("高德 Key 不正确或已过期");
    expect(output).not.toContain(KEY);
  });

  it("实况列表为空：明确报「没有返回该城市的实况」", async () => {
    configure("amap");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp(DISTRICT_OK))
      .mockResolvedValueOnce(jsonResp({ status: "1", infocode: "10000", lives: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "无锡" });

    expect(output).toContain("没有返回该城市的实况");
  });

  it("没填 Key：给出可操作的提示，一次请求都不发", async () => {
    configure("amap", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "无锡" });

    expect(output).toContain("还没有配置高德天气 Key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未知天气源：点名配置里选错了，不发请求", async () => {
    configure("qweather");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "无锡" });

    expect(output).toContain("未知的天气源");
    expect(output).toContain("qweather");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("天气功能关闭时直接拒绝，不读城市也不发请求", async () => {
    setWeatherConfig(() => "无锡", () => "amap", () => KEY, () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const output = await weatherTool.execute({ city: "无锡" });

    expect(output).toContain("天气查询功能未启用");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

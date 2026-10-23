// 高德地点两把工具的契约测试：poi_search（v5 关键字/周边）与 reverse_geocode（v3 regeo）。
// 全部走 stub 的 fetch，不发真实请求。
//
// 钉住的都是文档里写明、且回归时最容易悄悄改掉的东西：
//   - 参数名（v5 用 region + city_limit，不是 v3 的 city）；
//   - city_limit=true 查空后必须去掉限定重试（用户写「上海」而不是「上海市」时的唯一出路）；
//   - 逆地理的包装键是 `regeocode`（小写 c），写成 regeoCode/RegeoCode 会静默读成「解析不出地址」；
//   - 高德对「字段不存在」回 []，文案里不能漏出 undefined / [object Object] / []。

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAmapLocation,
  registerAmapPlaceTools,
  setAmapPlaceConfig,
  findPoiLocation,
} from "./amap-place-tools";
import { toolRegistry } from "./registry/tool-registry";

registerAmapPlaceTools();

const AMAP_KEY = "amapkey0123456789abcdef";

function jsonResp(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response;
}

function fetchUrl(fetchMock: ReturnType<typeof vi.fn>, hop = 0): string {
  return String(fetchMock.mock.calls[hop][0]);
}

function params(fetchMock: ReturnType<typeof vi.fn>, hop = 0): URLSearchParams {
  return new URL(fetchUrl(fetchMock, hop)).searchParams;
}

/** 文档里那条「省直辖县/直辖市的 city 回空数组」的真实形状，第二条 POI 的 cityname 与 business 都是 []。 */
const POI_TEXT_OK = {
  status: "1",
  infocode: "10000",
  info: "OK",
  count: "2",
  pois: [
    {
      name: "星巴克(中关村店)",
      type: "餐饮服务;咖啡厅;咖啡厅",
      location: "116.481008,39.996717",
      address: "中关村大街19号1层",
      pname: "北京市",
      cityname: "北京市",
      adname: "海淀区",
      distance: [],
      business: {
        tel: "010-62512345",
        rating: "4.6",
        cost: "38",
        business_area: "中关村",
        opentime_week: "周一至周五:07:00-22:00",
      },
    },
    {
      name: "Manner 咖啡",
      type: "餐饮服务;咖啡厅",
      location: "116.473000,39.993000",
      address: "海淀黄庄路2号",
      pname: "北京市",
      cityname: [],
      adname: "海淀区",
      distance: "860.4",
      business: [],
    },
  ],
};

/** 注意：高德这份文档的字段表里根本没写 formatted_address，所以两条路都要能走。 */
const REGEO_OK = {
  status: "1",
  infocode: "10000",
  info: "OK",
  regeocode: {
    addressComponent: {
      country: "中国",
      province: "北京市",
      city: [],
      citycode: "010",
      district: "海淀区",
      adcode: "110108",
      township: "燕园街道",
      neighborhood: { name: "北京大学", type: "科教文化服务;学校;高等院校" },
      building: [],
      streetNumber: { street: "中关村北大街", number: "5号", location: "116.312000,39.999000", direction: [], distance: "12" },
      businessAreas: [{ name: "中关村", location: "116.314000,39.983000", id: "110108" }],
      pois: [
        { name: "未名湖", distance: "300", type: [], tel: [], address: [] },
        { name: "博雅塔", distance: "612.4", type: "风景名胜" },
      ],
      roads: [],
      roadinters: [],
      aois: [],
      seaArea: [],
    },
  },
};

const poi = () => toolRegistry.getById("poi_search")!;
const regeo = () => toolRegistry.getById("reverse_geocode")!;

beforeEach(() => {
  setAmapPlaceConfig(() => AMAP_KEY, () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("poi_search 闸门与入参校验", () => {
  it("开关关掉时拒绝执行，且一次请求都不发", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);
    setAmapPlaceConfig(() => AMAP_KEY, () => false);

    expect(await poi().execute({ keywords: "咖啡" })).toContain("地点查询未启用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("没配 key 时给出配置指引，且不发请求", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);
    setAmapPlaceConfig(() => "", () => true);

    expect(await poi().execute({ keywords: "咖啡" })).toContain("高德 API Key 未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("关键词超过 80 字符直接挡下（高德只接受一个关键字且限长 80）", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    expect(await poi().execute({ keywords: "咖".repeat(81) })).toContain("不得超过 80 字符");
    expect(fetchMock).not.toHaveBeenCalled();

    // 正对照：80 字符整必须放行，否则上面的断言只是「恒拒绝」。
    await poi().execute({ keywords: "咖".repeat(80) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("缺 keywords 时挡下", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    expect(await poi().execute({})).toContain("keywords");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("文本搜索打 /v5/place/text，region+city_limit+show_fields+page_size 全部就位", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    await poi().execute({ keywords: "咖啡", city: "北京市", limit: 8 });

    const url = new URL(fetchUrl(fetchMock));
    expect(url.pathname).toBe("/v5/place/text");
    const q = url.searchParams;
    expect(q.get("keywords")).toBe("咖啡");
    expect(q.get("region")).toBe("北京市");
    expect(q.get("city_limit")).toBe("true");
    expect(q.get("show_fields")).toBe("business");
    expect(q.get("page_size")).toBe("8");
    expect(q.get("radius")).toBeNull();
  });

  it("limit 越界夹进 1-25（文档写死 page_size 取值范围）", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    await poi().execute({ keywords: "咖啡", limit: 999 });
    expect(params(fetchMock).get("page_size")).toBe("25");

    await poi().execute({ keywords: "咖啡", limit: 0 });
    expect(params(fetchMock, 1).get("page_size")).toBe("1");

    await poi().execute({ keywords: "咖啡" });
    expect(params(fetchMock, 2).get("page_size")).toBe("5");
  });

  it("传了 location 就换成周边搜索，带 radius 且不再带 city_limit", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    await poi().execute({ keywords: "咖啡", location: "116.481008,39.996717", radius: 2000, city: "北京市" });

    const q = params(fetchMock);
    expect(new URL(fetchUrl(fetchMock)).pathname).toBe("/v5/place/around");
    expect(q.get("location")).toBe("116.481008,39.996717");
    expect(q.get("radius")).toBe("2000");
    expect(q.get("city_limit")).toBeNull();
    expect(q.get("region")).toBeNull();
  });

  it("location 写法不对时挡下，并给出正确形状", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    expect(await poi().execute({ keywords: "咖啡", location: "39.99,116.48 号" })).toContain("经度在前");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("poi_search 城市限定重试", () => {
  it("city_limit 召回为空时去掉限定重试一次", async () => {
    const fetchMock = vi.fn(async (input: unknown) =>
      String(input).includes("city_limit=true") ? jsonResp({ status: "1", infocode: "10000", pois: [] }) : jsonResp(POI_TEXT_OK),
    );
    vi.stubGlobal("fetch", fetchMock);

    const output = await poi().execute({ keywords: "咖啡", city: "上海" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(params(fetchMock, 0).get("city_limit")).toBe("true");
    expect(params(fetchMock, 1).get("city_limit")).toBeNull();
    expect(params(fetchMock, 1).get("region")).toBe("上海");
    expect(output).toContain("星巴克(中关村店)");
  });

  it("两轮都空时报「查无」，并带上用户给的城市名", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1", infocode: "10000", count: "0", pois: [] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await poi().execute({ keywords: "不存在的店", city: "无锡市" })).toContain("[查无]");
    expect(await poi().execute({ keywords: "不存在的店", city: "无锡市" })).toContain("无锡市");
  });

  it("周边搜索查空不做去限定重试（那里没有城市限定可去）", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ status: "1", infocode: "10000", count: "0", pois: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await poi().execute({ keywords: "咖啡", location: "116.48,39.99" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("poi_search 结果渲染", () => {
  it("带出名称/地址/坐标与商业字段", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(POI_TEXT_OK)));

    const output = await poi().execute({ keywords: "咖啡" });

    expect(output).toContain("1. 星巴克(中关村店)");
    expect(output).toContain("北京市海淀区中关村大街19号1层（中关村）");
    expect(output).toContain("评分 4.6");
    expect(output).toContain("人均 38 元");
    expect(output).toContain("电话：010-62512345");
    expect(output).toContain("营业：周一至周五:07:00-22:00");
    expect(output).toContain("坐标：116.481008,39.996717");
  });

  it("cityname/business 回 [] 时不留残渣，距离照四舍五入", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(POI_TEXT_OK)));

    const output = await poi().execute({ keywords: "咖啡" });

    expect(output).not.toMatch(/undefined|\[object Object]/);
    expect(output).toContain("2. Manner 咖啡｜距 860 米");
    expect(output).toContain("北京市海淀区海淀黄庄路2号");
  });

  it("高德的错误码翻译要一路透到用户看得见的文案里", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "0", infocode: "10001", info: "INVALID_USER_KEY" })));

    expect(await poi().execute({ keywords: "咖啡" })).toContain("高德 Key 不正确或已过期");
  });

  it("高德把 key 回显在 info 里时，输出只剩掩码", async () => {
    // 用表外的码：表内的码走的是固定文案，info 根本进不了输出，那样这条锁是空的。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ status: "0", infocode: "12345", info: `key ${AMAP_KEY} 参数不合法` })),
    );

    const output = await poi().execute({ keywords: "咖啡" });
    expect(output).not.toContain(AMAP_KEY);
    expect(output).toContain("amap…(23)");
  });
});

describe("reverse_geocode", () => {
  it("经纬度拼成 location，打 /v3/geocode/regeo 且 extensions=all", async () => {
    const fetchMock = vi.fn(async () => jsonResp(REGEO_OK));
    vi.stubGlobal("fetch", fetchMock);

    await regeo().execute({ longitude: 116.397428, latitude: 39.90923 });

    const url = new URL(fetchUrl(fetchMock));
    expect(url.pathname).toBe("/v3/geocode/regeo");
    expect(url.searchParams.get("location")).toBe("116.397428,39.90923");
    expect(url.searchParams.get("extensions")).toBe("all");
    expect(url.searchParams.get("radius")).toBe("1000");
  });

  it("小数超过 6 位要截断（高德文档：小数点后不要超过 6 位）", async () => {
    const fetchMock = vi.fn(async () => jsonResp(REGEO_OK));
    vi.stubGlobal("fetch", fetchMock);

    await regeo().execute({ longitude: 116.3974281234, latitude: 39.90923 });
    expect(params(fetchMock).get("location")).toBe("116.397428,39.90923");
  });

  it("radius 上限按文档的 3000 夹住", async () => {
    const fetchMock = vi.fn(async () => jsonResp(REGEO_OK));
    vi.stubGlobal("fetch", fetchMock);

    await regeo().execute({ location: "116.397428,39.90923", radius: 99999 });
    expect(params(fetchMock).get("radius")).toBe("3000");
  });

  it("缺 longitude/latitude 时挡下且不发请求", async () => {
    const fetchMock = vi.fn(async () => jsonResp(REGEO_OK));
    vi.stubGlobal("fetch", fetchMock);

    expect(await regeo().execute({ longitude: 116.4 })).toContain("longitude");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("文档字段表里没有 formatted_address，缺失时按 addressComponent 自己拼", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(REGEO_OK)));

    const output = await regeo().execute({ location: "116.312,39.999" });

    expect(output).toContain("地址：北京市海淀区燕园街道中关村北大街5号北京大学");
    expect(output).toContain("行政区代码 110108");
    expect(output).toContain("城市编码 010");
    expect(output).toContain("商圈：中关村");
    expect(output).toContain("附近：未名湖（距 300 米）、博雅塔（距 612 米）");
    expect(output).not.toMatch(/undefined|\[object Object]|（）/);
  });

  it("高德给了 formatted_address 就直接用它，不再自己拼", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ status: "1", regeocode: { formatted_address: "北京市海淀区中关村北大街", addressComponent: REGEO_OK.regeocode.addressComponent } })),
    );

    const output = await regeo().execute({ location: "116.312,39.999" });
    expect(output).toContain("地址：北京市海淀区中关村北大街");
  });

  it("addressComponent 全空时承认解析不出，而不是回一行空地址", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "1", regeocode: { addressComponent: {} } })));

    expect(await regeo().execute({ location: "116.312,39.999" })).toContain("解析不出地址");
  });

  it("regeocode 键缺失（写成别的拼法就会走到这里）时报错而不是静默空文案", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "1" })));

    expect(await regeo().execute({ location: "116.312,39.999" })).toContain("没有解析这个坐标");
  });
});

describe("normalizeAmapLocation", () => {
  it("经度在前、纬度在后，多余小数截到 6 位", () => {
    expect(normalizeAmapLocation("116.4810084, 39.9967172 ")).toBe("116.481008,39.996717");
  });

  it("形状/数值/范围任一不对都回 null", () => {
    expect(normalizeAmapLocation("116.48")).toBeNull();
    expect(normalizeAmapLocation("a,b")).toBeNull();
    expect(normalizeAmapLocation("200,10")).toBeNull();
    expect(normalizeAmapLocation("116.48,95")).toBeNull();
  });
});

describe("findPoiLocation（plan_trip 的地理编码兜底）", () => {
  it("返回第一个带坐标的结果", async () => {
    const fetchMock = vi.fn(async () => jsonResp(POI_TEXT_OK));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findPoiLocation("星巴克(中关村店)", AMAP_KEY)).resolves.toEqual({
      ok: true,
      data: "116.481008,39.996717",
    });
    expect(new URL(fetchUrl(fetchMock)).pathname).toBe("/v5/place/text");
  });

  it("结果为空时报清楚，而不是回一个空字符串坐标", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp({ status: "1", pois: [] })));

    const result = await findPoiLocation("不存在的店", AMAP_KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不存在的店");
  });

  it("坐标字段回 [] 的条目要跳过，取后面带坐标的", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ status: "1", pois: [{ name: "无坐标", location: [] }, { name: "有坐标", location: "116.5,39.9" }] })),
    );

    await expect(findPoiLocation("咖啡", AMAP_KEY)).resolves.toEqual({ ok: true, data: "116.5,39.9" });
  });
});

describe("注册契约", () => {
  it("poi_search 与 reverse_geocode 相邻注册，模型可见字段固定", () => {
    const ids = toolRegistry.getAllTools().map((tool) => tool.id);
    const poiIndex = ids.indexOf("poi_search");
    const regeoIndex = ids.indexOf("reverse_geocode");

    expect(poiIndex).toBeGreaterThanOrEqual(0);
    expect(regeoIndex).toBe(poiIndex + 1);
    for (const id of ["poi_search", "reverse_geocode"]) {
      expect(toolRegistry.getById(id), `工具 ${id} 应已注册`).toMatchObject({
        enabled: true,
        effectKind: "read",
        risk: "network",
        modes: ["work"],
      });
    }
  });

  it("与 plan_trip 共用 travelEnabled：三把工具在同一个开关下启停", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/main/orchestrator/tools/registry/tool-registration.ts"),
      "utf8",
    );
    for (const id of ["plan_trip", "poi_search", "reverse_geocode"]) {
      expect(source, `${id} 必须跟随 travelEnabled`).toContain(
        `setEnabled("${id}", settings.travelEnabled)`,
      );
    }
    expect(source).toContain("registerAmapPlaceTools();");
  });
});

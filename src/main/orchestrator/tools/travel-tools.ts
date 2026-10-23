// 🚗 出行工具 —— 路线规划（驾车/步行/骑行/公交）。
//
// 设计原则：
// - 复用 GeneralSettings 中已有的 amapKey（高德 Web 服务 API Key）
// - 用高德地理编码将地名转坐标，再调用路径规划 API
// - 返回易读的中文路线描述
// - 出网一律走 amap/client：key 编码、重定向闸门、错误码翻译都在那一层收口

import { toolRegistry } from "./registry/tool-registry";
import { logger, LogTag } from "../../logger";
import { amapGet, amapList, amapText, type AmapResult } from "../../amap/client";
import { findPoiLocation } from "./amap-place-tools";

const LOG_PREFIX = "[TravelTools]";

// ══════════════════════════════════════════════════════════
// 配置注入
// ══════════════════════════════════════════════════════════

let amapKeyGetter: (() => string) | null = null;
let travelEnabledGetter: (() => boolean) | null = null;

/** index.ts 启动时注入 amapKey 获取器。 */
export function setTravelConfig(amapKeyFn: () => string, enabledFn?: () => boolean): void {
  amapKeyGetter = amapKeyFn;
  travelEnabledGetter = enabledFn ?? null;
}

// ══════════════════════════════════════════════════════════
// 高德地理编码：地名 → "经度,纬度"
// ══════════════════════════════════════════════════════════

interface GeoPayload { geocodes?: unknown }

/**
 * 地名 → "经度,纬度"。
 * 失败时把高德给的原因一起带回：以前一律回 null，调用方只能说「地名不够具体」，
 * key 填错的用户被指着去改地名，改十轮也修不好。
 *
 * geocode 自己回成功但列表为空时，再让地点搜索试一次：门店名（「星巴克(中关村店)」）
 * 在地理编码里恒回空，地点搜索才认——兜底省掉的是用户根本无从下手的「换成更具体的地名」。
 * key 错/配额用完这类失败不兜底：第二把工具只会撞同一堵墙，白烧一次调用量。
 */
async function geocode(address: string, key: string): Promise<AmapResult<string>> {
  const result = await amapGet<GeoPayload>("/v3/geocode/geo", { address, output: "JSON" }, key);
  if (!result.ok) return result;
  const location = amapText(amapList<{ location?: unknown }>(result.data.geocodes)[0]?.location);
  if (location) return { ok: true, data: location }; // 格式 "116.397428,39.90923"

  const fallback = await findPoiLocation(address, key);
  if (fallback.ok) return fallback;
  return { ok: false, kind: "params", infocode: null, error: `高德查不到「${address}」的坐标，可先用 poi_search 按门店名搜到坐标再规划路线` };
}

// ══════════════════════════════════════════════════════════
// 各出行方式 API 封装
// ══════════════════════════════════════════════════════════

interface DrivingPath { distance: string; duration: string; tolls: string; toll_distance: string; traffic_lights: string }
interface ShortPath { distance: string; duration: string }
// driving/walking 把路线放在 route.paths，v4 的 bicycling 放在 data.paths。
interface RoutePathsPayload { route?: { paths?: unknown } }
interface DataPathsPayload { data?: { paths?: unknown } }

/** 驾车路径规划。 */
async function planDriving(origin: string, destination: string, key: string): Promise<string> {
  const result = await amapGet<RoutePathsPayload>(
    "/v3/direction/driving",
    { origin, destination, extensions: "base", strategy: 0 },
    key,
  );
  if (!result.ok) return `[错误] 驾车路线查询失败：${result.error}`;
  const path = amapList<DrivingPath>(result.data.route?.paths)[0];
  if (!path) return "[错误] 未找到驾车路线";
  const distKm = (Number(path.distance) / 1000).toFixed(1);
  const durMin = Math.round(Number(path.duration) / 60);
  const toll = Number(path.tolls);
  const lines = [
    `🚗 驾车路线`,
    `距离：${distKm} 公里`,
    `预计用时：${durMin} 分钟`,
    toll > 0 ? `路费：${toll.toFixed(0)} 元` : `路费：免费`,
    `红绿灯：${path.traffic_lights || 0} 个`,
  ];
  return lines.join("\n");
}

/** 步行路径规划（最长 100km）。 */
async function planWalking(origin: string, destination: string, key: string): Promise<string> {
  const result = await amapGet<RoutePathsPayload>("/v3/direction/walking", { origin, destination }, key);
  if (!result.ok) return `[错误] 步行路线查询失败：${result.error}`;
  const path = amapList<ShortPath>(result.data.route?.paths)[0];
  if (!path) return "[错误] 未找到步行路线";
  const distM = Number(path.distance);
  const durMin = Math.round(Number(path.duration) / 60);
  const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} 公里` : `${distM.toFixed(0)} 米`;
  return [
    `🚶 步行路线`,
    `距离：${distStr}`,
    `预计用时：${durMin} 分钟`,
  ].join("\n");
}

/** 骑行路径规划（最长 500km）——v4 接口，回的是 errcode 而不是 status。 */
async function planCycling(origin: string, destination: string, key: string): Promise<string> {
  const result = await amapGet<DataPathsPayload>("/v4/direction/bicycling", { origin, destination }, key);
  if (!result.ok) return `[错误] 骑行路线查询失败：${result.error}`;
  const path = amapList<ShortPath>(result.data.data?.paths)[0];
  if (!path) return "[错误] 未找到骑行路线";
  const distKm = (Number(path.distance) / 1000).toFixed(1);
  const durMin = Math.round(Number(path.duration) / 60);
  return [
    `🚲 骑行路线`,
    `距离：${distKm} 公里`,
    `预计用时：${durMin} 分钟`,
  ].join("\n");
}

interface TransitBusline { name?: unknown; depart_stop?: { name?: unknown }; arrival_stop?: { name?: unknown } }
interface TransitSegment { walking?: { distance?: unknown }; bus?: { buslines?: unknown } }
interface TransitItem { cost?: unknown; duration?: unknown; walking_distance?: unknown; segments?: unknown }
interface TransitPayload { route?: { transits?: unknown; taxi_cost?: unknown } }

/** 公交路径规划（支持公交/地铁/火车综合换乘）。 */
async function planTransit(
  origin: string,
  destination: string,
  city: string,
  key: string,
): Promise<string> {
  const result = await amapGet<TransitPayload>(
    "/v3/direction/transit/integrated",
    { origin, destination, city, strategy: 0, extensions: "base" },
    key,
  );
  if (!result.ok) return `[错误] 公交路线查询失败：${result.error}`;
  const transit = amapList<TransitItem>(result.data.route?.transits)[0];
  if (!transit) return "[错误] 未找到公交路线";
  const durMin = Math.round(Number(amapText(transit.duration)) / 60);
  const price = Number(amapText(transit.cost)).toFixed(0);
  const walkDist = Number(amapText(transit.walking_distance));
  const walkStr = walkDist > 0 ? `（步行 ${walkDist.toFixed(0)} 米）` : "";
  const taxiCost = amapText(result.data.route?.taxi_cost);

  // 提取换乘方案简述：高德对没走的路段落回 []，取字段一律过 amapText
  const steps = amapList<TransitSegment>(transit.segments).flatMap((seg, i) => {
    const bus = amapList<TransitBusline>(seg.bus?.buslines)[0];
    if (bus) {
      return [`  ${i + 1}. 乘 ${amapText(bus.name)}：${amapText(bus.depart_stop?.name)} → ${amapText(bus.arrival_stop?.name)}`];
    }
    const walk = amapText(seg.walking?.distance);
    return walk ? [`  ${i + 1}. 步行 ${Number(walk).toFixed(0)} 米`] : [];
  });

  const lines = [
    `🚌 公交路线`,
    `预计用时：${durMin} 分钟`,
    `票价：${price} 元${walkStr}`,
    taxiCost ? `打车参考价：${taxiCost} 元` : "",
    ...(steps.length ? [`换乘方案：`, ...steps] : []),
  ].filter(Boolean);

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════
// 工具入口
// ══════════════════════════════════════════════════════════

// 先把口语别名收成枚举：校验必须在地理编码【之前】做完。
// 排在后面会白烧两次高德调用量——公交缺 city、方式打错字这两类请求根本走不到路线规划，
// 却已经把起终点的地理编码花掉了。
type TripMode = "driving" | "walking" | "cycling" | "transit";

const MODE_ALIASES: Record<string, TripMode> = {
  驾车: "driving",
  开车: "driving",
  步行: "walking",
  走路: "walking",
  骑行: "cycling",
  骑车: "cycling",
  自行车: "cycling",
  公交: "transit",
  公共交通: "transit",
  地铁: "transit",
  公交地铁: "transit",
};

async function executePlanTrip(args: Record<string, unknown>): Promise<string> {
  if (travelEnabledGetter && !travelEnabledGetter()) {
    return "[错误] 出行工具未启用，请在设置里开启";
  }

  const amapKey = amapKeyGetter?.() ?? "";
  if (!amapKey) {
    return "[提示] 高德 API Key 未配置。可在 设置→插件 中找到 🚗出行工具，填入高德 Web 服务 API Key（注册地址：https://lbs.amap.com）。";
  }

  const origin = String(args.origin ?? "").trim();
  const destination = String(args.destination ?? "").trim();
  if (!origin || !destination) {
    return "[错误] 请提供起点和终点";
  }

  const mode = String(args.mode ?? "驾车").trim();
  const tripMode = MODE_ALIASES[mode];
  if (!tripMode) {
    return `[错误] 不支持的出行方式「${mode}」。支持：驾车、步行、骑行、公交`;
  }
  const city = String(args.city ?? "").trim();
  if (tripMode === "transit" && !city) {
    return "[错误] 公交路线必须提供城市（参数 city），例如 city='北京'";
  }

  // 地理编码：地名 → 坐标
  const [origLoc, destLoc] = await Promise.all([
    geocode(origin, amapKey),
    geocode(destination, amapKey),
  ]);
  if (!origLoc.ok) return `[错误] ${origLoc.error}`;
  if (!destLoc.ok) return `[错误] ${destLoc.error}`;

  console.log(LOG_PREFIX, `规划路线：「${origin}」→「${destination}」, 方式=${mode}`);

  switch (tripMode) {
    case "driving":
      return planDriving(origLoc.data, destLoc.data, amapKey);
    case "walking":
      return planWalking(origLoc.data, destLoc.data, amapKey);
    case "cycling":
      return planCycling(origLoc.data, destLoc.data, amapKey);
    case "transit":
      return planTransit(origLoc.data, destLoc.data, city, amapKey);
  }
}

// ══════════════════════════════════════════════════════════
// 注册
// ══════════════════════════════════════════════════════════

/** 注册出行工具。index.ts startup 调一次。 */
export function registerTravelTools(): void {
  toolRegistry.register({
    id: "plan_trip",
    name: "🚗出行工具",
    description:
      "路线规划，查驾车/步行/骑行/公交的路线、距离和预计时间。\n\n" +
      "何时用：\n" +
      "- 用户问「从 A 到 B 怎么走」「去 X 怎么坐车」「到 Y 多远」\n" +
      "- 用户想知道驾车/公交/骑行/步行的路线和耗时\n" +
      "- 用户问「打车要多少钱」「骑自行车去 X 多久」\n\n" +
      "不要用于：\n" +
      "- 查天气（用 weather 工具）\n" +
      "- 查具体公交线路信息或时刻表（不支持）\n" +
      "- 查路况（不支持）\n\n" +
      "参数：\n" +
      "- origin（必填）：起点，如「故宫」「北京市天安门」\n" +
      "- destination（必填）：终点\n" +
      "- mode（可选，默认驾车）：出行方式——驾车/开车、步行/走路、骑行/骑车/自行车、公交/公共交通/地铁\n" +
      "- city（公交必填）：城市名，如「北京」「上海」。仅公交模式需要",
    enabled: true,
    effectKind: "read",
    risk: "network",
    modes: ["work"],
    inputSchema: {
      type: "object",
      properties: {
        origin:       { type: "string", description: "起点，如「故宫」「北京市天安门」" },
        destination:  { type: "string", description: "终点" },
        mode:         { type: "string", description: "出行方式：驾车/开车、步行/走路、骑行/骑车/自行车、公交/公共交通/地铁（默认驾车）" },
        city:         { type: "string", description: "城市名，如「北京」「上海」，公交模式必填" },
      },
      required: ["origin", "destination"],
    },
    execute: executePlanTrip,
  });

  logger.info(LogTag.TravelTools, "registered: plan_trip");
}

// 📍 高德地点工具 —— POI 搜索（关键字/周边）+ 逆地理编码（坐标→地址）。
//
// 这一层补的是 plan_trip 前面的洞：地理编码只认「行政区＋知名地名」，用户说
// 「中关村附近好吃的川菜」这种召回不到的短语，整条链路断在第一跳，而断的表象和
// 「key 没填对」长得一模一样。v5 地点搜索是高德专门吃关键字的接口，顺手也给
// geocode 当兜底（findPoiLocation）。
//
// 出网一律走 amap/client：key 编码、逐跳重定向闸门、错误码翻译、脱敏都在那一层收口。
//
// 契约出处（逐条从官方文档抄，不是凭印象）：
//   /v5/place/text、/v5/place/around —— lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch
//   /v3/geocode/regeo                —— lbs.amap.com/api/webservice/guide/api/georegeo
// 文档里写死的四条规则，代码照着防：
//   1) keywords 只支持一个关键字，文本总长度 ≤80 字符；
//   2) region 只认 citycode / adcode / 市级 cityname（如「北京市」），且不配 city_limit 时
//      只是「加权召回」不是「限定召回」——所以 city_limit=true 查空时要去掉限定重试一次，
//      否则用户写「上海」而不是「上海市」就永远一片空白；
//   3) page_size 取值 1-25（默认 10）；
//   4) regeo 的 radius 取值 0-3000（默认 1000），pois/roads/商圈 只在 extensions=all 时返回。
// 另外高德对「字段不存在」回的是 [] 而不是 ""（北京/上海/天津/重庆四个直辖市的
// addressComponent.city 恒为 []），所以取字段一律过 amapText / amapList / amapObj。

import { toolRegistry } from "./registry/tool-registry";
import { logger, LogTag } from "../../logger";
import { amapGet, amapList, amapObj, amapText, type AmapResult } from "../../amap/client";

const POI_KEYWORDS_MAX = 80;
const POI_PAGE_SIZE_MAX = 25;
const POI_PAGE_SIZE_DEFAULT = 5;
/** regeo 的 radius 上限，文档写的是 0~3000。 */
const REGEO_RADIUS_MAX = 3000;
const REGEO_RADIUS_DEFAULT = 1000;
/** 周边搜索的 radius 文档取值 0-50000、缺省 5000；「附近」在桌面上是按腿走的距离，钉在 1000。 */
const AROUND_RADIUS_MAX = 50000;
const AROUND_RADIUS_DEFAULT = 1000;

// ══════════════════════════════════════════════════════════
// 配置注入（与 plan_trip 共用 amapKey 和 travelEnabled）
// ══════════════════════════════════════════════════════════

let amapKeyGetter: (() => string) | null = null;
let placeEnabledGetter: (() => boolean) | null = null;

/** 启动时注入高德 Key 与开关读取器；不注入时按「未启用」处理，不静默发请求。 */
export function setAmapPlaceConfig(amapKeyFn: () => string, enabledFn?: () => boolean): void {
  amapKeyGetter = amapKeyFn;
  placeEnabledGetter = enabledFn ?? null;
}

type Gate = { key: string } | { blocked: string };

function gatePlaceTool(): Gate {
  if (placeEnabledGetter && !placeEnabledGetter()) {
    return { blocked: "[错误] 地点查询未启用，请在 设置→插件 打开「出行工具」（两把工具共用开关与高德 Key）" };
  }
  const key = amapKeyGetter?.() ?? "";
  if (!key) {
    return { blocked: "[提示] 高德 API Key 未配置。可在 设置→插件 找到 🚗出行工具，填入高德 Web 服务 API Key（注册地址：https://lbs.amap.com）。" };
  }
  return { key };
}

// ══════════════════════════════════════════════════════════
// 入参归一
// ══════════════════════════════════════════════════════════

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 「116.481008,39.996717」→ 归一后的同形状字符串；不合法回 null。
 * 高德文档要求经度在前、小数点后不超过 6 位，模型常常给到 8 位，这里替它截断。
 */
export function normalizeAmapLocation(raw: string): string | null {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lng = Number(parts[0].trim());
  const lat = Number(parts[1].trim());
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return `${truncate(lng)},${truncate(lat)}`;
}

function truncate(n: number): string {
  return String(Number(n.toFixed(6)));
}

// ══════════════════════════════════════════════════════════
// v5 地点搜索
// ══════════════════════════════════════════════════════════

/** 基础信息类字段始终返回；business 下的字段要靠 show_fields=business。 */
interface Poi {
  name?: unknown;
  address?: unknown;
  location?: unknown;
  type?: unknown;
  distance?: unknown;
  pname?: unknown;
  cityname?: unknown;
  adname?: unknown;
  business?: Record<string, unknown>;
}

interface PlacePayload {
  count?: unknown;
  pois?: unknown;
}

interface PoiQuery {
  keywords?: string;
  /** 「经度,纬度」——有值即走 /v5/place/around 周边搜索。 */
  location?: string;
  radius?: number;
  region?: string;
  /** 只有文本搜索带 region 时才有意义：true = city_limit 严格限定在区内。 */
  limitRegion?: boolean;
  pageSize: number;
}

async function queryPois(query: PoiQuery, key: string): Promise<AmapResult<Poi[]>> {
  const isAround = Boolean(query.location);
  const result = await amapGet<PlacePayload>(
    isAround ? "/v5/place/around" : "/v5/place/text",
    {
      keywords: query.keywords,
      location: query.location,
      radius: isAround ? query.radius : undefined,
      region: isAround ? undefined : query.region,
      city_limit: !isAround && query.region && query.limitRegion ? "true" : undefined,
      show_fields: "business",
      page_size: query.pageSize,
      page_num: 1,
    },
    key,
  );
  if (!result.ok) return result;
  return { ok: true, data: amapList<Poi>(result.data.pois) };
}

/**
 * 给 plan_trip 的地理编码兜底：地名在 /v3/geocode/geo 里召回不到时，
 * 拿它去地点搜索捞第一个带坐标的结果。用户说「星巴克(中关村店)」这种带括号的
 * 门店名，geocode 一律回空，POI 搜索才认。
 */
export async function findPoiLocation(keyword: string, key: string): Promise<AmapResult<string>> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { ok: false, kind: "params", infocode: null, error: "地点搜索缺少关键词" };
  }
  const result = await queryPois(
    { keywords: trimmed.slice(0, POI_KEYWORDS_MAX), pageSize: POI_PAGE_SIZE_DEFAULT },
    key,
  );
  if (!result.ok) return result;
  const location = result.data.map((poi) => amapText(poi.location)).find(Boolean);
  if (!location) {
    return { ok: false, kind: "params", infocode: null, error: `高德地点搜索也召回不到「${trimmed}」的坐标` };
  }
  return { ok: true, data: location };
}

/** 省/市/区/地址相邻重叠是常态（「北京市朝阳区…朝阳区xx路」），压掉重复再拼。 */
function poiAddress(poi: Poi): string {
  const seen: string[] = [];
  for (const raw of [poi.pname, poi.cityname, poi.adname, poi.address]) {
    const text = amapText(raw);
    if (text && seen[seen.length - 1] !== text) seen.push(text);
  }
  return seen.join("");
}

function renderPoi(index: number, poi: Poi): string[] {
  const name = amapText(poi.name) || "(无名地点)";
  const distance = meters(poi.distance);
  const business = amapObj(poi.business);
  const extras: string[] = [];
  if (distance) extras.push(`距 ${distance} 米`);
  const rating = amapText(business?.rating);
  if (rating) extras.push(`评分 ${rating}`);
  const cost = amapText(business?.cost);
  if (cost) extras.push(`人均 ${cost} 元`);

  const lines = [extras.length ? `${index}. ${name}｜${extras.join("｜")}` : `${index}. ${name}`];
  const address = poiAddress(poi);
  const area = amapText(business?.business_area);
  if (address || area) {
    lines.push(`   地址：${address || "(高德未给地址)"}${area ? `（${area}）` : ""}`);
  }
  const type = amapText(poi.type);
  const tel = amapText(business?.tel);
  const openTime = amapText(business?.opentime_week);
  const detail = [type ? `类型：${type}` : "", tel ? `电话：${tel}` : "", openTime ? `营业：${openTime}` : ""]
    .filter(Boolean)
    .join("｜");
  if (detail) lines.push(`   ${detail}`);
  const location = amapText(poi.location);
  if (location) lines.push(`   坐标：${location}`);
  return lines;
}

async function executePoiSearch(args: Record<string, unknown>): Promise<string> {
  const gate = gatePlaceTool();
  if ("blocked" in gate) return gate.blocked;

  const keywords = String(args.keywords ?? "").trim();
  if (!keywords) return "[错误] 请提供要搜的地点关键词（参数 keywords），例如 keywords='咖啡'";
  if (keywords.length > POI_KEYWORDS_MAX) {
    return `[错误] 关键词过长（${keywords.length} 字符）。高德每次只接受一个关键字且不得超过 ${POI_KEYWORDS_MAX} 字符，请缩成一个品类词或品牌名，例如「川菜」而不是「中关村附近好吃的川菜馆」。`;
  }

  const locationRaw = String(args.location ?? "").trim();
  let location: string | undefined;
  if (locationRaw) {
    location = normalizeAmapLocation(locationRaw) ?? undefined;
    if (!location) {
      return '[错误] location 要写成「经度,纬度」，例如 location="116.481008,39.996717"（经度在前、纬度在后）。';
    }
  }

  const region = String(args.city ?? "").trim();
  const pageSize = clampInt(args.limit, POI_PAGE_SIZE_DEFAULT, 1, POI_PAGE_SIZE_MAX);
  const query: PoiQuery = {
    keywords,
    location,
    radius: location ? clampInt(args.radius, AROUND_RADIUS_DEFAULT, 1, AROUND_RADIUS_MAX) : undefined,
    region: region || undefined,
    limitRegion: true,
    pageSize,
  };

  let result = await queryPois(query, gate.key);
  // city_limit=true 是「严格限定」：region 写成「上海」（要的是「上海市」）时
  // 召回一片空白，用户只看到「查无此地」。去掉限定重试，region 仍在给结果加权。
  if (result.ok && result.data.length === 0 && region && !location) {
    result = await queryPois({ ...query, limitRegion: false }, gate.key);
  }
  if (!result.ok) return `[错误] 地点查询失败：${result.error}`;

  const shown = result.data.slice(0, pageSize);
  if (shown.length === 0) {
    return region
      ? `[查无] 高德在「${region}」范围内没有召回「${keywords}」。建议换个更通用的品类词或品牌名，或者去掉城市限定再查一次。`
      : `[查无] 高德没有召回「${keywords}」。建议换个更通用的品类词或品牌名。`;
  }

  const where = location ? `在 ${location} 周边${query.radius ? ` ${query.radius} 米内` : ""}` : region ? `在「${region}」` : "";
  const lines = [`📍「${keywords}」${where}找到 ${shown.length} 个`];
  shown.forEach((poi, i) => lines.push(...renderPoi(i + 1, poi)));
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════
// v3 逆地理编码
// ══════════════════════════════════════════════════════════

interface RegeoPayload {
  regeocode?: Record<string, unknown>;
}

/** 高德偶发回非数字的 distance，NaN 直接进文案会变成「距 NaN 米」。 */
function meters(value: unknown): string {
  const n = Number(amapText(value));
  return Number.isFinite(n) ? n.toFixed(0) : "";
}

/**
 * 地址行：优先用高德给的 formatted_address，没有就按字段自己拼。
 * 官方字段表里其实没写 formatted_address（文档只列到 regeocode 一层），
 * 所以它是「有就用」的加速，不能当唯一依赖——自己拼这条路才是可靠的。
 * 拼的顺序按高德自己的口径：省→市→区→街道→门牌，社区/楼名收尾（它们回答的是「这一片是什么」）。
 */
function regeoAddress(rc: Record<string, unknown>): string {
  const formatted = amapText(rc.formatted_address);
  if (formatted) return formatted;
  const component = amapObj(rc.addressComponent) ?? {};
  const streetNumber = amapObj(component.streetNumber);
  const seen: string[] = [];
  const push = (value: unknown) => {
    const text = amapText(value);
    if (text && !seen.includes(text)) seen.push(text);
  };
  push(component.province);
  push(component.city);
  push(component.district);
  push(component.township);
  if (streetNumber) push(`${amapText(streetNumber.street)}${amapText(streetNumber.number)}`);
  for (const key of ["neighborhood", "building"] as const) {
    const name = amapText(amapObj(component[key])?.name);
    // 门牌串本身可能已经带着社区名（street 写成「北京大学中关村北大街」这类），叠上去只会重复
    if (name && !seen.some((line) => line.includes(name))) push(name);
  }
  if (seen.length) return seen.join("");
  const sea = amapText(component.seaArea);
  return sea ? `${sea}海域` : "";
}

function regeoNearby(rc: Record<string, unknown>): string[] {
  const component = amapObj(rc.addressComponent) ?? {};
  const areas = amapList<Record<string, unknown>>(component.businessAreas)
    .map((area) => amapText(area.name))
    .filter(Boolean);
  const pois = amapList<Record<string, unknown>>(component.pois)
    .map((poi) => {
      const name = amapText(poi.name);
      if (!name) return "";
      const distance = meters(poi.distance);
      return distance ? `${name}（距 ${distance} 米）` : name;
    })
    .filter(Boolean);

  const lines: string[] = [];
  if (areas.length) lines.push(`商圈：${areas.slice(0, 3).join("、")}`);
  if (pois.length) lines.push("附近：" + pois.slice(0, 3).join("、"));
  return lines;
}

async function executeReverseGeocode(args: Record<string, unknown>): Promise<string> {
  const gate = gatePlaceTool();
  if ("blocked" in gate) return gate.blocked;

  const locationRaw = String(args.location ?? "").trim();
  let location: string | null;
  if (locationRaw) {
    location = normalizeAmapLocation(locationRaw);
    if (!location) {
      return '[错误] location 要写成「经度,纬度」，例如 location="116.481008,39.996717"（经度在前、纬度在后）。';
    }
  } else {
    const lng = Number(args.longitude);
    const lat = Number(args.latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return "[错误] 请提供经纬度：longitude 与 latitude 都要是数字（经度在前），或者直接给 location=\"116.48,39.99\"";
    }
    location = normalizeAmapLocation(`${lng},${lat}`);
    if (!location) return "[错误] 经纬度超出范围：经度要在 -180~180，纬度要在 -90~90。";
  }

  // radius 只管「附近 POI/道路」的搜索半径，地址本身照旧；上限按文档的 3000 夹住。
  const radius = clampInt(args.radius, REGEO_RADIUS_DEFAULT, 1, REGEO_RADIUS_MAX);
  const result = await amapGet<RegeoPayload>(
    "/v3/geocode/regeo",
    { location, radius, extensions: "all" },
    gate.key,
  );
  if (!result.ok) return `[错误] 逆地理编码失败：${result.error}`;

  const regeocode = amapObj(result.data.regeocode);
  if (!regeocode) return `[错误] 高德没有解析这个坐标：${location}`;
  const address = regeoAddress(regeocode);
  if (!address) return `[错误] 坐标 ${location} 解析不出地址（可能在中国大陆地图覆盖之外）。`;

  const component = amapObj(regeocode.addressComponent) ?? {};
  const lines = [`📍 ${location} 的位置`, `地址：${address}`];
  const adcode = amapText(component.adcode);
  const citycode = amapText(component.citycode);
  const codes = [adcode ? `行政区代码 ${adcode}` : "", citycode ? `城市编码 ${citycode}` : ""].filter(Boolean);
  if (codes.length) lines.push(`区划：${codes.join("｜")}`);
  lines.push(...regeoNearby(regeocode));
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════
// 注册
// ══════════════════════════════════════════════════════════

export function registerAmapPlaceTools(): void {
  toolRegistry.register({
    id: "poi_search",
    name: "📍找地点",
    description:
      "按关键词或周边范围搜高德兴趣点（POI），返回名称、地址、类型、坐标，以及电话/评分/人均/营业时间（有则给）。\n\n" +
      "何时用：\n" +
      "- 用户找某类场所：「附近有什么咖啡店」「找家川菜馆」「哪里有打印店」\n" +
      "- 用户要知道某个具体门店的地址、电话、营业时间\n" +
      "- plan_trip 的起点/终点是门店名而路线规划报「查不到坐标」时，先用这把工具拿到坐标\n\n" +
      "不要用于：\n" +
      "- 路线与耗时（用 plan_trip）\n" +
      "- 已知坐标要地址（用 reverse_geocode）\n" +
      "- 历史价格、点评正文、优惠券——高德不给\n\n" +
      "参数：\n" +
      `- keywords（必填）：一个关键词，不超过 ${POI_KEYWORDS_MAX} 字符。写品类（「咖啡」）或品牌（「星巴克」），不要把整句话塞进来\n` +
      "- city（可选）：城市名/城市代码，如「北京市」「010」；给了会把结果限定在该城市\n" +
      "- location（可选）：「经度,纬度」，传了就变成周边搜索\n" +
      "- radius（可选，周边搜索用）：半径米数\n" +
      "- limit（可选）：返回条数 1-25，默认 5",
    enabled: true,
    effectKind: "read",
    risk: "network",
    modes: ["work"],
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "地点关键词，只支持一个词，例如「咖啡」「星巴克」「打印店」" },
        city:     { type: "string", description: "城市名（建议带「市」，如「北京市」）或 citycode/adcode，限定搜索范围" },
        location: { type: "string", description: "「经度,纬度」；传了就在这个点周边搜索" },
        radius:   { type: "number", description: "周边搜索半径（米），默认 1000" },
        limit:    { type: "number", description: "返回条数 1-25，默认 5" },
      },
      required: ["keywords"],
    },
    execute: executePoiSearch,
  });

  toolRegistry.register({
    id: "reverse_geocode",
    name: "🧭坐标转地址",
    description:
      "把「经度,纬度」翻译成中文地址（含省市区、街道、商圈、附近地标）。逆地理编码。\n\n" +
      "何时用：\n" +
      "- 用户给了坐标问「这是哪儿」「这个位置是什么地方」\n" +
      "- 其他工具（定位、截图里的坐标）拿到了经纬度，需要一段人话地址\n\n" +
      "不要用于：\n" +
      "- 地址转坐标（poi_search 或直接给 plan_trip，它会自己查坐标）\n" +
      "- 精确门牌与楼层——最细到街道/社区一级\n" +
      "- 海外坐标：高德覆盖不到中国大陆以外，会回「不在范围内」类错误\n\n" +
      "参数：location（「经度,纬度」）或 longitude+latitude（数字），二选一；radius（可选，1-3000 米，默认 1000）。",
    enabled: true,
    effectKind: "read",
    risk: "network",
    modes: ["work"],
    inputSchema: {
      type: "object",
      properties: {
        location:  { type: "string", description: "「经度,纬度」，例如 \"116.481008,39.996717\"" },
        longitude: { type: "number", description: "经度（与 latitude 配对使用）" },
        latitude:  { type: "number", description: "纬度" },
        radius:    { type: "number", description: `搜索附近地标/商圈的半径（米），1-${REGEO_RADIUS_MAX}，默认 ${REGEO_RADIUS_DEFAULT}` },
      },
      required: [],
    },
    execute: executeReverseGeocode,
  });

  logger.info(LogTag.TravelTools, "registered: poi_search, reverse_geocode");
}

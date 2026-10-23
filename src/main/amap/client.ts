// ── 高德 Web 服务 API 的唯一出口 ──────────────────────────
//
// 天气、出行、POI、逆地理四条链路共用同一个 key 打同一个域。各自手搓 URL 会漏四件事：
// key 原文插进 query（带个空格或 `&` 就把请求改写成另一个请求）、重定向跟着 fetch 默认的
// follow 走、失败只剩一个 `status=0`（用户分不清是 key 错了还是当天配额用完）、
// 脱敏各写各的必然漏一处。这四件事在这里收口：参数一律过 URLSearchParams 编码、
// 逐跳过上游重定向闸门、高德错误码翻成人话、任何对外文案与异常信息里不带 key 原文。
import { fetchWithoutUpstreamRedirects } from "../egress/safe-fetch";
import { maskApiKey, validateApiKey } from "../../shared/api-key";

const AMAP_BASE_URL = "https://restapi.amap.com";
const AMAP_TIMEOUT_MS = 15_000;

/** 高德 v3/v4 的查询参数；`undefined` 表示这个参数不发。 */
export type AmapParams = Record<string, string | number | undefined>;

/** 高德每个接口都带的信封字段：v3 用 status/infocode，v4 的骑行接口用 errcode/errmsg。 */
export interface AmapEnvelope {
  status?: string | number;
  infocode?: string | number;
  info?: string;
  errcode?: number;
  errmsg?: string;
}

export type AmapPayload<T> = AmapEnvelope & T;

export type AmapErrorKind =
  | "key"
  | "quota"
  | "rate"
  | "params"
  | "service"
  | "network"
  | "unknown";

export interface AmapSuccess<T> {
  ok: true;
  data: T;
}

export interface AmapFailure {
  ok: false;
  kind: AmapErrorKind;
  /** 给人看的一句话，已经过脱敏。 */
  error: string;
  /** 原始错误码，`null` 表示请求没到高德那一侧（网络/超时/重定向被拦）。 */
  infocode: string | null;
}

export type AmapResult<T> = AmapSuccess<T> | AmapFailure;

/**
 * 高德官方错误码表（lbs.amap.com/api/webservice/guide/tools/info）。
 * 只列这几个接口真可能碰到的；表里没有的走 describeAmapError 的兜底分支，
 * 兜底用高德自己回的文字，不猜语义。
 */
const AMAP_ERRORS: Record<string, { kind: AmapErrorKind; error: string }> = {
  "10001": { kind: "key", error: "高德 Key 不正确或已过期" },
  "10002": { kind: "key", error: "这个 Key 没有开通该服务，或接口路径拼写有误" },
  "10003": { kind: "quota", error: "这个 Key 当天的访问量已用完（次日自动恢复）" },
  "10004": { kind: "rate", error: "单位时间内请求过于频繁，稍后再试" },
  "10005": { kind: "key", error: "本机 IP 不在这个 Key 的白名单里" },
  "10006": { kind: "key", error: "这个 Key 绑定的域名无效" },
  "10007": { kind: "key", error: "数字签名校验未通过" },
  "10008": { kind: "key", error: "MD5 安全码校验未通过" },
  "10009": { kind: "key", error: "Key 的绑定平台与请求类型不符，需要「Web 服务」类型的 Key" },
  "10010": { kind: "rate", error: "本机 IP 访问量超限" },
  "10011": { kind: "service", error: "该服务不支持 https 请求" },
  "10012": { kind: "key", error: "权限不足，这个 Key 不能调用该接口" },
  "10013": { kind: "key", error: "Key 已被删除" },
  "10014": { kind: "rate", error: "云图服务 QPS 超限" },
  "10015": { kind: "rate", error: "受单机 QPS 限流，稍后再试" },
  "10016": { kind: "service", error: "高德服务器负载过高" },
  "10017": { kind: "service", error: "所请求的资源不可用" },
  "10019": { kind: "rate", error: "该服务总 QPS 超限" },
  "10020": { kind: "rate", error: "这个 Key 调用该接口的 QPS 超限" },
  "10021": { kind: "rate", error: "账号调用该接口的 QPS 超限" },
  "10026": { kind: "key", error: "账号处于封禁状态" },
  "10029": { kind: "rate", error: "这个 Key 的 QPS 超限" },
  "10041": { kind: "key", error: "这个 Key 对该接口的权限已过期" },
  "10044": { kind: "quota", error: "账号维度的日调用量已用完" },
  "10045": { kind: "quota", error: "账号维度的海外服务日调用量已用完" },
  "20000": { kind: "params", error: "请求参数不合法" },
  "20001": { kind: "params", error: "缺少必填参数" },
  "20002": { kind: "params", error: "请求协议不合法" },
  "20003": { kind: "service", error: "高德服务端未知错误" },
  "20011": { kind: "params", error: "查询的点在海外，这个 Key 没有海外地图权限" },
  "20012": { kind: "params", error: "查询内容包含非法信息" },
  "20800": { kind: "params", error: "规划点不在中国陆地范围内" },
  "20801": { kind: "params", error: "规划点附近搜不到路" },
  "20802": { kind: "params", error: "路线计算失败（起终点之间的道路连通关系不足）" },
  "20803": { kind: "params", error: "起点到终点距离过长，超出该出行方式的上限" },
  "40000": { kind: "quota", error: "高德账户余额已耗尽" },
  "40002": { kind: "quota", error: "购买的服务已到期" },
  "40003": { kind: "quota", error: "海外服务余额已耗尽" },
};

/** 300xx 是一段族（服务响应失败），不是单个码，单独认。 */
const AMAP_ENGINE_ERROR = /^300\d{2}$/;

/** 错误码 → 分类 + 人话；表外的码回落到高德自己给的 `info`，不猜。 */
export function describeAmapError(
  infocode: string | null | undefined,
  info = "",
): { kind: AmapErrorKind; error: string } {
  if (!infocode) {
    return { kind: "unknown", error: info ? `高德返回「${info}」` : "高德未返回错误码" };
  }
  const known = AMAP_ERRORS[infocode];
  if (known) return known;
  if (AMAP_ENGINE_ERROR.test(infocode)) {
    return { kind: "service", error: `高德服务响应失败（错误码 ${infocode}）` };
  }
  return {
    kind: "unknown",
    error: `高德返回码 ${infocode}${info ? `（${info}）` : ""}`,
  };
}

/**
 * 高德对空值统一回 `[]` 而不是 `""`（例：区级市 `city: []`）。
 * 直接当字符串用会得到 "[object Object]" 之类的鬼话，所以取字段一律过这一道。
 */
export function amapText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** 列表字段同理：缺字段、`[]` 之外的任何值都归一成空数组。 */
export function amapList<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 对象字段同理：高德把「这个字段没有」统一写成 `[]`，
 * 于是 `poi.business?.tel` 这类嵌套读取必须先确认它真的是个对象。
 * 数组也是 object，所以这里必须显式排除 Array——不然 `[]` 会被当成空对象往下读，
 * 读出来一片 undefined 而不是「这个字段不存在」。
 */
export function amapObj<T = Record<string, unknown>>(value: unknown): T | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as T;
}

/**
 * 异常/响应文本里的 key 换成掩码。
 * URLSearchParams 之后正常路径不会带原文，这一道是给 fetch/undici 抛出的整条 URL 兜底。
 */
function redactKey(message: string, key: string): string {
  if (!key || !message.includes(key)) return message;
  return message.split(key).join(maskApiKey(key));
}

function envelopeFailure(payload: AmapEnvelope): AmapFailure | null {
  // v4 的骑行接口用的是 errcode（0 = 成功），v3 全线用 status/infocode。
  if (typeof payload.errcode === "number") {
    if (payload.errcode === 0) return null;
    const code = String(payload.errcode);
    const described = describeAmapError(code, amapText(payload.errmsg));
    return { ok: false, infocode: code, ...described };
  }
  if (amapText(payload.status) === "1") return null;
  const infocode = amapText(payload.infocode);
  const described = describeAmapError(infocode || null, amapText(payload.info));
  return { ok: false, infocode: infocode || null, ...described };
}

export interface AmapRequestOptions {
  /** 覆盖默认 15 秒；超时后请求体读取也一并中断。 */
  timeoutMs?: number;
}

/**
 * 打一个高德接口，返回带类型的信封。
 *
 * 只负责「发对请求 + 说清为什么失败」，不碰任何业务字段——各接口返回结构差异
 * （`districts` / `geocodes` / `pois`）留给调用方，避免出现一个万能返回类型。
 */
export async function amapGet<T>(
  path: string,
  params: AmapParams,
  key: string,
  options: AmapRequestOptions = {},
): Promise<AmapResult<AmapPayload<T>>> {
  const validation = validateApiKey(key, "高德 Key");
  if (!validation.valid) {
    return { ok: false, kind: "key", infocode: null, error: validation.error ?? "高德 Key 无效" };
  }
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value));
  }
  query.set("key", validation.normalized);
  const timeoutMs = options.timeoutMs ?? AMAP_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetchWithoutUpstreamRedirects(
      `${AMAP_BASE_URL}${path}?${query.toString()}`,
      { signal: ctrl.signal },
    );
    if (!response.ok) {
      return { ok: false, kind: "service", infocode: null, error: `高德接口返回 HTTP ${response.status}` };
    }
    const payload = (await response.json()) as AmapPayload<T>;
    const failure = envelopeFailure(payload);
    if (failure) {
      return { ...failure, error: redactKey(failure.error, validation.normalized) };
    }
    return { ok: true, data: payload };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = ctrl.signal.aborted
      ? `请求高德超时（${Math.round(timeoutMs / 1000)} 秒）`
      : redactKey(raw, validation.normalized);
    return { ok: false, kind: "network", infocode: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

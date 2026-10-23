/**
 * Clash Verge 配置发现：只读，不改任何上游文件。
 *
 * 控制器地址与密钥的权威在 `clash-verge.yaml`（external-controller / secret），
 * 订阅信息在 `profiles.yaml`（current / items）。按 mtime+size 缓存，避免每 1.5s 轮询重读。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { NetworkReason, SubscriptionInfo } from "../../shared/network-types";

export const CONFIG_DIR_NAMES = [
  "io.github.clash-verge-rev.clash-verge-rev",
  "clash-verge-rev",
  "clash-verge",
] as const;

export interface ControllerConfig {
  baseUrl: string;
  secret: string;
  mixedPort: number | null;
  sourcePath: string;
}

export type ControllerConfigResult =
  | { ok: true; config: ControllerConfig }
  | { ok: false; reason: NetworkReason };

/**
 * `external-controller` 可能写成 `:9097`、`127.0.0.1:9097`、带 http:// 的整串。
 * 只留 loopback——这是本机控制面，不接受远程主机地址（也避免把密钥发到别处）。
 */
export function normalizeControllerBase(raw: unknown, fallbackPort = 9090): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  // mihomo 常见写法 `:9097`（只给端口、主机留空）：URL 解析不接受空 host，显式补本机。
  if (value.startsWith(":")) value = `127.0.0.1${value}`;
  if (!/^[a-z]+:\/\//i.test(value)) value = `http://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" || /^127\./.test(host) || host === "0.0.0.0";
  if (!loopback) return null;
  const normalizedHost = host === "0.0.0.0" || host === "::1" ? "127.0.0.1" : host;
  const port = url.port || String(fallbackPort);
  return `${url.protocol}//${normalizedHost}:${port}`;
}

export function discoverConfigRoot(input: {
  appData?: string;
  localAppData?: string;
  exists?: (file: string) => boolean;
}): string | null {
  const exists = input.exists ?? existsSync;
  const bases = [input.appData, input.localAppData].filter((v): v is string => !!v);
  for (const base of bases) {
    for (const name of CONFIG_DIR_NAMES) {
      const dir = path.join(base, name);
      if (exists(path.join(dir, "clash-verge.yaml"))) return dir;
    }
  }
  return null;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  value: unknown;
}

function readYamlCached(file: string): unknown {
  const stat = statSync(file);
  const cache = yamlCache.get(file);
  if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.value;
  const value = parseYaml(readFileSync(file, "utf8"));
  yamlCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

const yamlCache = new Map<string, CachedFile>();

export function readControllerConfig(root: string | null): ControllerConfigResult {
  if (!root) return { ok: false, reason: "no-config" };
  const file = path.join(root, "clash-verge.yaml");
  let raw: unknown;
  try {
    raw = readYamlCached(file);
  } catch {
    return { ok: false, reason: "no-config" };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "bad-response" };
  const doc = raw as Record<string, unknown>;
  const baseUrl = normalizeControllerBase(doc["external-controller"]);
  if (!baseUrl) return { ok: false, reason: "no-controller" };
  const secret = typeof doc.secret === "string" ? doc.secret : "";
  const mixedPort = typeof doc["mixed-port"] === "number" ? doc["mixed-port"] : null;
  return { ok: true, config: { baseUrl, secret, mixedPort, sourcePath: file } };
}

/** 订阅名是 base64url 的 JSON（`{u,e,s}`），解不出就当没有用户名。 */
export function decodeSubscriptionUser(name: unknown): string {
  if (typeof name !== "string" || !name) return "";
  try {
    const parsed: unknown = JSON.parse(Buffer.from(name, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const user = (parsed as Record<string, unknown>).u;
      if (typeof user === "string" && user.trim()) return user.trim();
    }
  } catch {
    // 普通名字（非 token）走这里
  }
  return "";
}

export function parseSubscription(doc: unknown): SubscriptionInfo | null {
  if (typeof doc !== "object" || doc === null) return null;
  const root = doc as Record<string, unknown>;
  const items = Array.isArray(root.items) ? root.items : [];
  const current = typeof root.current === "string" ? root.current : "";
  const item = items.find((entry) =>
    typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).uid === current,
  ) as Record<string, unknown> | undefined;
  if (!item) return null;
  const extra = typeof item.extra === "object" && item.extra !== null
    ? (item.extra as Record<string, unknown>)
    : {};
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const expireSeconds = typeof extra.expire === "number" && extra.expire > 0 ? extra.expire : null;
  const tokenExpire = (() => {
    if (typeof item.name !== "string") return null;
    try {
      const parsed = JSON.parse(Buffer.from(item.name, "base64url").toString("utf8")) as { e?: unknown };
      return typeof parsed.e === "number" && parsed.e > 0 ? parsed.e : null;
    } catch {
      return null;
    }
  })();
  return {
    name: typeof item.name === "string" ? item.name : "",
    user: decodeSubscriptionUser(item.name),
    expireAt: expireSeconds ? expireSeconds * 1000 : tokenExpire,
    updatedAt: typeof item.updated === "number" && item.updated > 0 ? item.updated * 1000 : null,
    upload: num(extra.upload),
    download: num(extra.download),
    total: num(extra.total),
  };
}

export function readSubscription(root: string | null): SubscriptionInfo | null {
  if (!root) return null;
  try {
    return parseSubscription(readYamlCached(path.join(root, "profiles.yaml")));
  } catch {
    return null;
  }
}

/** 测试用：清缓存，避免同一路径的假 FS 留下上一轮的值。 */
export function clearConfigCache(): void {
  yamlCache.clear();
}

// Magpie 网关发现：只读本机状态文件 + 回环 GET /v1/models。
// 不读取 Magpie 凭据，不修改其任何状态。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAGPIE_DEFAULT_GATEWAY_URL,
  magpieModelsUrl,
  normalizeMagpieGatewayUrl,
  parseMagpieModels,
  type MagpieModel,
} from "../../shared/magpie";

export interface DiscoverOptions {
  gatewayUrl?: string;
  homeDir?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface DiscoverResult {
  gatewayUrl: string;
  models: MagpieModel[];
  error?: string;
}

const DISCOVERY_TIMEOUT_MS = 2000;

function readStateGatewayUrl(filePath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const providers = (parsed as { providers?: unknown }).providers;
    if (!providers || typeof providers !== "object") return undefined;
    const gateway = (providers as { gateway?: unknown }).gateway;
    if (!gateway || typeof gateway !== "object") return undefined;
    return normalizeMagpieGatewayUrl((gateway as { url?: unknown }).url);
  } catch {
    return undefined;
  }
}

/** 优先 ~/.cache/magpie，其次 ~/.config/magpie；只采用回环地址。 */
export function readMagpieGatewayUrl(homeDir = os.homedir()): string | undefined {
  return readStateGatewayUrl(path.join(homeDir, ".cache", "magpie", "providers-state.json"))
    ?? readStateGatewayUrl(path.join(homeDir, ".config", "magpie", "providers-state.json"));
}

export async function discoverMagpieModels(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const explicit = options.gatewayUrl;
  const gatewayUrl = explicit !== undefined
    ? normalizeMagpieGatewayUrl(explicit)
    : readMagpieGatewayUrl(options.homeDir) ?? MAGPIE_DEFAULT_GATEWAY_URL;
  if (!gatewayUrl) {
    return {
      gatewayUrl: MAGPIE_DEFAULT_GATEWAY_URL,
      models: [],
      error: "拒绝非本机回环的 Magpie 网关",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(magpieModelsUrl(gatewayUrl), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { gatewayUrl, models: [], error: `Magpie /v1/models 返回 ${response.status} ${response.statusText}`.trim() };
    }
    const payload = await response.json() as unknown;
    return { gatewayUrl, models: parseMagpieModels(payload) };
  } catch (error) {
    return { gatewayUrl, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

// Magpie 本地网关的共享契约：模型目录解析、回环地址校验与推理档位映射。
// 仅本机回环；不解析、不保存 Magpie 的凭据（网关默认不鉴权）。

import type { ManualReasoningConfig } from "./manual-reasoning";
import type { ReasoningEffort } from "./vendor-registry/types";

/** 与 manual-reasoning 的规范顺序一致；用于去重排序与默认档位选择。 */
const EFFORT_ORDER: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

export const MAGPIE_PROVIDER = "Magpie";
export const MAGPIE_DEFAULT_GATEWAY_URL = "http://127.0.0.1:3425";
/** 与设置层本地占位 key 同一字面量：非空即视为已连接，但不会真的发出去。 */
export const MAGPIE_LOCAL_API_KEY = "__CYRENE_LOCAL_NO_AUTH__";
export const MAGPIE_PROFILE_ID = "magpie-gateway";

export interface MagpieModel {
  id: string;
  displayName?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  multimodal: boolean;
  reasoningLevels: ReasoningEffort[];
  reasoningDisable: boolean;
}

export interface MagpieSyncResult {
  available: boolean;
  changed: boolean;
  gatewayUrl?: string;
  importedModels: number;
  profileId?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInt(value: unknown, min: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= min ? rounded : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets[0] !== "127") return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

/**
 * 只接受本机回环 http(s) 网关；拒绝凭据、查询串、片段与非根路径。
 * 返回去除 `/v1` 与尾斜杠后的网关根地址。
 */
export function normalizeMagpieGatewayUrl(input: unknown): string | undefined {
  if (typeof input !== "string" || !input.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  if (url.search || url.hash) return undefined;
  if (!isLoopbackHost(url.hostname)) return undefined;
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "" && pathname !== "/v1") return undefined;
  return `${url.protocol}//${url.host}`;
}

export function normalizeMagpieBaseUrl(gatewayUrl: string): string {
  const gateway = normalizeMagpieGatewayUrl(gatewayUrl)
    ?? gatewayUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${gateway}/v1`;
}

export function magpieModelsUrl(gatewayUrl: string): string {
  return `${normalizeMagpieBaseUrl(gatewayUrl)}/models`;
}

/**
 * 把 `/v1/models` 的 OpenAI 列表与 Magpie 扩展字段映射成导入模型。
 * 畸形条目跳过、按 id 首现去重；上下文下限 4096 与档案 normalize 契约一致。
 */
export function parseMagpieModels(payload: unknown): MagpieModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const seen = new Set<string>();
  const models: MagpieModel[] = [];
  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const id = item.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const modalities = isRecord(item.modalities) && Array.isArray(item.modalities.input)
      ? item.modalities.input
      : [];
    const multimodal = modalities.some((kind) => (
      typeof kind === "string" && kind.trim() !== "" && kind.trim().toLowerCase() !== "text"
    ));

    const rawLevels = Array.isArray(item.reasoning_levels) ? item.reasoning_levels : [];
    const levels = new Set<ReasoningEffort>();
    for (const level of rawLevels) {
      if (typeof level === "string" && EFFORT_ORDER.includes(level as ReasoningEffort)) {
        levels.add(level as ReasoningEffort);
      }
    }
    const reasoningLevels = EFFORT_ORDER.filter((level) => levels.has(level));

    const displayName = typeof item.display_name === "string" && item.display_name.trim()
      ? item.display_name.trim()
      : typeof item.magpie_label === "string" && item.magpie_label.trim()
        ? item.magpie_label.trim()
        : undefined;
    const contextWindowTokens = positiveInt(item.context_window, 4096);
    const maxOutputTokens = positiveInt(item.max_output_tokens, 1);

    models.push({
      id,
      ...(displayName ? { displayName } : {}),
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      multimodal,
      reasoningLevels,
      reasoningDisable: rawLevels.includes("none"),
    });
  }
  return models;
}

export function manualReasoningForMagpie(
  model: Pick<MagpieModel, "reasoningLevels" | "reasoningDisable">,
): ManualReasoningConfig | undefined {
  const supportedEfforts = [...model.reasoningLevels];
  if (supportedEfforts.length === 0) return undefined;
  const defaultEffort = supportedEfforts.includes("medium")
    ? "medium"
    : supportedEfforts.includes("high")
      ? "high"
      : supportedEfforts[0];
  return {
    style: "openai-effort",
    supportedEfforts,
    defaultEffort,
    supportsDisable: model.reasoningDisable,
  };
}

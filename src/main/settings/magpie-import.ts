// 把 Magpie 目录映射成 Mochi 的已保存档案；合并保持幂等，并保留用户选择。

import { isDeepStrictEqual } from "node:util";
import {
  MAGPIE_LOCAL_API_KEY,
  MAGPIE_PROFILE_ID,
  MAGPIE_PROVIDER,
  manualReasoningForMagpie,
  normalizeMagpieBaseUrl,
  type MagpieModel,
} from "../../shared/magpie";
import type { SavedModelProfile } from "./model-catalog";

export function buildMagpieProfile(
  previous: SavedModelProfile | undefined,
  models: MagpieModel[],
  gatewayUrl: string,
  id = previous?.id ?? MAGPIE_PROFILE_ID,
): SavedModelProfile {
  const modelIds = models.map((model) => model.id);
  const chosen = models.find((model) => model.id === previous?.model) ?? models[0];

  const modelOptions: NonNullable<SavedModelProfile["modelOptions"]> = {};
  for (const model of models) {
    const manualReasoning = manualReasoningForMagpie(model)
      ?? previous?.modelOptions?.[model.id]?.manualReasoning;
    modelOptions[model.id] = {
      multimodal: model.multimodal,
      ...(model.contextWindowTokens !== undefined ? { contextWindowTokens: model.contextWindowTokens } : {}),
      ...(manualReasoning ? { manualReasoning } : {}),
    };
  }

  return {
    id,
    provider: MAGPIE_PROVIDER,
    displayName: previous?.displayName?.trim() || "Magpie",
    baseUrl: normalizeMagpieBaseUrl(gatewayUrl),
    model: chosen?.id ?? previous?.model ?? "",
    ...(modelIds.length > 1 ? { models: modelIds } : {}),
    ...(Object.keys(modelOptions).length > 0 ? { modelOptions } : {}),
    apiKey: previous?.apiKey || MAGPIE_LOCAL_API_KEY,
    explicitTransport: "openai",
    ...(chosen?.contextWindowTokens !== undefined ? { contextWindowTokens: chosen.contextWindowTokens } : {}),
    ...(chosen ? { multimodal: chosen.multimodal } : {}),
    ...(previous?.reasoning ? { reasoning: previous.reasoning } : {}),
  };
}

export function mergeMagpieProfiles(
  profiles: SavedModelProfile[],
  models: MagpieModel[],
  gatewayUrl: string,
): { profiles: SavedModelProfile[]; profile: SavedModelProfile; changed: boolean } {
  const index = profiles.findIndex((profile) => profile.provider === MAGPIE_PROVIDER);
  if (index >= 0) {
    const previous = profiles[index];
    const profile = buildMagpieProfile(previous, models, gatewayUrl, previous.id);
    if (isDeepStrictEqual(profile, previous)) {
      return { profiles, profile: previous, changed: false };
    }
    const next = [...profiles];
    next[index] = profile;
    return { profiles: next, profile, changed: true };
  }

  const taken = new Set(profiles.map((profile) => profile.id));
  let id = MAGPIE_PROFILE_ID;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${MAGPIE_PROFILE_ID}-${suffix}`;
  const profile = buildMagpieProfile(undefined, models, gatewayUrl, id);
  return { profiles: [...profiles, profile], profile, changed: true };
}

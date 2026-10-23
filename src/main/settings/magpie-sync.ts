// Magpie 同步编排：发现 → 合并 → 仅在有变化时写盘。

import type { MagpieSyncResult } from "../../shared/magpie";
import { discoverMagpieModels, type DiscoverOptions } from "../magpie/discovery";
import { mergeMagpieProfiles } from "./magpie-import";
import { listSavedModelProfiles, saveModelProfile } from "./model-settings";

export async function syncMagpieModels(options: DiscoverOptions = {}): Promise<MagpieSyncResult> {
  const discovery = await discoverMagpieModels(options);
  if (discovery.error) {
    return {
      available: false,
      changed: false,
      gatewayUrl: discovery.gatewayUrl,
      importedModels: 0,
      error: discovery.error,
    };
  }
  if (discovery.models.length === 0) {
    return {
      available: true,
      changed: false,
      gatewayUrl: discovery.gatewayUrl,
      importedModels: 0,
      error: "Magpie 在线但没有可用模型",
    };
  }

  const merged = mergeMagpieProfiles(listSavedModelProfiles(), discovery.models, discovery.gatewayUrl);
  if (merged.changed) saveModelProfile(merged.profile);
  return {
    available: true,
    changed: merged.changed,
    gatewayUrl: discovery.gatewayUrl,
    importedModels: discovery.models.length,
    profileId: merged.profile.id,
  };
}

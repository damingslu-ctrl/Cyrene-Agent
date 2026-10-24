import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renameWithRetrySync } from "../storage/rename-with-retry";
import { PET_FORMS, SIZE_TIERS, type PetForm, type SizeTier } from "../../shared/pet-profile";

export const VERGE_STATE_FILE = path.join("verge", "state.json");

export interface VergeState {
  /** 免打扰到期时刻（本地 epoch ms）。null = 不在安静期。 */
  quietUntil: number | null;
  /** 贴边藏身开关。native 侧手写 Default 为 true，这里保持同口径。 */
  tuckEnabled: boolean;
  /** 「第一次藏身先解释一句」的凭据，跨重启只说一次。 */
  tuckHinted: boolean;
  /** 形态（v1.5.0）：存量盘里没有就读默认。 */
  form: PetForm;
  /** 身形档位（v1.5.0）：同上。 */
  tier: SizeTier;
}

/** 产品默认（R-D1「猫娘为默认」＋ spec §2「猫娘默认大档」）。注意这里是**产品**默认，
 *  几何兜底 `defaultProfile()` 仍是 cat/standard——两者刻意分层。 */
export const DEFAULT_VERGE_STATE: VergeState = {
  quietUntil: null,
  tuckEnabled: true,
  tuckHinted: false,
  form: "girl",
  tier: "large",
};

function toState(raw: unknown): VergeState {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_VERGE_STATE };
  const input = raw as Record<string, unknown>;
  return {
    quietUntil: typeof input.quietUntil === "number" && Number.isFinite(input.quietUntil)
      ? input.quietUntil
      : null,
    tuckEnabled: typeof input.tuckEnabled === "boolean" ? input.tuckEnabled : DEFAULT_VERGE_STATE.tuckEnabled,
    tuckHinted: input.tuckHinted === true,
    form: PET_FORMS.find((f) => f === input.form) ?? DEFAULT_VERGE_STATE.form,
    tier: SIZE_TIERS.find((t) => t === input.tier) ?? DEFAULT_VERGE_STATE.tier,
  };
}

export function readVergeState(userDataDir: string): VergeState {
  const file = path.join(userDataDir, VERGE_STATE_FILE);
  try {
    return toState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_VERGE_STATE };
  }
}

/** 原子写：先落同目录 `.tmp` 再 rename。native 的账本被半截写过，这里不重演。 */
export function writeVergeState(userDataDir: string, state: VergeState): void {
  const dir = path.join(userDataDir, "verge");
  mkdirSync(dir, { recursive: true });
  const target = path.join(userDataDir, VERGE_STATE_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameWithRetrySync(tmp, target);
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renameWithRetrySync } from "../storage/rename-with-retry";

export const VERGE_STATE_FILE = path.join("verge", "state.json");

export interface VergeState {
  /** 免打扰到期时刻（本地 epoch ms）。null = 不在安静期。 */
  quietUntil: number | null;
  /** 贴边藏身开关。native 侧手写 Default 为 true，这里保持同口径。 */
  tuckEnabled: boolean;
  /** 「第一次藏身先解释一句」的凭据，跨重启只说一次。 */
  tuckHinted: boolean;
}

export const DEFAULT_VERGE_STATE: VergeState = {
  quietUntil: null,
  tuckEnabled: true,
  tuckHinted: false,
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

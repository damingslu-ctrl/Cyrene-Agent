import path from "node:path";
import { readVergeState, writeVergeState, VERGE_STATE_FILE, type VergeState } from "./verge-store";
import type { VergeSnapshot } from "./types";
import type { PetForm, SizeTier } from "../../shared/pet-profile";

export interface VergeService {
  getSnapshot(): VergeSnapshot;
  getState(): VergeState;
  setQuietUntil(until: number | null): void;
  setTuckEnabled(enabled: boolean): void;
  markTuckHinted(): void;
  /** v1.5.0：形态与档位（落盘；广播由装配层的 applyProfileState 收口）。 */
  setForm(form: PetForm): void;
  setTier(tier: SizeTier): void;
}

export function createVergeService(userDataDir: string): VergeService {
  let state = readVergeState(userDataDir);
  const persist = () => writeVergeState(userDataDir, state);

  return {
    getSnapshot: () => ({
      module: "verge",
      ready: true,
      statePath: path.join(userDataDir, VERGE_STATE_FILE),
      quietUntil: state.quietUntil,
    }),
    getState: () => ({ ...state }),
    setQuietUntil: (until) => { state = { ...state, quietUntil: until }; persist(); },
    setTuckEnabled: (enabled) => { state = { ...state, tuckEnabled: enabled }; persist(); },
    markTuckHinted: () => { state = { ...state, tuckHinted: true }; persist(); },
    setForm: (form) => { state = { ...state, form }; persist(); },
    setTier: (tier) => { state = { ...state, tier }; persist(); },
  };
}

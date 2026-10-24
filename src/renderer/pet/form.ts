import { buildCatOps, type CatInput } from "./art";
import { buildGirlOps } from "./girl";
import type { DrawOp } from "../../shared/draw-ops";
import type { PetForm } from "../../shared/pet-profile";

/**
 * 形态派发（v1.5.0 Task 6）。
 *
 * `PetInput` 是 `CatInput` 的超集：P1 只多 `form` 一条轴，`channels`/`expression`
 * 由 P2 的 Task 14 追加。缺省 `cat` —— 于是四足路径与今天**逐字节走同一条**，
 * 这一行派发是 R-D2 在代码里唯一需要证明的地方（girl.test 有等价条）。
 */
export type PetInput = CatInput & { form?: PetForm };

export const PET_BUILDERS: Record<PetForm, (i: PetInput) => DrawOp[]> = {
  cat: (i) => buildCatOps(i),
  girl: (i) => buildGirlOps(i),
};

export function buildPetOps(input: PetInput): DrawOp[] {
  const form: PetForm = input.form === "girl" ? "girl" : "cat";
  return PET_BUILDERS[form](input);
}

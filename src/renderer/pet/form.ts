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
export type PetInput = CatInput & {
  form?: PetForm;
  /** 四层合成的采样结果（Task 12/14）。cat 形不读它——四足逐字节不变靠这条。 */
  channels?: Partial<Record<string, number>>;
  /** 表情档（girl 专用；缺省 neutral）。 */
  expression?: import("./face").Expression;
};

export const PET_BUILDERS: Record<PetForm, (i: PetInput) => DrawOp[]> = {
  // cat 侧显式只喂 CatInput：多出来的 channels/expression 一个都不许漏进去（R-D2）。
  cat: (i) => buildCatOps(i),
  girl: (i) => buildGirlOps(i),
};

export function buildPetOps(input: PetInput): DrawOp[] {
  const form: PetForm = input.form === "girl" ? "girl" : "cat";
  return PET_BUILDERS[form](input);
}

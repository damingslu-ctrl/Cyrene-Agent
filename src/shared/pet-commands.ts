/** 右键菜单 → 宠物窗的单向动作。渲染端是唯一执行者（状态都在它手里）。 */
export type PetCommand =
  | "pet" | "feed" | "play" | "toggle-sleep" | "status"
  /** 「让它做个动作」：只演一次手势，不动数值（`gesture:<id>` 见 `GESTURE_COMMANDS`）。 */
  | "wave" | "bow" | "nod" | "tilt" | "hop" | "stretch" | "clap";

export const PET_COMMANDS: ReadonlyArray<PetCommand> = [
  "pet", "feed", "play", "toggle-sleep", "status",
  "wave", "bow", "nod", "tilt", "hop", "stretch", "clap",
];

/**
 * 手势命令 → 手势 id（`motion.ts` 的 GESTURE_IDS 子集）。
 *
 * 只收「纯表演、不牵动身体状态」的几个：招手/鞠躬/点头/歪头/跳一下/伸懒腰/鼓掌。
 * 睡觉与吃东西不在这里——它们会改 vitals 或进入长动作，混进「做个动作」会被当成
 * 真的喂食/催眠，用户点一下只是想让猫动一下而已。
 */
export const GESTURE_COMMANDS: Readonly<Partial<Record<PetCommand, string>>> = {
  wave: "wave",
  bow: "bow",
  nod: "nod",
  tilt: "tilt",
  hop: "hop",
  stretch: "stretch",
  clap: "clap",
};

export function isPetCommand(value: unknown): value is PetCommand {
  return typeof value === "string" && (PET_COMMANDS as readonly string[]).includes(value);
}

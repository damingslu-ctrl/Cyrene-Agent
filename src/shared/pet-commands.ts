/** 右键菜单 → 宠物窗的单向动作。渲染端是唯一执行者（状态都在它手里）。 */
export type PetCommand = "pet" | "feed" | "play" | "toggle-sleep" | "status";

export const PET_COMMANDS: ReadonlyArray<PetCommand> = [
  "pet", "feed", "play", "toggle-sleep", "status",
];

export function isPetCommand(value: unknown): value is PetCommand {
  return value === "pet" || value === "feed" || value === "play"
    || value === "toggle-sleep" || value === "status";
}

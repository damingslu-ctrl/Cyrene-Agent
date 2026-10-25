/** 右键菜单 → 宠物窗的单向动作。渲染端是唯一执行者（状态都在它手里）。 */
import { ACCESSORY_IDS, type AccessoryId } from "./pet-accessory";
import { RPS_SIGNS, rpsCommandFor, type RpsCommand } from "./pet-rps";

/** 装扮命令：`accessory:<id>`（id 来自共享词表，菜单与渲染端对同一组值）。 */
export type AccessoryCommand = `accessory:${AccessoryId}`;

export type PetCommand =
  | "pet" | "feed" | "play" | "toggle-sleep" | "status"
  /** 「让它做个动作」：只演一次手势，不动数值（`gesture:<id>` 见 `GESTURE_COMMANDS`）。 */
  | "wave" | "bow" | "nod" | "tilt" | "hop" | "stretch" | "clap"
  /** 猫娘专属：招一只伴飞小虫 / 自己散一段步。四足收到时静默忽略。 */
  | "summon-critter" | "wander"
  /** 猫娘专属玩具：逗猫棒 / 泡泡 / 落叶 / 跟着光标走 / 猜拳。 */
  | "wand" | "bubbles" | "leaves" | "follow"
  /** 猫娘专属玩具 V：纸箱 / 激光笔 / 梳毛 / 猫薄荷 / 纸飞机 / 小鸟来访 / 成长记录。 */
  | "box" | "laser" | "brush" | "catnip" | "plane" | "bird" | "growth"
  | RpsCommand
  | AccessoryCommand;

export const ACCESSORY_COMMANDS: ReadonlyArray<AccessoryCommand> =
  ACCESSORY_IDS.map((id) => `accessory:${id}` as const);

export const RPS_COMMANDS: ReadonlyArray<RpsCommand> = RPS_SIGNS.map((sign) => rpsCommandFor(sign));

const BASE_COMMANDS: ReadonlyArray<PetCommand> = [
  "pet", "feed", "play", "toggle-sleep", "status",
  "wave", "bow", "nod", "tilt", "hop", "stretch", "clap",
  "summon-critter", "wander",
  "wand", "bubbles", "leaves", "follow",
  "box", "laser", "brush", "catnip", "plane", "bird", "growth",
];

export const PET_COMMANDS: ReadonlyArray<PetCommand> = [
  ...BASE_COMMANDS, ...RPS_COMMANDS, ...ACCESSORY_COMMANDS,
];

/** `accessory:bow` → `"bow"`；不是装扮命令返回 null。 */
export function accessoryFromCommand(command: PetCommand): AccessoryId | null {
  if (!command.startsWith("accessory:")) return null;
  const id = command.slice("accessory:".length);
  return (ACCESSORY_IDS as readonly string[]).includes(id) ? (id as AccessoryId) : null;
}

export function accessoryCommandFor(id: AccessoryId): AccessoryCommand {
  return `accessory:${id}`;
}

/**
 * 手势命令 → 手势 id（`motion.ts` 的 GESTURE_IDS 子集）。
 *
 * 只收「纯表演、不牵动身体状态」的几个：招手/鞠躬/点头/歪头/跳一下/伸懒腰/鼓掌。
 * 睡觉与吃东西不在这里——它们会改 vitals 或进入长动作，混进「做个动作」
 * 会被当成真的喂食/催眠，用户点一下只是想让猫动一下而已。
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

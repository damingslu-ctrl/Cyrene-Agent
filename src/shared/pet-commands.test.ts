import { describe, expect, it } from "vitest";
import {
  ACCESSORY_COMMANDS,
  GESTURE_COMMANDS,
  PET_COMMANDS,
  RPS_COMMANDS,
  accessoryCommandFor,
  accessoryFromCommand,
  isPetCommand,
} from "./pet-commands";
import { ACCESSORY_IDS } from "./pet-accessory";
import { RPS_SIGNS } from "./pet-rps";

describe("右键菜单命令表", () => {
  it("每个命令都能被 isPetCommand 认出来（表与守卫不许脱节）", () => {
    for (const command of PET_COMMANDS) expect(isPetCommand(command), command).toBe(true);
    expect(isPetCommand("not-a-command")).toBe(false);
    expect(isPetCommand(undefined)).toBe(false);
    expect(isPetCommand(42)).toBe(false);
  });

  it("手势命令是命令表的子集，且都在 GESTURE_COMMANDS 里", () => {
    for (const command of Object.keys(GESTURE_COMMANDS)) {
      expect(PET_COMMANDS as readonly string[]).toContain(command);
    }
  });

  it("手势命令不碰数值：喂食/睡觉/摸摸/逗玩/状态一个都不许混进来", () => {
    // 这五条会改 vitals 或进入长动作；混进「让它做个动作」会被当成真的喂饭/催眠。
    for (const forbidden of ["pet", "feed", "play", "toggle-sleep", "status"]) {
      expect(GESTURE_COMMANDS).not.toHaveProperty(forbidden);
    }
  });

  it("7 个手势都有对应的 motion 手势 id（同名，改一处即断）", () => {
    expect(Object.keys(GESTURE_COMMANDS)).toEqual(["wave", "bow", "nod", "tilt", "hop", "stretch", "clap"]);
    for (const [command, gestureId] of Object.entries(GESTURE_COMMANDS)) {
      expect(gestureId, command).toBe(command);
    }
  });

  it("玩具箱四条与猜拳三条都在命令表里，猜拳走 `rps:<手型>`", () => {
    for (const command of ["wand", "bubbles", "leaves", "follow"]) {
      expect(PET_COMMANDS as readonly string[]).toContain(command);
    }
    expect(RPS_COMMANDS).toEqual(RPS_SIGNS.map((sign) => `rps:${sign}`));
    for (const command of RPS_COMMANDS) expect(isPetCommand(command), command).toBe(true);
  });

  it("装扮命令与词表一一对应，解析只认登记过的 id", () => {
    expect(ACCESSORY_COMMANDS).toEqual(ACCESSORY_IDS.map((id) => `accessory:${id}`));
    for (const id of ACCESSORY_IDS) {
      expect(accessoryCommandFor(id)).toBe(`accessory:${id}`);
      expect(accessoryFromCommand(`accessory:${id}`)).toBe(id);
    }
    expect(accessoryFromCommand("accessory:crown" as never)).toBeNull();
    expect(accessoryFromCommand("rps:rock")).toBeNull();
  });
});

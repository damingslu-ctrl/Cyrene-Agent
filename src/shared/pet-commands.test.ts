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
import { SOLO_KINDS } from "./pet-solo";
import { TRICK_COMMANDS, TRICK_IDS, trickCommandFor, trickFromCommand } from "./pet-trick";

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

  it("玩具箱两条线都在命令表里：v1.10 四条 + v1.11 六件 + 成长记录，猜拳走 `rps:<手型>`", () => {
    for (const command of [
      "wand", "bubbles", "leaves", "follow",
      "box", "laser", "brush", "catnip", "plane", "bird", "growth",
    ]) {
      expect(PET_COMMANDS as readonly string[]).toContain(command);
      expect(isPetCommand(command), command).toBe(true);
    }
    expect(RPS_COMMANDS).toEqual(RPS_SIGNS.map((sign) => `rps:${sign}`));
    for (const command of RPS_COMMANDS) expect(isPetCommand(command), command).toBe(true);
  });

  it("v1.13 九件新玩具都在命令表里，跳格子叫 hopscotch 而不是 hop", () => {
    for (const command of ["tail", "knead", "roll", "book", "gift", "wish", "hopscotch", "snow", "fortune"]) {
      expect(PET_COMMANDS as readonly string[]).toContain(command);
      expect(isPetCommand(command), command).toBe(true);
    }
    // `hop` 早被「跳一下」手势占了：跳格子若同名，菜单会永远只演一下。
    expect(GESTURE_COMMANDS.hop).toBe("hop");
    expect(PET_COMMANDS as readonly string[]).toContain("hop");
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

  it("v1.17 日常九条 + `trick:<id>`：躲猫猫不叫 hide（那是窗口动作）", () => {
    for (const command of [
      "mood", "favorite", "tricks", "treasure", "treasures", "hide-seek",
      "garden-plant", "garden", "garden-harvest",
    ]) {
      expect(PET_COMMANDS as readonly string[]).toContain(command);
      expect(isPetCommand(command), command).toBe(true);
    }
    // `hide` 是主窗菜单的「隐藏窗口」动作，宠物命令若同名会被读成藏猫猫。
    expect(PET_COMMANDS as readonly string[]).not.toContain("hide");
    expect(TRICK_COMMANDS).toEqual(TRICK_IDS.map((id) => `trick:${id}`));
    for (const id of TRICK_IDS) {
      expect(isPetCommand(trickCommandFor(id)), id).toBe(true);
      expect(trickFromCommand(trickCommandFor(id))).toBe(id);
    }
    expect(trickFromCommand("trick:hug")).toBeNull();
    expect(trickFromCommand("rps:rock")).toBeNull();
  });

  it("v1.18 自娱五件 + 汇报：件名即命令名，汇报命令不与件名同名", () => {
    for (const kind of SOLO_KINDS) {
      expect(PET_COMMANDS as readonly string[]).toContain(kind);
      expect(isPetCommand(kind), kind).toBe(true);
    }
    expect(PET_COMMANDS as readonly string[]).toContain("solo");
    expect(isPetCommand("solo")).toBe(true);
    // `solo` 是「看她自己玩到哪了」的汇报口，不是第六件玩具：混进词表会被当成可开场的一件。
    expect(SOLO_KINDS).not.toContain("solo");
    // 名字不跟已有的抢话筒：`mirror` 不是手势、`ball` 不是那两颗旧命令。
    for (const taken of ["hop", "play", "follow", "hide"]) {
      expect(SOLO_KINDS).not.toContain(taken);
    }
    expect(GESTURE_COMMANDS).not.toHaveProperty("mirror");
    expect(GESTURE_COMMANDS).not.toHaveProperty("ball");
  });
});

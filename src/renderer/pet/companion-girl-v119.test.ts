// v1.19 她的一天：换段开口、一起看天色、节日挂饰、夜里自己睡、两只汇报嘴。
import { describe, expect, it } from "vitest";
import { CompanionEngine } from "./companion";
import { AUTO_SLEEP_IDLE_MS, clockLine, phaseLine, skyLine } from "./girl-clock";
import { FESTIVALS, festivalOn } from "./girl-festival";
import { wrapBubbleText } from "./art";

const T0 = 1_700_000_000_000;
const BOND_KEY = "cyrene.pet.bond.v1";

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const seq = (values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

/** 可拨的墙上时钟：探针也靠这一根（只拨 Date.now，不动行为秒表）。 */
function wallClock(initial: number) {
  let value = initial;
  return { get: () => value, set: (next: number) => { value = next; } };
}

const at = (y: number, month: number, d: number, h: number, m = 0) =>
  new Date(y, month - 1, d, h, m, 0).getTime();

function girl(storage = makeStorage(), wall = wallClock(at(2026, 10, 28, 18, 20))) {
  const engine = new CompanionEngine({ storage, now: () => T0, wallNow: wall.get, random: seq([0.5]) });
  engine.setForm("girl");
  return { engine, wall, storage };
}

const line = (engine: CompanionEngine) => engine.getSnapshot().bubble?.text;
const clock = (engine: CompanionEngine) => engine.getSnapshot().clock;
const fits = (text: string, max = 78) => wrapBubbleText(text, max, 9).length === 1;

describe("v1.19 换段开口", () => {
  it("进入一段说一句，同一段一天只开口一次；安静期不记账，醒来补上", () => {
    const { engine, wall } = girl();
    engine.clockTick(T0);
    expect(clock(engine)?.phase).toBe("dusk");
    expect(line(engine)).toBe(phaseLine("dusk"));

    engine.clockTick(T0 + 30_000);
    expect(line(engine)).toBeUndefined();

    // 安静期换段：不许说，也不许把这一段的账提前烧掉。
    wall.set(at(2026, 10, 28, 19, 5));
    engine.setQuiet(true);
    engine.clockTick(T0 + 60_000);
    expect(clock(engine)?.phase).toBe("evening");
    expect(line(engine)).toBeUndefined();

    engine.setQuiet(false);
    engine.clockTick(T0 + 90_000);
    expect(line(engine)).toBe(phaseLine("evening"));
    engine.clockTick(T0 + 120_000);
    expect(line(engine)).toBeUndefined();
  });

  it("四足形态一条都不接，快照里的 clock 就是 null", () => {
    const { engine, wall } = girl();
    engine.setForm("cat");
    engine.clockTick(T0);
    expect(clock(engine)).toBeNull();
    expect(engine.watchSky(T0)).toBe(false);
    expect(engine.clockReport(T0)).toBe(false);
    expect(engine.festivalReport(T0)).toBe(false);
    wall.set(at(2026, 10, 28, 23, 55));
    engine.clockTick(T0 + 30_000);
    expect(engine.getSnapshot().activity).not.toBe("sleep");
  });

  it("开机第一拍只记账不出声：换了段才开口；安静期开机不烧账，醒来照补", () => {
    const { engine, wall, storage } = girl();
    engine.primeClock();
    expect(line(engine)).toBeUndefined();
    expect(clock(engine)?.phase).toBe("dusk");
    expect(JSON.parse(storage.getItem(BOND_KEY)!).clockKey).toBe("2026-10-28:dusk");

    wall.set(at(2026, 10, 28, 19, 10));
    engine.clockTick(T0 + 30_000);
    expect(line(engine)).toBe(phaseLine("evening"));

    // 安静期开机：prime 什么都不记，安静结束后第一拍把当前段补上。
    const quiet = girl(makeStorage(), wallClock(at(2026, 10, 28, 18, 20)));
    quiet.engine.setQuiet(true);
    quiet.engine.primeClock();
    expect(line(quiet.engine)).toBeUndefined();
    expect(JSON.parse(quiet.storage.getItem(BOND_KEY) ?? "{}").clockKey ?? "").toBe("");
    quiet.engine.setQuiet(false);
    quiet.engine.clockTick(T0 + 30_000);
    expect(line(quiet.engine)).toBe(phaseLine("dusk"));
  });
});

describe("v1.19 一起看天色", () => {
  it("黄昏点天色记号＝一起看日落：记一次、说一句，看过了记号就销账", () => {
    const { engine } = girl();
    engine.clockTick(T0);
    engine.dismissBubble(T0);
    expect(clock(engine)?.sky).toEqual({ kind: "sunset", watched: false });

    // 记号自带命中区（渲染端把落在记号上的那一下转成 watchSky）：
    // 摸头仍是摸头，不按时间偷换反应。
    expect(engine.watchSky(T0 + 1_000)).toBe(true);
    expect(line(engine)).toBe(skyLine("sunset"));
    expect(clock(engine)?.skies).toEqual({ sunrise: 0, sunset: 1, moon: 0 });
    expect(clock(engine)?.sky).toEqual({ kind: "sunset", watched: true });

    engine.dismissBubble(T0 + 2_000);
    expect(engine.watchSky(T0 + 3_000)).toBe(false);
    expect(line(engine)).toBeUndefined();
    expect(clock(engine)?.skies?.sunset).toBe(1);
  });

  it("同一场看第二眼不算数；第二天同一段又是新的一场", () => {
    const { engine, wall } = girl();
    engine.clockTick(T0);
    engine.dismissBubble(T0);
    engine.watchSky(T0 + 1_000);
    expect(engine.watchSky(T0 + 2_000)).toBe(false);
    expect(clock(engine)?.skies?.sunset).toBe(1);

    wall.set(at(2026, 10, 29, 18, 30));
    engine.clockTick(T0 + 30_000);
    expect(clock(engine)?.sky).toEqual({ kind: "sunset", watched: false });
    expect(engine.watchSky(T0 + 31_000)).toBe(true);
    expect(clock(engine)?.skies?.sunset).toBe(2);
  });

  it("正午天上没东西：摸头照旧，天色账本一个字节不动", () => {
    const { engine, wall } = girl(makeStorage(), wallClock(at(2026, 10, 28, 12, 0)));
    engine.clockTick(T0);
    expect(clock(engine)?.sky).toBeNull();
    engine.dismissBubble(T0);
    expect(engine.watchSky(T0 + 500)).toBe(false);
    expect(engine.touch("head", T0 + 1_000)).toBe(true);
    expect(clock(engine)?.skies).toEqual({ sunrise: 0, sunset: 0, moon: 0 });
  });

  it("日出与月亮各记一枚新成就；睡着的她不给看（叫醒只能靠碰）", () => {
    const { engine, wall } = girl(makeStorage(), wallClock(at(2026, 10, 28, 5, 30)));
    engine.clockTick(T0);
    engine.dismissBubble(T0);
    expect(engine.watchSky(T0 + 1_000)).toBe(true);
    expect(clock(engine)?.skies?.sunrise).toBe(1);
    expect(engine.getSnapshot().achievements).toContain("dawn-watch");
    expect(engine.getSnapshot().achievements).not.toContain("moon-watch");

    wall.set(at(2026, 10, 28, 22, 10));
    engine.clockTick(T0 + 60_000);
    engine.dismissBubble(T0 + 61_000);
    expect(engine.watchSky(T0 + 62_000)).toBe(true);
    expect(clock(engine)?.skies?.moon).toBe(1);
    expect(engine.getSnapshot().achievements).toContain("moon-watch");

    wall.set(at(2026, 10, 29, 22, 10));
    engine.clockTick(T0 + 120_000);
    engine.handleCommand("toggle-sleep", T0 + 121_000);
    expect(engine.watchSky(T0 + 122_000)).toBe(false);
    expect(clock(engine)?.skies?.moon).toBe(1);
    expect(clock(engine)?.sky).toBeNull();
  });
});

describe("v1.19 节日", () => {
  it("节日当天第一次问时：挂饰上线、说一句、记一次；同日不重复、次日收起", () => {
    const { engine, wall } = girl(makeStorage(), wallClock(at(2026, 12, 25, 10, 0)));
    const christmas = FESTIVALS.find((entry) => entry.id === "christmas")!;
    engine.clockTick(T0);
    expect(clock(engine)?.festival).toEqual({ id: "christmas", label: "圣诞节", ornament: "star" });
    expect(line(engine)).toBe(christmas.line);
    expect(clock(engine)?.festivals).toBe(1);
    expect(engine.getSnapshot().achievements).toContain("festive-day");

    engine.dismissBubble(T0 + 1_000);
    engine.clockTick(T0 + 30_000);
    expect(clock(engine)?.festivals).toBe(1);
    expect(line(engine)).toBeUndefined();

    wall.set(at(2026, 12, 26, 10, 0));
    engine.clockTick(T0 + 60_000);
    expect(clock(engine)?.festival).toBeNull();
    expect(clock(engine)?.festivals).toBe(1);
  });

  it("节日跨重启不重复记：盘上的 last 就是对账凭据，坏账本读成没记过", () => {
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: at(2026, 12, 1, 9),
        festival: { last: "christmas:2026-12-25", count: 2 },
      }),
    });
    const { engine } = girl(storage, wallClock(at(2026, 12, 25, 10, 0)));
    engine.clockTick(T0);
    expect(clock(engine)?.festival?.id).toBe("christmas");
    expect(clock(engine)?.festivals).toBe(2);
    expect(line(engine)).not.toBe(FESTIVALS.find((entry) => entry.id === "christmas")!.line);

    const junk = girl(makeStorage({
      [BOND_KEY]: JSON.stringify({ metAt: at(2026, 12, 1, 9), festival: { last: 42, count: "x" } }),
    }), wallClock(at(2026, 12, 25, 10, 0)));
    junk.engine.clockTick(T0);
    expect(clock(junk.engine)?.festivals).toBe(1);
  });
});

describe("v1.19 夜里自己睡", () => {
  it("23:30 后你离开满 3 分钟她才睡；05:00 天亮伸个懒腰醒来", () => {
    const { engine, wall } = girl(makeStorage(), wallClock(at(2026, 10, 28, 23, 35)));
    engine.clockTick(T0);
    expect(engine.getSnapshot().activity).not.toBe("sleep");

    wall.set(at(2026, 10, 28, 23, 37, 59));
    engine.clockTick(T0 + 30_000);
    expect(engine.getSnapshot().activity).not.toBe("sleep");

    wall.set(at(2026, 10, 28, 23, 38, 1));
    engine.clockTick(T0 + 60_000);
    expect(engine.getSnapshot().activity).toBe("sleep");
    expect(clock(engine)?.autoSleep).toBe(true);

    wall.set(at(2026, 10, 29, 4, 59));
    engine.clockTick(T0 + 90_000);
    expect(engine.getSnapshot().activity).toBe("sleep");

    wall.set(at(2026, 10, 29, 5, 0));
    engine.clockTick(T0 + 120_000);
    expect(engine.getSnapshot().activity).toBe("stretch");
    expect(clock(engine)?.autoSleep).toBe(false);
    expect(line(engine)).toBe(phaseLine("dawn"));
    // 伸完懒腰回到站姿，不是接着睡。
    engine.update(T0 + 120_000 + 10_000, {
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      size: { width: 82, height: 108 },
      canRoam: false,
    });
    expect(engine.getSnapshot().activity).toBe("idle");
  });

  it("你还在看就不睡（user_active）、安静里也不睡；手动哄睡不会被天亮叫醒", () => {
    const { engine, wall } = girl(makeStorage(), wallClock(at(2026, 10, 28, 23, 40)));
    engine.setUserActive(true);
    wall.set(at(2026, 10, 28, 23, 50));
    engine.clockTick(T0 + 30_000);
    expect(engine.getSnapshot().activity).not.toBe("sleep");

    // 离开后重新计 3 分钟：2:59 醒着，3:01 睡着。
    wall.set(at(2026, 10, 28, 23, 50));
    engine.setUserActive(false);
    wall.set(at(2026, 10, 28, 23, 52, 59));
    engine.clockTick(T0 + 60_000);
    expect(engine.getSnapshot().activity).not.toBe("sleep");
    wall.set(at(2026, 10, 28, 23, 53, 1));
    engine.clockTick(T0 + 90_000);
    expect(engine.getSnapshot().activity).toBe("sleep");

    const quiet = girl(makeStorage(), wallClock(at(2026, 10, 28, 23, 40)));
    quiet.engine.setQuiet(true);
    quiet.wall.set(at(2026, 10, 28, 23, 50));
    quiet.engine.clockTick(T0 + 30_000);
    expect(quiet.engine.getSnapshot().activity).not.toBe("sleep");

    const manual = girl(makeStorage(), wallClock(at(2026, 10, 28, 23, 40)));
    manual.engine.handleCommand("toggle-sleep", T0);
    manual.wall.set(at(2026, 10, 29, 5, 30));
    manual.engine.clockTick(T0 + 30_000);
    expect(manual.engine.getSnapshot().activity).toBe("sleep");
    expect(clock(manual.engine)?.autoSleep).toBe(false);
  });

  it("自动睡的门槛常量就是 3 分钟：改小/改大都不能悄悄通过", () => {
    expect(AUTO_SLEEP_IDLE_MS).toBe(180_000);
  });
});

describe("v1.19 两只汇报嘴", () => {
  it("报时三行：此刻、下一个节日、还有几天；每行都装得进 78px", () => {
    const { engine } = girl();
    expect(engine.clockReport(T0)).toBe(true);
    const lines = line(engine)!.split("\n");
    expect(lines).toEqual([clockLine(at(2026, 10, 28, 18, 20)), "下一个 万圣夜", "还有 3 天"]);
    for (const text of lines) expect(fits(text), text).toBe(true);
  });

  it("节日汇报：平常日子报倒计时，节日当天报自己；每行都装得进 78px", () => {
    const { engine } = girl();
    expect(engine.festivalReport(T0)).toBe(true);
    const idleLines = line(engine)!.split("\n");
    expect(idleLines).toEqual(["今天不是节日", "下一个 万圣夜", "还有 3 天"]);
    for (const text of idleLines) expect(fits(text), text).toBe(true);

    engine.dismissBubble(T0 + 1_000);
    const halloween = girl(makeStorage(), wallClock(at(2026, 10, 31, 9, 0)));
    expect(halloween.engine.festivalReport(T0)).toBe(true);
    const dayLines = line(halloween.engine)!.split("\n");
    expect(dayLines).toEqual(["今天是 万圣夜", festivalOn(at(2026, 10, 31, 9, 0))!.line]);
    for (const text of dayLines) expect(fits(text), text).toBe(true);
  });

  it("安静期两只嘴都闭上", () => {
    const { engine } = girl();
    engine.setQuiet(true);
    expect(engine.clockReport(T0)).toBe(false);
    expect(engine.festivalReport(T0)).toBe(false);
  });
});

describe("v1.19 落盘与坏档", () => {
  it("落盘就是这个形状：换段键、天色键、三项天色账、节日账", () => {
    const { engine, storage } = girl();
    engine.clockTick(T0);
    engine.dismissBubble(T0);
    engine.watchSky(T0 + 1_000);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.clockKey).toBe("2026-10-28:dusk");
    expect(saved.skyKey).toBe("2026-10-28:sunset");
    expect(saved.skies).toEqual({ sunrise: 0, sunset: 1, moon: 0 });
    expect(saved.festival).toEqual({ last: "", count: 0 });
  });

  it("重启后同一段不再开口、看过的天色不销第二次账；坏值只归零自己那一项", () => {
    const wall = wallClock(at(2026, 10, 28, 18, 20));
    const storage = makeStorage();
    const first = girl(storage, wall);
    first.engine.clockTick(T0);
    first.engine.dismissBubble(T0);
    first.engine.watchSky(T0 + 1_000);

    const again = girl(storage, wall);
    again.engine.clockTick(T0 + 30_000);
    expect(line(again.engine)).toBeUndefined();
    expect(clock(again.engine)?.sky).toEqual({ kind: "sunset", watched: true });
    expect(clock(again.engine)?.skies?.sunset).toBe(1);

    const bad = girl(makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: at(2026, 10, 1, 9),
        clockKey: 42,
        skyKey: "sunset:2026-10-28",
        skies: { sunrise: "x", sunset: -1, moon: 2.9 },
        festival: { last: "day:7", count: 2 },
      }),
    }), wallClock(at(2026, 10, 28, 12, 0)));
    expect(clock(bad.engine)?.skies).toEqual({ sunrise: 0, sunset: 0, moon: 2 });
    expect(clock(bad.engine)?.festivals).toBe(2);
    // 坏键读成空串：第一拍照常开口（不是被坏键堵死）。
    bad.engine.clockTick(T0);
    expect(line(bad.engine)).toBe(phaseLine("noon"));
  });

  it("快照给出去的账是副本：外面改不动她的天色账", () => {
    const { engine } = girl();
    engine.clockTick(T0);
    const snapshot = engine.getSnapshot();
    snapshot.clock!.skies.sunset = 99;
    engine.dismissBubble(T0);
    engine.watchSky(T0 + 1_000);
    expect(clock(engine)?.skies?.sunset).toBe(1);
  });
});

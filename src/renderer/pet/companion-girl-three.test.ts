import { describe, expect, it } from "vitest";
import {
  CompanionEngine,
  GIRL_ACCESSORY_LINES,
  GIRL_CHATTER,
  GIRL_CRITTER_LINES,
  GIRL_GREETINGS,
  GIRL_REUNION_LINES,
  GIRL_WEEKDAY_CHATTER,
  REUNION_GAP_MS,
  chatterPoolFor,
  type CompanionContext,
} from "./companion";
import { MILESTONE_MS } from "./girl-milestone";

const T0 = 1_700_000_000_000;
const workArea = { x: 0, y: 0, width: 1000, height: 700 };
const size = { width: 82, height: 108 };
const ctx: CompanionContext = { workArea, size, canRoam: true };
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

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).getTime();

describe("猫娘装扮（引擎）", () => {
  it("戴上会说一句、快照与存档都记住；换一件再换回来都行", () => {
    const storage = makeStorage();
    const engine = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.getSnapshot().accessory).toBe("none");

    expect(engine.setAccessory("bell", T0)).toBe(true);
    expect(engine.getSnapshot().accessory).toBe("bell");
    expect(GIRL_ACCESSORY_LINES.bell).toContain(engine.getSnapshot().bubble?.text);

    engine.setAccessory("bow", T0 + 1_000);
    expect(engine.getSnapshot().accessory).toBe("bow");
    expect(GIRL_ACCESSORY_LINES.bow).toContain(engine.getSnapshot().bubble?.text);

    const reload = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    expect(reload.getSnapshot().accessory).toBe("bow");
    expect(reload.setAccessory("bow", T0)).toBe(false);
  });

  it("坏值退回不戴，不会把存档写脏", () => {
    const storage = makeStorage();
    const engine = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setAccessory("crown" as never, T0);
    expect(engine.getSnapshot().accessory).toBe("none");
  });
});

describe("伴飞小虫（引擎）", () => {
  it("捉到会开心、涨一点亲密度、说一句捉虫的话", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    const before = engine.getVitals().affinity;
    expect(engine.catchCritter(T0)).toBe(true);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(GIRL_CRITTER_LINES).toContain(engine.getSnapshot().bubble?.text);
  });

  it("睡着时捉不到，也不说话", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    engine.handleCommand("toggle-sleep", T0);
    const before = engine.getVitals().affinity;
    expect(engine.catchCritter(T0)).toBe(false);
    expect(engine.getVitals().affinity).toBe(before);
    expect(engine.getSnapshot().bubble).toBeNull();
  });
});

describe("久别重逢", () => {
  it("隔了 3 小时以上，先说的是「你回来了」而不是普通问候", () => {
    const wall = at(25, 15);
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: wall - 4 * 86_400_000,
        lastSeenAt: wall - 4 * 3_600_000,
        morningKey: "",
        nightKey: "",
      }),
    });
    const engine = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.greet()).toBe(true);
    expect(GIRL_REUNION_LINES).toContain(engine.getSnapshot().bubble?.text);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.lastSeenAt).toBe(wall);

    // 第二次开窗（隔不到 3h）就回到普通问候。
    const again = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall + 60_000, random: seq([0.5]) });
    again.setForm("girl");
    expect(again.greet()).toBe(true);
    expect(again.getSnapshot().bubble?.text).toBe(GIRL_GREETINGS.afternoon);
  });

  it("首次见面（没有 lastSeenAt）不算久别", () => {
    const wall = at(25, 15);
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    engine.greet();
    expect(engine.getSnapshot().bubble?.text).toBe(GIRL_GREETINGS.afternoon);
  });

  it("3 小时是硬边界", () => {
    const wall = at(25, 15);
    for (const [gap, want] of [[REUNION_GAP_MS - 1, false], [REUNION_GAP_MS, true]] as const) {
      const storage = makeStorage({
        [BOND_KEY]: JSON.stringify({
          metAt: wall - 4 * 86_400_000,
          lastSeenAt: wall - gap,
          morningKey: "",
          nightKey: "",
        }),
      });
      const engine = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
      engine.setForm("girl");
      engine.greet();
      const text = engine.getSnapshot().bubble?.text ?? "";
      expect(GIRL_REUNION_LINES.includes(text)).toBe(want);
    }
  });
});

describe("纪念日", () => {
  it("第 7 天开窗：放彩带、说第 7 天；同一天再开不重演", () => {
    const wall = at(31, 15);
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: wall - 6 * 86_400_000,
        lastSeenAt: wall - 60_000,
        morningKey: "",
        nightKey: "",
      }),
    });
    const engine = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.getSnapshot().days).toBe(7);
    expect(engine.greet()).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.milestoneLeft).toBeGreaterThan(0);
    expect(snap.milestoneLeft).toBeLessThanOrEqual(MILESTONE_MS);
    expect(snap.milestoneDays).toBe(7);
    expect(snap.bubble?.text).toContain("第 7 天");

    const reload = new CompanionEngine({ storage, now: () => T0 + 10_000, wallNow: () => wall + 10_000, random: seq([0.5]) });
    reload.setForm("girl");
    reload.greet();
    expect(reload.getSnapshot().milestoneLeft).toBe(0);
    expect(reload.getSnapshot().bubble?.text).not.toContain("第 7 天");
  });

  it("普通日子 milestoneLeft 恒 0；第 30 天也认", () => {
    const wall = at(31, 15);
    const normal = new CompanionEngine({ storage: makeStorage(), now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    normal.setForm("girl");
    normal.greet();
    expect(normal.getSnapshot().milestoneLeft).toBe(0);

    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({ metAt: wall - 29 * 86_400_000, lastSeenAt: wall - 60_000 }),
    });
    const thirty = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    thirty.setForm("girl");
    thirty.greet();
    expect(thirty.getSnapshot().milestoneDays).toBe(30);
    expect(thirty.getSnapshot().bubble?.text).toContain("第 30 天");
  });
});

describe("星期语料", () => {
  it("周一/周五/周末各有自己的池子，其余日子按时段", () => {
    expect(GIRL_WEEKDAY_CHATTER.mon.length).toBeGreaterThan(0);
    expect(chatterPoolFor(9, 1, 0)).toBe(GIRL_WEEKDAY_CHATTER.mon);
    expect(chatterPoolFor(15, 5, 0)).toBe(GIRL_WEEKDAY_CHATTER.fri);
    expect(chatterPoolFor(15, 0, 0)).toBe(GIRL_WEEKDAY_CHATTER.weekend);
    expect(chatterPoolFor(15, 6, 0)).toBe(GIRL_WEEKDAY_CHATTER.weekend);
    // 抽签没中：回时段表。
    expect(chatterPoolFor(9, 1, 0.9)).toBe(GIRL_CHATTER.morning);
    expect(chatterPoolFor(15, 3, 0)).toBe(GIRL_CHATTER.afternoon);
    // 深夜不换星期话题：先把觉睡了。
    expect(chatterPoolFor(23, 1, 0)).toBe(GIRL_CHATTER.night);
  });

  it("周一闲话真的会在 idle 里说出来", () => {
    let t = T0;
    const wall = at(26, 9); // 2026-10-26 是周一
    expect(new Date(wall).getDay()).toBe(1);
    // 全程 0.1：休息 19.2s、抽签必中星期一池、选句取第一条——三处都确定。
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t, wallNow: () => wall, random: () => 0.1,
    });
    engine.setForm("girl");
    t += 70_000;
    engine.update(t, ctx); // 坐下
    t += 20_000;
    engine.update(t, ctx); // 起身伸懒腰
    t += 3_000;
    engine.update(t, ctx);
    t += 1_000;
    const text = engine.update(t, ctx).bubble?.text;
    expect(GIRL_WEEKDAY_CHATTER.mon).toContain(text);
    expect(text).toBe(GIRL_WEEKDAY_CHATTER.mon[0]);
  });
});

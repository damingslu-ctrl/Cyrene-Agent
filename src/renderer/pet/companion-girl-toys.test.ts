import { describe, expect, it } from "vitest";
import {
  CompanionEngine,
  GIRL_BUBBLE_LINES,
  GIRL_FOLLOW_ARRIVE_LINES,
  GIRL_FOLLOW_LINES,
  GIRL_FOLLOW_LOST_LINES,
  GIRL_LEAF_LINES,
  GIRL_RPS_LINES,
  GIRL_WAND_MISS_LINES,
} from "./companion";

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

function girl(storage = makeStorage(), random = seq([0.5])) {
  const engine = new CompanionEngine({ storage, now: () => T0, random });
  engine.setForm("girl");
  return engine;
}

describe("玩具箱（引擎）", () => {
  it("逗猫棒捉中：计入统计、涨亲密度、解锁第一枚成就并把徽章亮出来", () => {
    const engine = girl();
    const before = engine.getVitals().affinity;
    expect(engine.wandEnd(T0, true)).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.stats.wand).toBe(1);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(snap.achievements).toContain("first-wand");
    expect(snap.achievementId).toBe("first-wand");
    expect(snap.achievementLeft).toBeGreaterThan(0);
    // 第一次解锁的徽章会占住这一句（与捉虫的行为一致）。
    expect(snap.bubble?.text).toBe("羽毛…还想再玩一次");
  });

  it("空挥不算捉中：没有统计、没有成就，只自嘲一句", () => {
    const engine = girl();
    expect(engine.wandEnd(T0, false)).toBe(false);
    const snap = engine.getSnapshot();
    expect(snap.stats.wand).toBe(0);
    expect(snap.achievements).toEqual([]);
    expect(GIRL_WAND_MISS_LINES).toContain(snap.bubble?.text);
  });

  it("戳破第 12 颗泡泡解锁「泡泡终结者」；每四下才说一句，不刷屏", () => {
    const engine = girl();
    for (let i = 0; i < 12; i += 1) {
      expect(engine.bubblePop(T0 + i * 8_000)).toBe(true);
    }
    const snap = engine.getSnapshot();
    expect(snap.stats.bubbles).toBe(12);
    expect(snap.achievements).toContain("bubble-lover");

    const fresh = girl();
    fresh.bubblePop(T0);
    const first = fresh.getSnapshot().bubble?.text;
    expect(GIRL_BUBBLE_LINES).toContain(first);
    fresh.bubblePop(T0 + 8_000);
    // 第二下不发声：气泡还是第一下那句（引擎时钟固定在 T0，它还没过期）。
    expect(fresh.getSnapshot().bubble?.text).toBe(first);
  });

  it("撒落叶是纯演出：涨一点亲密度、有一句话，但不产生可拾取物", () => {
    const engine = girl();
    const before = engine.getVitals().affinity;
    expect(engine.leafToss(T0)).toBe(true);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(GIRL_LEAF_LINES).toContain(engine.getSnapshot().bubble?.text);
    expect(engine.getSnapshot().activity).toBe("play");
  });

  it("跟我来：答应一句；跟到位/跟丢各有收尾台词，且都不涨亲密度", () => {
    const engine = girl();
    const before = engine.getVitals().affinity;
    expect(engine.followStart(T0)).toBe(true);
    expect(GIRL_FOLLOW_LINES).toContain(engine.getSnapshot().bubble?.text);

    expect(engine.followStop(T0 + 9_000, true)).toBe(true);
    expect(GIRL_FOLLOW_ARRIVE_LINES).toContain(engine.getSnapshot().bubble?.text);
    expect(engine.followStop(T0 + 20_000, false)).toBe(true);
    expect(GIRL_FOLLOW_LOST_LINES).toContain(engine.getSnapshot().bubble?.text);
    expect(engine.getVitals().affinity).toBe(before);
  });
});

describe("猜拳（引擎）", () => {
  it("她按 random 出手，赢了涨一点、说赢家的台词", () => {
    const engine = girl(makeStorage(), seq([0.4])); // 1 → scissors
    const before = engine.getVitals().affinity;
    const result = engine.rpsPlay("rock", T0);
    expect(result).toEqual({ player: "rock", her: "scissors", outcome: "win" });
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(GIRL_RPS_LINES.win).toContain(engine.getSnapshot().bubble?.text);
  });

  it("平局只涨一点点；输了不涨，但也要有一句不服气", () => {
    const draw = girl(makeStorage(), seq([0]));
    const beforeDraw = draw.getVitals().affinity;
    expect(draw.rpsPlay("rock", T0)?.outcome).toBe("draw");
    expect(draw.getVitals().affinity).toBeGreaterThan(beforeDraw);
    expect(GIRL_RPS_LINES.draw).toContain(draw.getSnapshot().bubble?.text);

    const lose = girl(makeStorage(), seq([0.999])); // 2 → paper
    const beforeLose = lose.getVitals().affinity;
    expect(lose.rpsPlay("rock", T0)?.outcome).toBe("lose");
    expect(lose.getVitals().affinity).toBe(beforeLose);
    expect(GIRL_RPS_LINES.lose).toContain(lose.getSnapshot().bubble?.text);
  });
});

describe("玩具箱的闸门与存档", () => {
  it("安静期：五条新互动全部不接，也不写统计", () => {
    const engine = girl();
    engine.setQuiet(true);
    expect(engine.wandEnd(T0, true)).toBe(false);
    expect(engine.bubblePop(T0)).toBe(false);
    expect(engine.leafToss(T0)).toBe(false);
    expect(engine.followStart(T0)).toBe(false);
    expect(engine.rpsPlay("rock", T0)).toBeNull();
    expect(engine.getSnapshot().stats).toEqual({
      pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0,
      boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
    });
  });

  it("睡着时同样不接（叫醒只能靠摸/戳）", () => {
    const engine = girl();
    engine.handleCommand("toggle-sleep", T0);
    expect(engine.wandEnd(T0, true)).toBe(false);
    expect(engine.leafToss(T0)).toBe(false);
    expect(engine.followStart(T0)).toBe(false);
    expect(engine.rpsPlay("paper", T0)).toBeNull();
  });

  it("统计与成就跨重启保留；同一枚成就不会重复解锁/重复弹", () => {
    const storage = makeStorage();
    const first = girl(storage);
    first.wandEnd(T0, true);
    first.catchCritter(T0 + 10_000);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.stats.wand).toBe(1);
    expect(saved.stats.catches).toBe(1);
    expect(saved.achievements).toEqual(["first-wand", "first-catch"]);

    const again = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    again.setForm("girl");
    expect(again.getSnapshot().stats).toEqual({
      pats: 0, catches: 1, wand: 1, bubbles: 0, pounces: 0,
      boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
    });
    expect(again.getSnapshot().achievements).toEqual(["first-wand", "first-catch"]);
    expect(again.getSnapshot().achievementId).toBeNull();

    again.catchCritter(T0 + 20_000);
    expect(again.getSnapshot().achievements).toEqual(["first-wand", "first-catch"]);
  });

  it("相识满 7 天的第一次问候会顺手记下「七日之约」，但句子让给问候", () => {
    const wall = new Date(2026, 9, 25, 15, 0, 0).getTime();
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: wall - 6 * 86_400_000,
        lastSeenAt: wall,
        morningKey: "",
        nightKey: "",
      }),
    });
    const engine = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.greet()).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.achievements).toContain("seven-days");
    expect(snap.bubble?.text).not.toBe("第七天啦，我们还有好多天");
  });
});

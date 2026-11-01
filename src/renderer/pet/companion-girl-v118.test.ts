// v1.18 自娱：引擎侧的闸门、记账、成就与跨重启。
import { describe, expect, it } from "vitest";
import { CompanionEngine, type CompanionContext } from "./companion";
import {
  EMPTY_SOLO, SOLO_GESTURES, SOLO_KINDS, SOLO_LABELS,
  soloEndLine, soloStartLine, type SoloKind,
} from "../../shared/pet-solo";
import { EMPTY_STATS } from "./girl-achievements";
import { dateKey } from "./girl-bond";
import { COMBO_STEPS } from "./girl-combo";
import { gestureIds } from "./motion";

// 本地分量构造，别写绝对 epoch 常量：那种数的 getHours() 随运行时区变。判据锁见 pet-test-clock.test.ts。
const T0 = new Date(2023, 10, 15, 6, 13, 20).getTime();
const WALL = new Date(2026, 9, 27, 15, 0, 0).getTime();
const BOND_KEY = "cyrene.pet.bond.v1";
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 82, height: 108 };
const ctx: CompanionContext = { workArea, size, canRoam: true };
const still: CompanionContext = { ...ctx, canRoam: false };

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

function bond(over: Record<string, unknown> = {}) {
  return {
    [BOND_KEY]: JSON.stringify({ metAt: WALL - 86_400_000, ...over }),
  };
}

function girl(storage = makeStorage(), random = seq([0.5]), wallNow: () => number = () => WALL) {
  const engine = new CompanionEngine({ storage, now: () => T0, wallNow, random });
  engine.setForm("girl");
  return engine;
}

const line = (engine: CompanionEngine) => engine.getSnapshot().bubble?.text;
const solo = (engine: CompanionEngine) => engine.getSnapshot().solo;

describe("v1.18 自娱开场", () => {
  it("开场就登记这件玩具：一句话 + 一个姿态，第二次开场不再重复记件数", () => {
    const engine = girl();
    expect(solo(engine)).toEqual(EMPTY_SOLO);
    expect(engine.soloStart("ball", T0)).toBe(true);
    expect(line(engine)).toBe(soloStartLine("ball"));
    expect(engine.getSnapshot().gesture).toBe(SOLO_GESTURES.ball);
    expect(solo(engine).seen).toEqual(["ball"]);

    expect(engine.soloStart("fishing", T0 + 2_000)).toBe(true);
    expect(solo(engine).seen).toEqual(["ball", "fishing"]);
    expect(engine.soloStart("fishing", T0 + 4_000)).toBe(true);
    expect(solo(engine).seen).toEqual(["ball", "fishing"]);
  });

  it("五件都能开场，姿态名全部在动作表里（写错 id 不许悄悄放过去）", () => {
    const engine = girl();
    const registry = gestureIds();
    for (const kind of SOLO_KINDS) {
      expect(registry, SOLO_GESTURES[kind]).toContain(SOLO_GESTURES[kind]);
      expect(engine.soloStart(kind, T0)).toBe(true);
    }
    expect(solo(engine).seen).toEqual([...SOLO_KINDS]);
  });

  it("猫形态不接：她不会自己玩这些", () => {
    const engine = girl();
    engine.setForm("cat");
    expect(engine.soloStart("ball", T0)).toBe(false);
    expect(solo(engine)).toEqual(EMPTY_SOLO);
    expect(engine.soloScore("ball", 3, T0)).toBeNull();
    expect(engine.soloDone("ball", 3, T0)).toBe(false);
    expect(engine.selfPlayReportNow(T0)).toBe(false);
    expect(engine.soloScare(T0)).toBeNull();
  });

  it("安静期与睡着都不接，账本一个字节也不动", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    engine.setQuiet(true);
    expect(engine.soloStart("lantern", T0)).toBe(false);
    expect(engine.soloScore("lantern", 1, T0)).toBeNull();
    expect(engine.soloScare(T0)).toBeNull();
    expect(engine.soloDone("lantern", 1, T0)).toBe(false);
    expect(engine.selfPlayReportNow(T0)).toBe(false);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.solo).toEqual(EMPTY_SOLO);
    expect(saved.stats.selfPlay).toBe(0);
  });

  it("睡着时不接（叫醒只能靠摸/戳）", () => {
    const engine = girl();
    engine.handleCommand("toggle-sleep", T0);
    expect(engine.soloStart("mirror", T0)).toBe(false);
    expect(solo(engine).seen).toEqual([]);
  });

  it("开场句被更高级别的气泡占着话筒，也照样算开演：闸门与话筒是两回事", () => {
    // 渲染端拿这个返回值决定「要不要把玩具挂上去」。若它等于 say 的成败，
    // 话筒被占的那一下会变成「姿态已摆、账已记，玩具却永远不出现」的半截状态。
    const engine = girl();
    engine.say("这条更长也更要紧", 2, T0);
    expect(engine.soloStart("ball", T0 + 10)).toBe(true);
    expect(line(engine)).toBe("这条更长也更要紧");
    expect(solo(engine).seen).toEqual(["ball"]);
    expect(engine.getSnapshot().gesture).toBe(SOLO_GESTURES.ball);
  });
});

describe("v1.18 自娱记账", () => {
  it("best 型只抬峰值：皮球连击 5 之后再低也留 5", () => {
    const engine = girl();
    engine.soloStart("ball", T0);
    expect(engine.soloScore("ball", 3, T0 + 500)).toBe(3);
    expect(engine.soloScore("ball", 5, T0 + 900)).toBe(5);
    expect(engine.soloScore("ball", 2, T0 + 1_300)).toBe(5);
    expect(solo(engine).ballBest).toBe(5);
  });

  it("total 型逐次累加：拨灯两次就是两次，0 与负数不进账", () => {
    const engine = girl();
    engine.soloStart("lantern", T0);
    expect(engine.soloScore("lantern", 1, T0 + 500)).toBe(1);
    expect(engine.soloScore("lantern", 2, T0 + 900)).toBe(3);
    expect(engine.soloScore("lantern", 0, T0 + 1_200)).toBe(3);
    expect(engine.soloScore("lantern", -5, T0 + 1_500)).toBe(3);
    expect(solo(engine).flares).toBe(3);
  });

  it("不认识的档只回 null：账本不被没登记的件名污染", () => {
    const engine = girl();
    expect(engine.soloScore("mole" as SoloKind, 1, T0)).toBeNull();
    expect(solo(engine)).toEqual(EMPTY_SOLO);
  });

  it("飞蛾单独一笔：赶走三只也不给拨灯数添彩", () => {
    const engine = girl();
    engine.soloStart("lantern", T0);
    expect(engine.soloScare(T0 + 400)).toBe(1);
    expect(engine.soloScare(T0 + 800)).toBe(2);
    expect(engine.soloScare(T0 + 900)).toBe(3);
    expect(solo(engine).moths).toBe(3);
    expect(solo(engine).flares).toBe(0);
    expect(line(engine)).toBe(soloStartLine("lantern"));
  });

  it("玩出名堂才收账：涨亲密度、记今天陪玩、报一句把数写进句子", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    engine.soloStart("fishing", T0);
    const before = engine.getVitals().affinity;
    expect(engine.soloDone("fishing", 2, T0 + 5_000)).toBe(true);
    expect(line(engine)).toBe(soloEndLine("fishing", 2));
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(solo(engine).fish).toBe(2);
    expect(engine.getSnapshot().stats.selfPlay).toBe(1);
    expect(JSON.parse(storage.getItem(BOND_KEY)!).dayCounts.toys).toBe(1);
  });

  it("空手一轮不改口粮：不涨亲密度、不记今日陪玩、也不算自娱一次", () => {
    // questDay 必须一起种：构造函数的跨天收笔会把没对上任一日的 dayCounts 清零，
    // 那样「今天已经陪玩过三次」这个前提就没了，断言会退化成恒真。
    const storage = makeStorage(bond({
      questDay: dateKey(WALL),
      dayCounts: { pats: 2, plays: 1, feeds: 0, toys: 3 },
    }));
    const engine = girl(storage);
    engine.soloStart("mirror", T0);
    const before = engine.getVitals().affinity;
    expect(engine.soloDone("mirror", 0, T0 + 5_000)).toBe(false);
    expect(line(engine)).toBe("这次没玩出名堂");
    expect(engine.getVitals().affinity).toBeCloseTo(before, 6);
    expect(engine.getSnapshot().stats.selfPlay).toBe(0);
    expect(JSON.parse(storage.getItem(BOND_KEY)!).dayCounts.toys).toBe(3);
    expect(solo(engine).mirror).toBe(0);
    expect(solo(engine).seen).toEqual(["mirror"]);
  });

  it("没开场也能收账：渲染端的补报不重复计次", () => {
    const engine = girl();
    expect(engine.soloDone("combo", 4, T0)).toBe(true);
    expect(solo(engine).comboBest).toBe(4);
    expect(solo(engine).seen).toEqual(["combo"]);
    expect(engine.getSnapshot().stats.selfPlay).toBe(1);
  });
});

describe("v1.18 自娱成就", () => {
  it("六枚各自从自娱账本里解锁，差一记不给", () => {
    const engine = girl(makeStorage(bond({
      achievements: ["first-catch", "first-wand", "bubble-lover", "seven-days", "heart-bond",
        "box-hide", "laser-catch", "brush-lover", "catnip-high", "plane-catch",
        "scratch-art", "bell-fan", "windup-hunter", "mole-master",
        "hug-lover", "purr-engine", "rain-listener", "daily-perfect",
        "tail-chaser", "knead-master", "roll-artist", "bookworm", "gift-opener",
        "wish-maker", "hopscotch-pro", "snow-builder", "fortune-fan",
        "trick-master", "treasure-hunter", "hide-seeker", "garden-keeper", "true-favorite"],
    })));
    expect(engine.soloScore("ball", 4, T0)).toBe(4);
    expect(engine.getSnapshot().achievements).not.toContain("ball-rhythm");
    expect(engine.soloScore("ball", 5, T0)).toBe(5);
    expect(engine.getSnapshot().achievements).toContain("ball-rhythm");

    expect(engine.soloScore("lantern", 9, T0)).toBe(9);
    expect(engine.getSnapshot().achievements).not.toContain("lantern-keeper");
    expect(engine.soloScore("lantern", 1, T0)).toBe(10);
    expect(engine.getSnapshot().achievements).toContain("lantern-keeper");

    expect(engine.soloScore("fishing", 5, T0)).toBe(5);
    expect(engine.getSnapshot().achievements).toContain("fish-feast");
    expect(engine.soloScore("mirror", 11, T0)).toBe(11);
    expect(engine.getSnapshot().achievements).not.toContain("mirror-friend");
    expect(engine.soloScore("mirror", 1, T0)).toBe(12);
    expect(engine.getSnapshot().achievements).toContain("mirror-friend");

    for (let i = 1; i <= 4; i += 1) engine.soloDone("combo", 3, T0 + i * 1_000);
    expect(engine.getSnapshot().achievements).not.toContain("solo-player");
    expect(engine.soloDone("combo", 3, T0 + 9_000)).toBe(true);
    expect(engine.getSnapshot().achievements).toContain("solo-player");
  });

  it("节目单连招的门槛跟着台本走：差一步不给「全通」", () => {
    const engine = girl(makeStorage(bond({
      achievements: ["ball-rhythm", "lantern-keeper", "fish-feast", "mirror-friend", "solo-player"],
    })));
    const need = COMBO_STEPS.length;
    expect(engine.soloScore("combo", need - 1, T0)).toBe(need - 1);
    expect(engine.getSnapshot().achievements).not.toContain("full-rundown");
    expect(engine.soloScore("combo", need, T0)).toBe(need);
    expect(engine.getSnapshot().achievements).toContain("full-rundown");
  });
});

describe("v1.18 自娱汇报与跨重启", () => {
  it("汇报三行封顶：首行是件数与战果，之后按战果列两件", () => {
    const engine = girl(makeStorage(bond({
      solo: { ballBest: 5, comboBest: 0, flares: 3, moths: 9, fish: 6, mirror: 0, seen: ["ball", "lantern", "fishing"] },
    })));
    expect(engine.selfPlayReportNow(T0)).toBe(true);
    const lines = line(engine)!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`自娱 3/5 件 · 战果 ${5 + 3 + 6}`);
    expect(lines[1]).toBe(`${SOLO_LABELS.fishing} 6`);
    expect(lines[2]).toBe(`${SOLO_LABELS.ball} 5`);
  });

  it("一件都没玩过也肯回话：不报空数字", () => {
    const engine = girl();
    expect(engine.selfPlayReportNow(T0)).toBe(true);
    expect(line(engine)).toContain("自娱 0/5 件 · 战果 0");
  });

  it("账本跨重启保留，且落盘就是这一个形状", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    engine.soloStart("mirror", T0);
    engine.soloScore("mirror", 3, T0 + 500);
    engine.soloScare(T0 + 700);
    engine.soloStart("ball", T0 + 1_000);
    engine.soloScore("ball", 2, T0 + 1_500);
    engine.soloDone("ball", 2, T0 + 2_000);

    expect(JSON.parse(storage.getItem(BOND_KEY)!).solo).toEqual({
      ballBest: 2, comboBest: 0, flares: 0, moths: 1, fish: 0, mirror: 3, seen: ["mirror", "ball"],
    });

    const again = girl(storage);
    expect(solo(again)).toEqual({
      ballBest: 2, comboBest: 0, flares: 0, moths: 1, fish: 0, mirror: 3, seen: ["mirror", "ball"],
    });
    expect(again.getSnapshot().stats.selfPlay).toBe(1);
    // 读回来的账照样参与门槛：再照 9 面镜子才凑满 12 枚「对镜人」。
    expect(again.getSnapshot().achievements).not.toContain("mirror-friend");
    expect(again.soloScore("mirror", 9, T0)).toBe(12);
    expect(again.getSnapshot().achievements).toContain("mirror-friend");
  });

  it("快照给出去的那份是副本：外面改不动她的账", () => {
    const engine = girl();
    engine.soloStart("ball", T0);
    const snap = engine.getSnapshot();
    snap.solo.seen.push("fishing");
    snap.solo.ballBest = 99;
    expect(solo(engine).seen).toEqual(["ball"]);
    expect(solo(engine).ballBest).toBe(0);
  });

  it("坏档退回空账本，不把她已有的成就与统计一起拖没", () => {
    const engine = girl(makeStorage(bond({
      stats: { ...EMPTY_STATS, pats: 6 },
      solo: { ballBest: "x", moths: -4, seen: "ball", nope: 1 },
    })));
    expect(solo(engine)).toEqual(EMPTY_SOLO);
    expect(engine.getSnapshot().stats.pats).toBe(6);
  });
});

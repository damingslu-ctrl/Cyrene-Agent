import { describe, expect, it } from "vitest";
import {
  CompanionEngine,
  GIRL_BIRD_AWAY_LINES,
  GIRL_BIRD_LINES,
  GIRL_BOX_CATCH_LINES,
  GIRL_BOX_KNOCK_LINES,
  GIRL_BOX_START_LINES,
  GIRL_BRUSH_LINES,
  GIRL_BRUSH_START_LINES,
  GIRL_CATNIP_LINES,
  GIRL_CATNIP_START_LINES,
  GIRL_LASER_LINES,
  GIRL_LASER_MISS_LINES,
  GIRL_LASER_START_LINES,
  GIRL_PLANE_LINES,
  GIRL_PLANE_MISS_LINES,
  GIRL_PLANE_START_LINES,
} from "./companion";
import { ACHIEVEMENTS } from "./girl-achievements";

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

const line = (engine: CompanionEngine) => engine.getSnapshot().bubble?.text;

describe("纸箱（引擎）", () => {
  it("开工先看一眼、敲箱子有回执；从箱子里被点中才计数", () => {
    const engine = girl();
    expect(engine.boxStart(T0)).toBe(true);
    expect(GIRL_BOX_START_LINES).toContain(line(engine));
    expect(engine.boxKnock(T0 + 1_000)).toBe(true);
    expect(GIRL_BOX_KNOCK_LINES).toContain(line(engine));

    const before = engine.getVitals().affinity;
    expect(engine.boxCatch(T0 + 2_000)).toBe(true);
    expect(engine.getSnapshot().stats.boxes).toBe(1);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(GIRL_BOX_CATCH_LINES).toContain(line(engine));
  });

  it("两回就解锁「纸箱领主」，徽章占住这一句", () => {
    const engine = girl();
    engine.boxCatch(T0);
    expect(engine.getSnapshot().achievements).toEqual([]);
    engine.boxCatch(T0 + 5_000);
    const snap = engine.getSnapshot();
    expect(snap.stats.boxes).toBe(2);
    expect(snap.achievements).toEqual(["box-hide"]);
    expect(snap.achievementId).toBe("box-hide");
    expect(line(engine)).toBe(ACHIEVEMENTS.find((a) => a.id === "box-hide")!.line);
  });
});

describe("激光笔（引擎）", () => {
  it("开工有一句；扑中三次才解锁红光猎人；空手自嘲不计数", () => {
    const engine = girl();
    expect(engine.laserStart(T0)).toBe(true);
    expect(GIRL_LASER_START_LINES).toContain(line(engine));
    expect(engine.laserEnd(T0 + 1_000, false)).toBe(false);
    expect(GIRL_LASER_MISS_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.lasers).toBe(0);

    expect(engine.laserEnd(T0 + 4_000, true)).toBe(true);
    expect(GIRL_LASER_LINES).toContain(line(engine));
    engine.laserEnd(T0 + 8_000, true);
    engine.laserEnd(T0 + 12_000, true);
    const snap = engine.getSnapshot();
    expect(snap.stats.lasers).toBe(3);
    expect(snap.achievements).toEqual(["laser-catch"]);
    // 徽章优先级更高：第三下亮徽章，句子让给成就词。
    expect(line(engine)).toBe(ACHIEVEMENTS.find((a) => a.id === "laser-catch")!.line);
  });
});

describe("梳毛（引擎）", () => {
  it("梳到一半点她会多涨一点；整轮梳完才计一次", () => {
    const engine = girl();
    expect(engine.brushStart(T0)).toBe(true);
    expect(GIRL_BRUSH_START_LINES).toContain(line(engine));
    const before = engine.getVitals().affinity;
    expect(engine.brushBoost(T0 + 500)).toBe(true);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(engine.brushEnd(T0 + 5_000, false)).toBe(false);
    expect(engine.getSnapshot().stats.brushes).toBe(0);
    expect(engine.brushEnd(T0 + 6_000, true)).toBe(true);
    expect(engine.getSnapshot().stats.brushes).toBe(1);
    expect(GIRL_BRUSH_LINES).toContain(line(engine));
  });

  it("第十轮解锁梳毛上瘾", () => {
    const engine = girl();
    for (let i = 0; i < 10; i += 1) engine.brushEnd(T0 + i * 7_000, true);
    expect(engine.getSnapshot().stats.brushes).toBe(10);
    expect(engine.getSnapshot().achievements).toEqual(["purr-engine", "brush-lover"]);
  });
});

describe("猫薄荷（引擎）", () => {
  it("嗅一下开工；戳叶子多吸一口；一轮打完才计数，两轮解锁薄荷微醺", () => {
    const engine = girl();
    expect(engine.catnipStart(T0)).toBe(true);
    expect(GIRL_CATNIP_START_LINES).toContain(line(engine));
    expect(engine.catnipPuff(T0 + 900)).toBe(true);
    expect(engine.getSnapshot().stats.catnips).toBe(0);
    expect(engine.catnipEnd(T0 + 6_400, true)).toBe(true);
    expect(GIRL_CATNIP_LINES).toContain(line(engine));
    expect(engine.catnipEnd(T0 + 14_000, true)).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.stats.catnips).toBe(2);
    expect(snap.achievements).toEqual(["catnip-high"]);
  });
});

describe("纸飞机（引擎）", () => {
  it("丢出去有一句；接住计数，飞走只叹气", () => {
    const engine = girl();
    expect(engine.planeStart(T0)).toBe(true);
    expect(GIRL_PLANE_START_LINES).toContain(line(engine));

    expect(engine.planeEnd(T0 + 3_000, false)).toBe(false);
    expect(GIRL_PLANE_MISS_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.planes).toBe(0);

    expect(engine.planeEnd(T0 + 8_000, true)).toBe(true);
    expect(GIRL_PLANE_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.planes).toBe(1);
  });

  it("接住两架解锁空中小偷", () => {
    const engine = girl();
    engine.planeEnd(T0, true);
    engine.planeEnd(T0 + 9_000, true);
    expect(engine.getSnapshot().achievements).toEqual(["plane-catch"]);
  });
});

describe("小鸟来访（引擎）", () => {
  it("来看她时惊呼一句、飞走时道别，全程不涨亲密度也不动统计", () => {
    const engine = girl();
    const before = { vitals: engine.getVitals(), stats: engine.getSnapshot().stats };
    expect(engine.birdVisit(T0)).toBe(true);
    expect(GIRL_BIRD_LINES).toContain(line(engine));
    expect(engine.birdFlee(T0 + 6_000)).toBe(true);
    expect(GIRL_BIRD_AWAY_LINES).toContain(line(engine));
    expect(engine.getVitals()).toEqual(before.vitals);
    expect(engine.getSnapshot().stats).toEqual(before.stats);
  });
});

describe("成长记录", () => {
  it("三行档位与天数、徽章与互动总数；数字随互动变化", () => {
    const engine = girl();
    expect(engine.growthReport(T0)).toBe(true);
    expect(line(engine)).toBe("亲近 · 第 1 天\n徽章 0/18\n互动 0 次");

    engine.boxCatch(T0 + 1_000);
    engine.planeEnd(T0 + 2_000, true);
    expect(engine.growthReport(T0 + 3_000)).toBe(true);
    expect(line(engine)).toBe("亲近 · 第 1 天\n徽章 0/18\n互动 3 次");
  });

  it("安静期与四足形态不答（免得当成系统播报）", () => {
    const cat = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    expect(cat.growthReport(T0)).toBe(false);
    const engine = girl();
    engine.setQuiet(true);
    expect(engine.growthReport(T0)).toBe(false);
  });
});

describe("新玩具的闸门与存档", () => {
  it("安静期六件全不接、不写统计", () => {
    const engine = girl();
    engine.setQuiet(true);
    expect(engine.boxStart(T0)).toBe(false);
    expect(engine.boxKnock(T0)).toBe(false);
    expect(engine.boxCatch(T0)).toBe(false);
    expect(engine.laserStart(T0)).toBe(false);
    expect(engine.laserEnd(T0, true)).toBe(false);
    expect(engine.brushStart(T0)).toBe(false);
    expect(engine.brushBoost(T0)).toBe(false);
    expect(engine.brushEnd(T0, true)).toBe(false);
    expect(engine.catnipStart(T0)).toBe(false);
    expect(engine.catnipPuff(T0)).toBe(false);
    expect(engine.catnipEnd(T0, true)).toBe(false);
    expect(engine.planeStart(T0)).toBe(false);
    expect(engine.planeEnd(T0, true)).toBe(false);
    expect(engine.birdVisit(T0)).toBe(false);
    expect(engine.birdFlee(T0)).toBe(false);
    expect(engine.getSnapshot().stats).toEqual({
      pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0,
      boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
      scratches: 0, bells: 0, mice: 0, moles: 0, hugs: 0, purrs: 0, rains: 0, quests: 0,
    });
  });

  it("睡着时同样不接（叫醒只能靠摸/戳）", () => {
    const engine = girl();
    engine.handleCommand("toggle-sleep", T0);
    expect(engine.boxStart(T0)).toBe(false);
    expect(engine.laserStart(T0)).toBe(false);
    expect(engine.brushStart(T0)).toBe(false);
    expect(engine.catnipStart(T0)).toBe(false);
    expect(engine.planeStart(T0)).toBe(false);
  });

  it("新统计跨重启保留；缺字段的旧档读出来是 0 而不是 NaN", () => {
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({
        metAt: T0, morningKey: "", nightKey: "",
        stats: { pats: 4, catches: 0, wand: 0, bubbles: 0, pounces: 0 },
      }),
    });
    const engine = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.getSnapshot().stats).toEqual({
      pats: 4, catches: 0, wand: 0, bubbles: 0, pounces: 0,
      boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
      scratches: 0, bells: 0, mice: 0, moles: 0, hugs: 0, purrs: 0, rains: 0, quests: 0,
    });
    engine.boxCatch(T0 + 1_000);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.stats.boxes).toBe(1);
  });
});

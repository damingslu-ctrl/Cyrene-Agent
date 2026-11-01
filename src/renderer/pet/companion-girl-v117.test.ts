// v1.17 日常系统：心情 / 本命玩具 / 小把戏 / 拾荒 / 躲猫猫 / 薄荷盆。
import { describe, expect, it } from "vitest";
import { CompanionEngine, type CompanionContext } from "./companion";
import { dateKey } from "./girl-bond";
import { EMPTY_STATS } from "./girl-achievements";
import { GARDEN_STAGES } from "./girl-garden";
import { TREASURES } from "./girl-treasure";

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

describe("v1.17 每日心情", () => {
  it("第一天是精神满满且不落盘；跨天按昨天的照顾量滚出心情并落盘", () => {
    const storage = makeStorage();
    const first = girl(storage);
    expect(first.getSnapshot().moodId).toBe("lively");
    expect(JSON.parse(storage.getItem(BOND_KEY)!).mood).toBeNull();

    const yesterday = dateKey(WALL - 86_400_000);
    const lazyStorage = makeStorage(bond({
      questDay: yesterday,
      dayCounts: { pats: 0, plays: 0, feeds: 0, toys: 1 },
    }));
    const lazy = girl(lazyStorage, seq([0.5, 0.5, 0.2]));
    expect(lazy.getSnapshot().moodId).toBe("lazy");
    expect(JSON.parse(lazyStorage.getItem(BOND_KEY)!).mood).toEqual({ day: dateKey(WALL), id: "lazy" });
  });

  it("心情只从第二天起改节奏：懒洋洋更早坐下；第一天仍按 40s", () => {
    const yesterday = dateKey(WALL - 86_400_000);
    const lazy = girl(makeStorage(bond({
      questDay: yesterday,
      dayCounts: { pats: 0, plays: 0, feeds: 0, toys: 1 },
    })), seq([0.5, 0.5, 0.2]));
    lazy.update(T0 + 26_000, still);
    expect(lazy.getSnapshot().activity).toBe("rest");

    const fresh = girl();
    fresh.update(T0 + 26_000, still);
    expect(fresh.getSnapshot().activity).not.toBe("rest");
    fresh.update(T0 + 40_000, still);
    expect(fresh.getSnapshot().activity).toBe("rest");
  });

  it("黏人的日子亲和度吃得更足；心情报告两行", () => {
    const today = dateKey(WALL);
    const clingy = girl(makeStorage(bond({
      questDay: today,
      mood: { day: today, id: "clingy" },
    })));
    expect(clingy.getSnapshot().moodId).toBe("clingy");
    const before = clingy.getVitals().affinity;
    expect(clingy.touch("head", T0)).toBe(true);
    expect(clingy.getVitals().affinity).toBeCloseTo(before + 0.04 * 1.18, 6);

    expect(clingy.moodReport(T0 + 1_000)).toBe(true);
    expect(line(clingy)).toBe("今天的心情 · 黏人\n今天想离你近一点，别走太远");
  });
});

describe("v1.17 小把戏", () => {
  it("教三次才学会击掌；每次回执清楚；学会后不再计数", () => {
    const engine = girl();
    expect(engine.trickTeach("high-five", T0)).toEqual({ learned: false, already: false, count: 1, need: 3 });
    expect(line(engine)).toBe("击掌 · 还差 2 次");
    expect(engine.trickTeach("high-five", T0 + 1_000)).toMatchObject({ count: 2, learned: false });
    expect(engine.trickTeach("high-five", T0 + 2_000)).toMatchObject({ count: 3, learned: true });
    expect(line(engine)).toBe("把手举高一点…啪！");
    expect(engine.getSnapshot().gesture).toBe("wave");
    expect(engine.trickTeach("high-five", T0 + 3_000)).toMatchObject({ already: true, learned: false });
    expect(engine.getSnapshot().tricks.counts["high-five"]).toBe(3);
  });

  it("四件全学会解锁「小把戏全通」；计数跨重启保留", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    for (let i = 0; i < 3; i += 1) engine.trickTeach("high-five", T0 + i * 1_000);
    for (let i = 0; i < 4; i += 1) engine.trickTeach("spin", T0 + 10_000 + i * 1_000);
    for (let i = 0; i < 3; i += 1) engine.trickTeach("nod", T0 + 20_000 + i * 1_000);
    expect(engine.getSnapshot().achievements).not.toContain("trick-master");
    for (let i = 0; i < 5; i += 1) engine.trickTeach("shy", T0 + 30_000 + i * 1_000);
    expect(engine.getSnapshot().achievements).toContain("trick-master");

    const again = girl(storage);
    expect(again.getSnapshot().tricks.counts).toEqual({ "high-five": 3, spin: 4, nod: 3, shy: 5 });
    expect(again.getSnapshot().achievements).toContain("trick-master");
    expect(again.trickReportNow(T0 + 100_000)).toBe(true);
    expect(line(again)?.startsWith("小把戏 4/4")).toBe(true);
  });
});

describe("v1.17 桌边拾荒", () => {
  it("捡到的一件进小口袋；六件解锁「桌边拾荒人」；跨重启保留", () => {
    const storage = makeStorage();
    const engine = girl(storage, seq([0.5, 0.5, 0]));
    const find = engine.sniffTreasure(T0);
    expect(find).toMatchObject({ id: "button", label: "亮纽扣", count: 1, total: 1 });
    expect(line(engine)).toBe("捡到亮纽扣，先收好");
    expect(engine.getSnapshot().treasures.counts.button).toBe(1);

    for (let i = 1; i < 6; i += 1) engine.sniffTreasure(T0 + i * 1_000);
    expect(engine.getSnapshot().achievements).toContain("treasure-hunter");
    expect(engine.getSnapshot().treasures.counts.button).toBe(6);

    const again = girl(storage);
    expect(again.getSnapshot().treasures.counts.button).toBe(6);
    expect(again.treasureReportNow(T0 + 100_000)).toBe(true);
    expect(line(again)).toContain("小口袋 6 件");
    expect(line(again)).not.toContain("没捡到过");
  });

  it("空口袋报告两行；六件目录里每一件都能被抽到", () => {
    const engine = girl();
    expect(engine.treasureReportNow(T0)).toBe(true);
    expect(line(engine)).toBe("小口袋 还没捡到过什么\n带我到处转转吧");
    expect(TREASURES).toHaveLength(6);
  });
});

describe("v1.17 躲猫猫", () => {
  it("开局→探头逮到才记一笔；同一局不重复记；空手一句自嘲", () => {
    const engine = girl();
    expect(engine.hideStart(T0)).toBe(true);
    expect(line(engine)).toBe("你来找我呀，数到三就探头");
    expect(engine.hideResult(true, T0 + 1_300)).toBe(true);
    expect(engine.getSnapshot().hides).toBe(1);
    expect(engine.hideResult(true, T0 + 1_400)).toBe(false);
    expect(engine.getSnapshot().hides).toBe(1);

    expect(engine.hideStart(T0 + 20_000)).toBe(true);
    expect(engine.hideResult(false, T0 + 23_500)).toBe(true);
    expect(line(engine)).toBe("没找到我，我在这里呢");
    expect(engine.getSnapshot().hides).toBe(1);
    expect(engine.hideResult(false, T0 + 24_000)).toBe(false);
  });

  it("三次逮到解锁「躲猫猫高手」；计数跨重启保留；过期的回执不认", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    for (let i = 0; i < 3; i += 1) {
      const at = T0 + i * 10_000;
      expect(engine.hideStart(at)).toBe(true);
      expect(engine.hideResult(true, at + 1_500)).toBe(true);
    }
    expect(engine.getSnapshot().hides).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("hide-seeker");

    const stale = girl(makeStorage());
    expect(stale.hideStart(T0)).toBe(true);
    expect(stale.hideResult(true, T0 + 10_000)).toBe(false);
    expect(stale.getSnapshot().hides).toBe(0);

    const again = girl(storage);
    expect(again.getSnapshot().hides).toBe(3);
  });
});

describe("v1.17 薄荷盆", () => {
  it("种下后按墙上时间发芽/长叶/成熟；成熟才能收一茬", () => {
    let wall = WALL;
    const engine = girl(makeStorage(), seq([0.5]), () => wall);
    expect(engine.getSnapshot().gardenStage).toBe("empty");
    expect(engine.gardenPlant(T0)).toBe(true);
    expect(line(engine)).toBe("种下啦，等它发芽");
    expect(engine.gardenPlant(T0 + 1_000)).toBe(false);
    expect(line(engine)).toBe("盆里还种着东西呢");
    expect(engine.getSnapshot().gardenStage).toBe("seed");

    wall = WALL + GARDEN_STAGES.sprout;
    expect(engine.getSnapshot().gardenStage).toBe("sprout");
    wall = WALL + GARDEN_STAGES.leafy;
    expect(engine.getSnapshot().gardenStage).toBe("leafy");
    expect(engine.gardenHarvest(T0 + 2_000)).toBe(false);
    expect(line(engine)).toBe("还没长好，再等等");

    wall = WALL + GARDEN_STAGES.ready;
    expect(engine.getSnapshot().gardenStage).toBe("ready");
    expect(engine.gardenHarvest(T0 + 3_000)).toBe(true);
    expect(line(engine)).toBe("薄荷收好啦，香香的");
    expect(engine.getSnapshot().garden).toEqual({ plantedAt: -1, harvests: 1 });
    expect(engine.gardenReportNow(T0 + 4_000)).toBe(true);
    expect(line(engine)).toContain("薄荷盆 空着");
  });

  it("跨重启继续长；收两茬解锁「薄荷园丁」；空盆报告两行", () => {
    let wall = WALL;
    const storage = makeStorage();
    const engine = girl(storage, seq([0.5]), () => wall);
    expect(engine.gardenReportNow(T0)).toBe(true);
    expect(line(engine)).toBe("薄荷盆 空着\n种一颗吧，很快会发芽");

    engine.gardenPlant(T0);
    wall = WALL + GARDEN_STAGES.sprout + 1_000;
    const reopened = girl(storage, seq([0.5]), () => wall);
    expect(reopened.getSnapshot().gardenStage).toBe("sprout");
    wall = WALL + GARDEN_STAGES.ready;
    expect(reopened.gardenHarvest(T0 + 1_000)).toBe(true);

    wall = WALL + GARDEN_STAGES.ready + 10_000;
    reopened.gardenPlant(T0 + 2_000);
    wall = WALL + GARDEN_STAGES.ready * 2 + 10_000;
    expect(reopened.gardenHarvest(T0 + 3_000)).toBe(true);
    expect(reopened.getSnapshot().garden.harvests).toBe(2);
    expect(reopened.getSnapshot().achievements).toContain("garden-keeper");
  });
});

describe("v1.17 本命玩具与安静闸门", () => {
  it("本命玩具从既有统计里挑，够三次才算；报告带一次点名", () => {
    const none = girl();
    expect(none.getSnapshot().favorite).toBeNull();
    expect(none.favoriteReportNow(T0)).toBe(true);
    expect(line(none)).toBe("本命玩具 还没选中\n多陪我玩几次就知道了");

    const picked = girl(makeStorage(bond({
      stats: { ...EMPTY_STATS, wand: 3 },
    })));
    expect(picked.getSnapshot().favorite).toEqual({ id: "wand", label: "逗猫棒", count: 3 });
    expect(picked.favoriteReportNow(T0)).toBe(true);
    expect(line(picked)).toContain("本命玩具 逗猫棒 · 3 次");
  });

  it("本命玩到八次、且有第二件够格的玩具，才解锁「本命认定」", () => {
    const engine = girl(makeStorage(bond({
      stats: { ...EMPTY_STATS, wand: 7, bubbles: 3 },
      achievements: ["first-wand"],
    })));
    expect(engine.wandEnd(T0, true)).toBe(true);
    expect(engine.getSnapshot().stats.wand).toBe(8);
    expect(engine.getSnapshot().achievements).toContain("true-favorite");
  });

  it("只有一件玩具时谈不上「本命」：玩到八次也不给认定", () => {
    const engine = girl(makeStorage(bond({
      stats: { ...EMPTY_STATS, wand: 7 },
      achievements: ["first-wand"],
    })));
    expect(engine.wandEnd(T0, true)).toBe(true);
    expect(engine.getSnapshot().stats.wand).toBe(8);
    expect(engine.getSnapshot().achievements).not.toContain("true-favorite");
  });

  it("安静期六件日常全部不接，也不写一份存档", () => {
    const storage = makeStorage();
    const engine = girl(storage);
    engine.setQuiet(true);
    expect(engine.hideStart(T0)).toBe(false);
    expect(engine.sniffTreasure(T0)).toBeNull();
    expect(engine.trickTeach("nod", T0)).toBeNull();
    expect(engine.gardenPlant(T0)).toBe(false);
    expect(engine.gardenHarvest(T0)).toBe(false);
    expect(engine.moodReport(T0)).toBe(false);
    expect(engine.favoriteReportNow(T0)).toBe(false);
    expect(engine.trickReportNow(T0)).toBe(false);
    expect(engine.treasureReportNow(T0)).toBe(false);
    expect(engine.gardenReportNow(T0)).toBe(false);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.tricks.counts).toEqual({ "high-five": 0, spin: 0, nod: 0, shy: 0 });
    expect(saved.treasures.counts).toEqual({ button: 0, feather: 0, pebble: 0, ribbon: 0, cap: 0, leaf: 0 });
    expect(saved.garden).toEqual({ plantedAt: -1, harvests: 0 });
    expect(saved.hides).toBe(0);
  });

  it("睡着时同样不接（叫醒只能靠摸/戳）", () => {
    const engine = girl();
    engine.handleCommand("toggle-sleep", T0);
    expect(engine.hideStart(T0)).toBe(false);
    expect(engine.sniffTreasure(T0)).toBeNull();
    expect(engine.trickTeach("nod", T0)).toBeNull();
    expect(engine.gardenPlant(T0)).toBe(false);
  });
});

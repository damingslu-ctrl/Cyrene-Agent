// v1.13.0：追尾巴/踩奶/翻跟头/看书/礼物/许愿/跳格子/雪人/每日抽签接到引擎上。
import { describe, expect, it } from "vitest";
import {
  CompanionEngine,
  GIRL_BOOK_LINES,
  GIRL_BOOK_START_LINES,
  GIRL_FORTUNE_START_LINES,
  GIRL_GIFT_LINES,
  GIRL_GIFT_START_LINES,
  GIRL_HOP_LINES,
  GIRL_HOP_MISS_LINES,
  GIRL_HOP_START_LINES,
  GIRL_KNEAD_LINES,
  GIRL_ROLL_LINES,
  GIRL_SNOWMAN_LINES,
  GIRL_SNOW_START_LINES,
  GIRL_TAIL_DIZZY_LINES,
  GIRL_TAIL_LINES,
  GIRL_WISH_LINES,
  type CompanionContext,
} from "./companion";
import { ACHIEVEMENTS } from "./girl-achievements";
import { PURR_MS } from "./girl-purr";
import { RAIN_MS } from "./girl-rain";
import { SNOW_MS } from "./girl-snow";

const T0 = 1_700_000_000_000;
const BOND_KEY = "cyrene.pet.bond.v1";
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 82, height: 108 };
const ctx: CompanionContext = { workArea, size, canRoam: true };

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

function girl(storage = makeStorage(), random = seq([0.5]), wallNow?: () => number) {
  const engine = new CompanionEngine({ storage, now: () => T0, wallNow: wallNow ?? (() => T0), random });
  engine.setForm("girl");
  return engine;
}

const line = (engine: CompanionEngine) => engine.getSnapshot().bubble?.text;

describe("v1.13 九个新互动（引擎）", () => {
  it("追尾巴：开工/逗晕各有话；整轮走完才计数，三轮解锁尾巴猎手", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.tailStart(T0)).toBe(true);
    expect(engine.tailDizzy(T0 + 1_000)).toBe(true);
    expect(GIRL_TAIL_DIZZY_LINES).toContain(line(engine));
    expect(engine.tailEnd(T0 + 2_000, false)).toBe(false);
    expect(engine.getSnapshot().stats.tails).toBe(0);

    expect(engine.tailEnd(T0 + 6_000, true)).toBe(true);
    expect(GIRL_TAIL_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.tails).toBe(1);
    engine.tailEnd(T0 + 14_000, true);
    engine.tailEnd(T0 + 22_000, true);
    expect(engine.getSnapshot().stats.tails).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("tail-chaser");
  });

  it("踩奶：踩完起呼噜、涨亲切；三轮解锁踩奶师傅", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setVitals({ affinity: 0.3 });
    expect(engine.kneadStart(t)).toBe(true);
    expect(engine.getSnapshot().purrLeft).toBe(0);
    t = T0 + 5_000;
    expect(engine.kneadEnd(t)).toBe(true);
    expect(GIRL_KNEAD_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.kneads).toBe(1);
    expect(engine.getSnapshot().purrLeft).toBe(PURR_MS);

    engine.kneadEnd(T0 + 13_000);
    engine.kneadEnd(T0 + 21_000);
    expect(engine.getSnapshot().achievements).toContain("knead-master");
  });

  it("翻跟头：翻满三轮解锁翻滚艺术家；没翻完不计数", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    engine.rollStart(T0);
    expect(engine.rollEnd(T0 + 1_000, false)).toBe(false);
    expect(engine.rollEnd(T0 + 5_000)).toBe(true);
    expect(GIRL_ROLL_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.rolls).toBe(1);
    for (let i = 1; i < 3; i += 1) expect(engine.rollEnd(T0 + 5_000 + i * 8_000)).toBe(true);
    expect(engine.getSnapshot().stats.rolls).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("roll-artist");
  });

  it("看书：读满两本解锁书页间的猫", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.bookStart(T0)).toBe(true);
    expect(GIRL_BOOK_START_LINES).toContain(line(engine));
    expect(engine.bookEnd(T0 + 8_000)).toBe(true);
    expect(GIRL_BOOK_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.books).toBe(1);
    expect(engine.getSnapshot().achievements).not.toContain("bookworm");
    engine.bookEnd(T0 + 16_000);
    expect(engine.getSnapshot().achievements).toContain("bookworm");
  });

  it("礼物盒：拆开才计数、三份解锁拆礼物的人", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.giftStart(T0)).toBe(true);
    expect(GIRL_GIFT_START_LINES).toContain(line(engine));
    expect(engine.giftOpen(T0 + 2_000)).toBe(true);
    expect(GIRL_GIFT_LINES).toContain(line(engine));
    for (let i = 1; i < 3; i += 1) expect(engine.giftOpen(T0 + 2_000 + i * 7_000)).toBe(true);
    expect(engine.getSnapshot().stats.gifts).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("gift-opener");
  });

  it("许愿星：每颗星只许一次、五次要解锁许愿的人；不刷今日陪玩", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.wishStart(T0)).toBe(true);
    expect(engine.wishMake(T0 + 1_000)).toBe(true);
    expect(GIRL_WISH_LINES).toContain(line(engine));
    for (let i = 1; i < 5; i += 1) expect(engine.wishMake(T0 + 1_000 + i * 7_000)).toBe(true);
    expect(engine.getSnapshot().stats.wishes).toBe(5);
    expect(engine.getSnapshot().achievements).toContain("wish-maker");
    expect(engine.getSnapshot().quests.counts.play).toBe(0);
  });

  it("跳格子：踩歪有回执；两轮全中解锁跳格子高手", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.hopscotchStart(T0)).toBe(true);
    expect(GIRL_HOP_START_LINES).toContain(line(engine));
    expect(engine.hopscotchMiss(T0 + 1_000)).toBe(true);
    expect(GIRL_HOP_MISS_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.hopscotch).toBe(0);

    expect(engine.hopscotchDone(T0 + 8_000)).toBe(true);
    expect(GIRL_HOP_LINES).toContain(line(engine));
    engine.hopscotchDone(T0 + 16_000);
    expect(engine.getSnapshot().stats.hopscotch).toBe(2);
    expect(engine.getSnapshot().achievements).toContain("hopscotch-pro");
  });
});

describe("v1.13 雪天（引擎）", () => {
  it("下雪计 24 秒，与雨互斥：开雪收雨、开雨收雪", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    expect(engine.snowStart(T0)).toBe(true);
    expect(GIRL_SNOW_START_LINES).toContain(line(engine));
    expect(engine.getSnapshot().snowLeft).toBe(SNOW_MS);
    expect(engine.getSnapshot().rainLeft).toBe(0);

    t = T0 + 1_000;
    expect(engine.update(t, ctx).snowLeft).toBe(SNOW_MS - 1_000);

    t = T0 + 2_000;
    engine.rainStart(t);
    expect(engine.getSnapshot().snowLeft).toBe(0);
    expect(engine.getSnapshot().rainLeft).toBe(RAIN_MS);

    t = T0 + 3_000;
    engine.snowStart(t);
    expect(engine.getSnapshot().rainLeft).toBe(0);
    expect(engine.getSnapshot().snowLeft).toBe(SNOW_MS);

    t = T0 + 3_000 + SNOW_MS;
    expect(engine.update(t, ctx).snowLeft).toBe(0);
  });

  it("堆成雪人才计数；第一次就解锁雪人建筑师", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.snowmanMade(T0)).toBe(true);
    // 首枚徽章和堆雪人同刻：徽章那句优先级更高，占着气泡。
    expect(line(engine)).toBe(ACHIEVEMENTS.find((a) => a.id === "snow-builder")?.line);
    expect(engine.getSnapshot().stats.snowmen).toBe(1);
    expect(engine.getSnapshot().achievements).toContain("snow-builder");

    expect(engine.snowmanMade(T0 + 8_000)).toBe(true);
    expect(GIRL_SNOWMAN_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.snowmen).toBe(2);
  });
});

describe("v1.13 每日抽签（引擎）", () => {
  it("同一天只抽一张：再抽还是那张；揭晓只记一次，错档不认", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    const first = engine.fortuneStart(T0);
    expect(first).not.toBeNull();
    expect(GIRL_FORTUNE_START_LINES).toContain(line(engine));
    const again = engine.fortuneStart(T0 + 8_000)!;
    expect(again).toEqual(first!);

    expect(engine.fortuneReveal((first!.tier + 1) % 4, T0 + 9_000)).toBe(false);
    expect(engine.fortuneReveal(first!.tier, T0 + 9_500)).toBe(true);
    expect(engine.getSnapshot().stats.fortunes).toBe(1);
    expect(line(engine)).toBe(first!.line);
    expect(engine.fortuneReveal(first!.tier, T0 + 10_000)).toBe(false);
  });

  it("跨重启：当天已抽的签和揭晓状态都还在；换一天可以重新抽", () => {
    let wall = new Date(2026, 9, 25, 9, 0, 0).getTime();
    const storage = makeStorage();
    const engine = girl(storage, seq([0.9]), () => wall);
    const today = engine.fortuneStart(T0)!;
    expect(today.tier).toBe(3);
    expect(engine.fortuneReveal(today.tier, T0 + 1_000)).toBe(true);
    expect(JSON.parse(storage.getItem(BOND_KEY)!).fortune).toMatchObject({
      day: "2026-10-25", tier: 3, drawn: true,
    });

    const reopened = girl(storage, seq([0.1]), () => wall);
    expect(reopened.fortuneStart(T0 + 2_000)).toEqual(today);
    expect(reopened.fortuneReveal(today.tier, T0 + 3_000)).toBe(false);

    wall = new Date(2026, 9, 26, 9, 0, 0).getTime();
    const tomorrow = reopened.fortuneStart(T0 + 4_000)!;
    expect(tomorrow).not.toEqual(today);
    expect(reopened.fortuneReveal(tomorrow.tier, T0 + 5_000)).toBe(true);
    expect(reopened.getSnapshot().stats.fortunes).toBe(2);
  });

  it("坏存档里的签不会让她卡住：认不出的字段一律重抽", () => {
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({ fortune: { day: "not-a-day", tier: 99, line: 7, drawn: "yes" } }),
    });
    const engine = girl(storage, seq([0.5]), () => T0);
    expect(engine.fortuneStart(T0)).not.toBeNull();
  });
});

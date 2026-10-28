import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS, ACHIEVEMENT_IDS, ACHIEVEMENT_MS, EMPTY_STATS, achievementById, buildAchievementOps,
  newlyUnlocked, parseAchievements, parseStats, type AchievementExtras, type AchievementId, type PetStats,
} from "./girl-achievements";
import { COMBO_STEPS } from "./girl-combo";

const stats = (over: Partial<PetStats> = {}): PetStats => ({ ...EMPTY_STATS, ...over });

const extras = (over: Partial<AchievementExtras> = {}): AchievementExtras => ({
  tricks: 0, treasures: 0, hides: 0, harvests: 0, favorite: 0,
  ballBest: 0, comboBest: 0, flares: 0, moths: 0, fish: 0, mirror: 0, selfPlay: 0,
  ...over,
});

describe("成就条件", () => {
  it("新号一枚都没有；各条件各自成立后按表顺序给（一次只弹一枚）", () => {
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [])).toEqual([]);

    expect(newlyUnlocked(stats({ catches: 1 }), 1, "new", [])).toEqual(["first-catch"]);
    expect(newlyUnlocked(stats({ wand: 1 }), 1, "new", [])).toEqual(["first-wand"]);
    expect(newlyUnlocked(stats({ bubbles: 12 }), 1, "new", [])).toEqual(["bubble-lover"]);
    expect(newlyUnlocked(stats({ bubbles: 11 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 7, "new", [])).toEqual(["seven-days"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "heart", [])).toEqual(["heart-bond"]);

    // 同时满足多个：按表顺序，且已经记过的跳过。
    expect(newlyUnlocked(stats({ catches: 3, wand: 2, bubbles: 20 }), 9, "heart", []))
      .toEqual(["first-catch", "first-wand", "bubble-lover", "seven-days", "heart-bond"]);
    expect(newlyUnlocked(stats({ catches: 3, wand: 2 }), 1, "new", ["first-catch"]))
      .toEqual(["first-wand"]);
  });

  it("v1.11 五枚新成就各有自己的门槛，且互不串档（差一记不给）", () => {
    expect(newlyUnlocked(stats({ boxes: 1 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ boxes: 2 }), 1, "new", [])).toEqual(["box-hide"]);
    expect(newlyUnlocked(stats({ lasers: 2 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ lasers: 3 }), 1, "new", [])).toEqual(["laser-catch"]);
    expect(newlyUnlocked(stats({ brushes: 9 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ brushes: 10 }), 1, "new", [])).toEqual(["brush-lover"]);
    expect(newlyUnlocked(stats({ catnips: 1 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ catnips: 2 }), 1, "new", [])).toEqual(["catnip-high"]);
    expect(newlyUnlocked(stats({ planes: 1 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ planes: 2 }), 1, "new", [])).toEqual(["plane-catch"]);
    // 新玩具不碰旧条件：全套新计数拉满也不该把「第一次抓住光」带出来。
    expect(newlyUnlocked(stats({ boxes: 5, lasers: 5, brushes: 20, catnips: 5, planes: 5 }), 1, "new", []))
      .toEqual(["box-hide", "laser-catch", "brush-lover", "catnip-high", "plane-catch"]);
  });

  it("v1.13 九枚新成就各有门槛，差一记不给；v1.17 再加五枚、v1.18 再加六枚，整表 38 枚", () => {
    expect(ACHIEVEMENT_IDS).toHaveLength(38);
    expect(newlyUnlocked(stats({ tails: 2 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ tails: 3 }), 1, "new", [])).toEqual(["tail-chaser"]);
    expect(newlyUnlocked(stats({ kneads: 2 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ kneads: 3 }), 1, "new", [])).toEqual(["knead-master"]);
    expect(newlyUnlocked(stats({ rolls: 2 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ rolls: 3 }), 1, "new", [])).toEqual(["roll-artist"]);
    expect(newlyUnlocked(stats({ books: 1 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ books: 2 }), 1, "new", [])).toEqual(["bookworm"]);
    expect(newlyUnlocked(stats({ gifts: 2 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ gifts: 3 }), 1, "new", [])).toEqual(["gift-opener"]);
    expect(newlyUnlocked(stats({ wishes: 4 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ wishes: 5 }), 1, "new", [])).toEqual(["wish-maker"]);
    expect(newlyUnlocked(stats({ hopscotch: 1 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ hopscotch: 2 }), 1, "new", [])).toEqual(["hopscotch-pro"]);
    expect(newlyUnlocked(stats({ snowmen: 1 }), 1, "new", [])).toEqual(["snow-builder"]);
    expect(newlyUnlocked(stats({ fortunes: 3 }), 1, "new", [])).toEqual([]);
    expect(newlyUnlocked(stats({ fortunes: 4 }), 1, "new", [])).toEqual(["fortune-fan"]);
    // 新计数拉满也不该把旧成就带出来。
    expect(newlyUnlocked(
      stats({ tails: 9, kneads: 9, rolls: 9, books: 9 }), 1, "new", [],
    )).toEqual(["tail-chaser", "knead-master", "roll-artist", "bookworm"]);
  });

  it("v1.17 日常五枚走额外账本：把戏/拾荒/躲猫猫/收成/本命，各有门槛", () => {
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ tricks: 3 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ tricks: 4 }))).toEqual(["trick-master"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ treasures: 5 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ treasures: 6 }))).toEqual(["treasure-hunter"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ hides: 2 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ hides: 3 }))).toEqual(["hide-seeker"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ harvests: 1 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ harvests: 2 }))).toEqual(["garden-keeper"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ favorite: 7 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ favorite: 8 }))).toEqual(["true-favorite"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ tricks: 4, treasures: 6, hides: 3, harvests: 2, favorite: 8 })))
      .toEqual(["trick-master", "treasure-hunter", "hide-seeker", "garden-keeper", "true-favorite"]);
  });

  it("v1.18 自娱六枚走同一份额外账本：best 看峰值、total 看累计，差一记不给", () => {
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ ballBest: 4 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ ballBest: 5 }))).toEqual(["ball-rhythm"]);
    // 节目单连招的门槛跟着台本走：台本加一步，门槛就加一步（不许写死 5）。
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ comboBest: COMBO_STEPS.length - 1 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ comboBest: COMBO_STEPS.length }))).toEqual(["full-rundown"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ flares: 9 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ flares: 10 }))).toEqual(["lantern-keeper"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ fish: 4 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ fish: 5 }))).toEqual(["fish-feast"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ mirror: 11 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ mirror: 12 }))).toEqual(["mirror-friend"]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ selfPlay: 4 }))).toEqual([]);
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ selfPlay: 5 }))).toEqual(["solo-player"]);
    // 自娱的账不碰别人：拉满六件也只给这六枚，v1.17 那五枚一枚都不许顺带出来。
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({
      ballBest: 9, comboBest: 9, flares: 99, fish: 9, mirror: 99, selfPlay: 9,
    }))).toEqual(["ball-rhythm", "full-rundown", "lantern-keeper", "fish-feast", "mirror-friend", "solo-player"]);
    // 飞蛾是单独一笔账：赶走再多也不给拨灯那枚。
    expect(newlyUnlocked(EMPTY_STATS, 1, "new", [], extras({ moths: 20, flares: 0 }))).toEqual([]);
  });

  it("成就表与 id 表一一对应，文案不空", () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([...ACHIEVEMENT_IDS]);
    for (const id of ACHIEVEMENT_IDS) {
      const def = achievementById(id);
      expect(def?.title.length).toBeGreaterThan(0);
      expect(def?.line.length).toBeGreaterThan(0);
    }
    expect(achievementById("nope")).toBeNull();
  });
});

describe("存档解析", () => {
  it("计数器只收有限正数：负值/NaN/Infinity 归零，浮点取整，超大截断", () => {
    expect(parseStats(null)).toEqual(EMPTY_STATS);
    expect(parseStats("x")).toEqual(EMPTY_STATS);
    expect(parseStats({ pats: 3.9, catches: -2, wand: Number.NaN, bubbles: 2, pounces: Number.POSITIVE_INFINITY }))
      .toEqual({ ...EMPTY_STATS, pats: 3, bubbles: 2 });
    expect(parseStats({ pats: 1e9 }).pats).toBe(1_000_000);
    // v1.11 五条新计数缺省为 0，坏值同样归零。
    expect(parseStats({ boxes: 2, lasers: -1, brushes: 3.2, catnips: Number.NaN, planes: 4 }))
      .toEqual({ ...EMPTY_STATS, boxes: 2, brushes: 3, planes: 4 });
    // v1.13 九条新计数缺省为 0，浮点取整、坏值归零。
    expect(parseStats({ tails: 2.8, kneads: -1, rolls: Number.NaN, books: 1, gifts: 2, wishes: 3.9, hopscotch: 1, snowmen: 2, fortunes: 4 }))
      .toEqual({ ...EMPTY_STATS, tails: 2, books: 1, gifts: 2, wishes: 3, hopscotch: 1, snowmen: 2, fortunes: 4 });
    // v1.18 自娱开场次数缺省为 0，坏值同样归零。
    expect(parseStats({ selfPlay: 3.7 })).toEqual({ ...EMPTY_STATS, selfPlay: 3 });
    expect(parseStats({ selfPlay: -2 })).toEqual(EMPTY_STATS);
  });

  it("成就列表去重、去掉不认识的 id 与非字符串", () => {
    expect(parseAchievements(null)).toEqual([]);
    expect(parseAchievements("first-catch")).toEqual([]);
    expect(parseAchievements(["first-catch", "first-catch", "nope", 5, "seven-days"]))
      .toEqual(["first-catch", "seven-days"]);
  });
});

describe("成就画法", () => {
  const face = { cx: 41, top: 22, w: 46, h: 34 };

  it("只在 3.6 秒内画，坐标全有限", () => {
    expect(buildAchievementOps("first-catch", -1, face, 0)).toEqual([]);
    expect(buildAchievementOps("first-catch", ACHIEVEMENT_MS + 1, face, 0)).toEqual([]);
    const ops = buildAchievementOps("heart-bond", 800, face, 1.2);
    expect(ops.length).toBeGreaterThanOrEqual(4);
    expect(ops.some((op) => op.kind === "fillEllipse")).toBe(true);
    for (const op of ops) {
      for (const [key, value] of Object.entries(op)) {
        if (key === "kind" || key === "fill" || key === "stroke") continue;
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        if (Array.isArray(value)) expect(value.every((p) => p.every((n: number) => Number.isFinite(n)))).toBe(true);
      }
    }
  });

  it("三档奖牌用不同色调（同一份画法里可区分）", () => {
    const fills = (id: "heart-bond" | "seven-days" | "first-catch") => {
      const ops = buildAchievementOps(id, 500, face, 0);
      return ops.flatMap((op) => (op.kind === "fillEllipse" ? [op.fill] : []));
    };
    expect(new Set([...fills("heart-bond"), ...fills("seven-days"), ...fills("first-catch")]).size)
      .toBeGreaterThan(2);
  });

  it("v1.18 六枚的奖牌色调逐枚钉死（跟三档基准比色，掉档就算红）", () => {
    const tone = (id: AchievementId) => {
      const discs = buildAchievementOps(id, 500, face, 0)
        .flatMap((op) => (op.kind === "fillEllipse" ? [op.fill] : []));
      return discs[1];
    };
    const rose = tone("heart-bond");
    const green = tone("seven-days");
    const accent = tone("first-catch");
    expect(rose).not.toBe(green);
    expect(green).not.toBe(accent);
    expect(tone("ball-rhythm")).toBe(rose);
    expect(tone("mirror-friend")).toBe(rose);
    expect(tone("lantern-keeper")).toBe(green);
    expect(tone("fish-feast")).toBe(green);
    expect(tone("solo-player")).toBe(green);
    expect(tone("full-rundown")).toBe(accent);
  });
});

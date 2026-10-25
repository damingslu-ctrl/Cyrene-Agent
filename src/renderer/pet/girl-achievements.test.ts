import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS, ACHIEVEMENT_IDS, ACHIEVEMENT_MS, EMPTY_STATS, achievementById, buildAchievementOps,
  newlyUnlocked, parseAchievements, parseStats, type PetStats,
} from "./girl-achievements";

const stats = (over: Partial<PetStats> = {}): PetStats => ({ ...EMPTY_STATS, ...over });

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
});

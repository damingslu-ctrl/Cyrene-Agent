import { describe, expect, it } from "vitest";
import {
  BUBBLE_TTL_MS, CompanionEngine,
  GIRL_BELL_LINES, GIRL_BELL_START_LINES,
  GIRL_HUG_LINES, GIRL_HUG_START_LINES,
  GIRL_MOLE_END_LINES, GIRL_MOLE_START_LINES,
  GIRL_MOUSE_MISS_LINES, GIRL_MOUSE_START_LINES,
  GIRL_QUEST_DONE_LINES,
  GIRL_RAIN_START_LINES,
  GIRL_SCRATCH_LINES, GIRL_SCRATCH_START_LINES,
  type CompanionContext,
} from "./companion";
import { ACHIEVEMENTS } from "./girl-achievements";
import { PURR_MS } from "./girl-purr";
import { questDone, questsDoneCount } from "./girl-quests";
import { RAIN_MS } from "./girl-rain";

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

describe("v1.12 猫抓板 / 铃铛球 / 发条鼠 / 地鼠（引擎）", () => {
  it("猫抓板：开工说一句、点板面只涨一点；整轮磨完才计数，三轮解锁抓板艺术家", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.scratchStart(T0)).toBe(true);
    expect(GIRL_SCRATCH_START_LINES).toContain(line(engine));

    const before = engine.getVitals().affinity;
    expect(engine.scratchBoost(T0 + 200)).toBe(true);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(engine.scratchEnd(T0 + 4_000, false)).toBe(false);
    expect(engine.getSnapshot().stats.scratches).toBe(0);

    expect(engine.scratchEnd(T0 + 5_000, true)).toBe(true);
    expect(engine.getSnapshot().stats.scratches).toBe(1);
    expect(GIRL_SCRATCH_LINES).toContain(line(engine));

    engine.scratchEnd(T0 + 13_000, true);
    engine.scratchEnd(T0 + 21_000, true);
    expect(engine.getSnapshot().stats.scratches).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("scratch-art");
  });

  it("铃铛球：每声都计数、第一/三声有回执；摇过至少一声才算玩过一轮", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.bellStart(T0)).toBe(true);
    expect(GIRL_BELL_START_LINES).toContain(line(engine));

    const before = engine.getVitals().affinity;
    expect(engine.bellRing(T0 + 100, 1)).toBe(true);
    expect(engine.getSnapshot().stats.bells).toBe(1);
    expect(GIRL_BELL_LINES).toContain(line(engine));
    expect(engine.getVitals().affinity).toBeGreaterThan(before);

    engine.bellRing(T0 + 300, 2);
    engine.bellRing(T0 + 500, 3);
    expect(engine.getSnapshot().stats.bells).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("bell-fan");

    expect(engine.bellEnd(T0 + 600, 0)).toBe(false);
    expect(engine.bellEnd(T0 + 700, 3)).toBe(true);
    expect(engine.getSnapshot().quests.counts.play).toBe(1);
    expect(engine.getSnapshot().stats.quests).toBe(0);
  });

  it("发条鼠：抓住才计数，两次解锁发条猎手；空手溜走只自嘲", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.mouseStart(T0)).toBe(true);
    expect(GIRL_MOUSE_START_LINES).toContain(line(engine));
    expect(engine.mouseMiss(T0 + 3_000)).toBe(true);
    expect(GIRL_MOUSE_MISS_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.mice).toBe(0);

    expect(engine.mouseCatch(T0 + 4_000)).toBe(true);
    expect(engine.getSnapshot().stats.mice).toBe(1);
    expect(engine.mouseCatch(T0 + 12_000)).toBe(true);
    expect(engine.getSnapshot().stats.mice).toBe(2);
    expect(engine.getSnapshot().achievements).toContain("windup-hunter");
  });

  it("打地鼠：每拍中一只都计数，五只解锁；收尾一句并把陪玩记一笔", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.moleStart(T0)).toBe(true);
    expect(GIRL_MOLE_START_LINES).toContain(line(engine));
    for (let i = 1; i <= 5; i += 1) expect(engine.moleWhack(T0 + i * 300, i)).toBe(true);
    expect(engine.getSnapshot().stats.moles).toBe(5);
    expect(engine.getSnapshot().achievements).toContain("mole-master");
    expect(engine.getSnapshot().quests.counts.play).toBe(0);

    expect(engine.moleEnd(T0 + 9_000, 5)).toBe(true);
    expect(GIRL_MOLE_END_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.moles).toBe(5);
    expect(engine.getSnapshot().quests.counts.play).toBe(1);
  });
});

describe("v1.12 抱抱与呼噜（引擎）", () => {
  it("抱一下计数并起呼噜；抱紧续秒涨亲密度；三抱解锁抱抱成瘾", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.3 });
    expect(engine.hugStart(T0)).toBe(true);
    expect(GIRL_HUG_START_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.hugs).toBe(1);
    expect(engine.getSnapshot().purrLeft).toBe(PURR_MS);

    const before = engine.getVitals().affinity;
    expect(engine.hugTap(T0 + 500, 1)).toBe(true);
    expect(engine.getVitals().affinity).toBeGreaterThan(before);
    expect(GIRL_HUG_LINES).toContain(line(engine));
    expect(engine.getSnapshot().purrLeft).toBeGreaterThan(PURR_MS - 500);

    engine.hugStart(T0 + 2_000);
    expect(engine.getSnapshot().stats.hugs).toBe(2);
    engine.hugStart(T0 + 8_000);
    expect(engine.getSnapshot().stats.hugs).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("hug-lover");
  });

  it("呼噜：连击第二下才起，一次呼噜只记一次；断档后再摸记下一次，走完归零", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setVitals({ affinity: 0.3 });

    engine.touch("head", t);
    expect(engine.getSnapshot().purrLeft).toBe(0);
    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().stats.purrs).toBe(1);
    expect(engine.getSnapshot().purrLeft).toBeGreaterThan(0);

    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().stats.purrs).toBe(1);

    t += PURR_MS + 100;
    engine.touch("head", t);
    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().stats.purrs).toBe(2);

    t += PURR_MS + 1;
    const snap = engine.update(t, ctx);
    expect(snap.purrLeft).toBe(0);
  });
});

describe("v1.12 雨天（引擎）", () => {
  it("下雨记一次、由引擎计着 20 秒；第二场解锁听雨的人", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.rainStart(T0)).toBe(true);
    expect(GIRL_RAIN_START_LINES).toContain(line(engine));
    expect(engine.getSnapshot().stats.rains).toBe(1);
    expect(engine.getSnapshot().rainLeft).toBe(RAIN_MS);

    t += 1_000;
    expect(engine.update(t, ctx).rainLeft).toBe(RAIN_MS - 1_000);
    t = T0 + RAIN_MS + 1;
    expect(engine.update(t, ctx).rainLeft).toBe(0);

    engine.rainStart(T0 + RAIN_MS + 2);
    expect(engine.getSnapshot().stats.rains).toBe(2);
    expect(engine.getSnapshot().achievements).toContain("rain-listener");
  });
});

describe("v1.12 今日小目标与日记（引擎）", () => {
  it("三件小事各自到点才打勾，重复互动不再记账；全清时徽章喊话、目标回执不重复", () => {
    const engine = girl();
    engine.setVitals({ affinity: 0.43 });
    let t = T0;
    for (let i = 0; i < 5; i += 1) {
      engine.touch("head", t);
      t += 4_000;
    }
    expect(questDone(engine.getSnapshot().quests, "pat")).toBe(true);
    expect(engine.getSnapshot().stats.quests).toBe(1);
    // 第五下自己的反应先说完，小目标回执排在气泡后面。
    expect(GIRL_QUEST_DONE_LINES.pat).not.toContain(line(engine));
    const afterBubble = engine.update(t + BUBBLE_TTL_MS + 1, ctx);
    expect(GIRL_QUEST_DONE_LINES.pat).toContain(afterBubble.bubble?.text);

    engine.wandEnd(T0 + 40_000, true);
    engine.wandEnd(T0 + 50_000, true);
    expect(questDone(engine.getSnapshot().quests, "play")).toBe(true);
    expect(engine.getSnapshot().stats.quests).toBe(2);

    engine.feed(T0 + 60_000);
    expect(questsDoneCount(engine.getSnapshot().quests)).toBe(3);
    expect(engine.getSnapshot().stats.quests).toBe(3);
    expect(engine.getSnapshot().achievements).toContain("daily-perfect");
    expect(line(engine)).toBe(ACHIEVEMENTS.find((a) => a.id === "daily-perfect")?.line);

    engine.feed(T0 + 70_000);
    expect(engine.getSnapshot().stats.quests).toBe(3);

    expect(engine.questsReport(T0 + 80_000)).toBe(true);
    expect(line(engine)).toBe([
      "今日小目标 全清啦",
      "✓ 摸摸头 5/5",
      "✓ 陪它玩 2/2",
      "✓ 喂小鱼干 1/1",
    ].join("\n"));
  });

  it("小目标的计数跨重启保留，换天清零并把前一天写成一条日记", () => {
    let wall = new Date(2026, 9, 25, 23, 50, 0).getTime();
    const storage = makeStorage();
    const engine = girl(storage, seq([0.5]), () => wall);
    engine.setVitals({ affinity: 0.3 });
    engine.touch("head", T0);
    engine.touch("head", T0 + 700);
    engine.feed(T0 + 2_000);

    const again = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    again.setForm("girl");
    expect(again.getSnapshot().quests.counts).toEqual({ pat: 2, play: 0, feed: 1 });

    wall += 20 * 60_000;
    const snap = again.update(T0 + 30_000, ctx);
    expect(snap.diary).toEqual([{ day: "2026-10-25", text: "被摸 2 下，吃了 1 顿" }]);
    expect(snap.quests.counts).toEqual({ pat: 0, play: 0, feed: 0 });

    expect(again.diaryReport(T0 + 31_000)).toBe(true);
    expect(line(again)).toContain("猫咪日记");
    expect(line(again)).toContain("10月25日 被摸 2 下，吃了 1 顿");
    expect(line(again)).toContain("10月26日 安安静静待了一天");
  });
});

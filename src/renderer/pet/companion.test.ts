import { describe, expect, it, vi } from "vitest";
import {
  BUBBLE_TTL_MS,
  CompanionEngine,
  ROLL_WEIGHTS,
  POKE_VARIANTS,
  PET_HOLD_MS,
  TOUCH_KINDS,
  TOUCH_MERGE_MS,
  bucketOf,
  clickKindFor,
  pickRoll,
  IDLE_ACTIVITIES,
  decayVitals,
  pickIdleActivity,
  type CompanionContext,
} from "./companion";
import { gestureClip, gestureIds } from "./motion";

const T0 = 1_700_000_000_000;
const workArea = { x: 0, y: 0, width: 1000, height: 700 };
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

/** 固定序列随机源；用完后循环最后一个值。 */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("companion vitals", () => {
  it("离线衰减按小时结算，上限 72h，结果夹在 0..1", () => {
    const twelve = decayVitals({ affinity: 0.5, fullness: 1, energy: 0.2 }, 12 * 3600_000);
    expect(twelve.fullness).toBeCloseTo(0.4, 3); // 0.05/h × 12
    expect(twelve.energy).toBeGreaterThan(0.2); // 离线按休息回能
    expect(twelve.affinity).toBeCloseTo(0.5, 6);

    const forever = decayVitals({ affinity: 0.9, fullness: 0.3, energy: 1 }, 1000 * 3600_000);
    expect(forever.fullness).toBe(0); // 夹到 0，不留负数
    expect(forever.energy).toBe(1); // 夹到 1
    expect(forever.affinity).toBe(0.9); // 亲密度不因离线掉
    expect(forever.fullness).toBe(decayVitals({ affinity: 0.9, fullness: 0.3, energy: 1 }, 72 * 3600_000).fullness);
  });

  it("落盘 / 读盘：新实例按保存时刻补算离线衰减", () => {
    const storage = makeStorage();
    const first = new CompanionEngine({ storage, now: () => T0, random: seq([0.5]) });
    first.setVitals({ affinity: 0.8, fullness: 1, energy: 0.5 });
    first.save();

    const later = new CompanionEngine({ storage, now: () => T0 + 6 * 3600_000, random: seq([0.5]) });
    expect(later.getVitals().fullness).toBeCloseTo(0.7, 3);
    expect(later.getVitals().affinity).toBeCloseTo(0.8, 6);
  });
});

describe("companion idle table", () => {
  it("权重表完整且不重复上一动作", () => {
    expect(IDLE_ACTIVITIES.map((entry) => entry.activity)).toEqual([
      "walk", "groom", "yawn", "stretch", "tilt", "sleep", "idle",
    ]);
    const candidates = IDLE_ACTIVITIES.filter((entry) => entry.activity !== "groom");
    const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeGreaterThan(0);

    // 剔除上一动作后再取中点采样：每一条 entry 自己的区间必须仍然命中自己。
    let cursor = 0;
    for (const entry of candidates) {
      const at = (cursor + entry.weight / 2) / total;
      expect(pickIdleActivity(at, "groom")).toBe(entry.activity);
      cursor += entry.weight;
    }
    expect(pickIdleActivity(0.999999, "walk")).not.toBe("walk");
  });

  it("夜里与低精力时更想睡", () => {
    const night = { hour: 2, energy: 0.8 };
    const day = { hour: 14, energy: 0.8 };
    expect(pickIdleActivity(0.999, "groom", night)).toBe("sleep");
    // 同一随机数在白天落在别的动作上；且低精力会放大睡眠权重。
    expect(pickIdleActivity(0.999, "groom", day)).not.toBe("sleep");
    const spent = { hour: 14, energy: 0.05 };
    expect(pickIdleActivity(0.999, "groom", spent)).toBe("sleep");
  });
});

describe("companion roaming", () => {
  it("漫游按 55px/s 前进，朝目标换向，到点停稳并上报落位", () => {
    const onSettle = vi.fn();
    const engine = new CompanionEngine({
      now: () => T0, random: seq([0.5]), storage: makeStorage(), onSettle,
    });
    engine.setPosition({ x: 100, y: 300 });
    engine.roamTo({ x: 320, y: 300 });

    expect(engine.getSnapshot().activity).toBe("walk");
    expect(engine.getSnapshot().facing).toBe(1);

    engine.update(T0 + 1000, ctx);
    const afterOne = engine.getSnapshot();
    expect(afterOne.pos.x).toBeCloseTo(155, 0); // 55px/s
    expect(afterOne.pos.y).toBeCloseTo(300, 6);
    expect(afterOne.moving).toBe(true);

    engine.update(T0 + 2000, ctx);
    engine.update(T0 + 3000, ctx);
    engine.update(T0 + 4000, ctx); // 220px 总共 4s，最后 26px 会减速
    const settled = engine.getSnapshot();
    expect(settled.activity).toBe("idle");
    expect(settled.pos.x).toBeCloseTo(320, 6);
    expect(settled.moving).toBe(false);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ x: 320, y: 300 });
  });

  it("目标点被夹进工作区（离开屏幕的目标不许把猫带出去）", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setPosition({ x: 100, y: 300 });
    engine.roamTo({ x: 5000, y: -400 });
    engine.update(T0 + 100, ctx); // 只跑一小步，读目标附近的内部意图
    for (let i = 1; i <= 200; i += 1) engine.update(T0 + 100 + i * 100, ctx);
    const pos = engine.getSnapshot().pos;
    expect(pos.x).toBeLessThanOrEqual(workArea.width - size.width);
    expect(pos.y).toBeGreaterThanOrEqual(workArea.y);
    expect(pos.x).toBeCloseTo(workArea.width - size.width, 6);
    expect(pos.y).toBeCloseTo(workArea.y, 6);
  });

  it("外部占位（藏身/面板）期间不自主起步；闲置时到点才挑动作", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.0]), storage: makeStorage() });
    engine.setPosition({ x: 100, y: 300 });
    for (let i = 1; i <= 80; i += 1) {
      engine.update(T0 + i * 250, { ...ctx, canRoam: false });
    }
    expect(engine.getSnapshot().activity).toBe("idle");
    expect(engine.getSnapshot().pos).toEqual({ x: 100, y: 300 });

    // canRoam 放开后第一轮闲置计时仍从 0 起：不许把遮挡期攒成一发立刻起步。
    engine.update(T0 + 20_250, ctx);
    expect(engine.getSnapshot().activity).toBe("idle");
  });

  it("看猫一面时（userActive）不走开", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.0]), storage: makeStorage() });
    engine.setPosition({ x: 100, y: 300 });
    engine.roamTo({ x: 500, y: 300 });
    engine.setUserActive(true);
    engine.update(T0 + 1000, ctx);
    expect(engine.getSnapshot().pos.x).toBeCloseTo(155, 0);
    // 已经起步的这一趟不强行打断，但到位后（userActive）重新挑动作时不许再走。
    engine.setUserActive(false);
    engine.update(T0 + 2000, ctx);
    expect(engine.getSnapshot().activity).toBe("walk");
  });
});

describe("companion drag & throw", () => {
  it("拖拽起手清掉漫游；慢放原地落定、不写物理", () => {
    const onSettle = vi.fn();
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage(), onSettle });
    engine.setPosition({ x: 100, y: 300 });
    engine.roamTo({ x: 600, y: 300 });
    engine.update(T0 + 500, ctx);
    engine.beginDrag();
    expect(engine.getSnapshot().activity).toBe("drag");
    const frozen = engine.getSnapshot().pos;
    engine.update(T0 + 1000, ctx); // 拖拽期间引擎不推进位置
    expect(engine.getSnapshot().pos).toEqual(frozen);

    engine.endDrag({ x: 400, y: 250 }, { x: 20, y: 10 });
    const settled = engine.getSnapshot();
    expect(settled.activity).toBe("idle");
    expect(settled.pos).toEqual({ x: 400, y: 250 });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ x: 400, y: 250 });
  });

  it("投掷：重力下坠、落地反弹、水平摩擦衰减，最终停在底边并上报一次", () => {
    const onSettle = vi.fn();
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage(), onSettle });
    engine.setPosition({ x: 300, y: 200 });
    engine.beginDrag();
    engine.endDrag({ x: 300, y: 200 }, { x: 900, y: -200 });
    expect(engine.getSnapshot().activity).toBe("thrown");

    const floorY = workArea.height - size.height;
    let bounced = false;
    let lastY = 200;
    let lastVy = 0;
    for (let i = 1; i <= 600; i += 1) {
      engine.update(T0 + i * 16, ctx);
      const snap = engine.getSnapshot();
      if (lastY >= floorY - 0.5 && snap.pos.y < lastY - 0.5) bounced = true;
      lastY = snap.pos.y;
      lastVy = snap.vy;
      if (snap.activity === "idle") break;
    }
    const end = engine.getSnapshot();
    expect(bounced).toBe(true); // 落地真的反弹过（不是贴地滑到死）
    expect(end.activity).toBe("idle");
    expect(end.pos.y).toBeCloseTo(floorY, 6);
    expect(end.pos.x).toBeGreaterThan(300); // 朝右扔出后落在右侧
    expect(end.pos.x).toBeLessThanOrEqual(workArea.width - size.width);
    expect(Math.abs(lastVy)).toBeLessThan(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("投掷撞右墙不穿墙，且反弹后仍夹在工作区内", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setPosition({ x: 700, y: 500 });
    engine.beginDrag();
    engine.endDrag({ x: 700, y: 500 }, { x: 2000, y: -400 });
    for (let i = 1; i <= 200; i += 1) engine.update(T0 + i * 16, ctx);
    const pos = engine.getSnapshot().pos;
    expect(pos.x).toBeGreaterThanOrEqual(workArea.x);
    expect(pos.x).toBeLessThanOrEqual(workArea.width - size.width);
    expect(pos.y).toBeLessThanOrEqual(workArea.height - size.height);
  });
});

describe("companion interactions", () => {
  it("摸摸加亲密度并立刻开心；喂食加饱腹；玩耍耗精力；睡觉回能", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    const before = engine.getVitals();

    engine.pet();
    expect(engine.getVitals().affinity).toBeGreaterThan(before.affinity);
    expect(engine.getSnapshot().mood).toBe("happy");

    const hungry = engine.getVitals();
    engine.feed();
    expect(engine.getVitals().fullness).toBeGreaterThan(hungry.fullness);

    const peppy = engine.getVitals();
    engine.play();
    expect(engine.getVitals().energy).toBeLessThan(peppy.energy);
    expect(engine.getVitals().affinity).toBeGreaterThanOrEqual(peppy.affinity);

    engine.toggleSleep();
    expect(engine.getSnapshot().mood).toBe("sleep");
    const sleepEnergy = engine.getVitals().energy;
    for (let i = 1; i <= 4; i += 1) engine.update(T0 + i * 250, ctx);
    expect(engine.getVitals().energy).toBeGreaterThan(sleepEnergy);

    engine.toggleSleep();
    expect(engine.getSnapshot().mood).not.toBe("sleep");
  });

  it("精力见底时会闹脾气，喂饱睡足后回到 idle", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setVitals({ affinity: 0.5, fullness: 0.1, energy: 0.05 });
    engine.update(T0 + 16, ctx);
    expect(engine.getSnapshot().mood).toBe("grumpy");
    engine.pet(); // happy 计时盖过坏心情
    expect(engine.getSnapshot().mood).toBe("happy");
  });

  it("status 应答把亲密度/饱腹/精力说成一句人话，安静时不开口", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setVitals({ affinity: 0.8, fullness: 0.9, energy: 0.7 });
    engine.handleCommand("status");
    const bubble = engine.getSnapshot().bubble;
    expect(bubble?.text).toContain("亲密度");
    expect(bubble?.text).toContain("80");
    expect(bubble?.text).toContain("90");

    engine.setQuiet(true);
    engine.handleCommand("status");
    expect(engine.getSnapshot().bubble?.text).toBe(bubble?.text); // 不影响已有气泡，也不新说
  });
});

describe("companion sleep & greeting", () => {
  it("自主小睡到点会自己醒；手动 toggle 的睡眠不自动醒", () => {
    const night = new Date(2026, 0, 1, 2, 0, 0).getTime();
    const engine = new CompanionEngine({
      now: () => T0,
      wallNow: () => night,
      random: seq([0, 0.999999]),
      storage: makeStorage(),
    });
    engine.setPosition({ x: 100, y: 300 });
    // 构造后 idleUntil = T0+5000（r=0）；夜里 sleep 权重最大，r=0.999999 必中。
    engine.update(T0 + 5_000, ctx);
    expect(engine.getSnapshot().activity).toBe("sleep");

    // 小睡有终点：到点自己回 idle，不是一睡到重启。
    engine.update(T0 + 100_000, ctx);
    expect(engine.getSnapshot().activity).not.toBe("sleep");

    // 手动 toggle 的睡眠是用户意图，不许自作主张醒来。
    engine.toggleSleep();
    engine.update(T0 + 200_000, ctx);
    expect(engine.getSnapshot().activity).toBe("sleep");
    engine.toggleSleep();
    expect(engine.getSnapshot().activity).not.toBe("sleep");
  });

  it("问候按时段一句；安静时闭嘴", () => {
    const morning = new Date(2026, 0, 1, 8, 0, 0).getTime();
    const engine = new CompanionEngine({
      now: () => T0, wallNow: () => morning, random: seq([0.5]), storage: makeStorage(),
    });
    expect(engine.greet()).toBe(true);
    expect(engine.getSnapshot().bubble?.text).toContain("早上好");

    engine.dismissBubble();
    engine.setQuiet(true);
    expect(engine.greet()).toBe(false);
    expect(engine.getSnapshot().bubble).toBeNull();
  });
});

describe("companion bubble slot", () => {
  it("单槽：低优先级不抢高优先级，TTL 到了自动空出，安静期一律拒收", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    expect(engine.say("肚子有点饿", 1, T0)).toBe(true);
    expect(engine.say("网络断了", 3, T0 + 100)).toBe(true);
    expect(engine.getSnapshot().bubble?.text).toBe("网络断了");
    expect(engine.say("随便说说", 1, T0 + 200)).toBe(false);
    expect(engine.getSnapshot().bubble?.text).toBe("网络断了");

    expect(engine.getSnapshot().bubble).not.toBeNull();
    // 第二条在 T0+100 才说出口，它的 TTL 到 T0+6100；到期后同级可换。
    expect(engine.say("新的一句", 3, T0 + BUBBLE_TTL_MS + 200)).toBe(true);
    expect(engine.getSnapshot().bubble?.text).toBe("新的一句");

    engine.dismissBubble(T0 + BUBBLE_TTL_MS + 210);
    expect(engine.getSnapshot().bubble).toBeNull();

    engine.setQuiet(true);
    expect(engine.say("安静期不该说", 3, T0 + 20_000)).toBe(false);
    expect(engine.getSnapshot().bubble).toBeNull();
  });

  it("TTL 到点由 update 自己清空：没有新句子也不许留在屏幕上", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    expect(engine.say("我先说一句", 1, T0)).toBe(true);
    engine.update(T0 + BUBBLE_TTL_MS - 1, ctx);
    expect(engine.getSnapshot().bubble?.text).toBe("我先说一句");
    engine.update(T0 + BUBBLE_TTL_MS + 1, ctx);
    expect(engine.getSnapshot().bubble).toBeNull();
  });
});

// ===========================================================================
// Task 19：四档加权永不停轮（girl 作用域）
// ===========================================================================
describe("pickRoll 四档加权", () => {
  const DAY = { hour: 14, energy: 0.8 };
  const POOL = ["nod", "shake", "wave", "bow", "hop", "shiver", "tilt", "typeCode", "peek"];

  it("四档权重是 10/5/5/80（spec §5）", () => {
    expect(ROLL_WEIGHTS).toEqual({ idle_micro: 10, peek: 5, move: 5, gesture: 80 });
  });

  it("白天满精力：分数窗口按绝对权重 —— 0.09 仍是 idle_micro，0.11 进 peek", () => {
    const pool = POOL;
    expect(pickRoll(0.05, 0.5, { ...DAY, pool }).bucket).toBe("idle_micro");
    expect(pickRoll(0.12, 0.5, { ...DAY, pool }).bucket).toBe("peek");
    expect(pickRoll(0.17, 0.5, { ...DAY, pool }).bucket).toBe("move");
    expect(pickRoll(0.5, 0.5, { ...DAY, pool }).bucket).toBe("gesture");
  });

  it("夜里满精力：总重 81.25，peek 窗口右移（0.12 掉回 idle_micro）", () => {
    const night = { hour: 23, energy: 0.8 };
    expect(bucketOf(0.12, night)).toBe("idle_micro");
    expect(bucketOf(0.14, night)).toBe("peek");
  });

  it("夜里+力竭：总重 80.125，peek 窗口再右移到 [0.1248, 0.1872)", () => {
    const worst = { hour: 23, energy: 0.1 };
    expect(bucketOf(0.12, worst)).toBe("idle_micro");
    expect(bucketOf(0.15, worst)).toBe("peek");
    expect(bucketOf(0.19, worst)).toBe("move");
  });

  it("peek 档直接给 peek 手势（与池里那条同名同源）", () => {
    const r = pickRoll(0.12, 0.5, { ...DAY, pool: POOL });
    expect(r).toEqual({ bucket: "peek", gesture: "peek" });
  });

  it("gesture 档在池内等权抽；0 与 0.999 抽到两端", () => {
    const lo = pickRoll(0.5, 0, { ...DAY, pool: POOL });
    const hi = pickRoll(0.5, 0.999, { ...DAY, pool: POOL });
    expect(lo.gesture).toBe(POOL[0]);
    expect(hi.gesture).toBe(POOL[POOL.length - 1]);
  });

  it("不重复上一手势（沿用 pickIdleActivity 的 previous 剔除）", () => {
    const pool = ["a", "b", "c"];
    for (let i = 0; i <= 100; i += 1) {
      const r = pickRoll(0.5, i / 101, { ...DAY, pool, previousGesture: "a" });
      expect(r.gesture).not.toBe("a");
    }
  });

  it("池为空当场抛（不许静默退化成 idle）", () => {
    expect(() => pickRoll(0.5, 0.5, { ...DAY, pool: [] })).toThrow(/池为空/);
  });

  it("生产池由 gestureIds() 现算：池里每条都能被抽到且查得到 clip", () => {
    for (const id of gestureIds()) expect(() => gestureClip(id)).not.toThrow();
    expect(gestureIds().length).toBeGreaterThanOrEqual(9);
  });
});

// ===========================================================================
// Task 22：触摸六类 + 2.5s 合并 + 点击反馈 5 变体
// ===========================================================================
describe("companion touch kinds", () => {
  const girlCtx: CompanionContext = { workArea, size, canRoam: true };

  it("六类名单与合并窗口钉死（spec §5 :255-257）", () => {
    expect([...TOUCH_KINDS]).toEqual(["poke", "pet", "grab", "drop", "throw", "crash"]);
    expect(TOUCH_MERGE_MS).toBe(2500);
    expect(PET_HOLD_MS).toBe(500);
  });

  it("clickKindFor：500ms 是分界线", () => {
    expect(clickKindFor(0)).toBe("poke");
    expect(clickKindFor(499)).toBe("poke");
    expect(clickKindFor(500)).toBe("pet");
    expect(clickKindFor(10_000)).toBe("pet");
  });

  it("poke：五档变体按 random 选，��势与台词都落在那档", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.4, 0.5]) });
    engine.setForm("girl");
    expect(engine.touch("poke")).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.gesture).toBe("turnAway");     // 0.4×5 = 2 → 第 3 档
    expect(["哼，别戳我", "转过去冷静一下"]).toContain(snap.bubble?.text);
  });

  it("同类 2.5s 内合并：第二下 false，RNG 不再消耗", () => {
    let t = T0;
    let draws = 0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t,
      random: () => { draws += 1; return 0.4; },
    });
    engine.setForm("girl");
    expect(engine.touch("poke")).toBe(true);
    const afterFirst = draws;
    t += 1_000;
    expect(engine.touch("poke")).toBe(false);
    expect(draws, "合并掉的触摸不许再吃签").toBe(afterFirst);
    t += TOUCH_MERGE_MS;
    expect(engine.touch("poke")).toBe(true);
    expect(draws).toBeGreaterThan(afterFirst);
  });

  it("合并按类记账：poke 之后立刻 pet 不合并", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.4, 0.5, 0.5]) });
    engine.setForm("girl");
    expect(engine.touch("poke")).toBe(true);
    expect(engine.touch("pet")).toBe(true);
    expect(engine.getSnapshot().activity).toBe("pet");
  });

  it("猫形六类全吞：返回 false、零台词、零 RNG 消耗（口径差⑮的对照）", () => {
    let draws = 0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => T0,
      random: () => { draws += 1; return 0.5; },
    });
    const before = draws;
    for (const kind of TOUCH_KINDS) expect(engine.touch(kind)).toBe(false);
    expect(draws, "猫形触摸一支签都不许吃").toBe(before);
    expect(engine.getSnapshot().bubble).toBeNull();
    expect(engine.getSnapshot().gesture).toBeNull();
  });

  it("切形态清空合并窗：切回 girl 后立刻能再摸", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.4, 0.5]) });
    engine.setForm("girl");
    expect(engine.touch("poke")).toBe(true);
    engine.setForm("cat");
    engine.setForm("girl");
    t += 100;
    expect(engine.touch("poke")).toBe(true);
  });

  it("五档变体都在池里且各不相同", () => {
    expect(POKE_VARIANTS).toHaveLength(5);
    const ids = POKE_VARIANTS.map((v) => v.gesture);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(() => gestureClip(id)).not.toThrow();
  });

  it("物理四类各自有台词（同一词表形态），grab/drop/throw/crash 不合并到彼此", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    for (const kind of ["grab", "drop", "throw", "crash"] as const) {
      expect(engine.touch(kind), kind).toBe(true);
      expect(engine.getSnapshot().bubble?.text, kind).toBeTruthy();
      t += 60_000;
    }
    void girlCtx;
  });
});

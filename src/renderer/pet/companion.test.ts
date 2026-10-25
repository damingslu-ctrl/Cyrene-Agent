import { describe, expect, it, vi } from "vitest";
import {
  BUBBLE_TTL_MS,
  CompanionEngine,
  DIZZY_MS,
  GIRL_CHATTER,
  GIRL_GREETINGS,
  GIRL_LINES,
  GREETING_LINES,
  MICRO_GESTURES,
  NOTICE_COOLDOWN_MS,
  REST_AFTER_MS,
  ROLL_WEIGHTS,
  POKE_VARIANTS,
  PET_HOLD_MS,
  POUNCE_COOLDOWN_MS,
  STARTLE_MS,
  TOUCH_KINDS,
  TOUCH_MERGE_MS,
  bucketOf,
  clickKindFor,
  dayPartOf,
  GESTURE_CATEGORIES,
  pickCategorizedGesture,
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

  it("猫娘状态卡四行报：三条资源各占一行，羁绊与相识天数同一行", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setForm("girl");
    engine.setVitals({ affinity: 0.7, fullness: 0.7, energy: 0.8 });
    engine.handleCommand("status");
    const lines = engine.getSnapshot().bubble!.text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("亲密度 70%");
    expect(lines[1]).toBe("饱腹 70%");
    expect(lines[2]).toBe("精力 80%");
    expect(lines[3]).toBe("依赖 · 第 1 天");
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

  it("直接点的反应能顶掉同级上一条；网络播报（3）依旧不可抢", () => {
    const engine = new CompanionEngine({ now: () => T0, random: seq([0.5]), storage: makeStorage() });
    engine.setForm("girl");
    engine.touch("head", T0);
    expect(GIRL_LINES.head).toContain(engine.getSnapshot().bubble?.text);

    // 点脚是新的一句话：屏幕上不许还挂着「摸头」。
    engine.touch("feet", T0 + 100);
    expect(GIRL_LINES.feet).toContain(engine.getSnapshot().bubble?.text);

    // 网络播报更重要：直接点也不许把它换掉。
    expect(engine.say("网络断了", 3, T0 + 200)).toBe(true);
    engine.touch("head", T0 + 400);
    expect(engine.getSnapshot().bubble?.text).toBe("网络断了");
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
describe("随机小动作分类池（对齐 deepseek-pet 的 categories）", () => {
  it("五类权重 20/20/16/14/10，合计正好等于 gesture 档权重 80", () => {
    // 参考 `assets/config.jsonc` 的注释原文：「所有分类 weight 合计应与 animationWeights
    // 里顶层权重和的余量（100 − idle − turn − move）相等」。我们把 idle_micro+peek+move
    // 折成 20，gesture 就是 80——分类池合计必须等于它，否则两层权重各说各话。
    expect(GESTURE_CATEGORIES.map((c) => [c.id, c.weight])).toEqual([
      ["小动作", 20], ["玩耍", 20], ["吃什么", 16], ["时节", 14], ["文字", 10],
    ]);
    const sum = GESTURE_CATEGORIES.reduce((n, c) => n + c.weight, 0);
    expect(sum).toBe(ROLL_WEIGHTS.gesture);
  });

  it("每个动作名都查得到已注册的 gesture clip（写完不注册就是死条目）", () => {
    const registered = new Set(gestureIds());
    for (const c of GESTURE_CATEGORIES) {
      for (const a of c.actions) {
        expect(registered.has(a), `${c.id}: ${a} 不在 gestureIds() 里`).toBe(true);
      }
    }
  });

  it("生产抽取只产出分类池里的动作，且 0 / 0.999 分别落在首末类", () => {
    const allowed = new Set(GESTURE_CATEGORIES.flatMap((c) => c.actions));
    for (const r of [0, 0.05, 0.3, 0.55, 0.8, 0.95, 0.999]) {
      const g = pickCategorizedGesture(r, r);
      expect(allowed.has(g), `抽到了池外的 ${g}`).toBe(true);
    }
    // 类权重累加：0 → 小动作；0.999 → 文字
    expect(GESTURE_CATEGORIES[0].actions).toContain(pickCategorizedGesture(0, 0.5));
    expect(GESTURE_CATEGORIES[4].actions).toContain(pickCategorizedGesture(0.999, 0.5));
  });

  it("不重复上一动作（跨类也不重复）", () => {
    for (const prev of GESTURE_CATEGORIES.flatMap((c) => c.actions)) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const g = pickCategorizedGesture(r, 0.42, prev);
        expect(g, `上一动作 ${prev} 被重复抽到了`).not.toBe(prev);
      }
    }
  });

  it("分类池覆盖 18 条 clip 全部（spec §5 的手势清单一条不落）", () => {
    const inPool = new Set(GESTURE_CATEGORIES.flatMap((c) => c.actions));
    for (const id of gestureIds()) {
      expect(inPool.has(id), `${id} 没进任何分类`).toBe(true);
    }
  });
});

describe("companion touch kinds", () => {
  const girlCtx: CompanionContext = { workArea, size, canRoam: true };

  it("八类名单与合并窗口钉死（六类旧口径 + 猫娘三区的头/脚）", () => {
    expect([...TOUCH_KINDS]).toEqual(["poke", "pet", "grab", "drop", "throw", "crash", "head", "feet"]);
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

  it("猫形八类全吞：返回 false、零台词、零 RNG 消耗（口径差⑮的对照）", () => {
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

describe("companion 猫娘三区 / 眩晕 / 注意到你", () => {
  it("摸头：捂脸 + 头台词 + 亲密度，爱心走 pet 动作包络", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    const before = engine.getVitals().affinity;
    expect(engine.touch("head")).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.gesture).toBe("coverFace");
    expect(GIRL_LINES.head).toContain(snap.bubble?.text);
    expect(snap.activity).toBe("pet");
    expect(engine.getVitals().affinity).toBeCloseTo(before + 0.04, 6);
  });

  it("挠脚：怕痒（shiver）+ 脚台词，也涨亲密度", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    const before = engine.getVitals().affinity;
    expect(engine.touch("feet")).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.gesture).toBe("shiver");
    expect(GIRL_LINES.feet).toContain(snap.bubble?.text);
    expect(engine.getVitals().affinity).toBeCloseTo(before + 0.03, 6);
  });

  it("眩晕：晕满 3.6s、捂脸说晕话；晕着不叠晕，醒来可再晕；切形态清秒表", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    expect(engine.dizzy()).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.dizzyLeft).toBeCloseTo(DIZZY_MS, 6);
    expect(snap.gesture).toBe("coverFace");
    expect(GIRL_LINES.dizzy).toContain(snap.bubble?.text);
    expect(engine.dizzy()).toBe(false);
    t += DIZZY_MS + 1;
    expect(engine.dizzy()).toBe(true);
    engine.setForm("cat");
    expect(engine.dizzy()).toBe(false);
  });

  it("晕着站原地：不聊天、不迈步，星星转完才恢复", () => {
    let t = T0;
    let draws = 0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t,
      random: () => { draws += 1; return 0.5; },
    });
    engine.setForm("girl");
    engine.dizzy(t);
    const afterDizzy = draws;
    t += 1_000;
    const snap = engine.update(t, ctx);
    expect(snap.activity).toBe("idle");
    expect(snap.dizzyLeft).toBeGreaterThan(0);
    // 只允许 update 内部的必要抽取为 0：晕着时 stepIdle 应整段短路。
    expect(draws, "晕着还在抽动作").toBe(afterDizzy);
  });

  it("注意到你：优先级 0 不抢工作播报，说过一次 12s 内不再说", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    expect(engine.say("正在测速，先别走开", 1, t)).toBe(true);
    expect(engine.notice(t + 1), "有更高优先级的播报时不许抢").toBe(false);
    engine.dismissBubble(t + 2);

    expect(engine.notice(t + 3)).toBe(true);
    expect(GIRL_LINES.notice).toContain(engine.getSnapshot().bubble?.text);
    engine.dismissBubble(t + 4);
    expect(engine.notice(t + 5)).toBe(false);
    expect(engine.notice(t + NOTICE_COOLDOWN_MS + 3)).toBe(true);
  });

  it("安静或睡着时 notice 闭嘴；四足两条新接口都恒 false", () => {
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => T0, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setQuiet(true);
    expect(engine.notice()).toBe(false);
    engine.setQuiet(false);
    engine.toggleSleep();
    expect(engine.notice()).toBe(false);

    engine.setForm("cat");
    expect(engine.notice()).toBe(false);
    expect(engine.dizzy()).toBe(false);
  });

  it("问候按时段分表：猫娘四句、四足保留原表；dayPartOf 的四个边界", () => {
    expect(dayPartOf(5)).toBe("morning");
    expect(dayPartOf(10)).toBe("morning");
    expect(dayPartOf(11)).toBe("afternoon");
    expect(dayPartOf(17)).toBe("afternoon");
    expect(dayPartOf(18)).toBe("evening");
    expect(dayPartOf(21)).toBe("evening");
    expect(dayPartOf(22)).toBe("night");
    expect(dayPartOf(4)).toBe("night");

    const morning = new Date(2026, 9, 25, 9, 0, 0).getTime();
    const girl = new CompanionEngine({ storage: makeStorage(), now: () => T0, wallNow: () => morning, random: seq([0.5]) });
    girl.setForm("girl");
    expect(girl.greet()).toBe(true);
    expect(girl.getSnapshot().bubble?.text).toBe(GIRL_GREETINGS.morning);

    const cat = new CompanionEngine({ storage: makeStorage(), now: () => T0, wallNow: () => morning, random: seq([0.5]) });
    expect(cat.greet()).toBe(true);
    expect(cat.getSnapshot().bubble?.text).toBe(GREETING_LINES.morning);
  });

  it("闲话按时段换表，而且不坐着弹：起身后才说早上的那句", () => {
    let t = T0;
    const wall = new Date(2026, 9, 25, 9, 30, 0).getTime();
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    t += 70_000;
    // 一个人待够 40s 先坐下：静息优先于闲话，坐着不弹气泡。
    expect(engine.update(t, ctx).activity).toBe("rest");
    expect(engine.getSnapshot().bubble).toBeNull();

    // 坐满 24s（18 + 0.5×12）→ 伸懒腰 2.2s → 回待机的那一步才说话。
    t += 24_000;
    expect(engine.update(t, ctx).activity).toBe("stretch");
    t += 3_000;
    engine.update(t, ctx);
    t += 1_000;
    expect(GIRL_CHATTER.morning).toContain(engine.update(t, ctx).bubble?.text);
  });
});

describe("companion 猫娘静息周期与微动作", () => {
  it("一个人待够 40s 自己坐下；歇完先伸懒腰再回待机", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    t += REST_AFTER_MS - 1_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");

    t += 1_000;
    expect(engine.update(t, ctx).activity).toBe("rest");

    // 坐的时长 = 18s + 0.5 × 12s = 24s
    t += 24_000;
    expect(engine.update(t, ctx).activity).toBe("stretch");

    t += 3_000;
    expect(engine.update(t, ctx).activity).toBe("idle");
  });

  it("歇完的秒表从起身重新起算：不会站起来就又想坐", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    t += REST_AFTER_MS;
    expect(engine.update(t, ctx).activity).toBe("rest");
    t += 24_000; // 18s + 0.5 × 12s
    expect(engine.update(t, ctx).activity).toBe("stretch");
    t += 3_000; // 伸懒腰 2.2s 已结束
    expect(engine.update(t, ctx).activity).toBe("idle");

    // 起床时刻（t0+64s）才是新起点：39s 后还站着，41s 后才许坐。
    t = T0 + 64_000 + REST_AFTER_MS - 1_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");
    t += 2_000;
    expect(engine.update(t, ctx).activity).toBe("rest");
  });

  it("碰一下重新计时：不是「到点必坐」", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    t += REST_AFTER_MS - 5_000;
    engine.touch("head", t);
    t += 6_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");

    t += REST_AFTER_MS;
    expect(engine.update(t, ctx).activity).toBe("rest");
  });

  it("静息只长在猫娘上：四足待 40s 也不会「坐」", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    t += REST_AFTER_MS + 1_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");
  });

  it("被停在屏边（藏身中不许动）也照样坐下：静息不该被 canRoam 吃掉", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    t += REST_AFTER_MS;
    expect(engine.update(t, { ...ctx, canRoam: false }).activity).toBe("rest");
  });

  it("光标压在她身上不算一个人待着：手离开窗子 40s 才坐", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setUserActive(true);
    t += REST_AFTER_MS + 5_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");

    engine.setUserActive(false);
    t += REST_AFTER_MS - 1_000;
    expect(engine.update(t, ctx).activity).not.toBe("rest");
    t += 2_000;
    expect(engine.update(t, ctx).activity).toBe("rest");
  });

  it("idle_micro 偶尔真的动一下：抽到 peek/wink，而不是永远站桩", () => {
    let t = T0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t,
      random: seq([0.5, 0.5, 0.05, 0.1, 0.0]),
    });
    engine.setForm("girl");
    t += 8_000;
    const snap = engine.update(t, ctx);
    expect(snap.activity).toBe("idle");
    expect(MICRO_GESTURES).toContain(snap.gesture);
  });
});

describe("猫娘 II：连击 / 惊醒 / 羁绊 / 作息 / 扑与球", () => {
  it("摸头连击：3.2s 内递进到第 4/5 下换手势，断了重新起算", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    // 压到低好感，避免第 5 下顺手跨档：升档播报优先级 2 会把连击台词盖掉（另有单测锁它）。
    engine.setVitals({ affinity: 0.2 });

    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(1);
    expect(engine.getSnapshot().gesture).toBe("coverFace");

    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(2);
    expect(engine.getSnapshot().bubble?.text).toBe(GIRL_LINES.combo[0]);

    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(3);
    expect(engine.getSnapshot().gesture).toBe("shiver");

    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(4);
    expect(engine.getSnapshot().gesture).toBe("hop");

    t += 700;
    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(5);
    expect(engine.getSnapshot().bubble?.text).toBe(GIRL_LINES.combo[3]);

    // 窗口过了就不再算连击（下一次从 1 重来）。
    t += 3_300;
    expect(engine.getSnapshot().patCombo).toBe(0);
    engine.touch("head", t);
    expect(engine.getSnapshot().patCombo).toBe(1);
    expect(engine.getSnapshot().gesture).toBe("coverFace");
  });

  it("睡中被碰是惊醒而不是挠脚：立刻醒、受惊记号 + 一句被吓到的话", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    engine.toggleSleep(t);
    expect(engine.getSnapshot().activity).toBe("sleep");

    t += 500;
    engine.touch("feet", t);
    const snap = engine.getSnapshot();
    expect(snap.activity).toBe("idle");
    expect(snap.mood).not.toBe("sleep");
    expect(snap.startleLeft).toBeGreaterThan(0);
    expect(snap.startleLeft).toBeLessThanOrEqual(STARTLE_MS);
    expect(snap.gesture).toBe("shiver");
    expect(GIRL_LINES.wake).toContain(snap.bubble?.text);
  });

  it("深夜被摸醒换一套「嘘——」的台词", () => {
    const nightWall = new Date(2026, 0, 10, 23, 30).getTime();
    let t = T0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t, wallNow: () => nightWall, random: seq([0.5]),
    });
    engine.setForm("girl");
    engine.toggleSleep(t);
    t += 400;
    engine.touch("head", t);
    expect(GIRL_LINES.wakeNight).toContain(engine.getSnapshot().bubble?.text);
  });

  it("亲密度跨档才播报一次；setVitals 直接改数不播报", () => {
    let t = T0;
    const storage = makeStorage();
    const engine = new CompanionEngine({ storage, now: () => t, random: seq([0.5]) });
    engine.setForm("girl");

    engine.setVitals({ affinity: 0.64 });
    expect(engine.getSnapshot().bubble).toBeNull();
    t += 2_000;
    engine.touch("feet", t); // +0.03 → 0.67，跨过 0.66「依赖」
    const up = engine.getSnapshot();
    expect(up.bond.id).toBe("reliant");
    expect(up.bond.name).toBe("依赖");
    expect(up.bondUpLeft).toBeGreaterThan(0);
    expect(GIRL_LINES.bond.reliant).toContain(up.bubble?.text);

    // 同一档里再涨不再喊（气泡还是上一句，升档窗口继续走）。
    const upText = up.bubble?.text;
    const upLeft = up.bondUpLeft;
    t += 1_000;
    engine.touch("feet", t);
    const same = engine.getSnapshot();
    expect(same.bubble?.text).toBe(upText);
    expect(same.bondUpLeft).toBeLessThan(upLeft);
    engine.setVitals({ affinity: 0.1 });
    const dropped = engine.getSnapshot();
    expect(dropped.bond.id).toBe("new");
    expect(dropped.bubble?.text).not.toBe(GIRL_LINES.bond.new[0]);
  });

  it("第二天露脸：问候句把「第 N 天」单独放一行，不让换行劈开句子", () => {
    const wall = new Date(2026, 0, 10, 8, 0).getTime();
    const storage = makeStorage();
    new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });
    const engine = new CompanionEngine({
      storage, now: () => T0, wallNow: () => wall + 24 * 3600_000, random: seq([0.5]),
    });
    engine.setForm("girl");
    engine.greet(T0);
    expect(engine.getSnapshot().bubble?.text).toBe(`${GIRL_GREETINGS.morning}\n第 2 天`);
  });

  it("相识天数跨天累加，同一天只算第 1 天", () => {
    const wall = new Date(2026, 0, 10, 9, 0).getTime();
    const storage = makeStorage();
    new CompanionEngine({ storage, now: () => T0, wallNow: () => wall, random: seq([0.5]) });

    const same = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall + 2 * 3600_000, random: seq([0.5]) });
    expect(same.getSnapshot().days).toBe(1);

    const later = new CompanionEngine({ storage, now: () => T0, wallNow: () => wall + 2 * 24 * 3600_000, random: seq([0.5]) });
    expect(later.getSnapshot().days).toBe(3);
  });

  it("早晨第一次见面伸懒腰；同一天第二次不再演", () => {
    const wall = new Date(2026, 0, 10, 8, 0).getTime();
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, wallNow: () => wall, random: seq([0.5]) });
    engine.setForm("girl");
    engine.greet(t);
    expect(engine.getSnapshot().activity).toBe("stretch");

    t += 3_000;
    engine.update(t, ctx);
    engine.greet(t + 1_000);
    expect(engine.getSnapshot().activity).not.toBe("stretch");
  });

  it("深夜提醒同一晚 45 分钟内只说一次，安静期直接闭嘴", () => {
    const nightWall = new Date(2026, 0, 10, 23, 30).getTime();
    let t = T0;
    const engine = new CompanionEngine({
      storage: makeStorage(), now: () => t, wallNow: () => nightWall, random: seq([0.5]),
    });
    engine.setForm("girl");
    expect(engine.nightNudge(t)).toBe(true);
    expect(GIRL_LINES.night).toContain(engine.getSnapshot().bubble?.text);
    expect(engine.nightNudge(t + 60_000)).toBe(false);

    engine.setQuiet(true);
    expect(engine.nightNudge(t + 46 * 60_000)).toBe(false);
  });

  it("朝光标扑：只挪一小段、朝过去、带冷却", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    engine.setPosition({ x: 200, y: 300 });
    const before = engine.getSnapshot().pos.x;

    expect(engine.pounce(420, t, { minX: 0, maxX: 900 })).toBe(true);
    const pounced = engine.getSnapshot();
    expect(pounced.pos.x).toBeGreaterThan(before);
    expect(pounced.pos.x - before).toBeLessThanOrEqual(26);
    expect(pounced.facing).toBe(1);
    expect(pounced.pounces).toBe(1);
    expect(GIRL_LINES.pounce).toContain(pounced.bubble?.text);

    expect(engine.pounce(100, t + 1_000, { minX: 0, maxX: 900 })).toBe(false);
    expect(engine.pounce(engine.getSnapshot().pos.x + 2, t + POUNCE_COOLDOWN_MS + 1, { minX: 0, maxX: 900 })).toBe(false); // 太近不扑
    t += POUNCE_COOLDOWN_MS + 2_000;
    expect(engine.pounce(20, t, { minX: 0, maxX: 900 })).toBe(true);
    expect(engine.getSnapshot().facing).toBe(-1);
  });

  it("毛线球被拨：自动档不出声，手动档换 hop + 说球 + 微弱涨亲密度", () => {
    let t = T0;
    const engine = new CompanionEngine({ storage: makeStorage(), now: () => t, random: seq([0.5]) });
    engine.setForm("girl");
    const affinity = engine.getVitals().affinity;

    expect(engine.toyBat(t, true)).toBe(true);
    expect(engine.getSnapshot().bubble).toBeNull();
    expect(engine.getSnapshot().gesture).toBe("peek");

    t += 10;
    expect(engine.toyBat(t, false)).toBe(true);
    expect(engine.getSnapshot().gesture).toBe("hop");
    expect(GIRL_LINES.toy).toContain(engine.getSnapshot().bubble?.text);
    expect(engine.getVitals().affinity).toBeGreaterThan(affinity);

    engine.toggleSleep(t + 100);
    expect(engine.toyBat(t + 200, false)).toBe(false);
  });
});

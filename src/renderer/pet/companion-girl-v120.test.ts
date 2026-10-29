// v1.20 野性觉醒：三式（冲刺/潜行/扑击）在待机里自己长出来，四阶只解锁与改节奏。
import { describe, expect, it } from "vitest";
import { CompanionEngine, type CompanionContext } from "./companion";
import { achievementById } from "./girl-achievements";
import { WILD_COOLDOWN_MS, wildActLine, wildLevelUpLine } from "./girl-wild";
import { wrapBubbleText } from "./art";

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

/** 可续队随机：先吃掉队列，队列空了回落到固定值（默认 0.5，不会碰巧抽中低概率的野性冲动）。 */
function queued(defaultValue = 0.5) {
  const queue: number[] = [];
  return {
    push: (...values: number[]) => void queue.push(...values),
    random: () => (queue.length ? queue.shift()! : defaultValue),
  };
}

function wallClock(initial: number) {
  let value = initial;
  return { get: () => value, set: (next: number) => { value = next; } };
}

const at = (y: number, month: number, d: number, h: number, m = 0) =>
  new Date(y, month - 1, d, h, m, 0).getTime();

const context = (over: Partial<CompanionContext> = {}): CompanionContext => ({
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  size: { width: 82, height: 108 },
  canRoam: true,
  ...over,
});

function girl(storage = makeStorage(), wall = wallClock(at(2026, 10, 28, 12, 0)), random = queued().random) {
  const engine = new CompanionEngine({ storage, now: () => T0, wallNow: wall.get, random });
  engine.setForm("girl");
  return { engine, wall, storage };
}

function seeded(wild: unknown, wall = wallClock(at(2026, 10, 28, 12, 0))) {
  const storage = makeStorage({
    [BOND_KEY]: JSON.stringify({ metAt: at(2026, 10, 27, 9), wild }),
  });
  return girl(storage, wall);
}

const snap = (engine: CompanionEngine) => engine.getSnapshot().wild!;
const line = (engine: CompanionEngine) => engine.getSnapshot().bubble?.text;
const fits = (text: string, max = 78) => wrapBubbleText(text, max, 9).length === 1;

/** 一步一步推走到落点，返回用掉的毫秒数（只在野性赶路时用）。 */
function walkUntilDone(engine: CompanionEngine, from: number, step = 250, limit = 60): number {
  let t = from;
  for (let i = 0; i < limit; i += 1) {
    t += step;
    engine.update(t, context());
    if (engine.getSnapshot().wild?.act === null) return t;
  }
  return t;
}

describe("v1.20 野性账本", () => {
  it("新号是家猫：0 点、只会冲刺、开机前两分钟不撒野；四足形态没有这份账", () => {
    const { engine } = girl();
    expect(snap(engine)).toMatchObject({
      points: 0,
      level: "home",
      label: "家猫",
      act: null,
      left: 0,
      zooms: 0,
      stalks: 0,
      hunts: 0,
      next: 3,
      unlocked: { zoom: true, stalk: false, hunt: false },
    });
    expect(snap(engine).cooldownLeft).toBe(WILD_COOLDOWN_MS);

    engine.setForm("cat");
    expect(engine.getSnapshot().wild).toBeNull();
    expect(engine.wildNow(T0)).toBe(false);
    expect(engine.wildReportNow(T0)).toBe(false);
  });

  it("落盘就是这个形状：重启后点数与三式计数都在，坏值只归零自己那一项", () => {
    const { engine, storage } = girl();
    expect(engine.wildNow(T0)).toBe(true);
    const arrival = walkUntilDone(engine, T0);
    engine.dismissBubble(arrival);
    const saved = JSON.parse(storage.getItem(BOND_KEY)!);
    expect(saved.wild).toEqual({ points: 1, zooms: 1, stalks: 0, hunts: 0 });

    const again = girl(storage, wallClock(at(2026, 10, 28, 12, 5)));
    expect(snap(again.engine)).toMatchObject({ points: 1, zooms: 1, level: "home", next: 3 });

    const bad = seeded({ points: -3, zooms: "x", stalks: 2.8, hunts: Number.POSITIVE_INFINITY });
    expect(snap(bad.engine)).toMatchObject({ points: 0, zooms: 0, stalks: 2, hunts: 0, level: "home" });
  });
});

describe("v1.20 让她野一下", () => {
  it("家猫阶＝冲刺：用近三倍步速跑到落点，跑动时不开口，收尾才记账并说一句", () => {
    const { engine } = girl();
    expect(engine.wildNow(T0)).toBe(true);
    expect(snap(engine).act).toBe("zoom");
    expect(engine.getSnapshot().activity).toBe("walk");
    expect(line(engine)).toBeUndefined();

    let t = T0;
    let lastX = engine.getSnapshot().pos.x;
    let maxStep = 0;
    for (let i = 0; i < 60 && snap(engine).act !== null; i += 1) {
      t += 250;
      engine.update(t, context());
      const x = engine.getSnapshot().pos.x;
      maxStep = Math.max(maxStep, Math.abs(x - lastX));
      lastX = x;
    }
    // 散步 250ms 只走 ~14px；冲刺这一段必须明显更快（起步就该超过 25px）。
    expect(maxStep).toBeGreaterThan(25);
    expect(snap(engine)).toMatchObject({ act: null, points: 1, zooms: 1 });
    // 第一冲就解锁「追风的爪子」：收尾那句被徽章台词顶掉是既有口径（成就优先）。
    expect(engine.getSnapshot().achievements).toContain("wild-run");
    expect(line(engine)).toBe(achievementById("wild-run")!.line);
    expect(snap(engine).cooldownLeft).toBe(WILD_COOLDOWN_MS);
  });

  it("跑一半窗口被占（canRoam=false）＝这一轮没玩成：撤标记、不记账、不留句子", () => {
    const { engine, storage } = girl();
    const before = JSON.parse(storage.getItem(BOND_KEY)!).wild;
    expect(engine.wildNow(T0)).toBe(true);
    engine.update(T0 + 250, context({ canRoam: false }));
    expect(engine.getSnapshot().activity).toBe("idle");
    expect(snap(engine)).toMatchObject({ act: null, points: 0, zooms: 0 });
    expect(line(engine)).toBeUndefined();
    expect(JSON.parse(storage.getItem(BOND_KEY)!).wild).toEqual(before);
  });

  it("安静/睡着/力竭都不接「让她野一下」；安静里也不报野性", () => {
    const quiet = girl();
    quiet.engine.setQuiet(true);
    expect(quiet.engine.wildNow(T0)).toBe(false);
    expect(quiet.engine.wildReportNow(T0)).toBe(false);

    const sleepy = girl();
    sleepy.engine.handleCommand("toggle-sleep", T0);
    expect(sleepy.engine.wildNow(T0)).toBe(false);

    const tired = girl();
    tired.engine.setVitals({ energy: 0.1 });
    expect(tired.engine.wildNow(T0)).toBe(false);
  });

  it("扑中一次光标也是一笔野性：hunts 与点数同时长，白天记 1 点", () => {
    const { engine } = girl();
    expect(engine.pounce(40, T0)).toBe(true);
    expect(snap(engine)).toMatchObject({ points: 1, hunts: 1, zooms: 0, stalks: 0 });
  });

  it("「野性到哪了」报三行：阶名+点数 / 差多少 / 三式计数，每行都装得进 78px", () => {
    const { engine } = girl();
    expect(engine.wildReportNow(T0)).toBe(true);
    const lines = line(engine)!.split("\n");
    expect(lines).toEqual(["家猫 · 野性 0", "再 3 点成醒爪", "冲0 潜0 扑0"]);
    for (const text of lines) expect(fits(text), text).toBe(true);
  });
});

describe("v1.20 四阶与链式动作", () => {
  it("点数够 3 就升醒爪、解锁潜行；升阶那句等当前气泡走完再说", () => {
    const { engine } = seeded({ points: 2, zooms: 2, stalks: 0, hunts: 0 });
    engine.dismissBubble(T0);
    expect(engine.wildNow(T0)).toBe(true);
    const arrival = walkUntilDone(engine, T0);
    expect(snap(engine)).toMatchObject({ points: 3, level: "claw", label: "醒爪" });
    expect(snap(engine).unlocked).toEqual({ zoom: true, stalk: true, hunt: false });
    expect(snap(engine).next).toBe(8);

    // 徽章/收尾句还占着气泡：升阶那句排队，气泡清掉后的下一拍才说。
    engine.dismissBubble(arrival);
    engine.update(arrival + 1_000, context());
    expect(line(engine)).toBe(wildLevelUpLine("claw", 0.5));
  });

  it("猎手阶强制野＝扑击：在原地演 900ms，演完才记账", () => {
    const { engine } = seeded({ points: 8, zooms: 0, stalks: 0, hunts: 0 });
    expect(engine.wildNow(T0)).toBe(true);
    expect(snap(engine).act).toBe("hunt");
    expect(engine.getSnapshot().activity).toBe("play");
    expect(snap(engine).points).toBe(8);

    engine.update(T0 + 950, context());
    expect(snap(engine)).toMatchObject({ act: null, points: 9, hunts: 1 });
    expect(line(engine)).toBe(wildActLine("hunt", 0.5));
  });

  it("自主潜行贴到跟前，猎手以上顺势补一扑；这一扑不另吃冷却", () => {
    const rand = queued();
    const storage = makeStorage({
      [BOND_KEY]: JSON.stringify({ metAt: at(2026, 10, 27, 9), wild: { points: 8, zooms: 5, stalks: 3, hunts: 0 } }),
    });
    const two = new CompanionEngine({
      storage, now: () => T0, wallNow: wallClock(at(2026, 10, 28, 12, 0)).get, random: rand.random,
    });
    two.setForm("girl");
    // 冷却由开机起算 120s：先把「有人陪」的秒表拨新，再跨过冷却。
    two.pet(T0 + 1_000);
    two.dismissBubble(T0 + 1_100);
    two.update(T0 + 2_000, context());
    two.pet(T0 + 119_500);
    two.dismissBubble(T0 + 119_600);
    two.update(T0 + 120_500, context());
    // 这一拍先让闲聊开口（气泡占着），野性不成；下一拍清掉气泡再撒野。
    two.update(T0 + 128_000, context());
    two.dismissBubble(T0 + 128_100);
    rand.push(0.1, 0.7, 0.5); // 抽中冲动 / 潜行 / 落点 85px
    two.update(T0 + 136_000, context());
    expect(two.getSnapshot().wild?.act).toBe("stalk");
    expect(two.getSnapshot().activity).toBe("walk");

    let t = T0 + 136_000;
    for (let i = 0; i < 60 && two.getSnapshot().wild?.act === "stalk"; i += 1) {
      t += 250;
      two.update(t, context());
    }
    // 潜行收尾立刻接扑击：不用等下一拍、也不再抽冷却。
    expect(two.getSnapshot().wild?.act).toBe("hunt");
    expect(two.getSnapshot().activity).toBe("play");
    expect(two.getSnapshot().wild?.points).toBe(9);

    two.update(t + 950, context());
    expect(two.getSnapshot().wild).toMatchObject({ act: null, points: 10, stalks: 4, hunts: 1 });
  });
});

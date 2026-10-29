// v1.20 野性觉醒：四阶 / 三式 / 夜间双倍 / 三行汇报 / 落盘清洗。
import { describe, expect, it } from "vitest";
import { wrapBubbleText } from "./art";
import {
  EMPTY_WILD,
  WILD_CAP,
  WILD_COOLDOWN_MS,
  WILD_COOLDOWN_WILDCAT_MS,
  WILD_LEVELS,
  bestWildImpulse,
  emptyWild,
  nextWildAt,
  pickWildImpulse,
  recordWild,
  sanitizeWild,
  wildChanceFor,
  wildCooldownFor,
  wildGain,
  wildLevelFor,
  wildLevelUpLine,
  wildRank,
  wildReport,
  wildUnlocks,
} from "./girl-wild";

const fits = (text: string) => text.split("\n").every((line) => wrapBubbleText(line, 78, 9).length === 1);

describe("v1.20 四阶", () => {
  it("0/3/8/15 四个门槛，边界两边各认各的阶", () => {
    expect(WILD_LEVELS.map((l) => [l.id, l.label, l.at])).toEqual([
      ["home", "家猫", 0],
      ["claw", "醒爪", 3],
      ["hunter", "猎手", 8],
      ["wildcat", "小野猫", 15],
    ]);
    const cases: Array<[number, string]> = [
      [0, "home"], [2, "home"], [3, "claw"], [7, "claw"],
      [8, "hunter"], [14, "hunter"], [15, "wildcat"], [9999, "wildcat"],
    ];
    for (const [points, id] of cases) expect(wildLevelFor(points).id).toBe(id);
    expect([0, 3, 8, 15].map((points) => wildRank(points))).toEqual([0, 1, 2, 3]);
  });

  it("家猫先会冲刺，醒爪加潜行，猎手才准扑击", () => {
    expect(wildUnlocks("home")).toEqual({ zoom: true, stalk: false, hunt: false });
    expect(wildUnlocks("claw")).toEqual({ zoom: true, stalk: true, hunt: false });
    expect(wildUnlocks("hunter")).toEqual({ zoom: true, stalk: true, hunt: true });
    expect(wildUnlocks("wildcat")).toEqual({ zoom: true, stalk: true, hunt: true });
  });

  it("小野猫冷却减半、冲动更频繁；其余三阶同一条冷却", () => {
    expect(wildCooldownFor(wildLevelFor(0))).toBe(WILD_COOLDOWN_MS);
    expect(wildCooldownFor(wildLevelFor(8))).toBe(WILD_COOLDOWN_MS);
    expect(wildCooldownFor(wildLevelFor(15))).toBe(WILD_COOLDOWN_WILDCAT_MS);
    expect(wildCooldownFor(wildLevelFor(15))).toBeLessThan(wildCooldownFor(wildLevelFor(8)));
    expect(wildChanceFor(wildLevelFor(0))).toBeLessThan(wildChanceFor(wildLevelFor(15)));
    expect(wildChanceFor(wildLevelFor(15))).toBeLessThan(1);
  });
});

describe("v1.20 账本", () => {
  it("空账是零，记账各进各的格子、点数一起涨", () => {
    expect(EMPTY_WILD).toEqual({ points: 0, zooms: 0, stalks: 0, hunts: 0 });
    expect(emptyWild()).toEqual(EMPTY_WILD);
    expect(emptyWild()).not.toBe(EMPTY_WILD);

    const after = recordWild(emptyWild(), "zoom", 12);
    expect(after).toEqual({ points: 1, zooms: 1, stalks: 0, hunts: 0 });
    const more = recordWild(recordWild(after, "stalk", 12), "hunt", 12);
    expect(more).toEqual({ points: 3, zooms: 1, stalks: 1, hunts: 1 });
    // 纯函数：旧账本不许被改。
    expect(after).toEqual({ points: 1, zooms: 1, stalks: 0, hunts: 0 });
  });

  it("22 点到凌晨 5 点算夜：同样的动作记双倍", () => {
    expect(wildGain("zoom", 21)).toBe(1);
    expect(wildGain("zoom", 22)).toBe(2);
    expect(wildGain("zoom", 0)).toBe(2);
    expect(wildGain("zoom", 4)).toBe(2);
    expect(wildGain("zoom", 5)).toBe(1);
    expect(recordWild(emptyWild(), "hunt", 23)).toEqual({ points: 2, zooms: 0, stalks: 0, hunts: 1 });
  });

  it("坏档一次灌不满：点数与计数都封顶", () => {
    const burst = recordWild({ points: WILD_CAP, zooms: WILD_CAP, stalks: 0, hunts: 0 }, "zoom", 23);
    expect(burst.points).toBe(WILD_CAP);
    expect(burst.zooms).toBe(WILD_CAP);
  });

  it("下一个门槛：每一阶都报得出来，满阶是 null", () => {
    expect(nextWildAt(0)).toBe(3);
    expect(nextWildAt(2)).toBe(3);
    expect(nextWildAt(3)).toBe(8);
    expect(nextWildAt(8)).toBe(15);
    expect(nextWildAt(14)).toBe(15);
    expect(nextWildAt(15)).toBeNull();
    expect(nextWildAt(999)).toBeNull();
  });
});

describe("v1.20 三式", () => {
  it("家猫只有冲刺；醒爪多出潜行；猎手三式俱全", () => {
    const only = new Set<string>();
    for (let i = 0; i < 20; i += 1) only.add(pickWildImpulse(wildLevelFor(0), 12, i / 20)!);
    expect([...only]).toEqual(["zoom"]);

    const claw = new Set<string>();
    for (let i = 0; i < 20; i += 1) claw.add(pickWildImpulse(wildLevelFor(3), 12, i / 20)!);
    expect(claw.has("zoom")).toBe(true);
    expect(claw.has("stalk")).toBe(true);
    expect(claw.has("hunt")).toBe(false);

    const hunter = new Set<string>();
    for (let i = 0; i < 20; i += 1) hunter.add(pickWildImpulse(wildLevelFor(8), 12, i / 20)!);
    expect([...hunter].sort()).toEqual(["hunt", "stalk", "zoom"]);
  });

  it("夜里扑击更常来：同一批随机数，夜里的扑击次数不少于白天", () => {
    const count = (hour: number, impulse: string) => {
      let n = 0;
      for (let i = 0; i < 100; i += 1) {
        if (pickWildImpulse(wildLevelFor(15), hour, i / 100) === impulse) n += 1;
      }
      return n;
    };
    expect(count(23, "hunt")).toBeGreaterThan(count(12, "hunt"));
    expect(count(23, "zoom")).toBeLessThan(count(12, "zoom"));
  });

  it("强制一发挑她当前最拿手的那一式：猎手扑、醒爪潜、家猫冲", () => {
    expect(bestWildImpulse(wildLevelFor(0))).toBe("zoom");
    expect(bestWildImpulse(wildLevelFor(3))).toBe("stalk");
    expect(bestWildImpulse(wildLevelFor(8))).toBe("hunt");
    expect(bestWildImpulse(wildLevelFor(15))).toBe("hunt");
  });
});

describe("v1.20 汇报与进化", () => {
  it("三行封顶：阶名+点数 / 差多少 / 三式计数；每行都不折", () => {
    const lines = wildReport({ points: 4, zooms: 2, stalks: 1, hunts: 0 });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("醒爪 · 野性 4");
    expect(lines[1]).toBe("再 4 点成猎手");
    expect(lines[2]).toBe("冲2 潜1 扑0");
    expect(fits(lines.join("\n"))).toBe(true);
  });

  it("满阶不再吊下一阶，只报野性全开", () => {
    const lines = wildReport({ points: 15, zooms: 5, stalks: 5, hunts: 5 });
    expect(lines[0]).toBe("小野猫 · 野性 15");
    expect(lines[1]).toBe("野性全开了");
    expect(fits(lines.join("\n"))).toBe(true);
  });

  it("每一阶都有自己的一句进化台词；留在本阶或没得升时不出声", () => {
    expect(wildLevelUpLine("home", 0.5)).toBeNull();
    const claw = wildLevelUpLine("claw", 0);
    const hunter = wildLevelUpLine("hunter", 0);
    const wildcat = wildLevelUpLine("wildcat", 0);
    for (const line of [claw, hunter, wildcat]) {
      expect(typeof line).toBe("string");
      expect(fits(line!)).toBe(true);
    }
    expect(new Set([claw, hunter, wildcat]).size).toBe(3);
  });
});

describe("v1.20 落盘清洗", () => {
  it("缺项/错型/负数/小数/超限都收成合法账", () => {
    expect(sanitizeWild(null)).toEqual(EMPTY_WILD);
    expect(sanitizeWild({})).toEqual(EMPTY_WILD);
    expect(sanitizeWild({ points: -3, zooms: "x", stalks: 2.9, hunts: NaN })).toEqual({
      points: 0, zooms: 0, stalks: 2, hunts: 0,
    });
    expect(sanitizeWild({ points: 1e12, zooms: 1e12, stalks: 1e12, hunts: 1e12 }).points).toBe(WILD_CAP);
  });
});

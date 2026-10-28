// v1.18 自娱五件：词表（菜单与引擎共用）与跨重启的账本。
import { describe, expect, it } from "vitest";
import {
  EMPTY_SOLO,
  SOLO_FIELD,
  SOLO_GESTURES,
  SOLO_KINDS,
  SOLO_LABELS,
  SOLO_MODE,
  type SoloLedger,
  buildSoloReport,
  isSoloKind,
  parseSolo,
  soloEndLine,
  soloMarkSeen,
  soloScare,
  soloScore,
  soloSeenCount,
  soloStartLine,
  soloTotals,
} from "./pet-solo";

function ledger(over: Partial<SoloLedger> = {}): SoloLedger {
  return { ballBest: 0, comboBest: 0, flares: 0, moths: 0, fish: 0, mirror: 0, seen: [], ...over };
}

describe("自娱词表", () => {
  it("五件都有名字、模式和落账字段：三张表按同一组 id 对齐", () => {
    expect(SOLO_KINDS).toEqual(["ball", "combo", "lantern", "fishing", "mirror"]);
    for (const kind of SOLO_KINDS) {
      expect(SOLO_LABELS[kind].length, kind).toBeGreaterThan(0);
      expect(SOLO_MODE[kind], kind).toMatch(/^(best|total)$/);
      expect(SOLO_FIELD[kind], kind).toBeTruthy();
    }
    expect(isSoloKind("ball")).toBe(true);
    expect(isSoloKind("mole")).toBe(false);
    expect(isSoloKind(undefined)).toBe(false);
  });

  it("每件都有一个开场姿态名，五件各不重复", () => {
    for (const kind of SOLO_KINDS) expect(SOLO_GESTURES[kind].length, kind).toBeGreaterThan(0);
    expect(new Set(SOLO_KINDS.map((kind) => SOLO_GESTURES[kind])).size).toBe(SOLO_KINDS.length);
  });
});

describe("自娱的一句话", () => {
  it("开场句短到进得了 78 宽气泡；收场把数报进句子，空手不阴阳", () => {
    for (const kind of SOLO_KINDS) {
      expect(soloStartLine(kind).length, kind).toBeGreaterThan(0);
      expect(soloStartLine(kind).length, kind).toBeLessThanOrEqual(10);
      expect(soloEndLine(kind, 3), kind).toContain("3");
      expect(soloEndLine(kind, 3), kind).not.toBe(soloStartLine(kind));
      expect(soloEndLine(kind, 0), kind).toBe("这次没玩出名堂");
      expect(soloEndLine(kind, -2), kind).toBe("这次没玩出名堂");
    }
  });

  it("收场句是成品句子，不是模板：占位符不许漏到屏幕上", () => {
    for (const kind of SOLO_KINDS) expect(soloEndLine(kind, 1)).not.toContain("{n}");
    expect(soloEndLine("ball", 5)).toBe("皮球连到 5 下");
    expect(soloEndLine("fishing", 2)).toBe("鱼儿钓上 2 条");
  });

  it("汇报最多三行：首行是件数与战果，之后按战果从大到小列两件", () => {
    expect(buildSoloReport(EMPTY_SOLO)).toEqual(["自娱 0/5 件 · 战果 0", "让我自己玩一会儿吧"]);
    const s = ledger({ ballBest: 5, comboBest: 0, flares: 3, moths: 9, fish: 6, mirror: 0, seen: ["ball", "lantern", "fishing"] });
    expect(buildSoloReport(s)).toEqual(["自娱 3/5 件 · 战果 14", "鱼儿 6", "皮球 5"]);
    // 并列时按词表顺序，不许跟着对象键序漂
    const tie = ledger({ fish: 4, ballBest: 4, seen: ["fishing", "ball"] });
    expect(buildSoloReport(tie).slice(1)).toEqual(["皮球 4", "鱼儿 4"]);
    // 只玩过一件也只补到两行，不硬凑
    expect(buildSoloReport(ledger({ mirror: 2, seen: ["mirror"] }))).toEqual(["自娱 1/5 件 · 战果 2", "镜子 2"]);
  });
});

describe("自娱账本的读盘", () => {
  it("坏值一律夹成 0：负数、小数、字符串、NaN 都不许穿过来", () => {
    const parsed = parseSolo({
      ballBest: -3,
      comboBest: 2.7,
      flares: "12",
      moths: Number.NaN,
      fish: null,
      mirror: 4,
    });
    expect(parsed.ballBest).toBe(0);
    expect(parsed.comboBest).toBe(2);
    expect(parsed.flares).toBe(0);
    expect(parsed.moths).toBe(0);
    expect(parsed.fish).toBe(0);
    expect(parsed.mirror).toBe(4);
  });

  it("没见过的档只认登记过的 id，去重且不超过五件", () => {
    expect(parseSolo({ seen: ["ball", "ball", "mole", "mirror"] }).seen).toEqual(["ball", "mirror"]);
    expect(parseSolo({ seen: "ball" }).seen).toEqual([]);
    expect(parseSolo({ seen: ["ball", "combo", "lantern", "fishing", "mirror", "ball"] }).seen).toHaveLength(5);
    expect(parseSolo(undefined)).toEqual(EMPTY_SOLO);
    expect(parseSolo("x")).toEqual(EMPTY_SOLO);
    // 再大也夹在一百万以内：坏档不许一口气把成就灌满。
    expect(parseSolo({ ballBest: 1e9 }).ballBest).toBe(1_000_000);
    // 没登记过的档整体退空，不许留半份脏账本。
    expect(parseSolo(5)).toEqual(EMPTY_SOLO);
    expect(parseSolo([])).toEqual(EMPTY_SOLO);
  });
});

describe("自娱账本的记账", () => {
  it("best 型只往上抬：皮球连击 5 之后再低也留 5", () => {
    const s = ledger();
    expect(soloScore(s, "ball", 3)).toBe(3);
    expect(soloScore(s, "ball", 5)).toBe(5);
    expect(soloScore(s, "ball", 2)).toBe(5);
    expect(s.ballBest).toBe(5);
    expect(soloScore(s, "ball", 0)).toBe(5);
  });

  it("total 型逐次累加：不认负数，也不把 0 当一次", () => {
    const s = ledger();
    expect(soloScore(s, "lantern", 1)).toBe(1);
    expect(soloScore(s, "lantern", 2)).toBe(3);
    expect(soloScore(s, "lantern", -4)).toBe(3);
    expect(soloScore(s, "lantern", 0)).toBe(3);
    expect(s.flares).toBe(3);
    expect(soloScore(s, "fishing", 999_999_999)).toBeLessThanOrEqual(1_000_000);
  });

  it("飞蛾单独一笔：赶走的只进 moths，不污染拨灯数", () => {
    const s = ledger({ flares: 2 });
    expect(soloScare(s)).toBe(1);
    expect(s.moths).toBe(1);
    expect(s.flares).toBe(2);
    expect(soloScare(s, 3)).toBe(4);
  });

  it("种类数只记第一次：同一件玩八遍仍是一件", () => {
    const s = ledger();
    expect(soloMarkSeen(s, "ball")).toBe(1);
    expect(soloMarkSeen(s, "ball")).toBe(1);
    expect(soloMarkSeen(s, "mirror")).toBe(2);
    expect(soloSeenCount(s)).toBe(2);
  });

  it("汇报用的两个总数：玩过的件数与战果合计（飞蛾不进战果）", () => {
    const s = ledger({ ballBest: 4, comboBest: 3, flares: 5, moths: 2, fish: 6, mirror: 7, seen: ["ball", "combo"] });
    const totals = soloTotals(s);
    expect(totals.kinds).toBe(2);
    expect(totals.score).toBe(4 + 3 + 5 + 6 + 7);
    expect(soloTotals(ledger()).score).toBe(0);
    expect(soloTotals(ledger()).kinds).toBe(0);
  });
});

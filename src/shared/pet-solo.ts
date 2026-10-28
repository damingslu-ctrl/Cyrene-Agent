/**
 * v1.18 自娱五件：菜单、引擎、成就三方共用的词表与跨重启账本。
 * 账本只存事实（各件的峰值/累计），分数与句子都在这里算，渲染端不再自己编。
 */

export const SOLO_KINDS = ["ball", "combo", "lantern", "fishing", "mirror"] as const;

export type SoloKind = (typeof SOLO_KINDS)[number];

/** 一句话里用的名词（汇报行与收场句都从这里拼）。 */
export const SOLO_LABELS: Readonly<Record<SoloKind, string>> = {
  ball: "皮球",
  combo: "台本",
  lantern: "灯火",
  fishing: "鱼儿",
  mirror: "镜子",
};

/** `best` 只往上抬（连击峰值）；`total` 逐次累加（做过几回）。 */
export const SOLO_MODE: Readonly<Record<SoloKind, "best" | "total">> = {
  ball: "best",
  combo: "best",
  lantern: "total",
  fishing: "total",
  mirror: "total",
};

/** 每件落到账本上的那个字段名。 */
export const SOLO_FIELD: Readonly<Record<SoloKind, keyof SoloCounters>> = {
  ball: "ballBest",
  combo: "comboBest",
  lantern: "flares",
  fishing: "fish",
  mirror: "mirror",
};

/** 开场摆的那个姿势（必须是 motion 表里登记过的手势 id，渲染端照演）。 */
export const SOLO_GESTURES: Readonly<Record<SoloKind, string>> = {
  ball: "hop",
  combo: "wave",
  lantern: "peek",
  fishing: "tilt",
  mirror: "groom",
};

const SOLO_START: Readonly<Record<SoloKind, string>> = {
  ball: "我自己拍皮球",
  combo: "我整套演一遍",
  lantern: "我去点点夜灯",
  fishing: "我自己钓条鱼",
  mirror: "我照照镜子",
};

const SOLO_END: Readonly<Record<SoloKind, (n: number) => string>> = {
  ball: (n) => `皮球连到 ${n} 下`,
  combo: (n) => `台本走完 ${n} 遍`,
  lantern: (n) => `灯火拨亮 ${n} 次`,
  fishing: (n) => `鱼儿钓上 ${n} 条`,
  mirror: (n) => `镜子照够 ${n} 回`,
};

/** 空手回来的说法——不阴阳，也不报负数。 */
export const SOLO_EMPTY_LINE = "这次没玩出名堂";

/** 一句「没在玩」的自白，用于战果为零的汇报。 */
export const SOLO_IDLE_LINE = "让我自己玩一会儿吧";

/** 坏档不许一口气把成就灌满。 */
export const SOLO_CAP = 1_000_000;

export interface SoloCounters {
  ballBest: number;
  comboBest: number;
  /** 拨亮夜灯的次数（total）。 */
  flares: number;
  /** 赶走的飞蛾：单独一笔，不进战果、不进成就。 */
  moths: number;
  fish: number;
  mirror: number;
}

export interface SoloLedger extends SoloCounters {
  /** 玩过的件数按 id 记，同一件玩八遍仍算一件。 */
  seen: SoloKind[];
}

export const EMPTY_SOLO: SoloLedger = {
  ballBest: 0,
  comboBest: 0,
  flares: 0,
  moths: 0,
  fish: 0,
  mirror: 0,
  seen: [],
};

export function isSoloKind(value: unknown): value is SoloKind {
  return typeof value === "string" && (SOLO_KINDS as readonly string[]).includes(value);
}

export function soloStartLine(kind: SoloKind): string {
  return SOLO_START[kind];
}

export function soloEndLine(kind: SoloKind, value: number): string {
  return value > 0 ? SOLO_END[kind](value) : SOLO_EMPTY_LINE;
}

function toCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(SOLO_CAP, Math.floor(value));
}

/** 读盘自愈：非对象退空账本，脏值夹成 0，`seen` 只认登记过的 id。 */
export function parseSolo(raw: unknown): SoloLedger {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...EMPTY_SOLO, seen: [] };
  }
  const input = raw as Record<string, unknown>;
  const seen: SoloKind[] = [];
  if (Array.isArray(input.seen)) {
    for (const entry of input.seen) {
      if (isSoloKind(entry) && !seen.includes(entry)) seen.push(entry);
    }
    seen.length = Math.min(seen.length, SOLO_KINDS.length);
  }
  return {
    ballBest: toCount(input.ballBest),
    comboBest: toCount(input.comboBest),
    flares: toCount(input.flares),
    moths: toCount(input.moths),
    fish: toCount(input.fish),
    mirror: toCount(input.mirror),
    seen,
  };
}

/**
 * 记一笔并返回**当下**的分数。best 型取峰值、total 型累加；
 * 零与负数都不算一次，所以调用方可以据此判断这次有没有名堂。
 */
export function soloScore(ledger: SoloLedger, kind: SoloKind, value: number): number {
  const field = SOLO_FIELD[kind];
  const add = toCount(value);
  if (add === 0) return ledger[field];
  const next = SOLO_MODE[kind] === "best" ? Math.max(ledger[field], add) : Math.min(SOLO_CAP, ledger[field] + add);
  ledger[field] = next;
  return next;
}

/** 赶走飞蛾：只进 moths，不碰拨灯数。 */
export function soloScare(ledger: SoloLedger, count = 1): number {
  ledger.moths = Math.min(SOLO_CAP, ledger.moths + toCount(count));
  return ledger.moths;
}

/** 首次玩到某件时返回新的种类数；重复玩不涨。 */
export function soloMarkSeen(ledger: SoloLedger, kind: SoloKind): number {
  if (!ledger.seen.includes(kind)) {
    ledger.seen.push(kind);
    if (ledger.seen.length > SOLO_KINDS.length) ledger.seen.shift();
  }
  return ledger.seen.length;
}

export function soloSeenCount(ledger: SoloLedger): number {
  return ledger.seen.length;
}

/** 汇报口径：玩过的件数 + 战果合计（飞蛾故意不进战果）。 */
export function soloTotals(ledger: SoloLedger): { kinds: number; score: number } {
  return {
    kinds: ledger.seen.length,
    score: SOLO_KINDS.reduce((sum, kind) => sum + ledger[SOLO_FIELD[kind]], 0),
  };
}

/**
 * 汇报气泡：最多三行（气泡内宽只有 78px，第四行会切字）。
 * 首行是件数与战果，后两行按战果从大到小列两件，并列时按词表顺序。
 */
export function buildSoloReport(ledger: SoloLedger): string[] {
  const { kinds, score } = soloTotals(ledger);
  const head = `自娱 ${kinds}/${SOLO_KINDS.length} 件 · 战果 ${score}`;
  const ranked = SOLO_KINDS
    .map((kind) => ({ kind, value: ledger[SOLO_FIELD[kind]] }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  if (ranked.length === 0) return [head, SOLO_IDLE_LINE];
  return [head, ...ranked.slice(0, 2).map((entry) => `${SOLO_LABELS[entry.kind]} ${entry.value}`)];
}

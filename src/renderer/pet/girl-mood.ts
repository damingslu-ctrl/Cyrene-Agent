/**
 * 每日心情：昨天怎么被陪，决定今天从哪一档起步。
 * 纯函数只把「照顾量 + 一个 roll」翻成四档；跨天结算、落盘、节奏换算都在引擎里。
 * 不新增常驻墨迹：心情只通过步子、歇多久、说话间隔被看见。
 */
export const MOOD_IDS = ["lively", "lazy", "clingy", "proud"] as const;

export type MoodId = (typeof MOOD_IDS)[number];

export interface CareCounts {
  pats: number;
  plays: number;
  feeds: number;
  toys: number;
}

export interface DailyMood {
  day: string;
  id: MoodId;
}

export const MOOD_LABELS: Record<MoodId, string> = {
  lively: "精神满满",
  lazy: "懒洋洋",
  clingy: "黏人",
  proud: "小傲娇",
};

const MOOD_LINES: Record<MoodId, string> = {
  lively: "今天尾巴都闲不住，想多玩一会儿",
  lazy: "昨晚睡得晚，今天想慢慢来",
  clingy: "今天想离你近一点，别走太远",
  proud: "今天心情不错，但才不是因为你",
};

const MOOD_CHATTER: Record<MoodId, readonly string[]> = {
  lively: ["尾巴自己就摇起来了", "今天可以多玩一会儿吗"],
  lazy: ["再让我趴一会儿…", "今天的事，慢慢做"],
  clingy: ["你刚才去哪了？", "靠近一点也没关系吧"],
  proud: ["哼，今天也还行", "才没有一直等你"],
};

export interface MoodTuning {
  /** 多久没人碰才会坐下歇。 */
  restAfterMs: number;
  /** 亲和度增益倍率。 */
  affinityScale: number;
  /** 闲话间隔倍率：越大越安静。 */
  chatScale: number;
}

const TUNING: Record<MoodId, MoodTuning> = {
  lively: { restAfterMs: 55_000, affinityScale: 1.05, chatScale: 0.8 },
  lazy: { restAfterMs: 26_000, affinityScale: 0.95, chatScale: 1.4 },
  clingy: { restAfterMs: 48_000, affinityScale: 1.18, chatScale: 0.85 },
  proud: { restAfterMs: 40_000, affinityScale: 0.9, chatScale: 1.1 },
};

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === "string" && (MOOD_IDS as readonly string[]).includes(value);
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 摸头 1 分、陪玩/喂食各 2 分、玩具 1 分。 */
export function careScore(care: CareCounts): number {
  return safeCount(care.pats) + safeCount(care.plays) * 2 + safeCount(care.feeds) * 2 + safeCount(care.toys);
}

export function rollMood(care: CareCounts, roll: number): MoodId {
  const score = careScore(care);
  if (score <= 0) return "lazy";
  const pick = Number.isFinite(roll) ? ((roll % 1) + 1) % 1 : 0.5;
  if (score >= 10) {
    return safeCount(care.pats) >= safeCount(care.plays) * 2
      ? "clingy"
      : pick < 0.6 ? "lively" : "clingy";
  }
  if (score >= 4) return pick < 0.35 ? "proud" : "lively";
  return pick < 0.7 ? "lazy" : "proud";
}

export function moodTuning(id: MoodId): MoodTuning {
  return { ...TUNING[id] };
}

export function moodLine(id: MoodId): string {
  return MOOD_LINES[id];
}

export function moodChatter(id: MoodId): readonly string[] {
  return MOOD_CHATTER[id];
}

export function parseDailyMood(raw: unknown): DailyMood | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { day?: unknown; id?: unknown };
  if (typeof obj.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.day)) return null;
  if (!isMoodId(obj.id)) return null;
  return { day: obj.day, id: obj.id };
}

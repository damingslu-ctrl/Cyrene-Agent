/**
 * v1.20 野性觉醒：一只家猫慢慢露出猎手那一面。
 *
 * 四阶（家猫 0 / 醒爪 3 / 猎手 8 / 小野猫 15）只做两件事：
 *   1. 决定她会哪几式——冲刺一开始就会，醒爪加潜行，猎手才准扑击；
 *   2. 小野猫冷却减半、冲动更密（她才不是「练满就封顶」）。
 *
 * 账本只记事实：点数 + 三式各自的次数。句子、门槛、冷却都在这里算，
 * 引擎只负责把冲动演出来、把收尾交回来。
 */

export type WildImpulse = "zoom" | "stalk" | "hunt";
export type WildLevelId = "home" | "claw" | "hunter" | "wildcat";

export interface WildLevel {
  id: WildLevelId;
  label: string;
  /** 升到这一阶所需的野性点数。 */
  at: number;
}

/** 阶位表：顺序即汇报里的顺序，`at` 必须单调递增。 */
export const WILD_LEVELS: readonly WildLevel[] = [
  { id: "home", label: "家猫", at: 0 },
  { id: "claw", label: "醒爪", at: 3 },
  { id: "hunter", label: "猎手", at: 8 },
  { id: "wildcat", label: "小野猫", at: 15 },
];

/** 坏档一次灌满也只是一串数字：点数与计数一律封顶。 */
export const WILD_CAP = 1_000_000;

/** 22 点到凌晨 5 点算夜：同样的动作记双倍。 */
export const WILD_NIGHT_FROM = 22;
export const WILD_NIGHT_TO = 5;

/** 自主冲动的冷却：小野猫减半（更快、更野）。 */
export const WILD_COOLDOWN_MS = 120_000;
export const WILD_COOLDOWN_WILDCAT_MS = 60_000;

/** 三式的移动速度（px/s）：冲刺是走路的近三倍，潜行只有四成。 */
export const WILD_ZOOM_SPEED = 150;
export const WILD_STALK_SPEED = 22;

/** 扑击在原点演多久；潜行走到位后接的这一下也用它。 */
export const WILD_HUNT_MS = 900;
/** 冲刺/潜行的最长赶路时间：卡住（贴边/窗口被占）时也要收场，不许挂着野性标记。 */
export const WILD_MOVE_MS = 12_000;

export interface WildState {
  points: number;
  zooms: number;
  stalks: number;
  hunts: number;
}

export const EMPTY_WILD: WildState = { points: 0, zooms: 0, stalks: 0, hunts: 0 };

export function emptyWild(): WildState {
  return { ...EMPTY_WILD };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(WILD_CAP, Math.floor(value))
    : 0;
}

/** 读档清洗：缺项、错型、负数、小数、超限都收成合法账。 */
export function sanitizeWild(raw: unknown): WildState {
  if (!raw || typeof raw !== "object") return emptyWild();
  const obj = raw as Record<string, unknown>;
  return {
    points: count(obj.points),
    zooms: count(obj.zooms),
    stalks: count(obj.stalks),
    hunts: count(obj.hunts),
  };
}

export function wildLevelFor(points: number): WildLevel {
  const at = count(points);
  let found = WILD_LEVELS[0];
  for (const level of WILD_LEVELS) {
    if (at >= level.at) found = level;
  }
  return found;
}

export interface WildUnlocks {
  zoom: boolean;
  stalk: boolean;
  hunt: boolean;
}

export function wildUnlocks(level: WildLevelId): WildUnlocks {
  return {
    zoom: true,
    stalk: level !== "home",
    hunt: level === "hunter" || level === "wildcat",
  };
}

/** 阶位序号（0..3）：成就只认这个数，不必知道阶名怎么拼。 */
export function wildRank(points: number): number {
  return WILD_LEVELS.indexOf(wildLevelFor(points));
}

export function isWildNight(hour: number): boolean {
  return hour >= WILD_NIGHT_FROM || hour < WILD_NIGHT_TO;
}

/** 一次冲动记多少点：夜间双倍。 */
export function wildGain(event: WildImpulse, hour: number): number {
  void event;
  return isWildNight(hour) ? 2 : 1;
}

/** 纯记账：旧账本不改，返回新账本。 */
export function recordWild(state: WildState, event: WildImpulse, hour: number): WildState {
  const points = Math.min(WILD_CAP, state.points + wildGain(event, hour));
  const bump = (n: number) => Math.min(WILD_CAP, n + 1);
  return {
    points,
    zooms: event === "zoom" ? bump(state.zooms) : state.zooms,
    stalks: event === "stalk" ? bump(state.stalks) : state.stalks,
    hunts: event === "hunt" ? bump(state.hunts) : state.hunts,
  };
}

export function nextWildAt(points: number): number | null {
  const at = count(points);
  for (const level of WILD_LEVELS) {
    if (level.at > at) return level.at;
  }
  return null;
}

export function wildCooldownFor(level: WildLevel): number {
  return level.id === "wildcat" ? WILD_COOLDOWN_WILDCAT_MS : WILD_COOLDOWN_MS;
}

/** 每个待机拍想撒野的概率；到小野猫明显更密。 */
export function wildChanceFor(level: WildLevel): number {
  switch (level.id) {
    case "home": return 0.12;
    case "claw": return 0.16;
    case "hunter": return 0.2;
    case "wildcat": return 0.3;
  }
}

const DAY_WEIGHTS: Record<WildImpulse, number> = { zoom: 60, stalk: 25, hunt: 15 };
const NIGHT_WEIGHTS: Record<WildImpulse, number> = { zoom: 40, stalk: 30, hunt: 30 };

/** 按当前阶与昼夜加权抽一式；只会抽她已解锁的。 */
export function pickWildImpulse(level: WildLevel, hour: number, random: number): WildImpulse {
  const unlocked = wildUnlocks(level.id);
  const weights = isWildNight(hour) ? NIGHT_WEIGHTS : DAY_WEIGHTS;
  const pool = (Object.keys(weights) as WildImpulse[]).filter((impulse) => unlocked[impulse]);
  const total = pool.reduce((sum, impulse) => sum + weights[impulse], 0);
  let at = Math.min(0.999999, Math.max(0, random)) * total;
  for (const impulse of pool) {
    if (at < weights[impulse]) return impulse;
    at -= weights[impulse];
  }
  return pool[pool.length - 1];
}

/** 「让她野一下」用：不抽签，直接上她最拿手的那一式。 */
export function bestWildImpulse(level: WildLevel): WildImpulse {
  const unlocked = wildUnlocks(level.id);
  if (unlocked.hunt) return "hunt";
  if (unlocked.stalk) return "stalk";
  return "zoom";
}

/** 三行汇报：阶名+点数 / 差多少升阶 / 三式计数。气泡内宽 78px，每行都不许折。 */
export function wildReport(state: WildState): string[] {
  const level = wildLevelFor(state.points);
  const next = nextWildAt(state.points);
  return [
    `${level.label} · 野性 ${state.points}`,
    next === null ? "野性全开了" : `再 ${next - state.points} 点成${wildLevelFor(next).label}`,
    `冲${state.zooms} 潜${state.stalks} 扑${state.hunts}`,
  ];
}

/** 升阶台词；留在本阶（或传 home）时 null。 */
export const WILD_LEVEL_LINES: Record<WildLevelId, readonly string[]> = {
  home: [],
  claw: ["爪子醒了，想撒野", "毛毛都竖起来了"],
  hunter: ["闻到猎物的味道", "这次要扑个准的"],
  wildcat: ["野性全开，喵！", "这片桌面归我巡"],
};

export function wildLevelUpLine(level: WildLevelId, random: number): string | null {
  const lines = WILD_LEVEL_LINES[level];
  if (lines.length === 0) return null;
  const idx = Math.min(lines.length - 1, Math.floor(Math.min(0.999999, Math.max(0, random)) * lines.length));
  return lines[idx];
}

export const WILD_LINES: Record<WildImpulse, readonly string[]> = {
  zoom: ["呼——追风去！", "撒开腿，跑一段"],
  stalk: ["悄悄……再靠近一点", "压低——别出声"],
  hunt: ["就是现在，扑！", "抓到了！"],
};

export function wildActLine(impulse: WildImpulse, random: number): string {
  const lines = WILD_LINES[impulse];
  const idx = Math.min(lines.length - 1, Math.floor(Math.min(0.999999, Math.max(0, random)) * lines.length));
  return lines[idx];
}

/**
 * 她的一天：把墙上时间切成八段，每段有自己的名字、一句换段台词，以及「天上有没有东西可看」。
 *
 * 为什么不用 `dayPartOf`：那是问候词的粗分档（上午/下午/傍晚/夜里），四句话的锁已经钉在
 * `companion.test.ts` 里，改它等于改老口径。这里另起一张表，只服务新的作息与天色。
 *
 * 天色只挂三处：清晨的日出、黄昏的日落、夜里的月亮。上午/午后/入夜/凌晨没有可看的东西——
 * 「每小时都有节目」等于没有节目。
 */
import { dateKey } from "./girl-bond";

export type GirlPhase = "dawn" | "morning" | "noon" | "afternoon" | "dusk" | "evening" | "night" | "late";
export type SkyKind = "sunrise" | "sunset" | "moon";

export interface PhaseDef {
  phase: GirlPhase;
  label: string;
  /** 这一段从一天中的第几分钟开始（含）。 */
  fromMinute: number;
  sky: SkyKind | null;
}

/** 按时间顺序排列；查段靠 `fromMinute` 取最后一条 ≤ minute。 */
export const PHASES: readonly PhaseDef[] = [
  { phase: "late", label: "凌晨", fromMinute: 0, sky: null },
  { phase: "dawn", label: "清晨", fromMinute: 5 * 60, sky: "sunrise" },
  { phase: "morning", label: "上午", fromMinute: 7 * 60, sky: null },
  { phase: "noon", label: "正午", fromMinute: 11 * 60, sky: null },
  { phase: "afternoon", label: "午后", fromMinute: 13 * 60, sky: null },
  { phase: "dusk", label: "黄昏", fromMinute: 17 * 60, sky: "sunset" },
  { phase: "evening", label: "入夜", fromMinute: 19 * 60, sky: null },
  { phase: "night", label: "夜里", fromMinute: 22 * 60, sky: "moon" },
] as const;

const PHASE_LINES: Record<GirlPhase, string> = {
  dawn: "天边亮了，早安",
  morning: "上午好，今天做啥",
  noon: "正午了，太阳当头",
  afternoon: "午后的风轻轻的",
  dusk: "快看，天烧起来了",
  evening: "灯都亮起来了呢",
  night: "月亮出来了呢",
  late: "这么晚了…我还在",
};

const SKY_LINES: Record<SkyKind, string> = {
  sunrise: "日出…和你一起看",
  sunset: "太阳要落下去啦",
  moon: "月亮挂上来啦",
};

/** 三种天色，顺序即记账表顺序；与 PHASES 的 sky 列必须互为子集（单测钉着）。 */
export const SKY_KINDS: readonly SkyKind[] = ["sunrise", "sunset", "moon"];

/** 自动睡：23:30 上床，05:00 起床。窗口外的自动睡都算「睡过头」。 */
export const AUTO_SLEEP_FROM_MINUTE = 23 * 60 + 30;
export const AUTO_WAKE_MINUTE = 5 * 60;
/** 夜里你多久没碰她，她才自己睡——3 分钟，不是「刚转身就睡」。 */
export const AUTO_SLEEP_IDLE_MS = 3 * 60_000;

/** 本地时间的当日分钟数；坏时间戳退回 0:00（宁可当作凌晨，也不抛错）。 */
export function minuteOfDay(wallMs: number): number {
  const date = new Date(wallMs);
  if (!Number.isFinite(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

/** 当日分钟 → 时辰。越界夹到 [0,1439]，坏数按 0 点算。 */
export function phaseAtMinute(minute: number): GirlPhase {
  const m = Number.isFinite(minute) ? Math.max(0, Math.min(1439, Math.floor(minute))) : 0;
  let phase: GirlPhase = "late";
  for (const def of PHASES) {
    if (m >= def.fromMinute) phase = def.phase;
  }
  return phase;
}

function hhmmOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface ClockReading {
  phase: GirlPhase;
  label: string;
  minute: number;
  hhmm: string;
  sky: SkyKind | null;
}

export function clockAt(wallMs: number): ClockReading {
  const minute = minuteOfDay(wallMs);
  const phase = phaseAtMinute(minute);
  const def = PHASES.find((entry) => entry.phase === phase) ?? PHASES[0];
  return { phase, label: def.label, minute, hhmm: hhmmOf(minute), sky: def.sky };
}

/** 「这一段」的记账键：同一天同一段只记一次，跨天或换段都会变。 */
export function phaseKey(wallMs: number): string {
  return `${dateKey(wallMs)}:${phaseAtMinute(minuteOfDay(wallMs))}`;
}

/** 天色看过的记账键：同一天同一场看一次，跨天或换一种天色都会变。 */
export function watchedKey(wallMs: number, kind: SkyKind): string {
  return `${dateKey(wallMs)}:${kind}`;
}

const CLOCK_KEY_RE = /^\d{4}-\d{2}-\d{2}:(late|dawn|morning|noon|afternoon|dusk|evening|night)$/;
const WATCHED_KEY_RE = /^\d{4}-\d{2}-\d{2}:(sunrise|sunset|moon)$/;

/** 坏键一律退回空串：读档只认同一种形状，别把上年份的随机串当账。 */
export function normalizeClockKey(raw: unknown): string {
  return typeof raw === "string" && CLOCK_KEY_RE.test(raw) ? raw : "";
}

export function normalizeWatchedKey(raw: unknown): string {
  return typeof raw === "string" && WATCHED_KEY_RE.test(raw) ? raw : "";
}

export interface SkyCounters {
  sunrise: number;
  sunset: number;
  moon: number;
}

export const EMPTY_SKIES: SkyCounters = { sunrise: 0, sunset: 0, moon: 0 };

/** 三项各管各的：坏值只把那一项归零，不连坐另外两笔。 */
export function parseSkies(raw: unknown): SkyCounters {
  const out: SkyCounters = { ...EMPTY_SKIES };
  if (!raw || typeof raw !== "object") return out;
  const record = raw as Record<string, unknown>;
  for (const kind of SKY_KINDS) {
    const value = record[kind];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[kind] = Math.min(1_000_000, Math.floor(value));
    }
  }
  return out;
}

export function phaseLine(phase: GirlPhase): string {
  return PHASE_LINES[phase];
}

export function skyLine(kind: SkyKind): string {
  return SKY_LINES[kind];
}

/** 报时气泡：「黄昏 · 18:20」。带「现在是」会超过 78px 一行（v1.19 尺）。 */
export function clockLine(wallMs: number): string {
  const reading = clockAt(wallMs);
  return `${reading.label} · ${reading.hhmm}`;
}

export function autoSleepAt(minute: number): boolean {
  const m = Number.isFinite(minute) ? Math.max(0, Math.min(1439, Math.floor(minute))) : 0;
  return m >= AUTO_SLEEP_FROM_MINUTE || m < AUTO_WAKE_MINUTE;
}

export function autoWakeAt(minute: number): boolean {
  return !autoSleepAt(minute);
}

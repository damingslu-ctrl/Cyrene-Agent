/**
 * 她的节日：只认五个公历日子。农历、调休、洋节大全都不进来——
 * 一年里真正会「今天不一样」的日子不该有十几个。
 *
 * 节日当天只做三件事：戴一枚挂饰、说一句、记一次账。挂饰画在头发另一侧，
 * 与既有装扮槽并存（v1.9 的饰品是你给她选的，节日挂饰是这一天自己长出来的）。
 */
import { dateKey } from "./girl-bond";

export type FestivalId = "new-year" | "valentine" | "children" | "halloween" | "christmas";
export type FestivalOrnament = "lantern" | "heart" | "balloon" | "pumpkin" | "star";

export const FESTIVAL_ORNAMENTS: readonly FestivalOrnament[] = ["lantern", "heart", "balloon", "pumpkin", "star"];

export interface FestivalDef {
  id: FestivalId;
  month: number;
  day: number;
  label: string;
  line: string;
  ornament: FestivalOrnament;
}

export const FESTIVALS: readonly FestivalDef[] = [
  { id: "new-year", month: 1, day: 1, label: "元旦", line: "新年好，一起过", ornament: "lantern" },
  { id: "valentine", month: 2, day: 14, label: "情人节", line: "今天多摸一下", ornament: "heart" },
  { id: "children", month: 6, day: 1, label: "儿童节", line: "今天我当小孩", ornament: "balloon" },
  { id: "halloween", month: 10, day: 31, label: "万圣夜", line: "不给糖就捣蛋喵", ornament: "pumpkin" },
  { id: "christmas", month: 12, day: 25, label: "圣诞节", line: "星星挂在我头上", ornament: "star" },
] as const;

/** 当地日历的一天序号（UTC 折算，绕开夏令时 23/25 小时的一天）。 */
function dayNumber(year: number, month: number, dayOfMonth: number): number {
  return Date.UTC(year, month - 1, dayOfMonth) / 86_400_000;
}

function localParts(wallMs: number): { year: number; month: number; day: number; number: number } | null {
  const date = new Date(wallMs);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return { year, month, day, number: dayNumber(year, month, day) };
}

export function festivalOn(wallMs: number): FestivalDef | null {
  const parts = localParts(wallMs);
  if (!parts) return null;
  return FESTIVALS.find((entry) => entry.month === parts.month && entry.day === parts.day) ?? null;
}

export interface NextFestival {
  def: FestivalDef;
  /** 还有几天（严格 ≥1；当天不算）。 */
  days: number;
  /** 落在哪一年。 */
  year: number;
}

/** 严格在「今天之后」的下一个节日；当天问会跳过自己。 */
export function nextFestival(wallMs: number): NextFestival {
  const parts = localParts(wallMs);
  const today = parts ? parts.number : dayNumber(1970, 1, 1);
  const year = parts ? parts.year : 1970;
  let best: NextFestival | null = null;
  for (const def of FESTIVALS) {
    for (const y of [year, year + 1]) {
      const target = dayNumber(y, def.month, def.day);
      const days = Math.round(target - today);
      if (days < 1) continue;
      if (!best || days < best.days) best = { def, days, year: y };
    }
  }
  // 表非空，这里一定有值；兜底只为类型收敛。
  return best ?? { def: FESTIVALS[0], days: 1, year };
}

/** 当天记账键：同一天同一节只记一次，跨年换键。 */
export function festivalKey(def: FestivalDef, wallMs: number): string {
  return `${def.id}:${dateKey(wallMs)}`;
}

export interface FestivalState {
  /** 最近一次庆祝的键；空串＝没记过。 */
  last: string;
  /** 一共庆祝过几个节日（成就判据）。 */
  count: number;
}

export const EMPTY_FESTIVAL_STATE: FestivalState = { last: "", count: 0 };

export function parseFestivalState(raw: unknown): FestivalState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_FESTIVAL_STATE };
  const record = raw as Record<string, unknown>;
  const last = typeof record.last === "string" && /^[a-z-]+:\d{4}-\d{2}-\d{2}$/.test(record.last)
    ? record.last
    : "";
  const count = typeof record.count === "number" && Number.isFinite(record.count) && record.count > 0
    ? Math.min(1_000_000, Math.floor(record.count))
    : 0;
  return { last, count };
}

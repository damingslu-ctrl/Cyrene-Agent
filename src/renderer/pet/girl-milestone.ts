/**
 * 相识纪念日：只认 7/30/100/365 天。别的天数就是普通的一天——
 * 每天都庆祝等于每天都不庆祝。
 */
export const MILESTONES = [7, 30, 100, 365] as const;
export type MilestoneDay = (typeof MILESTONES)[number];

/** 彩带庆典的视觉寿命；引擎的 `milestoneLeft` 与渲染端同一条秒表。 */
export const MILESTONE_MS = 5_200;

export function milestoneFor(days: number): MilestoneDay | null {
  if (!Number.isFinite(days)) return null;
  const d = Math.floor(days);
  return (MILESTONES as readonly number[]).includes(d) ? (d as MilestoneDay) : null;
}

/** 纪念日记账键：同一天只庆祝一次，跨重启也不重复。 */
export function milestoneKey(day: number): string {
  return `day:${Math.floor(day)}`;
}

/** 坏存档读成空表；只留合法键并去重（旧版本/手改的存档都可能带垃圾）。 */
export function parseCelebrated(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !/^day:\d+$/.test(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

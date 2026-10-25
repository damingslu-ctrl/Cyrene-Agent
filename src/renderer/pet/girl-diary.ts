/**
 * 猫咪日记：每天睡前（或跨天时）把当天被摸/陪玩/喂食的笔数写成一行，留最近七条。
 * 纯函数只管排版、去重、封顶；「哪一天、什么时候收笔」由引擎看本地日期决定。
 */
export const DIARY_MAX = 7;
/** 气泡里最多四行：标题 + 今天 + 最近两条。 */
export const DIARY_LINES = 4;

export interface DiaryEntry {
  /** 本地日期键 YYYY-MM-DD。 */
  day: string;
  text: string;
}

export interface DiaryCounts {
  pats?: number;
  plays?: number;
  feeds?: number;
  toys?: number;
}

export function formatDiaryDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** 一天最多挑两笔最大的事，保证一行塞得进 78px 的气泡内宽。 */
export function composeDiaryLine(counts: DiaryCounts): string {
  const facts: Array<{ n: number; text: (n: number) => string }> = [
    { n: Math.max(0, Math.floor(counts.pats ?? 0)), text: (n) => `被摸 ${n} 下` },
    { n: Math.max(0, Math.floor(counts.plays ?? 0)), text: (n) => `玩疯 ${n} 回` },
    { n: Math.max(0, Math.floor(counts.feeds ?? 0)), text: (n) => `吃了 ${n} 顿` },
    { n: Math.max(0, Math.floor(counts.toys ?? 0)), text: (n) => `玩具 ${n} 次` },
  ];
  const picked = facts
    .filter((f) => f.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map((f) => f.text(f.n));
  return picked.length > 0 ? picked.join("，") : "安安静静待了一天";
}

export function diaryLine(entry: DiaryEntry): string {
  return `${formatDiaryDay(entry.day)} ${entry.text}`;
}

/** 同一天只留一条（后写的覆盖先写的），最多七条，新的在末尾。 */
export function pushDiary(entries: readonly DiaryEntry[], entry: DiaryEntry): DiaryEntry[] {
  const next = entries.filter((e) => e.day !== entry.day);
  next.push(entry);
  return next.slice(-DIARY_MAX);
}

/** 标题 + 今天 + 最近几条；没有旧账时给一句空态，不装作有历史。 */
export function diaryReport(
  entries: readonly DiaryEntry[],
  today: DiaryEntry,
  limit = DIARY_LINES,
): string[] {
  const lines = ["猫咪日记", diaryLine(today)];
  const past = entries
    .filter((e) => e.day !== today.day)
    .slice(-Math.max(0, limit - 2))
    .reverse();
  if (past.length === 0) lines.push("更早的日子还没写");
  else lines.push(...past.map((e) => diaryLine(e)));
  return lines;
}

export function parseDiary(raw: unknown): DiaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DiaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const day = (item as { day?: unknown }).day;
    const text = (item as { text?: unknown }).text;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (typeof text !== "string" || text.trim() === "") continue;
    out.push({ day, text: text.slice(0, 40) });
  }
  return out.slice(-DIARY_MAX);
}

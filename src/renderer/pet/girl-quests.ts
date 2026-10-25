/**
 * 今日小目标：每天三件小事，做完一件就记一笔。不设惩罚，只给一个「今天陪过它」的答案。
 * 纯函数只管计数与排版；跨天清零、落盘、发奖都在引擎。
 */
export type QuestId = "pat" | "play" | "feed";

export interface QuestSpec {
  id: QuestId;
  label: string;
  target: number;
}

export const DAILY_QUESTS: readonly QuestSpec[] = [
  { id: "pat", label: "摸摸头", target: 5 },
  { id: "play", label: "陪它玩", target: 2 },
  { id: "feed", label: "喂小鱼干", target: 1 },
];

export interface QuestState {
  counts: Record<QuestId, number>;
}

export function createQuests(): QuestState {
  return { counts: { pat: 0, play: 0, feed: 0 } };
}

export function questSpec(id: QuestId): QuestSpec {
  const spec = DAILY_QUESTS.find((q) => q.id === id);
  if (!spec) throw new RangeError(`未知的小目标：${id}`);
  return spec;
}

function clampCount(id: QuestId, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(questSpec(id).target, Math.floor(value)));
}

/** 记一笔；返回「这一笔刚好做完」。做完之后不再计数。 */
export function bumpQuest(state: QuestState, id: QuestId, by = 1): boolean {
  const spec = questSpec(id);
  const before = clampCount(id, state.counts[id] ?? 0);
  if (before >= spec.target || !(by > 0)) return false;
  const next = clampCount(id, before + Math.floor(by));
  state.counts[id] = next;
  return next >= spec.target;
}

export function questDone(state: QuestState, id: QuestId): boolean {
  return clampCount(id, state.counts[id] ?? 0) >= questSpec(id).target;
}

export function questsDoneCount(state: QuestState): number {
  return DAILY_QUESTS.filter((q) => questDone(state, q.id)).length;
}

export function questsAllDone(state: QuestState): boolean {
  return questsDoneCount(state) === DAILY_QUESTS.length;
}

/** 一行一件：「✓ 摸摸头 5/5」/「· 陪它玩 1/2」。 */
export function questLine(state: QuestState, id: QuestId): string {
  const spec = questSpec(id);
  const count = clampCount(id, state.counts[id] ?? 0);
  return `${count >= spec.target ? "✓" : "·"} ${spec.label} ${count}/${spec.target}`;
}

/** 气泡四行的账：头一行汇总，后面一件一行。 */
export function questReport(state: QuestState): string[] {
  const done = questsDoneCount(state);
  return [
    done === DAILY_QUESTS.length ? "今日小目标 全清啦" : `今日小目标 ${done}/${DAILY_QUESTS.length}`,
    ...DAILY_QUESTS.map((q) => questLine(state, q.id)),
  ];
}

export function parseQuests(raw: unknown): QuestState {
  const state = createQuests();
  if (!raw || typeof raw !== "object") return state;
  const counts = (raw as { counts?: unknown }).counts;
  if (!counts || typeof counts !== "object") return state;
  for (const q of DAILY_QUESTS) {
    const v = (counts as Record<string, unknown>)[q.id];
    if (typeof v === "number") state.counts[q.id] = clampCount(q.id, v);
  }
  return state;
}

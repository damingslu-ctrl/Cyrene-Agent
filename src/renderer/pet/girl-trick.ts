/**
 * 小把戏：击掌 / 转圈 / 点头 / 害羞。每件都要教够次数才学会；
 * 学会状态直接由次数推出来，不另存一份容易和次数打架的布尔表。
 */
export const TRICKS = [
  { id: "high-five", label: "击掌", gesture: "wave", need: 3, line: "把手举高一点…啪！" },
  { id: "spin", label: "转圈", gesture: "curtsy", need: 4, line: "转一圈，裙摆要飞起来" },
  { id: "nod", label: "点头", gesture: "nod", need: 3, line: "懂啦，这样点头" },
  { id: "shy", label: "害羞", gesture: "coverFace", need: 5, line: "捂住脸…才没有害羞" },
] as const;

export type TrickId = (typeof TRICKS)[number]["id"];

export interface TrickDef {
  id: TrickId;
  label: string;
  gesture: string;
  need: number;
  line: string;
}

export interface TrickState {
  counts: Record<TrickId, number>;
}

export interface TeachResult {
  learned: boolean;
  already: boolean;
  count: number;
  need: number;
}

export function createTricks(): TrickState {
  return { counts: { "high-five": 0, spin: 0, nod: 0, shy: 0 } };
}

export function trickSpec(id: TrickId): TrickDef {
  const spec = TRICKS.find((t) => t.id === id);
  if (!spec) throw new RangeError(`未知的小把戏：${id}`);
  return spec;
}

function clampCount(id: TrickId, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(trickSpec(id).need, Math.floor(value)));
}

export function teachTrick(state: TrickState, id: TrickId): TeachResult {
  const spec = trickSpec(id);
  const before = clampCount(id, state.counts[id]);
  if (before >= spec.need) {
    return { learned: false, already: true, count: spec.need, need: spec.need };
  }
  const count = before + 1;
  state.counts[id] = count;
  return { learned: count >= spec.need, already: false, count, need: spec.need };
}

export function trickLearned(state: TrickState, id: TrickId): boolean {
  return clampCount(id, state.counts[id]) >= trickSpec(id).need;
}

export function tricksLearned(state: TrickState): number {
  return TRICKS.filter((t) => trickLearned(state, t.id)).length;
}

export function trickLine(state: TrickState, id: TrickId): string {
  const spec = trickSpec(id);
  const count = clampCount(id, state.counts[id]);
  return count >= spec.need ? `✓ ${spec.label}` : `· ${spec.label} ${count}/${spec.need}`;
}

export function trickReport(state: TrickState): string[] {
  return [`小把戏 ${tricksLearned(state)}/${TRICKS.length}`, ...TRICKS.map((t) => trickLine(state, t.id))];
}

export function parseTricks(raw: unknown): TrickState {
  const state = createTricks();
  if (!raw || typeof raw !== "object") return state;
  const counts = (raw as { counts?: unknown }).counts;
  if (!counts || typeof counts !== "object") return state;
  for (const trick of TRICKS) {
    state.counts[trick.id] = clampCount(trick.id, (counts as Record<string, unknown>)[trick.id]);
  }
  return state;
}

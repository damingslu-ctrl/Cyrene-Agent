/**
 * 拾荒收藏：在桌边转转就会捡到的小东西。纯函数只管「roll 挑一件、记一笔、排一行」，
 * 什么时候真的去捡、说哪句话，都由引擎决定。
 */
export const TREASURES = [
  { id: "button", label: "亮纽扣" },
  { id: "feather", label: "一根羽毛" },
  { id: "pebble", label: "圆石子" },
  { id: "ribbon", label: "旧丝带" },
  { id: "cap", label: "汽水瓶盖" },
  { id: "leaf", label: "干树叶" },
] as const;

export type TreasureId = (typeof TREASURES)[number]["id"];

export interface TreasureState {
  counts: Record<TreasureId, number>;
}

export interface TreasureFind {
  id: TreasureId;
  label: string;
  count: number;
  total: number;
}

export function createTreasures(): TreasureState {
  return { counts: { button: 0, feather: 0, pebble: 0, ribbon: 0, cap: 0, leaf: 0 } };
}

function clampCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1_000_000, Math.floor(value));
}

export function findTreasure(state: TreasureState, roll: number): TreasureFind {
  const pick = Number.isFinite(roll) ? ((roll % 1) + 1) % 1 : 0.5;
  const index = Math.min(TREASURES.length - 1, Math.floor(pick * TREASURES.length));
  const item = TREASURES[index];
  const count = clampCount(state.counts[item.id]) + 1;
  state.counts[item.id] = count;
  return { id: item.id, label: item.label, count, total: treasureTotal(state) };
}

export function treasureTotal(state: TreasureState): number {
  return TREASURES.reduce((sum, t) => sum + clampCount(state.counts[t.id]), 0);
}

export function treasureReport(state: TreasureState): string[] {
  const total = treasureTotal(state);
  if (total <= 0) return ["小口袋 还没捡到过什么", "带我到处转转吧"];
  const lines = [`小口袋 ${total} 件`];
  for (const item of TREASURES) {
    const count = clampCount(state.counts[item.id]);
    if (count > 0) lines.push(`${item.label} ×${count}`);
  }
  return lines;
}

export function parseTreasures(raw: unknown): TreasureState {
  const state = createTreasures();
  if (!raw || typeof raw !== "object") return state;
  const counts = (raw as { counts?: unknown }).counts;
  if (!counts || typeof counts !== "object") return state;
  for (const item of TREASURES) {
    state.counts[item.id] = clampCount((counts as Record<string, unknown>)[item.id]);
  }
  return state;
}

/**
 * 本命玩具：不新增计数器，只从已有的 `PetStats` 里挑出玩得最多的那件。
 * 够三次才算「本命」，打平按词表顺序——同一份统计永远给同一个答案。
 */
import type { PetStats } from "./girl-achievements";

export const FAVORITE_MIN = 3;

export type FavoriteToyId =
  | "wand" | "bubbles" | "bell" | "mouse" | "mole" | "laser"
  | "brush" | "catnip" | "plane" | "scratch" | "tail" | "knead"
  | "roll" | "book" | "gift" | "wish" | "hopscotch" | "snow" | "fortune";

export interface FavoriteToyDef {
  id: FavoriteToyId;
  label: string;
  stat: keyof PetStats;
}

export const FAVORITE_TOYS: readonly FavoriteToyDef[] = [
  { id: "wand", label: "逗猫棒", stat: "wand" },
  { id: "bubbles", label: "泡泡", stat: "bubbles" },
  { id: "bell", label: "铃铛球", stat: "bells" },
  { id: "mouse", label: "发条鼠", stat: "mice" },
  { id: "mole", label: "地鼠", stat: "moles" },
  { id: "laser", label: "红点", stat: "lasers" },
  { id: "brush", label: "梳子", stat: "brushes" },
  { id: "catnip", label: "猫薄荷", stat: "catnips" },
  { id: "plane", label: "纸飞机", stat: "planes" },
  { id: "scratch", label: "猫抓板", stat: "scratches" },
  { id: "tail", label: "自己的尾巴", stat: "tails" },
  { id: "knead", label: "踩奶垫", stat: "kneads" },
  { id: "roll", label: "跟头", stat: "rolls" },
  { id: "book", label: "故事书", stat: "books" },
  { id: "gift", label: "礼物盒", stat: "gifts" },
  { id: "wish", label: "许愿星", stat: "wishes" },
  { id: "hopscotch", label: "格子", stat: "hopscotch" },
  { id: "snow", label: "雪人", stat: "snowmen" },
  { id: "fortune", label: "签纸", stat: "fortunes" },
];

export interface FavoriteToy {
  id: FavoriteToyId;
  label: string;
  count: number;
}

export function favoriteToy(stats: PetStats): FavoriteToy | null {
  let best: FavoriteToy | null = null;
  for (const toy of FAVORITE_TOYS) {
    const count = stats[toy.stat];
    if (!(typeof count === "number") || !Number.isFinite(count) || count < FAVORITE_MIN) continue;
    if (!best || count > best.count) best = { id: toy.id, label: toy.label, count: Math.floor(count) };
  }
  return best;
}

/** 够格的候选有几件：只有一件时还谈不上「本命」，只是一直玩它。 */
export function favoriteRivals(stats: PetStats): number {
  return FAVORITE_TOYS.filter((toy) => {
    const count = stats[toy.stat];
    return typeof count === "number" && Number.isFinite(count) && count >= FAVORITE_MIN;
  }).length;
}

const REQUEST_LINES = [
  (label: string) => `再玩一次${label}，好不好？`,
  (label: string) => `那个${label}…今天还没碰呢`,
  (label: string) => `${label}是我心里的第一名`,
] as const;

export function favoriteRequestLine(fav: FavoriteToy, roll: number): string {
  const pick = Number.isFinite(roll) ? ((roll % 1) + 1) % 1 : 0.5;
  const index = Math.min(REQUEST_LINES.length - 1, Math.floor(pick * REQUEST_LINES.length));
  return REQUEST_LINES[index](fav.label);
}

export function favoriteReport(fav: FavoriteToy | null): string {
  if (!fav) return "本命玩具 还没选中";
  return `本命玩具 ${fav.label} · ${fav.count} 次`;
}

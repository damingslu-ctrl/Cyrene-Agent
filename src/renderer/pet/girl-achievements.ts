/**
 * 五枚小成就。条件全部来自已经存在的计数器：不新增一套成长线，只在她做到某件事的
 * 时候把这一刻记住（跨重启）。徽章只在解锁当场弹出 3.6 秒，之后收进存档。
 */
import { ACCENT, GREEN, PAPER, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { BondTier } from "./girl-bond";
import type { DrawOp } from "./ops";

export const ACHIEVEMENT_MS = 3_600;

export const ACHIEVEMENT_IDS = [
  "first-catch", "first-wand", "bubble-lover", "seven-days", "heart-bond",
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface PetStats {
  /** 摸头次数（只数真的落下去的那一下，合并窗吞掉的不算）。 */
  pats: number;
  /** 捉住伴飞小虫的次数。 */
  catches: number;
  /** 逗猫棒捉中次数。 */
  wand: number;
  /** 戳破泡泡次数。 */
  bubbles: number;
  /** 光标扑击次数。 */
  pounces: number;
}

export const EMPTY_STATS: PetStats = { pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0 };

export interface AchievementDef {
  id: AchievementId;
  title: string;
  line: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first-catch", title: "第一次抓住光", line: "捉到啦！这个要记下来" },
  { id: "first-wand", title: "逗猫棒初体验", line: "羽毛…还想再玩一次" },
  { id: "bubble-lover", title: "泡泡终结者", line: "啵、啵、啵——都戳破啦" },
  { id: "seven-days", title: "七日之约", line: "第七天啦，我们还有好多天" },
  { id: "heart-bond", title: "心意相通", line: "这句话，我只对你说" },
];

export function achievementById(id: string): AchievementDef | null {
  return ACHIEVEMENTS.find((a) => a.id === id) ?? null;
}

/** 条件满足但还没记过的那些（一次只弹一枚，避免同时炸两朵花）。 */
export function newlyUnlocked(
  stats: PetStats,
  days: number,
  tier: BondTier["id"],
  unlocked: readonly AchievementId[],
): AchievementId[] {
  const done = new Set(unlocked);
  const hits: AchievementId[] = [];
  if (stats.catches >= 1) hits.push("first-catch");
  if (stats.wand >= 1) hits.push("first-wand");
  if (stats.bubbles >= 12) hits.push("bubble-lover");
  if (days >= 7) hits.push("seven-days");
  if (tier === "heart") hits.push("heart-bond");
  return hits.filter((id) => !done.has(id));
}

function count(value: unknown, cap = 1_000_000): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(cap, Math.floor(value))
    : 0;
}

export function parseStats(raw: unknown): PetStats {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATS };
  const obj = raw as Record<string, unknown>;
  return {
    pats: count(obj.pats),
    catches: count(obj.catches),
    wand: count(obj.wand),
    bubbles: count(obj.bubbles),
    pounces: count(obj.pounces),
  };
}

export function parseAchievements(raw: unknown): AchievementId[] {
  if (!Array.isArray(raw)) return [];
  const out: AchievementId[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const hit = ACHIEVEMENT_IDS.find((id) => id === value);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** 徽章：吊在头顶的奖牌（丝带 + 圆盘 + 星），双色。 */
export function buildAchievementOps(
  id: AchievementId,
  ageMs: number,
  face: { cx: number; top: number; w: number; h: number },
  nowSec: number,
): DrawOp[] {
  if (ageMs < 0 || ageMs > ACHIEVEMENT_MS) return [];
  const p = ageMs / ACHIEVEMENT_MS;
  const appear = Math.min(1, ageMs / 220);
  const fade = p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1;
  const alpha = appear * fade;
  const bob = Math.sin(nowSec * 3.1) * 1.2;
  const x = face.cx;
  const y = face.top - face.h * 0.16 + bob;
  const r = Math.max(3.2, face.w * 0.16);
  const ops: DrawOp[] = [];
  // 丝带
  const ribbon: Array<[number, number]> = [
    [x - r * 0.5, y - r * 0.2], [x + r * 0.5, y - r * 0.2],
    [x + r * 0.3, y + r * 1.9], [x, y + r * 0.9], [x - r * 0.3, y + r * 1.9],
  ];
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.92 * alpha), points: ribbon.map(([px, py]) => [x + (px - x) * 1.22, y + (py - y) * 1.22]) });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.94 * alpha), points: ribbon });
  // 奖牌
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.94 * alpha), cx: x, cy: y - r * 0.15, rx: r * 1.35, ry: r * 1.35 });
  const tone = id === "heart-bond" ? ROSE : id === "seven-days" ? GREEN : ACCENT;
  ops.push({ kind: "fillEllipse", fill: withAlpha(tone, 0.96 * alpha), cx: x, cy: y - r * 0.15, rx: r * 1.05, ry: r * 1.05 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.85 * alpha), width: 0.8, cx: x, cy: y - r * 0.15, rx: r * 0.78, ry: r * 0.78 });
  // 星
  const star: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r * 0.66 : r * 0.26;
    star.push([x + Math.cos(ang) * rad, y - r * 0.15 + Math.sin(ang) * rad]);
  }
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.96 * alpha), points: star });
  return ops;
}

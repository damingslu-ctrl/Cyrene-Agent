/**
 * 二十七枚小成就。条件全部来自已经存在的计数器：不新增一套成长线，只在她做到某件事的
 * 时候把这一刻记住（跨重启）。徽章只在解锁当场弹出 3.6 秒，之后收进存档。
 */
import { ACCENT, GREEN, PAPER, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { BondTier } from "./girl-bond";
import type { DrawOp } from "./ops";

export const ACHIEVEMENT_MS = 3_600;

export const ACHIEVEMENT_IDS = [
  "first-catch", "first-wand", "bubble-lover", "seven-days", "heart-bond",
  "box-hide", "laser-catch", "brush-lover", "catnip-high", "plane-catch",
  "scratch-art", "bell-fan", "windup-hunter", "mole-master",
  "hug-lover", "purr-engine", "rain-listener", "daily-perfect",
  "tail-chaser", "knead-master", "roll-artist", "bookworm", "gift-opener",
  "wish-maker", "hopscotch-pro", "snow-builder", "fortune-fan",
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
  /** 从纸箱里探出头被点到的次数。 */
  boxes: number;
  /** 扑中红点的次数。 */
  lasers: number;
  /** 完整梳完一轮的次数。 */
  brushes: number;
  /** 闻猫薄荷到打滚结束的次数。 */
  catnips: number;
  /** 接住纸飞机的次数。 */
  planes: number;
  /** 完整磨完一轮猫抓板的次数。 */
  scratches: number;
  /** 铃铛球被摇响的次数（一轮最多记五声）。 */
  bells: number;
  /** 抓住发条老鼠的次数。 */
  mice: number;
  /** 打地鼠拍中的次数。 */
  moles: number;
  /** 抱抱的次数。 */
  hugs: number;
  /** 呼噜开场的次数（一连串摸头只记一次）。 */
  purrs: number;
  /** 发起雨天的次数。 */
  rains: number;
  /** 完成每日小目标的件数（跨天累计）。 */
  quests: number;
  /** 完整追完一轮尾巴的次数。 */
  tails: number;
  /** 踩奶踩完一轮的次数。 */
  kneads: number;
  /** 翻跟头翻完一轮的次数。 */
  rolls: number;
  /** 完整读完一本书的次数。 */
  books: number;
  /** 拆开礼物盒的次数。 */
  gifts: number;
  /** 许愿的次数。 */
  wishes: number;
  /** 跳完一整轮格子的次数。 */
  hopscotch: number;
  /** 堆成雪人的次数。 */
  snowmen: number;
  /** 揭晓每日签文的次数（一天最多一次）。 */
  fortunes: number;
}

export const EMPTY_STATS: PetStats = {
  pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0,
  boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
  scratches: 0, bells: 0, mice: 0, moles: 0, hugs: 0, purrs: 0, rains: 0, quests: 0,
  tails: 0, kneads: 0, rolls: 0, books: 0, gifts: 0,
  wishes: 0, hopscotch: 0, snowmen: 0, fortunes: 0,
};

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
  { id: "box-hide", title: "纸箱领主", line: "这个箱子…现在是我的了" },
  { id: "laser-catch", title: "红光猎人", line: "红色的…一下就被我抓住" },
  { id: "brush-lover", title: "梳毛上瘾", line: "再梳一下下…就一下" },
  { id: "catnip-high", title: "薄荷微醺", line: "地板…好像在转圈" },
  { id: "plane-catch", title: "空中小偷", line: "纸飞机？归我了！" },
  { id: "scratch-art", title: "抓板艺术家", line: "这块板…以后归我的爪子了" },
  { id: "bell-fan", title: "铃铛收藏家", line: "叮铃叮铃…听不腻" },
  { id: "windup-hunter", title: "发条猎手", line: "咔哒咔哒的，追得到！" },
  { id: "mole-master", title: "打地鼠高手", line: "冒头一个，我拍一个" },
  { id: "hug-lover", title: "抱抱成瘾", line: "再抱一会儿…就一会儿" },
  { id: "purr-engine", title: "呼噜发动机", line: "呼噜…停不下来了" },
  { id: "rain-listener", title: "听雨的人", line: "下雨天，最适合一起发呆" },
  { id: "daily-perfect", title: "今日全勤", line: "今天的三件事，都做完啦" },
  { id: "tail-chaser", title: "尾巴猎手", line: "追着自己的尾巴转了三圈" },
  { id: "knead-master", title: "踩奶师傅", line: "软乎乎…踩出一首小曲" },
  { id: "roll-artist", title: "翻滚艺术家", line: "一个跟头，稳稳落地" },
  { id: "bookworm", title: "书页间的猫", line: "故事看完了，借你靠一会儿" },
  { id: "gift-opener", title: "拆礼物的人", line: "每一份心意，我都拆开看" },
  { id: "wish-maker", title: "许愿的人", line: "星星听见了，我也听见了" },
  { id: "hopscotch-pro", title: "跳格子高手", line: "一、二、三，全踩中啦" },
  { id: "snow-builder", title: "雪人建筑师", line: "这个雪人，是我们一起堆的" },
  { id: "fortune-fan", title: "签运常客", line: "第四天的签，也好好收着" },
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
  if (stats.boxes >= 2) hits.push("box-hide");
  if (stats.lasers >= 3) hits.push("laser-catch");
  if (stats.brushes >= 10) hits.push("brush-lover");
  if (stats.catnips >= 2) hits.push("catnip-high");
  if (stats.planes >= 2) hits.push("plane-catch");
  if (stats.scratches >= 3) hits.push("scratch-art");
  if (stats.bells >= 3) hits.push("bell-fan");
  if (stats.mice >= 2) hits.push("windup-hunter");
  if (stats.moles >= 5) hits.push("mole-master");
  if (stats.hugs >= 3) hits.push("hug-lover");
  if (stats.purrs >= 3) hits.push("purr-engine");
  if (stats.rains >= 2) hits.push("rain-listener");
  if (stats.quests >= 3) hits.push("daily-perfect");
  if (stats.tails >= 3) hits.push("tail-chaser");
  if (stats.kneads >= 3) hits.push("knead-master");
  if (stats.rolls >= 3) hits.push("roll-artist");
  if (stats.books >= 2) hits.push("bookworm");
  if (stats.gifts >= 3) hits.push("gift-opener");
  if (stats.wishes >= 5) hits.push("wish-maker");
  if (stats.hopscotch >= 2) hits.push("hopscotch-pro");
  if (stats.snowmen >= 1) hits.push("snow-builder");
  if (stats.fortunes >= 4) hits.push("fortune-fan");
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
    boxes: count(obj.boxes),
    lasers: count(obj.lasers),
    brushes: count(obj.brushes),
    catnips: count(obj.catnips),
    planes: count(obj.planes),
    scratches: count(obj.scratches),
    bells: count(obj.bells),
    mice: count(obj.mice),
    moles: count(obj.moles),
    hugs: count(obj.hugs),
    purrs: count(obj.purrs),
    rains: count(obj.rains),
    quests: count(obj.quests),
    tails: count(obj.tails),
    kneads: count(obj.kneads),
    rolls: count(obj.rolls),
    books: count(obj.books),
    gifts: count(obj.gifts),
    wishes: count(obj.wishes),
    hopscotch: count(obj.hopscotch),
    snowmen: count(obj.snowmen),
    fortunes: count(obj.fortunes),
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
  const tone = id === "heart-bond" || id === "brush-lover" || id === "laser-catch"
    || id === "scratch-art" || id === "hug-lover" || id === "purr-engine"
    || id === "tail-chaser" || id === "knead-master" || id === "gift-opener"
    ? ROSE
    : id === "seven-days" || id === "catnip-high" || id === "rain-listener"
      || id === "daily-perfect" || id === "mole-master" || id === "bookworm"
      || id === "hopscotch-pro" || id === "fortune-fan"
      ? GREEN
      : ACCENT;
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

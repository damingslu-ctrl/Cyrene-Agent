/**
 * 桌宠行为引擎（renderer 独占）。
 *
 * 位置权威在渲染端（漫游/投掷都从这里出发），主进程只在停稳后收一次落盘
 * （`pet-position-settled`）。事件/动作/气泡全是纯数据，renderer.ts 只负责把它
 * 翻译成 CatInput 与窗口几何；不碰 DOM、不碰 IPC，单测可在 node 里跑。
 */
import type { Mood } from "../../shared/cat-types";
import { gestureClip, gestureIds } from "./motion";
import type { PetForm } from "../../shared/pet-profile";
import type { Point, WorkArea } from "../../shared/pet-geometry";
import {
  BOND_UP_MS,
  bondTierOf,
  dateKey,
  daysTogether,
  nightKey,
  type BondState,
  type BondTier,
} from "./girl-bond";
import { normalizeAccessory, type AccessoryId } from "../../shared/pet-accessory";
import { MILESTONE_MS, milestoneFor, milestoneKey, parseCelebrated } from "./girl-milestone";
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_MS,
  achievementById,
  newlyUnlocked,
  parseAchievements,
  parseStats,
  EMPTY_STATS,
  type AchievementExtras,
  type AchievementId,
  type PetStats,
} from "./girl-achievements";
import {
  moodChatter,
  moodLine,
  moodTuning,
  MOOD_LABELS,
  parseDailyMood,
  rollMood,
  type DailyMood,
  type MoodId,
} from "./girl-mood";
import {
  favoriteReport as favoriteReportLine,
  favoriteRequestLine,
  favoriteRivals,
  favoriteToy,
  type FavoriteToy,
} from "./girl-favorite";
import {
  createTricks,
  parseTricks,
  teachTrick,
  trickReport as buildTrickReport,
  trickSpec,
  tricksLearned,
  type TeachResult,
  type TrickId,
  type TrickState,
} from "./girl-trick";
import {
  createTreasures,
  findTreasure,
  parseTreasures,
  TREASURES,
  treasureTotal,
  type TreasureFind,
  type TreasureState,
} from "./girl-treasure";
import {
  createGarden,
  gardenReport as buildGardenReport,
  gardenStage,
  harvestGarden,
  parseGarden,
  plantGarden,
  type GardenStage,
  type GardenState,
} from "./girl-garden";
import { HIDE_COVER_MS, HIDE_PEEK_MS } from "./girl-hide";
import {
  AUTO_SLEEP_IDLE_MS,
  EMPTY_SKIES,
  autoSleepAt,
  autoWakeAt,
  clockAt,
  clockLine,
  minuteOfDay,
  normalizeClockKey,
  normalizeWatchedKey,
  parseSkies,
  phaseKey,
  phaseLine,
  skyLine,
  watchedKey,
  type GirlPhase,
  type SkyCounters,
  type SkyKind,
} from "./girl-clock";
import {
  EMPTY_FESTIVAL_STATE,
  festivalKey,
  festivalOn,
  nextFestival,
  parseFestivalState,
  type FestivalState,
  type FestivalId,
  type FestivalOrnament,
} from "./girl-festival";
import {
  EMPTY_SOLO,
  buildSoloReport,
  isSoloKind,
  parseSolo,
  soloEndLine,
  soloMarkSeen,
  soloScore as scoreSolo,
  soloScare as scareSolo,
  soloStartLine,
  SOLO_GESTURES,
  type SoloKind,
  type SoloLedger,
} from "../../shared/pet-solo";
import {
  WILD_HUNT_MS,
  WILD_MOVE_MS,
  WILD_STALK_SPEED,
  WILD_ZOOM_SPEED,
  bestWildImpulse,
  emptyWild,
  nextWildAt,
  pickWildImpulse,
  recordWild,
  sanitizeWild,
  wildActLine,
  wildChanceFor,
  wildCooldownFor,
  wildLevelFor,
  wildLevelUpLine,
  wildRank,
  wildReport as buildWildReport,
  wildUnlocks,
  type WildImpulse,
  type WildLevelId,
  type WildState,
  type WildUnlocks,
} from "./girl-wild";
import { judgeRps, RPS_SIGNS, type RpsOutcome, type RpsSign } from "../../shared/pet-rps";
import { PURR_MS } from "./girl-purr";
import { RAIN_MS } from "./girl-rain";
import { SNOW_MS } from "./girl-snow";
import { FORTUNE_TIERS, fortuneTierAt } from "./girl-fortune";
import {
  bumpQuest as bumpQuestCount,
  createQuests,
  parseQuests,
  questReport,
  questsAllDone,
  type QuestId,
  type QuestState,
} from "./girl-quests";
import {
  composeDiaryLine,
  diaryReport as buildDiaryReport,
  parseDiary,
  pushDiary,
  type DiaryEntry,
} from "./girl-diary";

export const BUBBLE_TTL_MS = 6_000;
/** 排在气泡后面的那句话最多等这么久；等太久就作废，免得半小时后突然冒出来。 */
const PENDING_LINE_MS = 30_000;
/** 漫游速度（DIP/s）：比 native 的缓动藏身快一档，但仍是「散步」不是「瞬移」。 */
export const WALK_SPEED = 55;
/** 到位减速的半径：最后一段按比例降速，避免贴脸急停。 */
const WALK_EASE_PX = 26;
const WALK_MIN_SPEED = 18;
const WALK_ARRIVE_PX = 1.5;

/** dsh-pet 同口径的投掷物理。 */
export const THROW = {
  gravity: 1400,
  restitution: 0.78,
  wallRestitution: 0.65,
  friction: 2.5,
  maxSpeed: 1500,
  /** 松手时超过这个速度才算「扔」，否则算「放下」。 */
  throwThreshold: 260,
  /** 落地弹跳的最小竖直速度：低于它就不再弹，直接贴地。 */
  bounceFloor: 90,
  restSpeed: 20,
} as const;

const VITALS_KEY = "cyrene.pet.vitals.v1";
/** 羁绊存档：初见时刻、晨间伸懒腰/深夜提醒的日历键。和 vitals 分开，坏一份不拖累另一份。 */
const BOND_KEY = "cyrene.pet.bond.v1";
/** 离线结算上限：半年不开机也不会把猫饿成 0（时间戳被改坏时也兜得住）。 */
const OFFLINE_CAP_MS = 72 * 3600_000;
const IDLE_MIN_MS = 5_000;
const IDLE_SPAN_MS = 4_000;
const CHAT_MIN_MS = 35_000;
const CHAT_SPAN_MS = 30_000;
/** 自主小睡时长：到点自己醒。手动 toggle 的睡眠不受这个上限约束。 */
export const NAP_MIN_MS = 45_000;
const NAP_SPAN_MS = 45_000;

/**
 * 猫娘的静息周期：一个人待够 40s 会自己坐下来歇 18–30s，起身时顺手伸个懒腰。
 * 只有猫娘有「坐」这一段（四足睡/站两态），所以这条周期也只长在 girl 分支上。
 */
export const REST_AFTER_MS = 40_000;
export const REST_MIN_MS = 18_000;
const REST_SPAN_MS = 12_000;

/**
 * `idle_micro` 档里真的动一下：只挑两个最轻的短手势，不打断「她在陪你」的静。
 *
 * 名单里**只准写手势名**（`gestureIds()` 那一族），不准写帧图集的段名或表情名。
 * `wink` 曾经在这里躺了很久：它是 `girl-anim` 的段名、也是 `face` 的表情名，
 * 但不是手势名——引擎排时长要查 `gestureClip`，抽到它就在 `draw()` 里抛
 * 「未知 clip：wink」，而注入随机数的那条单测永远抽不到第二档，于是全绿。
 */
export const MICRO_GESTURES = ["peek", "tilt"] as const;
export const MICRO_CHANCE = 0.35;

/** 那一档抽到哪一支：0 → 第一支，0.999999 → 最后一支。抽偏一档＝名单与算式漂了。 */
export function microGestureAt(draw: number): string {
  const idx = Math.min(
    MICRO_GESTURES.length - 1,
    Math.floor(clamp(draw, 0, 0.999999) * MICRO_GESTURES.length),
  );
  return MICRO_GESTURES[idx];
}

export type CompanionActivity =
  | "idle" | "walk" | "groom" | "yawn" | "stretch" | "tilt"
  | "sleep" | "pet" | "eat" | "play" | "rest" | "drag" | "thrown";

export interface CompanionVitals {
  affinity: number;
  fullness: number;
  energy: number;
}

export interface CompanionContext {
  workArea: WorkArea;
  /** 窗口**物理**尺寸（zoom 后）：漫游夹取要按它算，猫才不会半只脚出屏。 */
  size: { width: number; height: number };
  /** 贴边藏身/面板展开等外部占位：false 时不做自主动作。 */
  canRoam: boolean;
}

export interface CompanionBubble {
  text: string;
  priority: number;
  expiresAt: number;
}

/** v1.19「她的一天」：换段、天色、节日与自动睡。四足形态恒 null。 */
export interface ClockSnapshot {
  phase: GirlPhase;
  /** 此刻天上有东西可看（睡着时为 null）；`watched` 是「这一场已经一起看过」。 */
  sky: { kind: SkyKind; watched: boolean } | null;
  /** 三项天色账（副本）。 */
  skies: SkyCounters;
  /** 今天是什么节（没有则为 null）；挂饰由渲染端照着画。 */
  festival: { id: FestivalId; label: string; ornament: FestivalOrnament } | null;
  /** 一起过节的次数（跨重启）。 */
  festivals: number;
  /** 这一觉是她自己睡着的（天亮会自己醒），不是手动哄睡的。 */
  autoSleep: boolean;
}

/** v1.20 野性觉醒：她此刻的阶、正在演的冲动与冷却。四足恒 null。 */
export interface WildSnapshot {
  points: number;
  level: WildLevelId;
  label: string;
  /** 正在演的冲动；null＝此刻不在撒野。 */
  act: WildImpulse | null;
  /** 这一式还剩多久（赶路时是上限，扑击是动作剩余）。 */
  left: number;
  /** 距下一次自主撒野还有多久（0＝随时可以）。 */
  cooldownLeft: number;
  zooms: number;
  stalks: number;
  hunts: number;
  /** 下一阶门槛；满阶为 null。 */
  next: number | null;
  unlocked: WildUnlocks;
}

export interface CompanionSnapshot {
  activity: CompanionActivity;
  mood: Mood;
  facing: 1 | -1;
  pos: Point;
  vitals: CompanionVitals;
  moving: boolean;
  /** 走路相位（弧度），渲染端拿它摆前后爪与身体起伏。 */
  step: number;
  /** 落地压扁量 0..1，短暂脉冲。 */
  squash: number;
  /** 计时动作的进度 0..1（摸摸/喂食/玩耍/洗脸/哈欠/伸懒腰/歪头）；其它动作为 0。 */
  activityProgress: number;
  vx: number;
  vy: number;
  bubble: CompanionBubble | null;
  /**
   * 猫娘自主抽到的手势 clip id；过期即 null。四足路径恒 null（R-D2：它读不到这条也照常演）。
   */
  gesture: string | null;
  /** 连点逗晕的剩余毫秒（0＝不晕）。四足恒 0；渲染端拿它摆星环与晃身。 */
  dizzyLeft: number;
  /** 当前羁绊档（亲密度换算）；四足也带，但只有猫娘的面板/文案读它。 */
  bond: BondState;
  /** 相识第几天（见面当天＝1）。 */
  days: number;
  /** 刚升档的记号剩余毫秒；0＝没有升档。 */
  bondUpLeft: number;
  /** 摸头连击数（窗口内才非 0，1 是普通的一下）。 */
  patCombo: number;
  /** 连击窗口剩余毫秒。 */
  patComboLeft: number;
  /** 睡梦中被碰醒的惊跳剩余毫秒（0＝没受惊）。 */
  startleLeft: number;
  /** 本次会话扑了几次光标（诊断/成就用，不进存档）。 */
  pounces: number;
  /** 她身上戴的那一件（`none` = 不戴）。四足也带，但只有猫娘会画。 */
  accessory: AccessoryId;
  /** 纪念日彩带的剩余毫秒（0＝今天没有庆典在放）。 */
  milestoneLeft: number;
  /** 正在庆祝的是第几天（不在庆典中为 0）。 */
  milestoneDays: number;
  /** 已解锁的成就（跨重启，顺序即解锁顺序）。 */
  achievements: AchievementId[];
  /** 当前这枚徽章的剩余毫秒（0＝没有徽章在展示）。 */
  achievementLeft: number;
  /** 正在展示的徽章 id；没在展示时为 null。 */
  achievementId: AchievementId | null;
  /** 累计互动统计：成就判据，也供探针核对。 */
  stats: PetStats;
  /** 呼噜剩余毫秒（0＝没在呼噜）；渲染端据此画胸口声纹。 */
  purrLeft: number;
  /** 雨天剩余毫秒（0＝没下雨）；雨滴由渲染端解析绘制。 */
  rainLeft: number;
  /** 雪天剩余毫秒（0＝没下雪）；雪与雨互斥，同一时刻最多一个。 */
  snowLeft: number;
  /** 今日小目标的计数（跨天重置）。 */
  quests: QuestState;
  /** 最近七天的日记（新的在末尾）。 */
  diary: DiaryEntry[];
  /** 今日心情（第一天固定精神满满，第二天起由昨天的照顾量决定）。 */
  moodId: MoodId;
  /** 本命玩具：够三次才认，打平按词表顺序。 */
  favorite: FavoriteToy | null;
  /** 小把戏的练习次数（学没学会由次数推出来）。 */
  tricks: TrickState;
  /** 小口袋里的拾荒收藏。 */
  treasures: TreasureState;
  /** 薄荷盆（plantedAt 是墙上时钟；-1 = 空盆）。 */
  garden: GardenState;
  /** 薄荷种下多久了（行为时钟友好；-1 = 空盆）。 */
  gardenAge: number;
  gardenStage: GardenStage;
  /** 躲猫猫逮到的次数（跨重启）。 */
  hides: number;
  /** v1.18 自娱账本（副本：渲染端改不动她的真账）。 */
  solo: SoloLedger;
  /** v1.19 她的一天；四足为 null（不报时、不做天色、不自动睡）。 */
  clock: ClockSnapshot | null;
  /** v1.20 野性觉醒；四足为 null（不冲刺、不潜行、不扑击）。 */
  wild: WildSnapshot | null;
}

export interface CompanionOptions {
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  random?: () => number;
  /** 行为时钟（生产用 performance.now，与 rAF 同一根秒表）。 */
  now?: () => number;
  /** 落盘时间戳（生产用 Date.now）：存档跨重启，不能拿进程内秒表记。 */
  wallNow?: () => number;
  /** 每一步位置变化（renderer 用它 moveTo；测试可省）。 */
  onMove?: (position: Point) => void;
  /** 停稳（漫游到达/投掷落地/慢放）时一次，renderer 用它落盘。 */
  onSettle?: (position: Point) => void;
}

/** 闲置加权表：`walk` 是漫游，`idle` 是「再站一会儿」。 */
export const IDLE_ACTIVITIES: ReadonlyArray<{ activity: Exclude<CompanionActivity, "drag" | "thrown" | "pet" | "eat" | "play">; weight: number }> = [
  { activity: "walk", weight: 34 },
  { activity: "groom", weight: 16 },
  { activity: "yawn", weight: 10 },
  { activity: "stretch", weight: 10 },
  { activity: "tilt", weight: 10 },
  { activity: "sleep", weight: 6 },
  { activity: "idle", weight: 14 },
];

const ACTION_MS: Record<"groom" | "yawn" | "stretch" | "tilt", number> = {
  groom: 2_400,
  yawn: 1_800,
  stretch: 2_200,
  tilt: 2_000,
};

const CHATTER = [
  "我在这儿呢",
  "要不要看看网络？",
  "窗外好像有鸟",
  "发会儿呆…",
  "今天也好好陪着你",
];

/** 猫娘自己的闲话：四足的「网络/窗外」是猫视角，她坐在这里陪你，说的是人的话。 */
export const GIRL_CHATTER: Record<"morning" | "afternoon" | "evening" | "night", readonly string[]> = {
  morning: ["早呀，今天想先做什么？", "窗边的光刚刚好", "我陪你开工吧"],
  afternoon: ["要不要伸个懒腰？", "我在这儿，不吵你", "忙完记得喝口水"],
  evening: ["今天也辛苦啦", "剩下的明天再说嘛", "灯开暖一点好不好"],
  night: ["这么晚…我陪你一会儿", "该睡啦，真的", "夜里我守着你"],
};

const PET_LINES = ["呼噜呼噜…", "再摸一下嘛", "今天也很喜欢你"];
const FEED_LINES = ["小鱼干！", "嚼嚼…好吃", "吃饱啦"];
const PLAY_LINES = ["再来一次！", "接住啦～", "好玩！"];

const GIRL_PET_LINES = ["嗯…再摸一会儿", "手、手不要停嘛", "这样很安心"];
const GIRL_FEED_LINES = ["是给我的吗？", "嚼嚼…好甜", "还想再吃一口"];
const GIRL_PLAY_LINES = ["陪你玩到天黑！", "这回我赢定了", "再来一局嘛"];
const GIRL_HEAD_LINES = ["诶？摸、摸头…", "头发会被摸乱的啦", "再、再摸一下也可以"];
const GIRL_FEET_LINES = ["呀！脚很痒的——", "别、别挠那里", "咯咯…站不稳了"];
const GIRL_DIZZY_LINES = ["眼、眼前在转…", "别晃啦…", "站、站不稳了"];
const GIRL_NOTICE_LINES = ["你回来啦", "刚刚在看什么呀？", "我在这儿哦"];

/** 连击 2..5 的递进：从「诶？」到「只许再一下」再到彻底放弃抵抗。行序＝连击数−2。 */
const GIRL_PAT_COMBO_LINES = [
  "诶？又、又摸…",
  "头发真的要乱了啦",
  "再摸下去…我要脸红了",
  "好、好啦…只许再一下",
] as const;
/** 升档台词：只在**用户互动**把亲密度推过门槛时说，不抢网络播报（优先级 2）。 */
const GIRL_BOND_LINES: Record<BondTier["id"], readonly string[]> = {
  new: ["我们…刚认识吧？"],
  familiar: ["好像，和你更熟一点了", "下次也来找我玩嘛"],
  close: ["和你待在一起，很安心", "我已经记住你的脚步声了"],
  reliant: ["你不在的话…我会想你的", "今天也想多黏你一会儿"],
  heart: ["最喜欢你了。真的。", "以后也一直在一起，好不好？"],
};
/** 被摸醒：白天理直气壮否认，深夜则压低声音。 */
const GIRL_WAKE_LINES = ["唔…我没有睡着！", "被、被你摸醒了…", "刚才只是闭目养神"];
const GIRL_WAKE_NIGHT_LINES = ["这么晚还来摸我…", "嘘…小点声啦", "我、我醒着呢"];
const GIRL_TOY_LINES = ["球！球给我！", "看我的——", "滚回来呀", "接住！"];
const GIRL_POUNCE_LINES = ["抓到你啦！", "别跑——", "嘿！"];
const GIRL_NIGHT_LINES = ["很晚了…真的该睡了", "再陪你十分钟，然后去睡", "眼睛该休息啦", "我把屏幕调暗一点？"];
export const GIRL_WAND_LINES = ["羽毛！别跑——", "抓到了！", "再甩高一点嘛"];
export const GIRL_WAND_MISS_LINES = ["飞、飞走了…", "下一次一定抓住"];
export const GIRL_BUBBLE_LINES = ["啵！", "泡泡、泡泡别破", "再吹一串嘛"];
export const GIRL_LEAF_LINES = ["哇…下叶子雨了", "接住一片！", "秋天来啦"];
export const GIRL_FOLLOW_LINES = ["等等我——", "你去哪儿呀？", "我跟着你哦"];
export const GIRL_FOLLOW_ARRIVE_LINES = ["到啦", "跟上了！", "是这里吗？"];
export const GIRL_FOLLOW_LOST_LINES = ["诶…不等我", "跑太快啦"];
export const GIRL_RPS_LINES: Record<RpsOutcome, readonly string[]> = {
  win: ["我赢啦！", "嘿嘿，猜拳我最强"],
  lose: ["呜…输了", "再来一局嘛"],
  draw: ["平局！", "我们想到一块了"],
};
export const GIRL_BOX_START_LINES = ["箱子？是给我的吗", "我先钻进去看看"];
export const GIRL_BOX_KNOCK_LINES = ["谁呀？", "在、在的！"];
export const GIRL_BOX_CATCH_LINES = ["被、被发现了！", "里面很舒服的"];
export const GIRL_LASER_START_LINES = ["红点点！别跑——", "那个红的是什么？"];
export const GIRL_LASER_LINES = ["抓到了！", "红点点被我按住啦"];
export const GIRL_LASER_MISS_LINES = ["逃掉了…", "红点点去哪儿了"];
export const GIRL_BRUSH_START_LINES = ["梳毛？好呀…", "轻、轻一点哦"];
export const GIRL_BRUSH_LINES = ["呼…舒服得想睡", "毛都顺了", "还要再梳"];
export const GIRL_CATNIP_START_LINES = ["这个味道…有点上头", "薄荷？我只闻一下"];
export const GIRL_CATNIP_LINES = ["地板…在转圈", "晕乎乎的…好开心"];
export const GIRL_PLANE_START_LINES = ["纸飞机！等等我——", "飞得好高"];
export const GIRL_PLANE_LINES = ["接住啦！", "这架归我了"];
export const GIRL_PLANE_MISS_LINES = ["飞走了…", "纸飞机不等我"];
export const GIRL_BIRD_LINES = ["有小鸟！嘘——", "快看，窗边"];
export const GIRL_BIRD_AWAY_LINES = ["飞走了…", "下次还来吗"];
export const GIRL_SCRATCH_START_LINES = ["猫抓板？我试试", "这块板…是给我的吗"];
export const GIRL_SCRATCH_LINES = ["沙沙沙…舒服", "爪子磨好了，亮亮的"];
export const GIRL_BELL_START_LINES = ["铃铛球！叮铃叮铃", "这个声音…再响一次嘛"];
export const GIRL_BELL_LINES = ["叮铃！", "球、球别跑"];
export const GIRL_MOUSE_START_LINES = ["发条老鼠？咔哒咔哒的", "我来追它！"];
export const GIRL_MOUSE_LINES = ["抓到了！", "看你往哪儿跑"];
export const GIRL_MOUSE_MISS_LINES = ["溜走了…", "老鼠太快了啦"];
export const GIRL_MOLE_START_LINES = ["打地鼠！我来", "冒头就拍下去"];
export const GIRL_MOLE_LINES = ["啪！", "又冒一个！"];
export const GIRL_MOLE_END_LINES = ["手都拍热了", "还、还想玩"];
export const GIRL_HUG_START_LINES = ["要抱抱吗？来吧", "抱紧一点也没关系"];
export const GIRL_HUG_LINES = ["这样…好暖", "再抱一会儿嘛"];
export const GIRL_RAIN_START_LINES = ["下雨了…一起听", "雨声，很舒服"];
export const GIRL_TAIL_START_LINES = ["尾巴…它怎么在动？", "咦，尾巴自己转起来了"];
export const GIRL_TAIL_LINES = ["抓、抓到了！", "转得有点晕…"];
export const GIRL_TAIL_DIZZY_LINES = ["尾巴…变成三个了", "别、别转了啦"];
export const GIRL_KNEAD_START_LINES = ["踩踩…软乎乎的", "这张垫子，我要踩一踩"];
export const GIRL_KNEAD_LINES = ["呼噜…踩得停不下来", "踩好了，舒服吗？"];
export const GIRL_ROLL_START_LINES = ["看我的——翻跟头", "数好咯，一、二——"];
export const GIRL_ROLL_LINES = ["翻过来啦！", "一点都没歪"];
export const GIRL_BOOK_START_LINES = ["这本书…我读两页", "安静一会儿，我看书"];
export const GIRL_BOOK_LINES = ["这一页写得真好", "读完了…还想再看一遍"];
export const GIRL_GIFT_START_LINES = ["礼物盒？给我的吗", "里面会是什么呢"];
export const GIRL_GIFT_LINES = ["是…给我的！", "我要把它收好"];
export const GIRL_WISH_START_LINES = ["有颗星星…", "对着它许个愿吧"];
export const GIRL_WISH_LINES = ["愿望…说好了", "希望明天也见到你"];
export const GIRL_HOP_START_LINES = ["跳格子！我先来", "一、二、三——"];
export const GIRL_HOP_LINES = ["三格都跳完啦", "你看，一次就过"];
export const GIRL_HOP_MISS_LINES = ["踩、踩歪了…", "再来一次嘛"];
export const GIRL_SNOW_START_LINES = ["下雪了…", "雪落到手心里了"];
export const GIRL_SNOWMAN_LINES = ["雪人！像不像你？", "再给它围条围巾"];
export const GIRL_FORTUNE_START_LINES = ["今天的签…", "抽一张看看吧"];
/** 每日小目标做完一件时的回执：三个目标各一句自己的。 */
export const GIRL_QUEST_DONE_LINES: Record<QuestId, readonly string[]> = {
  pat: ["今天的摸摸，够了", "被摸饱了…"],
  play: ["今天玩够本啦", "陪你玩，最开心"],
  feed: ["小鱼干任务完成", "吃得饱饱的"],
};
export const GIRL_QUESTS_DONE_LINES = ["今天的目标全清啦", "三件事，都做到了"];

/** 猫娘词表的唯一出口：测试按表锁文案，别在用例里另抄一份。 */
export const GIRL_LINES = {
  pet: GIRL_PET_LINES,
  feed: GIRL_FEED_LINES,
  play: GIRL_PLAY_LINES,
  head: GIRL_HEAD_LINES,
  feet: GIRL_FEET_LINES,
  dizzy: GIRL_DIZZY_LINES,
  notice: GIRL_NOTICE_LINES,
  combo: GIRL_PAT_COMBO_LINES,
  wake: GIRL_WAKE_LINES,
  wakeNight: GIRL_WAKE_NIGHT_LINES,
  toy: GIRL_TOY_LINES,
  pounce: GIRL_POUNCE_LINES,
  night: GIRL_NIGHT_LINES,
  bond: GIRL_BOND_LINES,
} as const;

/** 被连点逗晕后的视觉时长；渲染端的星环与晃身同一条秒表。 */
export const DIZZY_MS = 3_600;
/** 「注意到你」的台词冷却：跟 presence.noticeCooldownMs 同量级，但两边各记各的。 */
export const NOTICE_COOLDOWN_MS = 12_000;

export const GREETING_LINES = {
  morning: "早上好，今天也一起加油",
  afternoon: "下午好，我在呢",
  evening: "晚上好，今天辛苦啦",
  night: "这么晚还没睡呀",
} as const;

/** 猫娘的露面问候：同一个时段，说的是「我陪你」而不是四足的「一起加油」。 */
export const GIRL_GREETINGS = {
  morning: "早呀，\n今天也要一起",
  afternoon: "你忙你的，\n我在这儿",
  evening: "回来啦，\n先歇一会儿",
  night: "这么晚…\n我陪你一会儿",
} as const;

/** 隔多久没见算「久别」：3 小时内只是走开一下，别每次都演重逢。 */
export const REUNION_GAP_MS = 3 * 3600_000;

/** 久别重逢：三个说法都短，78px 内不折成两半。 */
export const GIRL_REUNION_LINES = [
  "你回来了…我等好久",
  "总算见到你了",
  "还以为你今天不来了",
] as const;

/** 装扮台词：每一件一句招呼；`none` 是「换回不戴」的回执。 */
export const GIRL_ACCESSORY_LINES: Record<AccessoryId, readonly string[]> = {
  none: ["先这样也很好看"],
  bell: ["叮铃…听得见吗？", "铃铛，喜欢吗？"],
  bow: ["蝴蝶结，系好了", "这样会不会太显眼…"],
  scarf: ["围巾暖乎乎的", "冬天也不怕了"],
  flower: ["花别在耳边啦", "像不像春天？"],
  star: ["星星别在头发上", "今晚也闪一闪"],
};

/** 捉到伴飞小虫的台词；「小家伙」两个虫种都叫得出口。 */
export const GIRL_CRITTER_LINES = [
  "捉到啦！",
  "小家伙，对不起啦",
  "飞、飞走了？",
];

/**
 * 星期语料：周一/周五/周末各有自己的池子。抽签没中（或平日）仍回时段表，
 * 深夜永远不换——先把觉睡了。
 */
export const GIRL_WEEKDAY_CHATTER: Record<"mon" | "fri" | "weekend", readonly string[]> = {
  mon: ["周一…慢慢来就好", "新的一周，我陪你", "今天先做一件小事吧"],
  fri: ["周五啦，快收工", "再撑一下下就周末了", "今晚可以晚一点睡"],
  weekend: ["周末就懒一会儿嘛", "今天想去哪儿？", "不用赶，慢慢过"],
};

/** 星期话题的抽中概率：一半日子仍按时段说，免得变成日历播报机。 */
export const WEEKDAY_CHATTER_CHANCE = 0.5;

export function chatterPoolFor(hour: number, weekday: number, roll: number): readonly string[] {
  const part = dayPartOf(hour);
  if (part === "night") return GIRL_CHATTER.night;
  if (Number.isFinite(roll) && roll < WEEKDAY_CHATTER_CHANCE) {
    if (weekday === 1) return GIRL_WEEKDAY_CHATTER.mon;
    if (weekday === 5) return GIRL_WEEKDAY_CHATTER.fri;
    if (weekday === 0 || weekday === 6) return GIRL_WEEKDAY_CHATTER.weekend;
  }
  return GIRL_CHATTER[part];
}

/** 纪念日的独白：必须带「第 N 天」原文，气泡尺按它锁。 */
function milestoneLine(day: number): string {
  switch (day) {
    case 7: return "我们认识第 7 天啦";
    case 30: return "第 30 天了呢";
    case 100: return "第 100 天…好久呀";
    default: return "第 365 天，一整年了";
  }
}

export type DayPart = keyof typeof GREETING_LINES;

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), Math.max(hi, lo));
const dayCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(100_000, Math.floor(value))
    : 0;

/**
 * 离线结算：饱腹掉、精力按休息回。亲密度不因离线下降——回来发现猫记仇不是陪伴。
 * `elapsedMs` 夹在 72h，坏时间戳不会一次把数值清零。
 */
export function decayVitals(vitals: CompanionVitals, elapsedMs: number): CompanionVitals {
  const hours = clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, OFFLINE_CAP_MS) / 3600_000;
  return {
    affinity: clamp01(vitals.affinity),
    fullness: clamp01(vitals.fullness - 0.05 * hours),
    energy: clamp01(vitals.energy + 0.06 * hours),
  };
}

/**
 * 加权挑选；`previous` 的权重会被剔掉（不重复上一动作）。
 * 夜里与低精力时 `sleep` 权重放大、`idle` 直接归零——想睡的时候不该还站着发呆。
 */
export function pickIdleActivity(
  random: number,
  previous: CompanionActivity | null,
  options: { hour?: number; energy?: number } = {},
): CompanionActivity {
  const hour = options.hour ?? 14;
  const energy = options.energy ?? 0.8;
  const night = hour >= 22 || hour < 7;
  const exhausted = energy < 0.25;
  const tired = energy < 0.5;
  const weighted = IDLE_ACTIVITIES.map((entry) => {
    if (entry.activity === previous) return 0;
    switch (entry.activity) {
      case "walk":
        return entry.weight * (night ? 0.45 : 1) * (exhausted ? 0.5 : 1);
      case "sleep":
        return entry.weight * (night ? 6 : 1) * (exhausted ? 4 : tired ? 1.8 : 1);
      case "idle":
        return night || exhausted ? 0 : entry.weight;
      default:
        return entry.weight * (night ? 0.8 : 1);
    }
  });
  const total = weighted.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return "idle";
  const at = clamp(random, 0, 0.999999) * total;
  let cursor = 0;
  for (let i = 0; i < IDLE_ACTIVITIES.length; i += 1) {
    cursor += weighted[i];
    if (at < cursor) return IDLE_ACTIVITIES[i].activity;
  }
  return IDLE_ACTIVITIES[IDLE_ACTIVITIES.length - 1].activity;
}


// ===========================================================================
// v1.5.0 P4 Task 19：猫娘的四档加权抽取（永不停轮）
// ===========================================================================

/** 四档权重（spec §5）：待机微动 10 / 张望 5 / 移动 5 / 小动作池 80。 */
export const ROLL_WEIGHTS = { idle_micro: 10, peek: 5, move: 5, gesture: 80 } as const;
export type RollBucket = keyof typeof ROLL_WEIGHTS;

/**
 * 随机小动作的**分类池**（2026-10-24 按 deepseek-pet `assets/config.jsonc` 的
 * `animations.categories` 对齐）。参考那边分五类、权重 20/20/16/14/10（合计 80，
 * 正好等于顶层 gesture 权重），动作是 106 段预渲视频；我们没有视频预算，
 * 但**分类法与权重可以照搬**，落地成 18 条 clip 的归组：
 *
 *   | 分类 | 权重 | 参考里的动作（举例） | 这里对应的 clip |
 *   |---|---|---|---|
 *   | 小动作 | 20 | 超大伸懒腰 / 哈欠连天 / 照镜子 / 轻快记录 | stretch / yawn / groom / tilt / shiver / nod |
 *   | 玩耍   | 20 | 原地跳跃 / 轻快摇摆舞 / 拍手 | clap / hop / wave / point / shake |
 *   | 吃什么 | 16 | 吃白饭 / 大口吃零食 | sip |
 *   | 时节   | 14 | 女仆屈膝礼仪 / 收红包 | bow / curtsy |
 *   | 文字   | 10 | 深度思考碎碎念 | typeCode / peek |
 *
 * 五类权重合计必须等于 `ROLL_WEIGHTS.gesture`（80）——`companion.test` 有锁；
 * 不等就说明「小动作池」与「分类池」各说各话，抽取会悄悄偏。
 */
export interface GestureCategory {
  id: string;
  weight: number;
  actions: readonly string[];
}

export const GESTURE_CATEGORIES: readonly GestureCategory[] = [
  // 18 条 clip 必须**一条不落**地进池（`companion.test` 有锁）：少了哪条，
  // 那条动作就永远不会被自主抽到，等于白做。
  { id: "小动作", weight: 20, actions: ["stretch", "yawn", "groom", "tilt", "shiver", "nod", "coverFace"] },
  { id: "玩耍", weight: 20, actions: ["clap", "hop", "wave", "point", "shake"] },
  // 「吃什么」在参考里是 12 段吃喝动作；我们只有 sip 一条，单动作分类会让
  // 「不重复上一动作」失效（唯一的候选被剔掉后整类消失）。补一条 wave 的同价动作
  // 不成立——所以把 span 扩到两类合并：吃/喝 + 时节的礼仪动作共用同一段「吃与礼」，
  // 但保持四段权重不变。
  { id: "吃什么", weight: 16, actions: ["sip", "curtsy"] },
  { id: "时节", weight: 14, actions: ["bow", "turnAway"] },
  { id: "文字", weight: 10, actions: ["typeCode", "peek"] },
];

/**
 * 按分类权重抽一条动作：先抽类（权重 20/20/16/14/10），再在类内等权抽一条。
 * `previous` 会在**全池**层面被剔掉（跨类也不重复上一动作），与 `pickRoll` 同口径。
 */
export function pickCategorizedGesture(
  categoryRandom: number,
  actionRandom: number,
  previous?: string | null,
): string {
  // 剔除上一动作；**只有剔完还剩东西才剔**——否则该分类会整类消失，
  // 类权重之和变化会让其余四类的相对概率被悄悄放大（上一版就这么歪的）。
  // 单动作分类（目前没有，但别再退回两条）剔完为空时保留原动作，
  // 「不重复」是尽力而为：全池只剩一种动作时重复是唯一合法结果。
  const pool = GESTURE_CATEGORIES.map((c) => {
    const kept = previous ? c.actions.filter((a) => a !== previous) : [...c.actions];
    return { ...c, actions: kept.length > 0 ? kept : [...c.actions] };
  });

  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  if (!(total > 0)) throw new Error("pickCategorizedGesture：分类池为空");
  let at = clamp(categoryRandom, 0, 0.999999) * total;
  for (const c of pool) {
    if (at < c.weight) {
      const idx = Math.floor(clamp(actionRandom, 0, 0.999999) * c.actions.length);
      return c.actions[Math.min(idx, c.actions.length - 1)];
    }
    at -= c.weight;
  }
  const last = pool[pool.length - 1];
  return last.actions[Math.min(Math.floor(clamp(actionRandom, 0, 0.999999) * last.actions.length), last.actions.length - 1)];
}

export interface RollResult {
  bucket: RollBucket;
  /** 抽到的手势 id（只有 bucket === "gesture" 或 "peek" 时非空）。 */
  gesture: string | null;
}

export interface RollOptions {
  previousGesture?: string | null;
  hour?: number;
  energy?: number;
  /** 测试可注入固定池；生产由 `gestureIds()` 现算（CLIPS 补条自动长）。 */
  pool?: readonly string[];
}

/**
 * 两次抽取：先按四档权重抽桶，再在 gesture 池里等权抽一条。
 *
 * 昼夜/精力系数照 `pickIdleActivity:169-177` 搬：move×0.45 夜、×0.5 力竭；gesture×0.8 夜。
 * 权重变化会移动**分数窗口**（总重变小→同一 random 落到更靠后的桶），所以
 * `bucketOf` 用绝对权重累加，不写死区间端点。
 */
export function pickRoll(bucketRandom: number, gestureRandom: number, options: RollOptions = {}): RollResult {
  const hour = options.hour ?? 14;
  const energy = options.energy ?? 0.8;
  const night = hour >= 22 || hour < 7;
  const exhausted = energy < 0.25;
  const weighted: Record<RollBucket, number> = {
    idle_micro: ROLL_WEIGHTS.idle_micro,
    peek: ROLL_WEIGHTS.peek,
    move: ROLL_WEIGHTS.move * (night ? 0.45 : 1) * (exhausted ? 0.5 : 1),
    gesture: ROLL_WEIGHTS.gesture * (night ? 0.8 : 1),
  };
  const total = weighted.idle_micro + weighted.peek + weighted.move + weighted.gesture;
  const at = clamp(bucketRandom, 0, 0.999999) * total;
  const bucket = bucketOf(at / total, options);
  if (bucket === "peek") return { bucket, gesture: "peek" };
  if (bucket !== "gesture") return { bucket, gesture: null };

  const prev = options.previousGesture ?? null;
  // 注入了 pool 就用平铺等权（测试要可复现）；生产走分类池 20/20/16/14/10。
  if (options.pool) {
    const candidates = options.pool.length > 1 && prev ? options.pool.filter((id) => id !== prev) : [...options.pool];
    if (candidates.length === 0) throw new Error("pickRoll：gesture 池为空（CLIPS 里一条 gesture 都没注册？）");
    const idx = Math.floor(clamp(gestureRandom, 0, 0.999999) * candidates.length);
    return { bucket, gesture: candidates[idx] };
  }
  return { bucket, gesture: pickCategorizedGesture(bucketRandom, gestureRandom, prev) };
}

/** 分数（0..1）落在哪一档；窗口端点按当前权重现算，不写死。 */
export function bucketOf(frac: number, options: Pick<RollOptions, "hour" | "energy"> = {}): RollBucket {
  const hour = options.hour ?? 14;
  const energy = options.energy ?? 0.8;
  const night = hour >= 22 || hour < 7;
  const exhausted = energy < 0.25;
  const w = {
    idle_micro: ROLL_WEIGHTS.idle_micro,
    peek: ROLL_WEIGHTS.peek,
    move: ROLL_WEIGHTS.move * (night ? 0.45 : 1) * (exhausted ? 0.5 : 1),
    gesture: ROLL_WEIGHTS.gesture * (night ? 0.8 : 1),
  };
  const total = w.idle_micro + w.peek + w.move + w.gesture;
  const at = clamp(frac, 0, 0.999999) * total;
  if (at < w.idle_micro) return "idle_micro";
  if (at < w.idle_micro + w.peek) return "peek";
  if (at < w.idle_micro + w.peek + w.move) return "move";
  return "gesture";
}


// ===========================================================================
// v1.5.0 P4 Task 22：触摸六类 + 2.5s 合并 + 点击反馈 5 变体
// ===========================================================================

export const TOUCH_KINDS = ["poke", "pet", "grab", "drop", "throw", "crash", "head", "feet"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
/** 同类触摸的合并窗：连点/连撞不灌队列（spec §5 :257）。 */
export const TOUCH_MERGE_MS = 2_500;
/**
 * 头/脚两区的合并窗短得多：2.5s 只能「弹同一句话两次」，650ms 才留得出
 * 连击的节奏（约 1–3 次/秒）。poke/pet 仍走 2.5s，免得连点变复读机。
 */
export const HEAD_MERGE_MS = 650;
/** 摸头连击的窗口：两次摸头间隔超过它，连击从头数。 */
export const PAT_COMBO_WINDOW_MS = 3_200;
/** 连击封顶：第 5 下之后不再升级，只维持最后一句。 */
export const PAT_COMBO_MAX = 5;
/** 睡梦中被碰醒的惊跳时长；渲染端的「！」与小跳共用这条秒表。 */
export const STARTLE_MS = 1_600;
/** 扑光标的冷却：扑一次就满足，不许跟着鼠标抽搐。 */
export const POUNCE_COOLDOWN_MS = 18_000;
/** 按住超它且没拖过 4px 阈值＝摩挲；以下是戳一下。 */
export const PET_HOLD_MS = 500;
export function clickKindFor(heldMs: number): "poke" | "pet" {
  return heldMs >= PET_HOLD_MS ? "pet" : "poke";
}

const SHY_LINES = ["呀——别看这边", "脸、脸红了啦"] as const;
const ANGRY_LINES = ["哼，别戳我", "转过去冷静一下"] as const;
const EXCITED_LINES = ["咯咯咯好痒", "再来再来！"] as const;
const GRAB_LINES = ["哇——放我下来", "脚、脚够不到地啦"] as const;
const DROP_LINES = ["稳稳落地", "谢、谢谢"] as const;
const THROW_LINES = ["呜哇——！"] as const;
const CRASH_LINES = ["痛…", "撞、撞到了"] as const;

/** spec §6 点击反馈 5 变体，行序即表序。只服务 poke。 */
export const POKE_VARIANTS: ReadonlyArray<{ gesture: string; lines: readonly string[] }> = [
  { gesture: "hop", lines: PET_LINES },
  { gesture: "coverFace", lines: SHY_LINES },
  { gesture: "turnAway", lines: ANGRY_LINES },
  { gesture: "shiver", lines: EXCITED_LINES },
  { gesture: "wave", lines: PLAY_LINES },
];

export class CompanionEngine {
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  private readonly onMove?: (position: Point) => void;
  private readonly onSettle?: (position: Point) => void;

  private vitals: CompanionVitals = { affinity: 0.5, fullness: 0.7, energy: 0.8 };
  /** 行为形态：cat 走 IDLE_ACTIVITIES 七行平表，girl 走四档加权（口径差⑭）。 */
  private form: PetForm = "cat";
  private ambientGesture: string | null = null;
  private gestureUntil = 0;
  private previousGesture: string | null = null;
  private lastTouchAt = new Map<TouchKind, number>();
  private pos: Point = { x: 0, y: 0 };
  private activity: CompanionActivity = "idle";
  private previousActivity: CompanionActivity | null = null;
  private facing: 1 | -1 = 1;
  private step = 0;
  private target: Point | null = null;
  private vx = 0;
  private vy = 0;
  private squashUntil = 0;
  private happyUntil = 0;
  private actionUntil = 0;
  private actionStartAt = 0;
  private actionDuration = 0;
  private idleUntil: number;
  private chatAt: number;
  private lastNow: number;
  private bubble: CompanionBubble | null = null;
  private quiet = false;
  private userActive = false;
  /** 手动塞进被窝（右键 toggle）的睡眠没有终点；自主小睡到 sleepUntil 自醒。 */
  private sleepManual = false;
  private sleepUntil = 0;
  /** 连点逗晕的终点；晕着的时候不再接新的晕，也不起步走开。 */
  private dizzyUntil = 0;
  private noticeCooldownUntil = 0;
  /** 最近一次「用户碰过她」的行为时钟；静息周期从这里数 40s。 */
  private lastUserAt = 0;
  /** 初见时刻（墙上时钟）：相识天数从这天算第 1 天。 */
  private metAt = 0;
  /** 上一次读到的档位：只用来判「升级了」，掉档不广播。 */
  private lastBondTier: BondState = bondTierOf(0.5);
  private bondUpUntil = 0;
  /** 晨间伸懒腰与深夜提醒各自的日历键（跨重启去重）。 */
  private morningKey = "";
  private lastNightKey = "";
  private lastNightNudgeAt = 0;
  /** 今天已经露过脸：同一天隐藏/显示不再重复「第 N 天」。 */
  private greetedKey = "";
  /** 摸头连击：窗口内累加，超窗归零；650ms 合并窗保证连击有节奏而不是连点。 */
  private headCombo = 0;
  private headComboAt = 0;
  private startleUntil = 0;
  private pounceCooldownUntil = 0;
  private pounces = 0;
  /** 她身上那一件（跟着羁绊存档走，关窗再开还在）。 */
  private accessory: AccessoryId = "none";
  /** 已经庆祝过的纪念日键（`day:7` …）：同一天跨重启不重演。 */
  private celebrated: string[] = [];
  /** 上一次真的见到她的墙上时刻；0 = 还没有记录（首次见面不算久别）。 */
  private lastSeenAt = 0;
  /** 彩带寿命与正在庆祝的天数。 */
  private milestoneUntil = 0;
  private milestoneDays = 0;
  /** 十枚成就共用的一组计数器；新玩具的计数当场落盘，旧计数器跟既有的存档时机走。 */
  private stats: PetStats = { ...EMPTY_STATS };
  private achievements: AchievementId[] = [];
  private achievementUntil = 0;
  private achievementId: AchievementId | null = null;
  /** 呼噜的终点：摸顺/抱抱/梳完时续上，渲染端只看剩余毫秒。 */
  private purrUntil = 0;
  private rainUntil = 0;
  private snowUntil = 0;
  /** 今日的签：抽到即落盘，同一天再打开还是这一张；drawn＝今天已经揭晓过（计数一次）。 */
  private fortune: { day: string; tier: number; line: string; drawn: boolean } | null = null;
  /** 今日小目标与当天笔数；跨天时把前一天收成一条日记。 */
  private quests: QuestState = createQuests();
  private questDay = "";
  private dayCounts = { pats: 0, plays: 0, feeds: 0, toys: 0 };
  private diary: DiaryEntry[] = [];
  /** 完成小目标的那句话排在当前气泡后面说：不许顶掉刚摸头/刚玩完的那句反应。 */
  private pendingLine: { text: string; priority: number; at: number } | null = null;
  /** 今天的心情；第一天还没「昨天」，固定精神满满，也还不参与节奏换算。 */
  private dailyMood: DailyMood = { day: "", id: "lively" };
  private moodRolled = false;
  private tricks: TrickState = createTricks();
  private treasures: TreasureState = createTreasures();
  private garden: GardenState = createGarden();
  private hides = 0;
  /** v1.18 自娱账本：五件的峰值/累计 + 玩过的件数。 */
  private solo: SoloLedger = { ...EMPTY_SOLO, seen: [] };
  /** 躲猫猫开局后等渲染端回报「逮到/溜走」；没有开局就不认账。 */
  private hideOpen = false;
  private hideStartedAt = 0;
  /** v1.19：最近一次开口的段（`日期:段`）与最近一场看过的天色（`日期:种类`）。 */
  private clockKey = "";
  private skyKey = "";
  private skies: SkyCounters = { ...EMPTY_SKIES };
  private festivalState: FestivalState = { ...EMPTY_FESTIVAL_STATE };
  /** 到点自己钻进被窝的那一觉：天亮要自己醒；手动哄睡不归这里管。 */
  private autoSleeping = false;
  /** 墙上时钟的「上一次有人陪」：夜里满 3 分钟没人理她才睡（行为时钟测不了这个）。 */
  private lastUserWall = 0;
  /** v1.20 野性账本：点数 + 三式次数，跨重启。 */
  private wild: WildState = emptyWild();
  /** 正在演的那一式；null＝没在撒野。赶路时靠它决定收尾记哪一笔。 */
  private wildAct: WildImpulse | null = null;
  /** 这一式的收场时限（赶路防挂死；扑击＝动作剩余）。 */
  private wildUntil = 0;
  /** 上一次撒野结束后的冷却；强制命令可以立刻再来一发，但仍会重设冷却。 */
  private wildCooldownUntil = 0;
  /** 「让她野一下」先跑起来再说的那句话：跑动时不开口（气泡会把迈步闸关掉）。 */
  private wildSay: string | null = null;
  /** 这一次迈步的速度：散步 55，冲刺 150，潜行 22。 */
  private roamSpeed = WALK_SPEED;

  constructor(options: CompanionOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.wallNow = options.wallNow ?? this.now;
    this.storage = options.storage ?? null;
    this.onMove = options.onMove;
    this.onSettle = options.onSettle;
    this.lastNow = this.now();
    this.lastUserAt = this.lastNow;
    this.lastUserWall = this.wallNow();
    this.idleUntil = this.lastNow + this.idleDelay();
    this.chatAt = this.lastNow + CHAT_MIN_MS + this.random() * CHAT_SPAN_MS;
    // 开机先看她自己的：头两分钟不撒野，免得一启动就绕着桌面跑。
    this.wildCooldownUntil = this.lastNow + 120_000;
    this.load();
    this.loadBond();
    // 读档后的亲密度就是「当前档」：不把旧存档误报成刚升级。
    this.lastBondTier = bondTierOf(this.vitals.affinity);
    // 跨天收笔：昨天的小目标与日记在这里结清，今天从零开始。
    this.ensureDay(this.wallNow());
  }

  // —— 查询面 ——

  /** 形态切换。切回猫时把猫娘侧的抽取残留清干净，否则切回来的瞬间会「自己演一遍」。 */
  setForm(form: PetForm): void {
    if (form === this.form) return;
    this.form = form;
    this.ambientGesture = null;
    this.gestureUntil = 0;
    this.previousGesture = null;
    this.lastTouchAt.clear();
    // 晕与「注意到你」都是她这一形的事：切走再切回来不该接着上一轮的秒表。
    this.dizzyUntil = 0;
    this.noticeCooldownUntil = 0;
    this.headCombo = 0;
    this.headComboAt = 0;
    this.startleUntil = 0;
    this.pounceCooldownUntil = 0;
    this.bondUpUntil = 0;
    this.purrUntil = 0;
    this.rainUntil = 0;
    this.snowUntil = 0;
    this.pendingLine = null;
    this.hideOpen = false;
    this.abortWild();
  }

  /**
   * 触摸六类（spec §5）。同类 2.5s 内合并；**猫形恒 false**（口径差⑮：反应只长在猫娘上，
   * 四足的单击仍走 main.ts → handleCommand("pet") 那条老路，一支签都不多吃）。
   */
  touch(kind: TouchKind, now = this.now()): boolean {
    if (this.form !== "girl") return false;
    // 碰一下就算「有人陪着」：即使这一下被合并窗吞掉，也不该马上坐下来歇。
    this.lastUserAt = now;
    // 睡着时被碰：先受惊醒来，这一下算「叫醒」而不是摸头/挠脚。
    if (this.activity === "sleep" && (kind === "head" || kind === "feet" || kind === "poke")) {
      this.lastTouchAt.set(kind, now);
      this.wakeStartle(now);
      return true;
    }
    const mergeMs = kind === "head" || kind === "feet" ? HEAD_MERGE_MS : TOUCH_MERGE_MS;
    const last = this.lastTouchAt.get(kind);
    if (last !== undefined && now - last < mergeMs) return false;
    this.lastTouchAt.set(kind, now);
    switch (kind) {
      case "poke": {
        const v = POKE_VARIANTS[Math.min(4, Math.floor(this.random() * 5))];
        this.ambientGesture = v.gesture;
        this.gestureUntil = now + gestureClip(v.gesture).ms;
        this.say(this.pickLine([...v.lines]), 1, now, true);
        return true;
      }
      case "pet":
        this.pet(now);
        return true;
      case "head":
        this.patHead(now);
        return true;
      case "feet": {
        // 挠脚：怕痒、不掉精力（她没跑，只是缩了一下）。
        this.rewardAffinity(0.03, now);
        this.happyUntil = now + 2_500;
        this.ambientGesture = "shiver";
        this.gestureUntil = now + gestureClip("shiver").ms;
        this.idleUntil = now + IDLE_MIN_MS;
        this.say(this.pickLine([...GIRL_FEET_LINES]), 1, now, true);
        return true;
      }
      case "grab":
        return this.say(this.pickLine([...GRAB_LINES]), 1, now);
      case "drop":
        return this.say(this.pickLine([...DROP_LINES]), 1, now);
      case "throw":
        return this.say(this.pickLine([...THROW_LINES]), 1, now);
      case "crash":
        return this.say(this.pickLine([...CRASH_LINES]), 1, now);
    }
  }

  /**
   * 连点逗晕。计时与阈值在 `girl-zones.ts`（纯计数器）；这里只负责「晕了之后」：
   * 停下脚步、演一段捂脸、说一句晕话，并给渲染端一个剩余时长。
   * 四足恒 false —— 四足的连点仍按合并窗吞掉（口径差⑮）。
   */
  dizzy(now = this.now()): boolean {
    if (this.form !== "girl") return false;
    if (now < this.dizzyUntil) return false;
    this.lastUserAt = now;
    this.dizzyUntil = now + DIZZY_MS;
    this.target = null;
    this.vx = 0;
    this.vy = 0;
    this.actionDuration = 0;
    this.happyUntil = 0;
    this.headCombo = 0;
    this.headComboAt = 0;
    this.startleUntil = 0;
    if (this.activity !== "drag" && this.activity !== "thrown") this.activity = "idle";
    this.ambientGesture = "coverFace";
    this.gestureUntil = now + gestureClip("coverFace").ms;
    this.idleUntil = now + DIZZY_MS;
    this.wakeFromSleep();
    this.say(this.pickLine([...GIRL_DIZZY_LINES]), 2, now);
    return true;
  }

  /**
   * 「注意到你回来了」。presence 认到「光标从远处进入近圈」时调用；
   * 优先级 0：不抢任何工作播报，只在没话的时候轻轻接一句。
   * 安静/睡着时闭嘴——免打扰期间她只挂月牙（native #67 同一条规矩）。
   */
  notice(now = this.now()): boolean {
    if (this.form !== "girl") return false;
    if (this.quiet || this.activity === "sleep") return false;
    if (now < this.noticeCooldownUntil) return false;
    if (!this.say(this.pickLine([...GIRL_NOTICE_LINES]), 0, now)) return false;
    this.noticeCooldownUntil = now + NOTICE_COOLDOWN_MS;
    this.happyUntil = Math.max(this.happyUntil, now + 1_800);
    return true;
  }

  /**
   * 一次摸头（已被合并窗放行）：连击在 3.2s 窗口内递增，第 4/5 下换手势，
   * 封顶那下多给一点亲密度。第一下必须与旧口径逐字节一致：coverFace + 0.04。
   */
  private patHead(now: number): void {
    const continued = this.headCombo > 0 && now - this.headComboAt <= PAT_COMBO_WINDOW_MS;
    this.headCombo = continued ? Math.min(PAT_COMBO_MAX, this.headCombo + 1) : 1;
    this.headComboAt = now;
    this.stats.pats += 1;
    this.dayCounts.pats += 1;
    // 摸顺了才呼噜：第一下只是「诶？」，第二下起才是真的被摸舒服了。
    if (this.headCombo >= 2) this.startPurr(now);
    this.rewardAffinity(0.04 + (this.headCombo >= PAT_COMBO_MAX ? 0.02 : 0), now);
    this.happyUntil = now + 3_000 + (this.headCombo - 1) * 250;
    const gesture = this.headCombo >= 4 ? "hop" : this.headCombo >= 3 ? "shiver" : "coverFace";
    this.ambientGesture = gesture;
    this.gestureUntil = now + gestureClip(gesture).ms;
    this.startAction("pet", now, 1_000);
    this.idleUntil = now + IDLE_MIN_MS;
    const comboLine = this.headCombo >= 2
      ? GIRL_PAT_COMBO_LINES[Math.min(GIRL_PAT_COMBO_LINES.length - 1, this.headCombo - 2)]
      : null;
    this.say(comboLine ?? this.pickLine([...GIRL_HEAD_LINES]), 1, now, true);
    this.noteQuest("pat", now);
  }

  /** 睡着被碰：立刻醒、缩一下、说一句被吓到的话；这一拍不走摸头/挠脚的反馈。 */
  private wakeStartle(now: number): void {
    const hour = new Date(this.wallNow()).getHours();
    const night = hour >= 22 || hour < 5;
    this.activity = "idle";
    this.target = null;
    this.vx = 0;
    this.vy = 0;
    this.actionDuration = 0;
    this.wakeFromSleep();
    this.startleUntil = now + STARTLE_MS;
    this.ambientGesture = "shiver";
    this.gestureUntil = now + gestureClip("shiver").ms;
    this.idleUntil = now + IDLE_MIN_MS;
    this.lastUserAt = now;
    this.say(this.pickLine([...(night ? GIRL_WAKE_NIGHT_LINES : GIRL_WAKE_LINES)]), 2, now, true);
  }

  /**
   * 深夜提醒：由渲染端每 30s 问一次，引擎自己按「同一晚 45 分钟」去重。
   * 不挂在 stepIdle 上——否则会变成一个额外随机源，把既有行为的抽签全挪位。
   */
  nightNudge(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    const wall = this.wallNow();
    const hour = new Date(wall).getHours();
    if (!(hour >= 23 || hour < 5)) return false;
    const key = nightKey(wall);
    if (this.lastNightKey === key && now - this.lastNightNudgeAt < 45 * 60_000) return false;
    if (!this.say(this.pickLine([...GIRL_NIGHT_LINES]), 0, now)) return false;
    this.lastNightKey = key;
    this.lastNightNudgeAt = now;
    this.saveBond();
    this.ambientGesture = "yawn";
    this.gestureUntil = now + gestureClip("yawn").ms;
    return true;
  }

  // —— v1.19 她的一天 ——

  /**
   * 渲染端每 30s 问一次。三件事按顺序：节日 → 作息 → 换段。
   * 节日排在换段前面：节日那天的第一句话该是节日那句，换段句让位（但段照样记账，
   * 否则下一个 30s 会把节日句顶掉）。四足形态整段不接。
   */
  /**
   * 开机第一拍只记账不出声：启动问候已经在说人话，换段台词留给真正的换段。
   * 安静期不记（醒来第一拍照补当前段）。
   */
  primeClock(): void {
    if (this.form !== "girl" || this.quiet) return;
    this.clockKey = phaseKey(this.wallNow());
    this.saveBond();
  }

  clockTick(now = this.now()): boolean {
    if (this.form !== "girl") return false;
    // 与 update 同口径：过期的气泡先收掉，快照里不该还挂着上一句。
    if (this.bubble && now >= this.bubble.expiresAt) this.bubble = null;
    const wall = this.wallNow();
    const festival = this.festivalTick(now, wall);
    this.rhythmTick(now, wall);
    const phase = this.phaseTick(now, wall);
    return festival || phase;
  }

  /** 节日当天第一次问：记事、挂饰（快照里按日期现算）、说一句。安静期留到醒来。 */
  private festivalTick(now: number, wall: number): boolean {
    if (this.quiet) return false;
    const def = festivalOn(wall);
    if (!def) return false;
    const key = festivalKey(def, wall);
    if (this.festivalState.last === key) return false;
    this.festivalState = { last: key, count: this.festivalState.count + 1 };
    this.saveBond();
    this.refreshAchievements(now);
    return this.say(def.line, 2, now, true);
  }

  /**
   * 23:30 后你满 3 分钟没理她，她自己钻进被窝；05:00 天亮自己伸个懒腰醒来。
   * 看着（user_active）、安静期、被拖/被投掷时都不睡；手动哄睡的不归这里叫醒。
   */
  private rhythmTick(now: number, wall: number): void {
    if (this.activity === "drag" || this.activity === "thrown") return;
    const minute = minuteOfDay(wall);
    if (this.autoSleeping) {
      if (autoWakeAt(minute)) {
        this.target = null;
        this.vx = 0;
        this.vy = 0;
        this.startAction("stretch", now, ACTION_MS.stretch);
        this.idleUntil = now + IDLE_MIN_MS;
      }
      return;
    }
    if (this.activity === "sleep" || this.quiet || this.userActive) return;
    if (!autoSleepAt(minute)) return;
    if (wall - this.lastUserWall < AUTO_SLEEP_IDLE_MS) return;
    this.activity = "sleep";
    this.autoSleeping = true;
    this.sleepManual = false;
    this.sleepUntil = 0;
    this.target = null;
    this.vx = 0;
    this.vy = 0;
    this.actionDuration = 0;
    this.ambientGesture = null;
    this.gestureUntil = 0;
    this.idleUntil = now + IDLE_MIN_MS;
  }

  /**
   * 换段开口：同一段一天只说一次（键里带日期），安静期与睡着不记账。
   * 记账与「真说出口」分开：被节日/徽章那句占着槽时算说过，
   * 否则 30s 后那句迟到的话会把刚说的节日句顶掉。
   */
  private phaseTick(now: number, wall: number): boolean {
    if (this.quiet || this.activity === "sleep") return false;
    const key = phaseKey(wall);
    if (this.clockKey === key) return false;
    this.clockKey = key;
    this.saveBond();
    return this.say(phaseLine(clockAt(wall).phase), 0, now);
  }

  /**
   * 一起看天色：点脑袋时顶上来的那一手。同一场只看一次（按日期+天色记账），
   * 睡着/安静/被拖时不接。看完 `sky.watched` 变 true，渲染端把记号收掉。
   */
  watchSky(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    const wall = this.wallNow();
    const kind = clockAt(wall).sky;
    if (!kind) return false;
    const key = watchedKey(wall, kind);
    if (this.skyKey === key) return false;
    this.lastUserAt = now;
    this.skyKey = key;
    this.skies = { ...this.skies, [kind]: this.skies[kind] + 1 };
    this.saveBond();
    const said = this.say(skyLine(kind), 1, now, true);
    this.refreshAchievements(now, !said);
    return said;
  }

  /** 报时三行：此刻 / 下一个节日 / 还有几天。 */
  clockReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    const wall = this.wallNow();
    const next = nextFestival(wall);
    this.lastUserAt = now;
    return this.say(`${clockLine(wall)}\n下一个 ${next.def.label}\n还有 ${next.days} 天`, 2, now, true);
  }

  /** 节日两行/三行：当天报自己，平常日子报倒计时。 */
  festivalReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    const wall = this.wallNow();
    const today = festivalOn(wall);
    const next = nextFestival(wall);
    this.lastUserAt = now;
    const text = today
      ? `今天是 ${today.label}\n${today.line}`
      : `今天不是节日\n下一个 ${next.def.label}\n还有 ${next.days} 天`;
    return this.say(text, 2, now, true);
  }

  // —— v1.20 野性觉醒 ——

  /**
   * 「让她野一下」：挑她当前最拿手的一式，立刻开演（跑动时不开口）。
   * `bounds` 是**可走的 x 区间**（猫身左缘的界），调用方有工作区就该递进来：
   * 不递时 wildAim 只管 ±420，贴着右边下令会瞄到界外、被夹成零距离——
   * 起跑即「到达」，没有位移还照样记账（2026-10-29 真窗踩过）。
   */
  wildNow(now = this.now(), target?: Point, bounds?: { minX: number; maxX: number }): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (this.wildAct !== null || this.activity === "walk") return false;
    if (now < this.dizzyUntil) return false;
    const level = wildLevelFor(this.wild.points);
    const impulse = bestWildImpulse(level);
    const line = wildActLine(impulse, this.random());
    return this.startWild(impulse, now, true, bounds, target, line);
  }

  /** 「野性到哪了」：三行账；只念，不动身体、不替她重来一发。 */
  wildReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    this.abortWild();
    this.lastUserAt = now;
    return this.say(buildWildReport(this.wild).join("\n"), 2, now, true);
  }

  /** 收下她玩成的这一式：记账、存盘、判阶；升阶那句排在当前气泡后面说。 */
  private noteWild(event: WildImpulse, now: number): void {
    const before = wildLevelFor(this.wild.points);
    this.wild = recordWild(this.wild, event, new Date(this.wallNow()).getHours());
    const after = wildLevelFor(this.wild.points);
    this.saveBond();
    this.refreshAchievements(now);
    if (after.id === before.id) return;
    const line = wildLevelUpLine(after.id, this.random());
    if (!line) return;
    this.pendingLine = { text: line, priority: 1, at: now };
    this.flushPending(now);
  }

  /**
   * 起一式。冲刺/潜行先赶路（到达才记账），扑击在原地演完再记账；
   * 被摸、被拖、开口说话都会经 `abortWild` 取消——没收尾的那一下不算玩成。
   */
  private startWild(
    impulse: WildImpulse,
    now: number,
    forced: boolean,
    bounds?: { minX: number; maxX: number },
    target?: Point,
    queuedLine?: string,
  ): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (this.wildAct !== null || this.activity === "walk") return false;
    if (now < this.dizzyUntil) return false;
    if (this.vitals.energy < 0.3) return false;
    const level = wildLevelFor(this.wild.points);
    if (!wildUnlocks(level.id)[impulse]) return false;
    if (!forced && now < this.wildCooldownUntil) return false;
    this.lastUserAt = now;
    this.wildCooldownUntil = now + wildCooldownFor(level);
    this.wildSay = queuedLine ?? null;
    if (impulse === "hunt") {
      this.startHunt(now);
      return true;
    }
    const aim = this.wildAim(impulse, bounds, target);
    this.target = aim;
    this.facing = aim.x >= this.pos.x ? 1 : -1;
    this.activity = "walk";
    this.actionDuration = 0;
    this.actionUntil = 0;
    this.wildAct = impulse;
    this.wildUntil = now + WILD_MOVE_MS;
    this.roamSpeed = impulse === "zoom" ? WILD_ZOOM_SPEED : WILD_STALK_SPEED;
    this.idleUntil = now + this.idleDelay();
    return true;
  }

  private startHunt(now: number): void {
    this.target = null;
    this.roamSpeed = WALK_SPEED;
    this.wildAct = "hunt";
    this.wildUntil = now + WILD_HUNT_MS;
    this.ambientGesture = null;
    this.gestureUntil = 0;
    this.startAction("play", now, WILD_HUNT_MS);
  }

  private wildAim(
    impulse: WildImpulse,
    bounds?: { minX: number; maxX: number },
    target?: Point,
  ): Point {
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) return { ...target };
    const minX = bounds?.minX ?? this.pos.x - 420;
    const maxX = bounds?.maxX ?? this.pos.x + 420;
    const left = Math.max(0, this.pos.x - minX);
    const right = Math.max(0, maxX - this.pos.x);
    const dir = right >= left ? 1 : -1;
    const room = Math.max(left, right);
    const want = impulse === "zoom" ? 160 + this.random() * 120 : 60 + this.random() * 50;
    const distance = Math.max(20, Math.min(want, room));
    return { x: this.pos.x + dir * distance, y: this.pos.y };
  }

  /** 撤掉野性标记但不记账：被打断、被叫停、跑丢的那一轮都不算玩成。 */
  private abortWild(): void {
    if (this.wildAct === null) return;
    this.wildAct = null;
    this.wildUntil = 0;
    this.wildSay = null;
    this.roamSpeed = WALK_SPEED;
  }

  private finishWild(impulse: WildImpulse, now: number, chain = true): void {
    const level = wildLevelFor(this.wild.points);
    this.wildAct = null;
    this.wildUntil = 0;
    this.roamSpeed = WALK_SPEED;
    this.target = null;
    this.idleUntil = now + this.idleDelay();
    const line = this.wildSay;
    this.wildSay = null;
    if (line && !this.quiet) this.say(line, 1, now, true);
    this.noteWild(impulse, now);
    // 潜行贴到跟前，猎手以上顺势补一扑；这一扑不另吃冷却。
    if (impulse === "stalk" && chain && wildUnlocks(level.id).hunt) this.startHunt(now);
  }

  private wildSnapshot(): WildSnapshot {
    const level = wildLevelFor(this.wild.points);
    const now = this.now();
    return {
      points: this.wild.points,
      level: level.id,
      label: level.label,
      act: this.wildAct,
      left: this.wildAct !== null ? Math.max(0, this.wildUntil - now) : 0,
      cooldownLeft: Math.max(0, this.wildCooldownUntil - now),
      zooms: this.wild.zooms,
      stalks: this.wild.stalks,
      hunts: this.wild.hunts,
      next: nextWildAt(this.wild.points),
      unlocked: wildUnlocks(level.id),
    };
  }

  private clockSnapshot(wall: number): ClockSnapshot {
    const reading = clockAt(wall);
    const def = festivalOn(wall);
    return {
      phase: reading.phase,
      // 睡着时天上还有月亮，但她闭着眼：记号不该亮着（醒了再点同样的机制）。
      sky: reading.sky && this.activity !== "sleep"
        ? { kind: reading.sky, watched: this.skyKey === watchedKey(wall, reading.sky) }
        : null,
      skies: { ...this.skies },
      festival: def ? { id: def.id, label: def.label, ornament: def.ornament } : null,
      festivals: this.festivalState.count,
      autoSleep: this.autoSleeping,
    };
  }

  /**
   * 朝光标扑一下：只挪 9–26px（读起来是「扑」不是「瞬移」），朝向立刻对着光标，
   * 落地压扁 + hop 片 + 一句得意的话。冷却 18s，安静/睡着/被拖/被投掷时整段不接。
   * `bounds` 由渲染端给（窗口原点的可去范围），测试可省。
   */
  pounce(aimX: number, now = this.now(), bounds?: { minX: number; maxX: number }): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity !== "idle" && this.activity !== "rest") return false;
    if (now < this.dizzyUntil || now < this.pounceCooldownUntil) return false;
    const dx = aimX - this.pos.x;
    if (!Number.isFinite(dx) || Math.abs(dx) < 6) return false;
    const dir = dx >= 0 ? 1 : -1;
    const step = Math.min(26, Math.max(9, Math.abs(dx) * 0.18));
    let nextX = this.pos.x + dir * step;
    if (bounds) nextX = clamp(nextX, bounds.minX, bounds.maxX);
    if (Math.abs(nextX - this.pos.x) < 1) return false;
    this.pos = { x: Math.round(nextX), y: this.pos.y };
    this.facing = dir;
    this.activity = "idle";
    this.target = null;
    this.actionDuration = 0;
    this.squashUntil = now + 220;
    this.happyUntil = now + 2_400;
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.idleUntil = now + 3_000;
    this.lastUserAt = now;
    this.pounceCooldownUntil = now + POUNCE_COOLDOWN_MS;
    this.pounces += 1;
    this.stats.pounces += 1;
    this.onMove?.({ ...this.pos });
    this.settle(now);
    this.say(this.pickLine([...GIRL_POUNCE_LINES]), 1, now, true);
    this.refreshAchievements(now);
    // 亲手扑中一次也算一笔野性：她把光标当猎物，账本不分成「谁先动的」。
    this.noteWild("hunt", now);
    return true;
  }

  /**
   * 毛线球被踢：`auto` 是她自己扒拉球（不出声、不涨好感），
   * 手动踢才换成 hop + 一句「球给我」并微弱涨亲密度。
   */
  toyBat(now = this.now(), auto = false): boolean {
    if (this.form !== "girl") return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (now < this.dizzyUntil) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.idleUntil = now + IDLE_MIN_MS;
    const gesture = auto ? "peek" : "hop";
    this.ambientGesture = gesture;
    this.gestureUntil = now + gestureClip(gesture).ms;
    if (auto) return true;
    this.lastUserAt = now;
    this.rewardAffinity(0.01, now);
    this.startAction("play", now, 900);
    this.say(this.pickLine([...GIRL_TOY_LINES]), 1, now, true);
    return true;
  }

  getVitals(): CompanionVitals {
    return { ...this.vitals };
  }

  /**
   * 换一件装扮：坏值一律回「不戴」，同一件再点一次不说话。
   * 返回 false 只代表「状态没变」，不是失败。
   */
  setAccessory(id: AccessoryId | string, now = this.now()): boolean {
    if (this.form !== "girl") return false;
    const next = normalizeAccessory(id);
    if (next === this.accessory) return false;
    this.accessory = next;
    this.lastUserAt = now;
    this.happyUntil = Math.max(this.happyUntil, now + 1_800);
    this.idleUntil = now + IDLE_MIN_MS;
    this.saveBond();
    this.say(this.pickLine(GIRL_ACCESSORY_LINES[next]), 1, now, true);
    return true;
  }

  /**
   * 捉住伴飞的小虫：涨一点亲密度、开心一下、说一句。
   * 睡着时不接——叫醒她的方式只有摸/戳，虫子不能替用户动手。
   */
  catchCritter(now = this.now()): boolean {
    if (this.form !== "girl") return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    this.lastUserAt = now;
    this.stats.catches += 1;
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine([...GIRL_CRITTER_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 逗猫棒一局收尾：捉中算一次、涨一点亲密度；空挥也有一句自嘲。 */
  wandEnd(now = this.now(), caught = true): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (now < this.dizzyUntil) return false;
    this.lastUserAt = now;
    this.idleUntil = now + IDLE_MIN_MS;
    if (!caught) {
      this.say(this.pickLine([...GIRL_WAND_MISS_LINES]), 1, now, true);
      return false;
    }
    this.stats.wand += 1;
    this.rewardAffinity(0.015, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.startAction("play", now, 900);
    this.say(this.pickLine([...GIRL_WAND_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 戳破一个泡泡：每四下说一句，其余只开心一小会儿，免得一句话刷屏。 */
  bubblePop(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    this.lastUserAt = now;
    this.stats.bubbles += 1;
    this.happyUntil = Math.max(this.happyUntil, now + 1_000);
    this.rewardAffinity(0.004, now);
    if (this.stats.bubbles % 4 === 1) this.say(this.pickLine([...GIRL_BUBBLE_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  /** 撒落叶：纯演出 + 一点点亲密度，不产生可拾取物。 */
  leafToss(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (now < this.dizzyUntil) return false;
    this.lastUserAt = now;
    this.happyUntil = Math.max(this.happyUntil, now + 2_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.startAction("play", now, 1_200);
    this.idleUntil = now + IDLE_MIN_MS;
    this.rewardAffinity(0.006, now);
    this.say(this.pickLine([...GIRL_LEAF_LINES]), 1, now, true);
    return true;
  }

  /** 「跟我来」：她答应一声，把方向交给渲染端的 follow 模块。 */
  followStart(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    this.lastUserAt = now;
    this.happyUntil = Math.max(this.happyUntil, now + 1_600);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.idleUntil = now + 2_000;
    this.say(this.pickLine([...GIRL_FOLLOW_LINES]), 1, now, true);
    return true;
  }

  /** 跟到位/跟丢：各自一句，不涨亲密度（这是陪伴不是奖励）。 */
  followStop(now = this.now(), arrived = true): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    this.idleUntil = now + IDLE_MIN_MS;
    return this.say(this.pickLine([...(arrived ? GIRL_FOLLOW_ARRIVE_LINES : GIRL_FOLLOW_LOST_LINES)]), 1, now, true);
  }

  /** 猜拳：她按 `random` 选一手，赢了涨一点、平局一点点、输了只不服气。 */
  rpsPlay(player: RpsSign, now = this.now()): { player: RpsSign; her: RpsSign; outcome: RpsOutcome } | null {
    if (this.form !== "girl" || this.quiet) return null;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return null;
    if (now < this.dizzyUntil) return null;
    const her = RPS_SIGNS[Math.floor(this.random() * RPS_SIGNS.length) % RPS_SIGNS.length];
    const outcome = judgeRps(player, her);
    this.lastUserAt = now;
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = outcome === "lose" ? "turnAway" : "hop";
    this.gestureUntil = now + gestureClip(outcome === "lose" ? "turnAway" : "hop").ms;
    this.idleUntil = now + IDLE_MIN_MS;
    if (outcome === "win") this.rewardAffinity(0.012, now);
    else if (outcome === "draw") this.rewardAffinity(0.005, now);
    this.say(this.pickLine([...GIRL_RPS_LINES[outcome]]), 1, now, true);
    return { player, her, outcome };
  }

  /** 六件新玩具共用的开工闸门：认得人、没被安静、没在睡/被拖/被扔、不在晕。 */
  private toyReady(now: number): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    if (now < this.dizzyUntil) return false;
    this.lastUserAt = now;
    this.idleUntil = now + IDLE_MIN_MS;
    return true;
  }

  /** 纸箱：她先看一眼再钻进去；敲箱子另有一句。 */
  boxStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_200);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_BOX_START_LINES]), 1, now, true);
    return true;
  }

  boxKnock(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    return this.say(this.pickLine([...GIRL_BOX_KNOCK_LINES]), 1, now, true);
  }

  /** 从纸箱里探出头被点到：计数、涨亲密度、蹦一下。 */
  boxCatch(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.boxes += 1;
    this.saveBond();
    this.rewardAffinity(0.012, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_BOX_CATCH_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  laserStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.startAction("play", now, 1_000);
    this.say(this.pickLine([...GIRL_LASER_START_LINES]), 1, now, true);
    return true;
  }

  /** 扑中红点；空手一局在收尾时用 `caught=false` 自嘲一句。 */
  laserEnd(now = this.now(), caught = true): boolean {
    if (!this.toyReady(now)) return false;
    if (!caught) {
      this.say(this.pickLine([...GIRL_LASER_MISS_LINES]), 1, now, true);
      return false;
    }
    this.stats.lasers += 1;
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_LASER_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  brushStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "tilt";
    this.gestureUntil = now + gestureClip("tilt").ms;
    this.say(this.pickLine([...GIRL_BRUSH_START_LINES]), 1, now, true);
    return true;
  }

  /** 梳到一半点她一下：多梳一道、涨一点点；不刷屏说话（梳子每 1.25s 本来就有一道）。 */
  brushBoost(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 900);
    this.rewardAffinity(0.004, now);
    return true;
  }

  /** 一轮梳完才算一次；中途走开不计数也不说话。 */
  brushEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (!completed) return false;
    this.stats.brushes += 1;
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.startPurr(now);
    this.say(this.pickLine([...GIRL_BRUSH_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  catnipStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_CATNIP_START_LINES]), 1, now, true);
    return true;
  }

  /** 戳一下薄荷叶：再吸一口，不计数（整轮结束才记一次）。 */
  catnipPuff(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 1_000);
    this.rewardAffinity(0.003, now);
    return true;
  }

  catnipEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (!completed) return false;
    this.stats.catnips += 1;
    this.saveBond();
    this.rewardAffinity(0.018, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.say(this.pickLine([...GIRL_CATNIP_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  planeStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_200);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_PLANE_START_LINES]), 1, now, true);
    return true;
  }

  planeEnd(now = this.now(), caught = true): boolean {
    if (!this.toyReady(now)) return false;
    if (!caught) {
      this.say(this.pickLine([...GIRL_PLANE_MISS_LINES]), 1, now, true);
      return false;
    }
    this.stats.planes += 1;
    this.saveBond();
    this.rewardAffinity(0.016, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_PLANE_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 小鸟落在窗框上：她自己那句不涨数值，纯陪伴。 */
  birdVisit(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "drag" || this.activity === "thrown") return false;
    this.lastUserAt = now;
    return this.say(this.pickLine([...GIRL_BIRD_LINES]), 1, now, true);
  }

  birdFlee(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    return this.say(this.pickLine([...GIRL_BIRD_AWAY_LINES]), 1, now, true);
  }

  /** 猫抓板：一整轮磨爪；点板面由渲染端转成 boost，不另计数。 */
  scratchStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_SCRATCH_START_LINES]), 1, now, true);
    return true;
  }

  scratchBoost(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 900);
    this.rewardAffinity(0.004, now);
    return true;
  }

  scratchEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet || !completed) return false;
    this.stats.scratches += 1;
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.say(this.pickLine([...GIRL_SCRATCH_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  bellStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_BELL_START_LINES]), 1, now, true);
    return true;
  }

  /** 摇响一次：每声都计数（一轮上限在渲染端的铃铛模块里），只在第 1/3 声说话。 */
  bellRing(now = this.now(), rings = 1): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.bells += 1;
    this.saveBond();
    this.happyUntil = Math.max(this.happyUntil, now + 1_000);
    this.rewardAffinity(0.004, now);
    if (rings === 1 || rings === 3) this.say(this.pickLine([...GIRL_BELL_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  /** 一轮结束：摇过至少一声才算「玩过」，顺手记进今日目标。 */
  bellEnd(now = this.now(), rings = 0): boolean {
    if (this.form !== "girl" || this.quiet || rings <= 0) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 1_200);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  mouseStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_MOUSE_START_LINES]), 1, now, true);
    return true;
  }

  mouseCatch(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.mice += 1;
    this.saveBond();
    this.rewardAffinity(0.018, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_MOUSE_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 发条老鼠自己跑完了还没抓住：一句自嘲，不计数。 */
  mouseMiss(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    if (this.activity === "sleep" || this.activity === "drag" || this.activity === "thrown") return false;
    this.lastUserAt = now;
    return this.say(this.pickLine([...GIRL_MOUSE_MISS_LINES]), 1, now, true);
  }

  moleStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_MOLE_START_LINES]), 1, now, true);
    return true;
  }

  /** 拍中一只：每只都计数，隔一只说一声「啪」；整轮结束再记陪玩。 */
  moleWhack(now = this.now(), hits = 1): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.moles += 1;
    this.saveBond();
    this.rewardAffinity(0.006, now);
    this.happyUntil = Math.max(this.happyUntil, now + 1_200);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    if (hits % 2 === 1) this.say(this.pickLine([...GIRL_MOLE_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  moleEnd(now = this.now(), hits = 0): boolean {
    if (this.form !== "girl" || this.quiet || hits <= 0) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 1_400);
    this.say(this.pickLine([...GIRL_MOLE_END_LINES]), 1, now, true);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  hugStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.hugs += 1;
    this.saveBond();
    this.startPurr(now);
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "clap";
    this.gestureUntil = now + gestureClip("clap").ms;
    this.say(this.pickLine([...GIRL_HUG_START_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  /** 再抱紧一点：涨一点亲密度、把呼噜续上；点得越多胸口的心越多（渲染端）。 */
  hugTap(now = this.now(), taps = 1): boolean {
    if (!this.toyReady(now)) return false;
    this.rewardAffinity(0.008, now);
    this.happyUntil = Math.max(this.happyUntil, now + 1_400);
    this.startPurr(now);
    if (taps === 1 || taps === 3) this.say(this.pickLine([...GIRL_HUG_LINES]), 1, now, true);
    return true;
  }

  rainStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.stats.rains += 1;
    this.rainUntil = now + RAIN_MS;
    // 天气互斥：下雨就把雪收了，两套粒子不同时铺在 82px 窗里。
    this.snowUntil = 0;
    this.saveBond();
    this.happyUntil = Math.max(this.happyUntil, now + 4_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_RAIN_START_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  /** 追尾巴：她绕着自己转，点三次尾巴会晕；整轮走完才记一次。 */
  tailStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_TAIL_START_LINES]), 1, now, true);
    return true;
  }

  tailDizzy(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 1_400);
    this.ambientGesture = "coverFace";
    this.gestureUntil = now + gestureClip("coverFace").ms;
    return this.say(this.pickLine([...GIRL_TAIL_DIZZY_LINES]), 1, now, true);
  }

  tailEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet || !completed) return false;
    this.stats.tails += 1;
    this.saveBond();
    this.rewardAffinity(0.016, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.say(this.pickLine([...GIRL_TAIL_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 踩奶：在坐垫上一下一下踩，踩完呼噜会响起来。 */
  kneadStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_KNEAD_START_LINES]), 1, now, true);
    return true;
  }

  kneadEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet || !completed) return false;
    this.stats.kneads += 1;
    this.saveBond();
    this.rewardAffinity(0.018, now);
    this.startPurr(now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.say(this.pickLine([...GIRL_KNEAD_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 翻跟头：一段有起跳、有滞空的翻滚；翻满三圈才算一轮。 */
  rollStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_ROLL_START_LINES]), 1, now, true);
    return true;
  }

  rollEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet || !completed) return false;
    this.stats.rolls += 1;
    this.saveBond();
    this.rewardAffinity(0.016, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.say(this.pickLine([...GIRL_ROLL_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 看书：翻完三页合上书才算读完；点书页只翻页，不重复计数。 */
  bookStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_BOOK_START_LINES]), 1, now, true);
    return true;
  }

  bookEnd(now = this.now(), completed = true): boolean {
    if (this.form !== "girl" || this.quiet || !completed) return false;
    this.stats.books += 1;
    this.saveBond();
    this.rewardAffinity(0.014, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.say(this.pickLine([...GIRL_BOOK_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 礼物盒：先晃晃听听，再拆开；拆开的那一刻才记账。 */
  giftStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_GIFT_START_LINES]), 1, now, true);
    return true;
  }

  giftOpen(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.stats.gifts += 1;
    this.saveBond();
    this.rewardAffinity(0.022, now);
    this.happyUntil = Math.max(this.happyUntil, now + 3_000);
    this.ambientGesture = "clap";
    this.gestureUntil = now + gestureClip("clap").ms;
    this.say(this.pickLine([...GIRL_GIFT_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 许愿星：只许一个愿（一颗星一次机会）；计数进愿望，不进今日陪玩。 */
  wishStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_WISH_START_LINES]), 1, now, true);
    return true;
  }

  wishMake(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.stats.wishes += 1;
    this.saveBond();
    this.rewardAffinity(0.012, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.say(this.pickLine([...GIRL_WISH_LINES]), 1, now, true);
    this.refreshAchievements(now);
    return true;
  }

  /** 跳格子：踩错顺序会重来，踩满三格才算跳完。 */
  hopscotchStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.say(this.pickLine([...GIRL_HOP_START_LINES]), 1, now, true);
    return true;
  }

  hopscotchMiss(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.happyUntil = Math.max(this.happyUntil, now + 1_200);
    return this.say(this.pickLine([...GIRL_HOP_MISS_LINES]), 1, now, true);
  }

  hopscotchDone(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.stats.hopscotch += 1;
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "clap";
    this.gestureUntil = now + gestureClip("clap").ms;
    this.say(this.pickLine([...GIRL_HOP_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 下雪：与雨互斥；雪堆由渲染端点，堆成雪人再回来记账。 */
  snowStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.rainUntil = 0;
    this.snowUntil = now + SNOW_MS;
    this.happyUntil = Math.max(this.happyUntil, now + 4_000);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_SNOW_START_LINES]), 1, now, true);
    return true;
  }

  snowmanMade(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.stats.snowmen += 1;
    this.saveBond();
    this.rewardAffinity(0.024, now);
    this.happyUntil = Math.max(this.happyUntil, now + 3_200);
    this.ambientGesture = "clap";
    this.gestureUntil = now + gestureClip("clap").ms;
    this.say(this.pickLine([...GIRL_SNOWMAN_LINES]), 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /**
   * 每日抽签：同一天只抽一张，抽到的档位当场落盘；再打开看到的是同一张。
   * 返回今天那张签，渲染端把它交给签纸去揭。
   */
  fortuneStart(now = this.now()): { tier: number; line: string } | null {
    if (!this.toyReady(now)) return null;
    this.ensureDay(this.wallNow());
    if (!this.fortune || this.fortune.day !== this.questDay) {
      const tier = fortuneTierAt(this.random());
      this.fortune = { day: this.questDay, tier, line: FORTUNE_TIERS[tier].line, drawn: false };
      this.saveBond();
    }
    const today = this.fortune;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(this.pickLine([...GIRL_FORTUNE_START_LINES]), 1, now, true);
    return { tier: today.tier, line: today.line };
  }

  /** 揭晓今天的签：一天只记一次；渲染端传错档位不认账。 */
  fortuneReveal(tier: number, now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    const today = this.fortune;
    if (!today || today.day !== this.questDay || today.drawn) return false;
    if (tier !== today.tier) return false;
    today.drawn = true;
    this.stats.fortunes += 1;
    this.saveBond();
    this.rewardAffinity(0.012, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.say(today.line, 1, now, true);
    this.refreshAchievements(now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return true;
  }

  /** 今日小目标：四行账（汇总 + 三件小事）。 */
  questsReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.ensureDay(this.wallNow());
    this.lastUserAt = now;
    return this.say(questReport(this.quests).join("\n"), 2, now, true);
  }

  /** 猫咪日记：标题 + 今天 + 最近两条旧账。 */
  diaryReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.ensureDay(this.wallNow());
    this.lastUserAt = now;
    const today: DiaryEntry = { day: this.questDay, text: composeDiaryLine(this.dayCounts) };
    return this.say(buildDiaryReport(this.diary, today).join("\n"), 2, now, true);
  }

  // —— v1.17 日常系统 ——

  moodReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.ensureDay(this.wallNow());
    this.lastUserAt = now;
    return this.say(
      `今天的心情 · ${MOOD_LABELS[this.dailyMood.id]}\n${moodLine(this.dailyMood.id)}`,
      2, now, true,
    );
  }

  favoriteReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    const fav = favoriteToy(this.stats);
    if (!fav) return this.say(`${favoriteReportLine(null)}\n多陪我玩几次就知道了`, 2, now, true);
    return this.say(`${favoriteReportLine(fav)}\n${favoriteRequestLine(fav, this.random())}`, 2, now, true);
  }

  trickTeach(id: TrickId, now = this.now()): TeachResult | null {
    if (!this.toyReady(now)) return null;
    const result = teachTrick(this.tricks, id);
    this.saveBond();
    const spec = trickSpec(id);
    if (result.already) {
      this.say(`${spec.label} 早就学会啦`, 1, now, true);
      return result;
    }
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = spec.gesture;
    this.gestureUntil = now + gestureClip(spec.gesture).ms;
    if (result.learned) {
      this.rewardAffinity(0.02, now);
      this.dayCounts.toys += 1;
      this.noteQuest("play", now);
      this.say(spec.line, 1, now, true);
    } else {
      this.say(`${spec.label} · 还差 ${spec.need - result.count} 次`, 1, now, true);
    }
    return result;
  }

  trickReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    return this.say(buildTrickReport(this.tricks).join("\n"), 2, now, true);
  }

  sniffTreasure(now = this.now()): TreasureFind | null {
    if (!this.toyReady(now)) return null;
    const find = findTreasure(this.treasures, this.random());
    this.saveBond();
    this.happyUntil = Math.max(this.happyUntil, now + 2_200);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say(`捡到${find.label}，先收好`, 1, now, true);
    this.rewardAffinity(0.008, now);
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    return find;
  }

  treasureReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    const total = treasureTotal(this.treasures);
    if (total <= 0) return this.say("小口袋 还没捡到过什么\n带我到处转转吧", 2, now, true);
    const lines = [`小口袋 ${total} 件`];
    const found = TREASURES.filter((item) => this.treasures.counts[item.id] > 0);
    for (const item of found.slice(0, 3)) lines.push(`${item.label} ×${this.treasures.counts[item.id]}`);
    if (found.length > 3) lines.push(`…还有 ${found.length - 3} 种`);
    return this.say(lines.join("\n"), 2, now, true);
  }

  hideStart(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    this.hideOpen = true;
    this.hideStartedAt = now;
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "coverFace";
    this.gestureUntil = now + gestureClip("coverFace").ms;
    this.say("你来找我呀，数到三就探头", 1, now, true);
    return true;
  }

  /** 渲染端在探头窗口里点中/窗口走完各回报一次；没有开局或超时都不认账。 */
  hideResult(found: boolean, now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) {
      this.hideOpen = false;
      return false;
    }
    if (!this.hideOpen) return false;
    if (now - this.hideStartedAt > HIDE_COVER_MS + HIDE_PEEK_MS + 500) {
      this.hideOpen = false;
      return false;
    }
    this.hideOpen = false;
    if (!found) {
      this.say("没找到我，我在这里呢", 1, now, true);
      return true;
    }
    this.hides += 1;
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    this.say("被找到啦！", 1, now, true);
    return true;
  }

  gardenPlant(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    if (!plantGarden(this.garden, this.wallNow())) {
      this.say("盆里还种着东西呢", 1, now, true);
      return false;
    }
    this.saveBond();
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    this.ambientGesture = "peek";
    this.gestureUntil = now + gestureClip("peek").ms;
    this.say("种下啦，等它发芽", 1, now, true);
    return true;
  }

  gardenHarvest(now = this.now()): boolean {
    if (!this.toyReady(now)) return false;
    if (!harvestGarden(this.garden, this.wallNow())) {
      this.say("还没长好，再等等", 1, now, true);
      return false;
    }
    this.saveBond();
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_800);
    this.ambientGesture = "hop";
    this.gestureUntil = now + gestureClip("hop").ms;
    this.dayCounts.toys += 1;
    this.noteQuest("play", now);
    this.say("薄荷收好啦，香香的", 1, now, true);
    return true;
  }

  gardenReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.ensureDay(this.wallNow());
    this.lastUserAt = now;
    return this.say(buildGardenReport(this.garden, this.wallNow()).join("\n"), 2, now, true);
  }

  /**
   * v1.18 自娱：开场只登记「这件玩过」并摆出那件玩具的起手姿势，分数留给渲染端
   * 在玩具真演完时回报。四足/安静/睡着都不接——她不会自己玩这些。
   */
  soloStart(kind: SoloKind, now = this.now()): boolean {
    if (!isSoloKind(kind) || !this.toyReady(now)) return false;
    soloMarkSeen(this.solo, kind);
    this.saveBond();
    this.happyUntil = Math.max(this.happyUntil, now + 2_400);
    const gesture = SOLO_GESTURES[kind];
    this.ambientGesture = gesture;
    this.gestureUntil = now + gestureClip(gesture).ms;
    // 开场句挤不进气泡只是少一句话，玩具该演还是得演（与 boxStart/hideStart 同口径）：
    // 渲染端认这个返回值决定挂不挂玩具，返回 say 的成败会留下「姿态已摆、玩具却没出现」的半截态。
    this.say(soloStartLine(kind), 1, now, true);
    return true;
  }

  /** 演一段报一次数：best 型抬峰值、total 型累加；不认识的档一律 null。 */
  soloScore(kind: SoloKind, value: number, now = this.now()): number | null {
    if (!isSoloKind(kind) || !this.toyReady(now)) return null;
    const next = scoreSolo(this.solo, kind, value);
    this.saveBond();
    this.refreshAchievements(now);
    return next;
  }

  /** 点灯时顺手赶走一只飞蛾：只进 `moths`，不进战果、不进成就，也不另起一句话。 */
  soloScare(now = this.now()): number | null {
    if (!this.toyReady(now)) return null;
    const total = scareSolo(this.solo);
    this.saveBond();
    return total;
  }

  /**
   * 一轮玩完的收账。空手回来（`result <= 0`）只补一句、不改口粮：不涨亲密度、
   * 不记今日陪玩、更不算「自娱一次」，否则成就门槛会被一轮失败喂出来。
   */
  soloDone(kind: SoloKind, result: number, now = this.now()): boolean {
    if (!isSoloKind(kind) || !this.toyReady(now)) return false;
    soloMarkSeen(this.solo, kind);
    const scored = Number.isFinite(result) && result > 0;
    let value = 0;
    if (scored) {
      value = scoreSolo(this.solo, kind, result);
      this.stats.selfPlay += 1;
      this.rewardAffinity(0.012, now);
      // 先滚一天再记今日陪玩：noteQuest 跨天时会把 dayCounts 清零，反过来写就把刚记的那次冲掉。
      this.noteQuest("play", now);
      this.dayCounts.toys += 1;
      this.happyUntil = Math.max(this.happyUntil, now + 2_600);
    }
    this.saveBond();
    this.refreshAchievements(now);
    this.say(soloEndLine(kind, value), 1, now, true);
    return scored;
  }

  /** 「她自娱到哪了」：只读账本，三行封顶（气泡内宽 78px）。 */
  selfPlayReportNow(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    this.lastUserAt = now;
    return this.say(buildSoloReport(this.solo).join("\n"), 2, now, true);
  }

  /**
   * 成长记录：不说数值细节，只说「认识多久、什么档、拿了几枚」。
   * 三行——气泡内宽只有 78px（v1.8 尺 #62），徽章与互动数各占一行，不折行。
   */
  growthReport(now = this.now()): boolean {
    if (this.form !== "girl" || this.quiet) return false;
    const tier = bondTierOf(this.vitals.affinity);
    const days = daysTogether(this.metAt, this.wallNow());
    const total = Object.values(this.stats).reduce((sum, n) => sum + n, 0);
    this.lastUserAt = now;
    return this.say(`${tier.name} · 第 ${days} 天\n徽章 ${this.achievements.length}/${ACHIEVEMENT_IDS.length}\n互动 ${total} 次`, 2, now, true);
  }

  getSnapshot(): CompanionSnapshot {
    return {
      activity: this.activity,
      mood: this.mood(),
      facing: this.facing,
      pos: { ...this.pos },
      vitals: { ...this.vitals },
      moving: this.activity === "walk" || this.activity === "thrown",
      step: this.step,
      squash: this.squashUntil > 0 ? clamp01(1 - (this.now() - (this.squashUntil - 220)) / 220) : 0,
      activityProgress: this.actionDuration > 0
        ? clamp01((this.lastNow - this.actionStartAt) / this.actionDuration)
        : 0,
      vx: this.vx,
      vy: this.vy,
      bubble: this.bubble ? { ...this.bubble } : null,
      gesture: this.ambientGesture && this.gestureUntil > this.now() ? this.ambientGesture : null,
      dizzyLeft: Math.max(0, this.dizzyUntil - this.now()),
      bond: bondTierOf(this.vitals.affinity),
      days: daysTogether(this.metAt, this.wallNow()),
      bondUpLeft: Math.max(0, this.bondUpUntil - this.now()),
      patCombo: this.headCombo > 0 && this.now() - this.headComboAt <= PAT_COMBO_WINDOW_MS ? this.headCombo : 0,
      patComboLeft: this.headCombo > 0
        ? Math.max(0, this.headComboAt + PAT_COMBO_WINDOW_MS - this.now())
        : 0,
      startleLeft: Math.max(0, this.startleUntil - this.now()),
      pounces: this.pounces,
      accessory: this.accessory,
      milestoneLeft: this.milestoneUntil > this.now() ? this.milestoneUntil - this.now() : 0,
      milestoneDays: this.milestoneUntil > this.now() ? this.milestoneDays : 0,
      achievements: [...this.achievements],
      achievementLeft: Math.max(0, this.achievementUntil - this.now()),
      achievementId: this.achievementUntil > this.now() ? this.achievementId : null,
      stats: { ...this.stats },
      purrLeft: Math.max(0, this.purrUntil - this.now()),
      rainLeft: Math.max(0, this.rainUntil - this.now()),
      snowLeft: Math.max(0, this.snowUntil - this.now()),
      quests: { counts: { ...this.quests.counts } },
      diary: this.diary.map((entry) => ({ ...entry })),
      moodId: this.dailyMood.id,
      favorite: favoriteToy(this.stats),
      tricks: { counts: { ...this.tricks.counts } },
      treasures: { counts: { ...this.treasures.counts } },
      garden: { ...this.garden },
      gardenAge: this.garden.plantedAt >= 0 ? Math.max(0, this.wallNow() - this.garden.plantedAt) : -1,
      gardenStage: gardenStage(this.garden, this.wallNow()),
      hides: this.hides,
      solo: { ...this.solo, seen: [...this.solo.seen] },
      clock: this.form === "girl" ? this.clockSnapshot(this.wallNow()) : null,
      wild: this.form === "girl" ? this.wildSnapshot() : null,
    };
  }

  setVitals(vitals: Partial<CompanionVitals>): void {
    this.vitals = {
      affinity: clamp01(vitals.affinity ?? this.vitals.affinity),
      fullness: clamp01(vitals.fullness ?? this.vitals.fullness),
      energy: clamp01(vitals.energy ?? this.vitals.energy),
    };
  }

  setPosition(position: Point): void {
    this.pos = { x: position.x, y: position.y };
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    if (quiet) this.abortWild();
  }

  /** user_active 的另一个消费面：看着它的时候不主动走开（已经起步的那趟不打断）。 */
  setUserActive(active: boolean): void {
    // 只在真的翻转时重记墙钟：渲染端可能每帧都推同一个值，重复推送不能把
    // 「三分钟没人理」的秒表一直清零。
    if (this.userActive === active) return;
    this.userActive = active;
    this.lastUserWall = this.wallNow();
  }

  // —— 自主行为 ——

  /** 起步漫游；目标会在 update 里按当前 workArea 夹取。 */
  roamTo(target: Point, now = this.now()): void {
    this.lastUserAt = now;
    this.abortWild();
    this.roamSpeed = WALK_SPEED;
    this.target = { x: target.x, y: target.y };
    this.activity = "walk";
    this.actionUntil = 0;
    this.actionDuration = 0;
    this.vx = 0;
    this.vy = 0;
    this.wakeFromSleep();
    this.lastNow = now;
  }

  /** 开工/被摸/被抱走都算醒了：清掉小睡计时、手动睡眠与「自己睡」的标记。 */
  private wakeFromSleep(): void {
    this.sleepManual = false;
    this.sleepUntil = 0;
    this.autoSleeping = false;
  }

  update(now: number, context: CompanionContext): CompanionSnapshot {
    const dt = clamp((now - this.lastNow) / 1000, 0, 1);
    this.lastNow = now;

    this.ensureDay(this.wallNow());
    this.tickVitals(dt);
    // 野性赶路超时（窗口被占、目标被夹回原地）：撤标记、不记账，别挂着不撒手。
    if (this.wildAct !== null && this.wildAct !== "hunt" && now >= this.wildUntil) {
      this.target = null;
      this.activity = "idle";
      this.abortWild();
      this.idleUntil = now + this.idleDelay();
    }
    if (this.bubble && now >= this.bubble.expiresAt) this.bubble = null;
    this.flushPending(now);

    switch (this.activity) {
      case "sleep":
        // 自主小睡到点自醒；手动 toggle 的睡眠一直睡到用户再点一次；
        // 自己睡下的那一觉没有终点，等 05:00 的 clockTick 叫醒（不是这里）。
        if (!this.sleepManual && !this.autoSleeping && now >= this.sleepUntil) {
          this.activity = "idle";
          this.wakeFromSleep();
          this.idleUntil = now + this.idleDelay();
          break;
        }
        this.idleUntil = now + IDLE_MIN_MS;
        break;
      case "drag":
        break;
      case "thrown":
        this.stepThrow(dt, now, context);
        break;
      case "walk":
        this.stepWalk(dt, now, context);
        break;
      case "groom":
      case "yawn":
      case "stretch":
      case "tilt":
      case "pet":
      case "eat":
      case "play":
      case "rest":
        if (now >= this.actionUntil) this.finishAction(now);
        break;
      case "idle":
        this.stepIdle(now, context);
        break;
    }

    return this.getSnapshot();
  }

  // —— 互动 ——

  pet(now = this.now()): void {
    this.lastUserAt = now;
    this.rewardAffinity(0.04, now);
    this.happyUntil = now + 3_500;
    this.startAction("pet", now, 900);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(this.lines(PET_LINES, GIRL_PET_LINES)), 1, now, true);
  }

  feed(now = this.now()): void {
    this.lastUserAt = now;
    this.setVitals({
      fullness: this.vitals.fullness + 0.3,
      energy: this.vitals.energy + 0.05,
    });
    this.rewardAffinity(0.02, now);
    this.happyUntil = now + 2_500;
    this.startAction("eat", now, 1_600);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(this.lines(FEED_LINES, GIRL_FEED_LINES)), 1, now, true);
    if (this.form === "girl") {
      this.dayCounts.feeds += 1;
      this.noteQuest("feed", now);
    }
  }

  play(now = this.now()): void {
    this.lastUserAt = now;
    this.setVitals({
      energy: this.vitals.energy - 0.14,
      fullness: this.vitals.fullness - 0.05,
    });
    this.rewardAffinity(0.05, now);
    this.happyUntil = now + 4_000;
    this.startAction("play", now, 2_000);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(this.lines(PLAY_LINES, GIRL_PLAY_LINES)), 1, now, true);
    if (this.form === "girl") {
      this.dayCounts.plays += 1;
      this.noteQuest("play", now);
    }
  }

  toggleSleep(now = this.now()): void {
    this.lastUserAt = now;
    this.actionDuration = 0;
    this.headCombo = 0;
    this.headComboAt = 0;
    this.startleUntil = 0;
    if (this.activity === "sleep") {
      this.activity = "idle";
      this.wakeFromSleep();
      this.idleUntil = now + 2_500;
      return;
    }
    this.activity = "sleep";
    this.sleepManual = true;
    this.sleepUntil = 0;
    this.target = null;
    this.vx = 0;
    this.vy = 0;
  }

  /** 露个脸：按时段说一句。安静期由 say() 拒绝，返回 false。 */
  greet(now = this.now()): boolean {
    this.lastUserAt = now;
    const wall = this.wallNow();
    const part = dayPartOf(new Date(wall).getHours());
    if (this.form !== "girl") {
      this.lastSeenAt = wall;
      this.saveBond();
      return this.say(GREETING_LINES[part], 1, now);
    }
    const days = daysTogether(this.metAt, wall);
    // 重逢判定必须在写回 lastSeenAt 之前读：先写就成了「刚见过」。
    const reunion = this.lastSeenAt > 0 && wall - this.lastSeenAt >= REUNION_GAP_MS;
    this.lastSeenAt = wall;
    const todayKey = dateKey(wall);
    const firstToday = this.greetedKey !== todayKey;
    // 每天第一次见面：先伸个懒腰再开口（同一天重启不再演）。
    this.maybeMorningStretch(now, wall);
    const milestone = this.takeMilestone(days, now);
    let text: string;
    if (milestone) {
      text = milestoneLine(days);
    } else if (reunion) {
      text = this.pickLine([...GIRL_REUNION_LINES]);
    } else if (firstToday && days >= 2 && milestoneFor(days) === null) {
      // 问候句自己按标点断行、第 N 天再独占一行：78px 内宽装不下 9 个全角字，
      // 交给贪心折行会把「一起」劈成「一 / 起」。只在**当天第一次露脸**说一次；
      // 纪念日当天这句让给庆典，不再补「第 N 天」。
      text = `${GIRL_GREETINGS[part]}\n第 ${days} 天`;
    } else {
      text = GIRL_GREETINGS[part];
    }
    // 只有真说出口才算「今天露过脸」：被更高优先级的卡片顶掉时，
    // 「第 N 天」这句要留到下一次露脸补上，不能被一次沉默吃掉。
    const said = this.say(text, milestone ? 2 : 1, now, milestone);
    if (said) this.greetedKey = todayKey;
    // 问候优先：纪念日/重逢/第 N 天已经占着气泡，成就只弹徽章别抢句。
    this.refreshAchievements(now, !said);
    this.saveBond();
    return said;
  }

  /**
   * 纪念日：只在 7/30/100/365 天、且这一天还没庆祝过时点火。
   * 安静期不点火也不记账——醒来后还能补上。
   */
  private takeMilestone(days: number, now: number): boolean {
    const day = milestoneFor(days);
    if (day === null || this.quiet) return false;
    const key = milestoneKey(day);
    if (this.celebrated.includes(key)) return false;
    this.celebrated.push(key);
    this.milestoneUntil = now + MILESTONE_MS;
    this.milestoneDays = day;
    this.saveBond();
    return true;
  }

  /**
   * 数值类互动（摸摸/喂/玩/睡/状态）。手势命令（招手/鞠躬…）不进这里：
   * 它们只演一次、不改数值，由渲染端直接 `playGesture`。
   */
  handleCommand(
    command: "pet" | "feed" | "play" | "toggle-sleep" | "status",
    now = this.now(),
  ): void {
    this.lastUserAt = now;
    switch (command) {
      case "pet": this.pet(now); break;
      case "feed": this.feed(now); break;
      case "play": this.play(now); break;
      case "toggle-sleep": this.toggleSleep(now); break;
      case "status": {
        const v = this.vitals;
        const vitalLine = `亲密度 ${Math.round(v.affinity * 100)}% · 饱腹 ${Math.round(v.fullness * 100)}% · 精力 ${Math.round(v.energy * 100)}%`;
        if (this.form === "girl") {
          const bond = bondTierOf(v.affinity);
          const days = daysTogether(this.metAt, this.wallNow());
          // 四行小卡片：气泡内宽只有 78px，一整句真宽 160px+，硬挤会切字（v1.8 尺 #62）。
          const card = [
            `亲密度 ${Math.round(v.affinity * 100)}%`,
            `饱腹 ${Math.round(v.fullness * 100)}%`,
            `精力 ${Math.round(v.energy * 100)}%`,
            `${bond.name} · 第 ${days} 天`,
          ].join("\n");
          this.say(card, 2, now, true);
        } else {
          this.say(vitalLine, 2, now, true);
        }
        break;
      }
    }
  }

  beginDrag(now = this.now()): void {
    this.lastUserAt = now;
    this.activity = "drag";
    this.target = null;
    this.actionDuration = 0;
    this.vx = 0;
    this.vy = 0;
    this.wakeFromSleep();
    this.lastNow = now;
  }

  /** 松手：慢放=原地落定；快甩=进入投掷物理，最终由地面接住。 */
  endDrag(position: Point, velocity: Point, now = this.now()): void {
    this.pos = { x: position.x, y: position.y };
    this.actionDuration = 0;
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed >= THROW.throwThreshold) {
      this.activity = "thrown";
      this.vx = clamp(velocity.x, -THROW.maxSpeed, THROW.maxSpeed);
      this.vy = clamp(velocity.y, -THROW.maxSpeed, THROW.maxSpeed);
      this.idleUntil = now + IDLE_MIN_MS;
      return;
    }
    this.activity = "idle";
    this.vx = 0;
    this.vy = 0;
    this.idleUntil = now + IDLE_MIN_MS;
    this.settle(now);
  }

  // —— 气泡 ——

  /**
   * 单槽气泡。默认口径：同级不抢、低级不抢高级（闲话/播报/notice 共用一条槽）。
   * `replaceSame` 只给**用户刚做的事**用：点完头立刻点脚，第二句必须顶掉第一句，
   * 否则屏幕上还是上一句「摸头」，读起来像没反应。再高的优先级（≥3 的网络播报）
   * 依旧不可抢——把重要的信息换掉比少一句撒娇糟得多。
   */
  say(text: string, priority = 1, now = this.now(), replaceSame = false): boolean {
    if (this.quiet) return false;
    if (!text.trim()) return false;
    const cur = this.bubble;
    if (cur && now < cur.expiresAt) {
      if (cur.priority > priority) return false;
      if (!replaceSame && cur.priority === priority) return false;
    }
    this.bubble = { text, priority, expiresAt: now + BUBBLE_TTL_MS };
    return true;
  }

  dismissBubble(now = this.now()): void {
    void now;
    this.bubble = null;
  }

  // —— 落盘 ——

  load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(VITALS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { vitals?: Partial<CompanionVitals>; savedAt?: number };
      if (!parsed?.vitals) return;
      const savedAt = typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
        ? parsed.savedAt
        : this.wallNow();
      const stored = {
        affinity: clamp01(Number(parsed.vitals.affinity) || 0.5),
        fullness: clamp01(Number(parsed.vitals.fullness) || 0),
        energy: clamp01(Number(parsed.vitals.energy) || 0),
      };
      this.vitals = decayVitals(stored, this.wallNow() - savedAt);
    } catch {
      // 坏存档不阻塞启动：用默认值，下一次 save 覆盖。
    }
  }

  save(): void {
    // 关窗/落位都算「见过」：只靠 greet 写 lastSeenAt 会把整场陪跑的时长丢掉，
    // 下次开窗就误报成久别。
    this.lastSeenAt = this.wallNow();
    this.saveBond();
    if (!this.storage) return;
    try {
      this.storage.setItem(VITALS_KEY, JSON.stringify({ vitals: this.vitals, savedAt: this.wallNow() }));
    } catch {
      // 存储不可写（配额/隐私模式）：行为不受影响，只是下次从默认值起步。
    }
  }

  private loadBond(): void {
    this.metAt = this.wallNow();
    if (!this.storage) return;
    let found = false;
    try {
      const raw = this.storage.getItem(BOND_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          metAt?: number;
          morningKey?: string;
          nightKey?: string;
          accessory?: unknown;
          celebrated?: unknown;
          lastSeenAt?: unknown;
          greetedKey?: unknown;
          stats?: unknown;
          achievements?: unknown;
          questDay?: unknown;
          quests?: unknown;
          dayCounts?: unknown;
          diary?: unknown;
          fortune?: unknown;
          mood?: unknown;
          tricks?: unknown;
          treasures?: unknown;
          garden?: unknown;
          hides?: unknown;
          solo?: unknown;
          clockKey?: unknown;
          skyKey?: unknown;
          skies?: unknown;
          festival?: unknown;
          wild?: unknown;
        };
        found = true;
        if (typeof parsed?.metAt === "number" && Number.isFinite(parsed.metAt) && parsed.metAt > 0) {
          this.metAt = parsed.metAt;
        }
        if (typeof parsed.morningKey === "string") this.morningKey = parsed.morningKey;
        if (typeof parsed.nightKey === "string") this.lastNightKey = parsed.nightKey;
        this.accessory = normalizeAccessory(parsed.accessory);
        this.celebrated = parseCelebrated(parsed.celebrated);
        if (typeof parsed.lastSeenAt === "number" && Number.isFinite(parsed.lastSeenAt) && parsed.lastSeenAt > 0) {
          this.lastSeenAt = parsed.lastSeenAt;
        }
        if (typeof parsed.greetedKey === "string") this.greetedKey = parsed.greetedKey;
        this.stats = parseStats(parsed.stats);
        this.achievements = parseAchievements(parsed.achievements);
        if (typeof parsed.questDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.questDay)) {
          this.questDay = parsed.questDay;
        }
        this.quests = parseQuests(parsed.quests);
        this.diary = parseDiary(parsed.diary);
        const f = parsed.fortune as Record<string, unknown> | null | undefined;
        if (f && typeof f === "object"
          && typeof f.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.day)
          && typeof f.tier === "number" && Number.isInteger(f.tier) && f.tier >= 0 && f.tier < FORTUNE_TIERS.length
          && typeof f.line === "string"
          && typeof f.drawn === "boolean") {
          this.fortune = { day: f.day, tier: f.tier, line: f.line, drawn: f.drawn };
        }
        const mood = parseDailyMood(parsed.mood);
        if (mood) {
          this.dailyMood = mood;
          this.moodRolled = true;
        }
        this.tricks = parseTricks(parsed.tricks);
        this.treasures = parseTreasures(parsed.treasures);
        this.garden = parseGarden(parsed.garden);
        this.solo = parseSolo(parsed.solo);
        this.clockKey = normalizeClockKey(parsed.clockKey);
        this.skyKey = normalizeWatchedKey(parsed.skyKey);
        this.skies = parseSkies(parsed.skies);
        this.festivalState = parseFestivalState(parsed.festival);
        this.wild = sanitizeWild(parsed.wild);
        if (typeof parsed.hides === "number" && Number.isFinite(parsed.hides) && parsed.hides > 0) {
          this.hides = Math.min(1_000_000, Math.floor(parsed.hides));
        }
        if (parsed.dayCounts && typeof parsed.dayCounts === "object") {
          const raw = parsed.dayCounts as Record<string, unknown>;
          this.dayCounts = {
            pats: dayCount(raw.pats),
            plays: dayCount(raw.plays),
            feeds: dayCount(raw.feeds),
            toys: dayCount(raw.toys),
          };
        }
      }
    } catch {
      // 坏档不阻塞启动：初见时刻退回本次启动，下面立刻覆盖。
    }
    // 第一次见面就落盘：相识天数哪怕只开一次也不能从明天重新数。
    if (!found) this.saveBond();
  }

  private saveBond(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(BOND_KEY, JSON.stringify({
        metAt: this.metAt,
        morningKey: this.morningKey,
        nightKey: this.lastNightKey,
        accessory: this.accessory,
        celebrated: this.celebrated,
        lastSeenAt: this.lastSeenAt,
        greetedKey: this.greetedKey,
        stats: this.stats,
        achievements: this.achievements,
        questDay: this.questDay,
        quests: this.quests,
        dayCounts: this.dayCounts,
        diary: this.diary,
        fortune: this.fortune,
        mood: this.moodRolled ? this.dailyMood : null,
        tricks: this.tricks,
        treasures: this.treasures,
        garden: this.garden,
        hides: this.hides,
        solo: this.solo,
        clockKey: this.clockKey,
        skyKey: this.skyKey,
        skies: this.skies,
        festival: this.festivalState,
        wild: this.wild,
      }));
    } catch {
      // 同 save：写不进去只影响「第几天」，不影响本次行为。
    }
  }

  // —— 内部 ——

  private idleDelay(): number {
    return IDLE_MIN_MS + this.random() * IDLE_SPAN_MS;
  }

  private pickLine(lines: readonly string[]): string {
    return lines[Math.floor(this.random() * lines.length) % lines.length];
  }

  /** 同一件事，四足与猫娘两张词表；不在 `say` 层分支，免得每句都问一次形态。 */
  private lines(cat: readonly string[], girl: readonly string[]): readonly string[] {
    return this.form === "girl" ? girl : cat;
  }

  /**
   * 每天第一次见面演一段伸懒腰：只改动作、不碰气泡（问候词由 greet 自己说）。
   * 日历键落盘，跨重启同一天不重演。只在真正闲着时接管，拖拽/投掷/睡觉都不打断。
   */
  private maybeMorningStretch(now: number, wallMs: number): void {
    const hour = new Date(wallMs).getHours();
    if (hour < 5 || hour >= 11) return;
    const key = dateKey(wallMs);
    if (this.morningKey === key) return;
    this.morningKey = key;
    this.saveBond();
    if (this.activity === "idle" || this.activity === "rest") {
      this.ambientGesture = null;
      this.gestureUntil = 0;
      this.startAction("stretch", now, ACTION_MS.stretch);
    }
  }

  /**
   * 用户互动涨亲密度：先写数值再判档位。只有**这一个入口**会广播升级，
   * 外部 setVitals/读档不会把旧数值误报成「刚刚升级」。
   */
  private rewardAffinity(delta: number, now: number): void {
    this.setVitals({ affinity: this.vitals.affinity + delta * this.moodAffinityScale() });
    this.refreshBond(now);
    this.refreshAchievements(now);
  }

  /** 心情从第二天起参与换算；第一天保持旧口径，免得老秒表/老存档被悄悄改拍。 */
  private moodAffinityScale(): number {
    return this.moodRolled ? moodTuning(this.dailyMood.id).affinityScale : 1;
  }

  private restAfterMs(): number {
    return this.moodRolled ? moodTuning(this.dailyMood.id).restAfterMs : REST_AFTER_MS;
  }

  private chatScale(): number {
    return this.moodRolled ? moodTuning(this.dailyMood.id).chatScale : 1;
  }

  private achievementExtras(): AchievementExtras {
    const fav = favoriteToy(this.stats);
    // 只有一件够格的玩具时谈不上「本命」——至少要跟第二名比过一次。
    const contested = fav && favoriteRivals(this.stats) >= 2 ? fav.count : 0;
    return {
      tricks: tricksLearned(this.tricks),
      treasures: treasureTotal(this.treasures),
      hides: this.hides,
      harvests: this.garden.harvests,
      favorite: contested,
      ballBest: this.solo.ballBest,
      comboBest: this.solo.comboBest,
      flares: this.solo.flares,
      moths: this.solo.moths,
      fish: this.solo.fish,
      mirror: this.solo.mirror,
      selfPlay: this.stats.selfPlay,
      festivals: this.festivalState.count,
      sunrise: this.skies.sunrise,
      sunset: this.skies.sunset,
      moon: this.skies.moon,
      zooms: this.wild.zooms,
      stalks: this.wild.stalks,
      wildLevel: wildRank(this.wild.points),
    };
  }

  /** 呼噜：同一串互动只记一次；已经在呼噜就把终点往后推。 */
  private startPurr(now: number): void {
    if (now >= this.purrUntil) {
      this.stats.purrs += 1;
      this.saveBond();
    }
    this.purrUntil = Math.max(this.purrUntil, now + PURR_MS);
  }

  /** 记一笔今日小目标；刚好做完时发奖、说一句，全清时换一句更得意的。 */
  private noteQuest(id: QuestId, now: number): void {
    if (this.form !== "girl") return;
    this.ensureDay(this.wallNow());
    const done = bumpQuestCount(this.quests, id);
    this.saveBond();
    if (!done) return;
    this.stats.quests += 1;
    this.rewardAffinity(0.02, now);
    this.happyUntil = Math.max(this.happyUntil, now + 2_200);
    const allDone = questsAllDone(this.quests);
    // 第三件事和第 18 枚徽章同时发生：徽章那句已经在说「今天都做完啦」，不再重复。
    const badgeSaid = allDone && this.achievementId === "daily-perfect" && now < this.achievementUntil;
    if (badgeSaid) {
      this.pendingLine = null;
    } else {
      const lines = allDone ? GIRL_QUESTS_DONE_LINES : GIRL_QUEST_DONE_LINES[id];
      this.pendingLine = { text: this.pickLine([...lines]), priority: 1, at: now };
      this.flushPending(now);
    }
    this.saveBond();
  }

  /** 排队的句子只在当前气泡走完、且她醒着的时候说；最多等 PENDING_LINE_MS。 */
  private flushPending(now: number): void {
    const pending = this.pendingLine;
    if (!pending) return;
    if (now - pending.at > PENDING_LINE_MS) {
      this.pendingLine = null;
      return;
    }
    if (this.activity === "sleep") return;
    if (this.bubble && now < this.bubble.expiresAt) return;
    if (this.say(pending.text, pending.priority, now)) this.pendingLine = null;
  }

  /**
   * 跨天结账：把前一天的笔数收成一条日记，清空小目标与当天计数。
   * 没有笔数的日子不留空白条目——「安静地待着」也是一天，但不必天天写进七条里。
   */
  private ensureDay(wall: number): void {
    const key = dateKey(wall);
    if (!key || key === this.questDay) {
      // 旧存档没有心情这一项：当天先按「精神满满」走，明天再按今天的照顾量滚。
      if (this.dailyMood.day !== this.questDay) this.dailyMood = { day: this.questDay, id: "lively" };
      return;
    }
    const firstDay = this.questDay === "";
    const day = this.dayCounts;
    if (!firstDay && day.pats + day.plays + day.feeds + day.toys > 0) {
      this.diary = pushDiary(this.diary, { day: this.questDay, text: composeDiaryLine(day) });
    }
    this.questDay = key;
    this.quests = createQuests();
    this.dayCounts = { pats: 0, plays: 0, feeds: 0, toys: 0 };
    if (firstDay) {
      this.dailyMood = { day: key, id: "lively" };
    } else {
      this.dailyMood = { day: key, id: rollMood(day, this.random()) };
      this.moodRolled = true;
    }
    this.saveBond();
  }

  /**
   * 成就只在互动当时检查：条件全部来自既有计数器，不额外起定时器。
   * 一次弹一枚（多条件同时满足时余下的等下一次互动），安静期不弹也不记账。
   */
  private refreshAchievements(now: number, speak = true): void {
    if (this.form !== "girl" || this.quiet) return;
    const next = newlyUnlocked(
      this.stats,
      daysTogether(this.metAt, this.wallNow()),
      bondTierOf(this.vitals.affinity).id,
      this.achievements,
      this.achievementExtras(),
    );
    if (next.length === 0) return;
    const id = next[0];
    this.achievements.push(id);
    this.achievementId = id;
    this.achievementUntil = now + ACHIEVEMENT_MS;
    this.saveBond();
    // 升档的台词优先级更高：徽章照弹，句子让给「最喜欢你了」。
    if (speak && now >= this.bondUpUntil) {
      const def = achievementById(id);
      if (def) this.say(def.line, 2, now, true);
    }
  }

  private refreshBond(now: number): void {
    const next = bondTierOf(this.vitals.affinity);
    if (next.index <= this.lastBondTier.index) {
      this.lastBondTier = next;
      return;
    }
    this.lastBondTier = next;
    this.bondUpUntil = now + BOND_UP_MS;
    this.happyUntil = Math.max(this.happyUntil, now + 3_200);
    this.ambientGesture = "clap";
    this.gestureUntil = now + gestureClip("clap").ms;
    this.saveBond();
    this.say(this.pickLine([...GIRL_BOND_LINES[next.id]]), 2, now, true);
  }

  private mood(): Mood {
    if (this.activity === "sleep") return "sleep";
    if (this.happyUntil > this.now()) return "happy";
    if (this.vitals.fullness < 0.18 || this.vitals.energy < 0.12) return "grumpy";
    return "idle";
  }

  private tickVitals(dt: number): void {
    const hours = dt / 3600;
    if (this.activity === "sleep") {
      this.vitals = {
        ...this.vitals,
        energy: clamp01(this.vitals.energy + 0.35 * hours),
        fullness: clamp01(this.vitals.fullness - 0.02 * hours),
      };
      return;
    }
    this.vitals = {
      ...this.vitals,
      fullness: clamp01(this.vitals.fullness - 0.02 * hours),
      energy: clamp01(this.vitals.energy - 0.02 * hours),
    };
  }

  private stepIdle(now: number, context: CompanionContext): void {
    // 晕着的时候站原地晃：不聊天、不迈步，等星星转完。
    if (now < this.dizzyUntil) {
      this.idleUntil = Math.max(this.idleUntil, this.dizzyUntil);
      return;
    }
    // 光标就压在她窗子里＝人还在跟前：把「一个人待着」的秒表一直按在 0。
    // 不这样做，手一离开窗子她会立刻坐下，读起来像「等你好久了」的惊悚版。
    if (this.userActive) this.lastUserAt = now;
    // 静息周期排在「能不能动」的闸之前，而且**只**要求她自己闲着：
    // 贴边藏身（peek 中 canRoam 恒 false）与气泡开着恰恰是最常见的「人不在」现场，
    // 把坐下挂在这道闸后面，等于永远轮不到她歇。
    if (
      this.form === "girl"
      && this.activity === "idle"
      && now - this.lastUserAt >= this.restAfterMs()
    ) {
      this.startRest(now);
      return;
    }
    if (!context.canRoam) {
      // 被藏身/面板占着：把起步时间一路推后，解除后不许「攒满一发立刻走」。
      this.idleUntil = Math.max(this.idleUntil, now + 4_000);
      return;
    }
    if (this.bubble === null && !this.quiet && now >= this.chatAt) {
      const wall = this.wallNow();
      const fav = this.form === "girl" ? favoriteToy(this.stats) : null;
      const moody = this.form === "girl" && this.moodRolled && this.random() < 0.35;
      const chatter: readonly string[] = moody
        ? moodChatter(this.dailyMood.id)
        : fav && this.random() < 0.25
          ? [favoriteRequestLine(fav, this.random())]
          : this.form === "girl"
            ? chatterPoolFor(new Date(wall).getHours(), new Date(wall).getDay(), this.random())
            : CHATTER;
      this.say(this.pickLine(chatter), 1, now);
      this.chatAt = now + (CHAT_MIN_MS + this.random() * CHAT_SPAN_MS) * this.chatScale();
    }
    if (now < this.idleUntil) return;

    // 时钟域：now 是行为秒表（performance.now），拿它 new Date 会落到 1970 年；
    // 昼夜权重必须读墙上时钟。
    const hour = new Date(this.wallNow()).getHours();
    if (this.form === "girl") {
      this.stepIdleGirl(now, context, hour);
      return;
    }
    const activity = pickIdleActivity(this.random(), this.previousActivity, { hour, energy: this.vitals.energy });
    this.previousActivity = activity;
    switch (activity) {
      case "walk":
        if (this.userActive) {
          this.idleUntil = now + this.idleDelay();
          return;
        }
        this.startRoam(context, now);
        return;
      case "sleep":
        this.activity = "sleep";
        this.sleepManual = false;
        this.sleepUntil = now + NAP_MIN_MS + this.random() * NAP_SPAN_MS;
        return;
      case "groom":
      case "yawn":
      case "stretch":
      case "tilt":
        this.startAction(activity, now, ACTION_MS[activity]);
        return;
      default:
        this.idleUntil = now + this.idleDelay();
    }
  }

  /**
   * 猫娘的一签落地（四档 → 引擎口）：
   *   idle_micro → 什么都不做（待机微动由通道常数与 blinkAt 说话）；夜里力竭才转睡
   *   peek       → lasting 的 peek 手势，到期自清
   *   move       → startRoam（userActive 时不迈步，与四足同判据）
   *   gesture    → 抽到的那条片，演完让位（renderer 侧靠槽位时钟，引擎只管过期）
   */
  private stepIdleGirl(now: number, context: CompanionContext, hour: number): void {
    const night = hour >= 22 || hour < 7;
    // 野性冲动排在常规签前面：冷却好了、精力够、这一拍抽中，就先撒野；
    // 抽不中或抽到的这一式还没解锁，再回到老的四档。
    // 人就在跟前（userActive）或正张着嘴（气泡开着）时不撒野：冲刺会把她从
    // 刚开口的那句话里拽走，也和「你看着时她不乱走」的既有口径打架。
    const level = wildLevelFor(this.wild.points);
    if (this.wildAct === null
      && this.bubble === null
      && !this.userActive
      && now >= this.wildCooldownUntil
      && this.vitals.energy >= 0.3
      && this.random() < wildChanceFor(level)) {
      const impulse = pickWildImpulse(level, hour, this.random());
      if (this.startWild(impulse, now, false, this.roamBounds(context))) return;
    }
    const roll = pickRoll(this.random(), this.random(), {
      previousGesture: this.previousGesture,
      hour,
      energy: this.vitals.energy,
    });
    this.idleUntil = now + this.idleDelay();

    if (roll.bucket === "move") {
      if (this.userActive) return;
      this.startRoam(context, now);
      return;
    }
    if (roll.gesture) {
      this.previousGesture = roll.gesture;
      this.ambientGesture = roll.gesture;
      this.gestureUntil = now + gestureClip(roll.gesture).ms;
      return;
    }
    // idle_micro 不再一定「什么都不做」：偶尔抬眼看你一下、或轻轻歪个头，
    // 两段都短到不打断静坐，却能让待机不像一张会呼吸的贴图。
    if (roll.bucket === "idle_micro" && this.random() < MICRO_CHANCE) {
      const micro = microGestureAt(this.random());
      this.previousGesture = micro;
      this.ambientGesture = micro;
      this.gestureUntil = now + gestureClip(micro).ms;
      return;
    }
    // idle_micro：夜里力竭才睡，睡法与四足共用一条 NAP 口。
    if (night && this.vitals.energy < 0.5) {
      this.activity = "sleep";
      this.sleepManual = false;
      this.sleepUntil = now + NAP_MIN_MS + this.random() * NAP_SPAN_MS;
    }
  }

  /**
   * 自己坐下歇一会儿。起身由 `finishAction` 接一段伸懒腰，不用另开计时器；
   * 坐下即重置「有人陪」的秒表，歇完 40s 内不会再坐（否则会变成一直坐着）。
   */
  private startRest(now: number): void {
    this.lastUserAt = now;
    this.ambientGesture = null;
    this.gestureUntil = 0;
    this.startAction("rest", now, REST_MIN_MS + this.random() * REST_SPAN_MS);
  }

  private startRoam(context: CompanionContext, now: number): void {
    this.roamSpeed = WALK_SPEED;
    const bounds = this.roamBounds(context);
    let target: Point = { x: 0, y: 0 };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      target = {
        x: bounds.minX + this.random() * (bounds.maxX - bounds.minX),
        y: bounds.minY + this.random() * (bounds.maxY - bounds.minY),
      };
      if (Math.hypot(target.x - this.pos.x, target.y - this.pos.y) >= 60) break;
    }
    this.target = target;
    this.activity = "walk";
    this.idleUntil = now + this.idleDelay();
  }

  private roamBounds(context: CompanionContext) {
    const wa = context.workArea;
    const rawMinX = wa.x;
    const rawMaxX = wa.x + wa.width - context.size.width;
    const rawMinY = wa.y;
    const rawMaxY = wa.y + wa.height - context.size.height;
    return {
      minX: Math.min(rawMinX, rawMaxX),
      maxX: Math.max(rawMinX, rawMaxX),
      minY: Math.min(rawMinY, rawMaxY),
      maxY: Math.max(rawMinY, rawMaxY),
    };
  }

  private stepWalk(dt: number, now: number, context: CompanionContext): void {
    if (!context.canRoam) {
      this.activity = "idle";
      this.target = null;
      this.abortWild();
      this.idleUntil = now + 4_000;
      return;
    }
    if (!this.target) {
      this.activity = "idle";
      this.idleUntil = now + this.idleDelay();
      return;
    }
    const bounds = this.roamBounds(context);
    this.target = {
      x: clamp(this.target.x, bounds.minX, bounds.maxX),
      y: clamp(this.target.y, bounds.minY, bounds.maxY),
    };
    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= WALK_ARRIVE_PX) {
      this.pos = { ...this.target };
      this.activity = "idle";
      this.target = null;
      this.idleUntil = now + this.idleDelay();
      const wild = this.wildAct;
      if (wild) this.finishWild(wild, now);
      this.settle(now);
      return;
    }

    const speed = Math.max(WALK_MIN_SPEED, this.roamSpeed * Math.min(1, distance / WALK_EASE_PX));
    const move = Math.min(distance, speed * dt);
    this.pos = {
      x: this.pos.x + (dx / distance) * move,
      y: this.pos.y + (dy / distance) * move,
    };
    if (Math.abs(dx) > 0.5) this.facing = dx > 0 ? 1 : -1;
    this.step += move / 6;
    if (move >= distance - WALK_ARRIVE_PX) {
      this.pos = { ...this.target };
      this.activity = "idle";
      this.target = null;
      this.idleUntil = now + this.idleDelay();
      const wild = this.wildAct;
      if (wild) this.finishWild(wild, now);
      this.onMove?.({ ...this.pos });
      this.settle(now);
      return;
    }
    this.onMove?.({ ...this.pos });
  }

  private stepThrow(dt: number, now: number, context: CompanionContext): void {
    const wa = context.workArea;
    const left = wa.x;
    const right = wa.x + wa.width - context.size.width;
    const top = wa.y;
    const floor = wa.y + wa.height - context.size.height;
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    let onFloor = false;

    for (let i = 0; i < steps; i += 1) {
      this.vy += THROW.gravity * h;
      this.pos = { x: this.pos.x + this.vx * h, y: this.pos.y + this.vy * h };

      if (this.pos.x < left) {
        this.pos.x = left;
        this.vx = Math.abs(this.vx) * THROW.wallRestitution;
      } else if (this.pos.x > right) {
        this.pos.x = right;
        this.vx = -Math.abs(this.vx) * THROW.wallRestitution;
      }
      if (this.pos.y < top) {
        this.pos.y = top;
        this.vy = Math.abs(this.vy) * 0.5;
      }
      if (this.pos.y >= floor) {
        this.pos.y = floor;
        if (Math.abs(this.vy) > THROW.bounceFloor) {
          this.vy = -Math.abs(this.vy) * THROW.restitution;
          this.squashUntil = now + 220;
        } else {
          this.vy = 0;
          onFloor = true;
          this.vx *= Math.exp(-THROW.friction * h);
        }
      } else {
        this.vx *= Math.exp(-0.25 * h);
      }
    }

    this.facing = this.vx >= 0 ? 1 : -1;
    if (onFloor && Math.abs(this.vx) < THROW.restSpeed) {
      this.vx = 0;
      this.activity = "idle";
      this.squashUntil = now + 220;
      this.idleUntil = now + this.idleDelay();
      this.settle(now);
      return;
    }
    this.onMove?.({ ...this.pos });
  }

  private startAction(activity: CompanionActivity, now: number, duration: number): void {
    // 被别的动作接管＝这一轮野性没跑完：撤标记、不记账（扑击自己那一段除外）。
    if (this.wildAct !== null && !(this.wildAct === "hunt" && activity === "play")) {
      this.target = null;
      this.abortWild();
    }
    this.activity = activity;
    this.actionStartAt = now;
    this.actionDuration = duration;
    this.actionUntil = now + duration;
    this.wakeFromSleep();
  }

  private finishAction(now: number): void {
    const rested = this.activity === "rest";
    const wild = this.wildAct;
    this.activity = "idle";
    this.target = null;
    this.actionDuration = 0;
    this.idleUntil = now + this.idleDelay();
    if (wild) this.finishWild(wild, now, false);
    // 歇完先伸个懒腰再站好：直接从坐姿切回待机会像「被剪了一刀」。
    // 静息秒表也从「歇完」重新起算——否则坐 25s 再站 15s 就凑满 40s，
    // 一下变成坐一会儿、站一会儿，坐着反而成了常态。
    if (rested) {
      this.lastUserAt = now;
      this.startAction("stretch", now, ACTION_MS.stretch);
    }
  }

  private settle(now: number): void {
    void now;
    // 落位即整数像素：窗口位置本来就取整，模型不跟着取整会让「快照坐标」和
    // 「主端落盘的坐标」差半像素，后续按快照算目标点会反复微调。
    const snapped = { x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    this.pos = snapped;
    this.onSettle?.({ ...snapped });
  }
}

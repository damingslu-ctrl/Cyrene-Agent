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

export const BUBBLE_TTL_MS = 6_000;
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

/** `idle_micro` 档里真的动一下：只挑两个最轻的短手势，不打断「她在陪你」的静。 */
export const MICRO_GESTURES = ["peek", "wink"] as const;
export const MICRO_CHANCE = 0.35;

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
  morning: "早呀，今天也要一起",
  afternoon: "你忙你的，我在这儿",
  evening: "回来啦，先歇一会儿",
  night: "这么晚…我陪你一会儿",
} as const;

export type DayPart = keyof typeof GREETING_LINES;

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), Math.max(hi, lo));

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
  /** 摸头连击：窗口内累加，超窗归零；650ms 合并窗保证连击有节奏而不是连点。 */
  private headCombo = 0;
  private headComboAt = 0;
  private startleUntil = 0;
  private pounceCooldownUntil = 0;
  private pounces = 0;

  constructor(options: CompanionOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.wallNow = options.wallNow ?? this.now;
    this.storage = options.storage ?? null;
    this.onMove = options.onMove;
    this.onSettle = options.onSettle;
    this.lastNow = this.now();
    this.lastUserAt = this.lastNow;
    this.idleUntil = this.lastNow + this.idleDelay();
    this.chatAt = this.lastNow + CHAT_MIN_MS + this.random() * CHAT_SPAN_MS;
    this.load();
    this.loadBond();
    // 读档后的亲密度就是「当前档」：不把旧存档误报成刚升级。
    this.lastBondTier = bondTierOf(this.vitals.affinity);
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
    this.onMove?.({ ...this.pos });
    this.settle(now);
    this.say(this.pickLine([...GIRL_POUNCE_LINES]), 1, now, true);
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
  }

  /** user_active 的另一个消费面：看着它的时候不主动走开（已经起步的那趟不打断）。 */
  setUserActive(active: boolean): void {
    this.userActive = active;
  }

  // —— 自主行为 ——

  /** 起步漫游；目标会在 update 里按当前 workArea 夹取。 */
  roamTo(target: Point, now = this.now()): void {
    this.lastUserAt = now;
    this.target = { x: target.x, y: target.y };
    this.activity = "walk";
    this.actionUntil = 0;
    this.actionDuration = 0;
    this.vx = 0;
    this.vy = 0;
    this.wakeFromSleep();
    this.lastNow = now;
  }

  /** 开工/被摸/被抱走都算醒了：清掉小睡计时与手动睡眠标记。 */
  private wakeFromSleep(): void {
    this.sleepManual = false;
    this.sleepUntil = 0;
  }

  update(now: number, context: CompanionContext): CompanionSnapshot {
    const dt = clamp((now - this.lastNow) / 1000, 0, 1);
    this.lastNow = now;

    this.tickVitals(dt);
    if (this.bubble && now >= this.bubble.expiresAt) this.bubble = null;

    switch (this.activity) {
      case "sleep":
        // 自主小睡到点自醒；手动 toggle 的睡眠一直睡到用户再点一次。
        if (!this.sleepManual && now >= this.sleepUntil) {
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
    if (this.form !== "girl") return this.say(GREETING_LINES[part], 1, now);
    // 每天第一次见面：先伸个懒腰再开口（同一天重启不再演）。
    this.maybeMorningStretch(now, wall);
    const days = daysTogether(this.metAt, wall);
    // 第 N 天独占一行：问候句 72px，后面再缀「 · 第 2 天」会被 78px 内宽从词中间劈开。
    const text = days >= 2
      ? `${GIRL_GREETINGS[part]}\n第 ${days} 天`
      : GIRL_GREETINGS[part];
    return this.say(text, 1, now);
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
        const parsed = JSON.parse(raw) as { metAt?: number; morningKey?: string; nightKey?: string };
        found = true;
        if (typeof parsed?.metAt === "number" && Number.isFinite(parsed.metAt) && parsed.metAt > 0) {
          this.metAt = parsed.metAt;
        }
        if (typeof parsed.morningKey === "string") this.morningKey = parsed.morningKey;
        if (typeof parsed.nightKey === "string") this.lastNightKey = parsed.nightKey;
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
    this.setVitals({ affinity: this.vitals.affinity + delta });
    this.refreshBond(now);
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
      && now - this.lastUserAt >= REST_AFTER_MS
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
      const chatter = this.form === "girl"
        ? GIRL_CHATTER[dayPartOf(new Date(this.wallNow()).getHours())]
        : CHATTER;
      this.say(this.pickLine(chatter), 1, now);
      this.chatAt = now + CHAT_MIN_MS + this.random() * CHAT_SPAN_MS;
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
    // idle_micro 不再一定「什么都不做」：偶尔抬眼看你一下、或轻轻眨个眼，
    // 两段都短到不打断静坐，却能让待机不像一张会呼吸的贴图。
    if (roll.bucket === "idle_micro" && this.random() < MICRO_CHANCE) {
      const idx = Math.min(
        MICRO_GESTURES.length - 1,
        Math.floor(clamp(this.random(), 0, 0.999999) * MICRO_GESTURES.length),
      );
      const micro = MICRO_GESTURES[idx];
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
      this.settle(now);
      return;
    }

    const speed = Math.max(WALK_MIN_SPEED, WALK_SPEED * Math.min(1, distance / WALK_EASE_PX));
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
    this.activity = activity;
    this.actionStartAt = now;
    this.actionDuration = duration;
    this.actionUntil = now + duration;
    this.wakeFromSleep();
  }

  private finishAction(now: number): void {
    const rested = this.activity === "rest";
    this.activity = "idle";
    this.target = null;
    this.actionDuration = 0;
    this.idleUntil = now + this.idleDelay();
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

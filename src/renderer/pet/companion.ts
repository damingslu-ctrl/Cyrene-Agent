/**
 * 桌宠行为引擎（renderer 独占）。
 *
 * 位置权威在渲染端（漫游/投掷都从这里出发），主进程只在停稳后收一次落盘
 * （`pet-position-settled`）。事件/动作/气泡全是纯数据，renderer.ts 只负责把它
 * 翻译成 CatInput 与窗口几何；不碰 DOM、不碰 IPC，单测可在 node 里跑。
 */
import type { Mood } from "../../shared/cat-types";
import type { Point, WorkArea } from "../../shared/pet-geometry";

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
/** 离线结算上限：半年不开机也不会把猫饿成 0（时间戳被改坏时也兜得住）。 */
const OFFLINE_CAP_MS = 72 * 3600_000;
const IDLE_MIN_MS = 5_000;
const IDLE_SPAN_MS = 4_000;
const CHAT_MIN_MS = 35_000;
const CHAT_SPAN_MS = 30_000;
/** 自主小睡时长：到点自己醒。手动 toggle 的睡眠不受这个上限约束。 */
export const NAP_MIN_MS = 45_000;
const NAP_SPAN_MS = 45_000;

export type CompanionActivity =
  | "idle" | "walk" | "groom" | "yawn" | "stretch" | "tilt"
  | "sleep" | "pet" | "eat" | "play" | "drag" | "thrown";

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

const PET_LINES = ["呼噜呼噜…", "再摸一下嘛", "今天也很喜欢你"];
const FEED_LINES = ["小鱼干！", "嚼嚼…好吃", "吃饱啦"];
const PLAY_LINES = ["再来一次！", "接住啦～", "好玩！"];

export const GREETING_LINES = {
  morning: "早上好，今天也一起加油",
  afternoon: "下午好，我在呢",
  evening: "晚上好，今天辛苦啦",
  night: "这么晚还没睡呀",
} as const;

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

export class CompanionEngine {
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  private readonly onMove?: (position: Point) => void;
  private readonly onSettle?: (position: Point) => void;

  private vitals: CompanionVitals = { affinity: 0.5, fullness: 0.7, energy: 0.8 };
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

  constructor(options: CompanionOptions = {}) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.wallNow = options.wallNow ?? this.now;
    this.storage = options.storage ?? null;
    this.onMove = options.onMove;
    this.onSettle = options.onSettle;
    this.lastNow = this.now();
    this.idleUntil = this.lastNow + this.idleDelay();
    this.chatAt = this.lastNow + CHAT_MIN_MS + this.random() * CHAT_SPAN_MS;
    this.load();
  }

  // —— 查询面 ——

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
    this.setVitals({ affinity: this.vitals.affinity + 0.04 });
    this.happyUntil = now + 3_500;
    this.startAction("pet", now, 900);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(PET_LINES), 1, now);
  }

  feed(now = this.now()): void {
    this.setVitals({
      fullness: this.vitals.fullness + 0.3,
      energy: this.vitals.energy + 0.05,
      affinity: this.vitals.affinity + 0.02,
    });
    this.happyUntil = now + 2_500;
    this.startAction("eat", now, 1_600);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(FEED_LINES), 1, now);
  }

  play(now = this.now()): void {
    this.setVitals({
      energy: this.vitals.energy - 0.14,
      fullness: this.vitals.fullness - 0.05,
      affinity: this.vitals.affinity + 0.05,
    });
    this.happyUntil = now + 4_000;
    this.startAction("play", now, 2_000);
    this.idleUntil = now + IDLE_MIN_MS;
    this.say(this.pickLine(PLAY_LINES), 1, now);
  }

  toggleSleep(now = this.now()): void {
    this.actionDuration = 0;
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
    const hour = new Date(this.wallNow()).getHours();
    const text = hour >= 5 && hour < 11
      ? GREETING_LINES.morning
      : hour >= 11 && hour < 18
        ? GREETING_LINES.afternoon
        : hour >= 18 && hour < 22
          ? GREETING_LINES.evening
          : GREETING_LINES.night;
    return this.say(text, 1, now);
  }

  handleCommand(command: "pet" | "feed" | "play" | "toggle-sleep" | "status", now = this.now()): void {
    switch (command) {
      case "pet": this.pet(now); break;
      case "feed": this.feed(now); break;
      case "play": this.play(now); break;
      case "toggle-sleep": this.toggleSleep(now); break;
      case "status": {
        const v = this.vitals;
        this.say(
          `亲密度 ${Math.round(v.affinity * 100)}% · 饱腹 ${Math.round(v.fullness * 100)}% · 精力 ${Math.round(v.energy * 100)}%`,
          2,
          now,
        );
        break;
      }
    }
  }

  beginDrag(now = this.now()): void {
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

  say(text: string, priority = 1, now = this.now()): boolean {
    if (this.quiet) return false;
    if (!text.trim()) return false;
    if (this.bubble && now < this.bubble.expiresAt && priority <= this.bubble.priority) return false;
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
    if (!this.storage) return;
    try {
      this.storage.setItem(VITALS_KEY, JSON.stringify({ vitals: this.vitals, savedAt: this.wallNow() }));
    } catch {
      // 存储不可写（配额/隐私模式）：行为不受影响，只是下次从默认值起步。
    }
  }

  // —— 内部 ——

  private idleDelay(): number {
    return IDLE_MIN_MS + this.random() * IDLE_SPAN_MS;
  }

  private pickLine(lines: string[]): string {
    return lines[Math.floor(this.random() * lines.length) % lines.length];
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
    if (!context.canRoam) {
      // 被藏身/面板占着：把起步时间一路推后，解除后不许「攒满一发立刻走」。
      this.idleUntil = Math.max(this.idleUntil, now + 4_000);
      return;
    }
    if (this.bubble === null && !this.quiet && now >= this.chatAt) {
      this.say(this.pickLine(CHATTER), 1, now);
      this.chatAt = now + CHAT_MIN_MS + this.random() * CHAT_SPAN_MS;
    }
    if (now < this.idleUntil) return;

    // 时钟域：now 是行为秒表（performance.now），拿它 new Date 会落到 1970 年；
    // 昼夜权重必须读墙上时钟。
    const hour = new Date(this.wallNow()).getHours();
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
    this.activity = "idle";
    this.target = null;
    this.actionDuration = 0;
    this.idleUntil = now + this.idleDelay();
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

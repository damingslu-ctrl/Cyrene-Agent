/// <reference path="../types/cyrene.d.ts" />
import {
  clampRestoreOrigin,
  computeCatRect,
  computePetLayout,
  resolveGrowthDirection,
  type Point,
  type WorkArea,
} from "../../shared/pet-geometry";
import {
  EDGE_NEAR_PX,
  TUCK_IDLE_SECS,
  TUCK_PEEK_PX,
  shouldTuck,
  tuckHintShout,
  tuckStep,
  unTuckForDrag,
} from "../../main/verge/tuck-clock";
import { paintOps, type DrawOp, type Point2 } from "./ops";
import { buildBubbleOps, bubbleBoxRect, type BubbleBox, type CatInput } from "./art";
import { buildPetOps } from "./form";
import { buildGirlOverlayOps, girlAnimBodyFor, girlBodyFor, type GirlAnimBody } from "./girl-sprite";
import { GIRL_SPRITE } from "./girl-sprite-meta";
import { GIRL_ANIM } from "./girl-anim-meta";
import {
  GIRL_CLIP_PLAY,
  GirlClipPlayer,
  baseClipFor,
  frameSourceRect,
  gestureClipFor,
  redrawFloorFor,
  type GirlActivity,
  type GirlClipId,
} from "./girl-anim";
import { blinkAt, bodyClip, gestureClip, mixPose, sampleClip, type Slots } from "./motion";
import { faceOf, MOOD_TO_EXPRESSION, type Expression } from "./face";
import { CompanionEngine, type CompanionSnapshot, type TouchKind } from "./companion";
import type { PetCommand } from "../../shared/pet-commands";
import { GESTURE_COMMANDS } from "../../shared/pet-commands";
import type { WorkStatusTier } from "../../shared/work-status-types";
import { presentationOf } from "./work-status-presentation";
import { formGeometry, profileFor, type PetForm, type PetProfile } from "../../shared/pet-profile";

export interface HitAreaDef {
  name: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface PixelPetRendererOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  onLoad(): void;
  /** 仅供面兼容：init 的异步失败路径随 Live2D 加载一起删了，P1 永不触发。 */
  onError(error: unknown): void;
  /**
   * 行为引擎（漫游/互动/气泡）。生产在 main.ts 显式打开；默认关——
   * 贴边藏身那套机械测试要的是「不动、不说」的猫，不能被随机漫游掺进来。
   */
  companion?: boolean;
  /**
   * 每次真的发出 PET_RESIZE（窗口要动/要长）后回调一次。点击穿透的 alpha 判定
   * 依赖光标与窗口的相对位置；窗口在静止光标底下挪了，必须重判一次。
   */
  onWindowGeometry?(): void;
}

// native main.rs:4317-4320 的三档重绘策略：4fps 保活 / 30fps 面板与短动画 / 60fps hover 与拖拽。
// 后两档由 Task 11/12 经 setRedrawPolicy 接线消费。native 的两档速率是 repaint_after
// 33ms/250ms（main.rs:4361-4365），这里的 fps 闸是同一语义：低档只是少重绘，不是慢放。
const FPS_IDLE = 4;
const FPS_ACTIVE = 30;
const FPS_HOVER = 60;

/** fps 闸的容差：贴着 1000/fps 卡线时，浮点抖动不该把重绘顺延到下一档（再空 250ms）。 */
const FPS_GATE_SLACK_MS = 2.5;

export class PixelPetRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cat: CatInput;
  /** 形态：缺省 cat（R-D2）。 */
  private form: PetForm = "cat";
  /** 显式表情（workStatus/点击反馈覆盖用）；null＝跟 mood 级联走。 */
  private expressionOverride: Expression | null = null;
  /**
   * agent 工作状态（六档演出的当前档）。null＝没有 agent 在干活，
   * 一切回到自主行为；有值时它盖过自主抽到的小动作，但不改漫游/物理。
   */
  private workTier: WorkStatusTier | null = null;
  private workSince = 0;
  /** 注视目标（窗口内容坐标）；null 时眼球走自主游移。 */
  private gazeTarget: Point2 | null = null;
  /** 槽位时钟：每层「当前片 + 起点」（ms）。只存状态，采样在 draw 里按 now 算。 */
  private slots: Partial<Record<"body" | "gesture", { id: string; startedAt: number }>> = {};
  /** 手势层的显式片（playGesture/touch）；空则按活动映射。 */
  private explicitGesture: { id: string; startedAt: number } | null = null;
  /** 最近一帧的行为快照（composeChannels 要用；四足不读）。 */
  private lastSnapshot: CompanionSnapshot | null = null;
  private zoom = 1;
  /** rAF 句柄。0 = 没在跑；拖窗期 pause() 冻结绘制，DWM 快照逐位不变（Task 5 尖峰）。 */
  private ticker = 0;
  private paused = false;
  private fps = FPS_IDLE;
  /** fps 闸的上一次重绘时刻；闸挡掉的是重绘，挡不掉猫时钟（猫相位取绝对 t）。 */
  private lastDrawAt = 0;
  /** 免打扰（Task 11）：true 时猫画月牙、不许睡着（月牙与 Zzz 屏幕互斥，native #67）。 */
  private quiet = false;
  /**
   * 猫娘立绘。图在构造时就开拉（37 KB 本地 WebP），切到 girl 时通常已解码完：
   * girl 形态的每一帧只画这一张图 + 记号，不再走 buildGirlOps 的矢量路径。
   * 未就绪的 1–2 帧宁可不画身子，也不许拿旧矢量形象顶——那会变成「一开机两个形象」。
   */
  private readonly girlSprite = new Image();
  private girlSpriteReady = false;
  /** 图真的拉坏了（不是还没到）：此时回退到矢量猫娘，宁可旧形象也不要空窗。 */
  private girlSpriteFailed = false;

  /**
   * 多帧动作图集（dsh-pet 同路线）：同一段开场视频切出的 16 段动作。
   * 与静态立绘同时开拉，谁先到用谁——壳是同一个形象，不存在「开机两个形象」。
   */
  private readonly girlAnim = new Image();
  private girlAnimReady = false;
  /** 帧动画时钟：所有时间参数由 draw 的绝对 now 注入，暂停/拖窗不会偷跑。 */
  private readonly girlPlayer = new GirlClipPlayer("idle", 0);
  /** 正在演的手势段（显式 playGesture 或 companion 抽到的 ambient），播完回基础动作。 */
  private animGesture: { clipId: GirlClipId; startedAt: number } | null = null;
  private lastAmbientGesture: string | null = null;

  // —— Task 12 贴边藏身状态机（对位 native ui-thread App 状态：pet_pos/peek_dx/idle_t/user_active）——
  // 渲染端不是位置权威：catOrigin 只跟三条合法来源走——起帧 invoke 拉取、
  // display-metrics 重夹取后主端推送、拖拽结束的 flushMove 落位。
  /** 猫模型原点（native pet_pos，不含 peek）。null = 还没拿到几何基线，状态机不跑。 */
  private catOrigin: Point | null = null;
  private workArea: WorkArea | null = null;
  private tuckEnabled = false;
  /** 只作本地闸门（落盘权威在主端 service）：第一句 TUCK_HINT 说过就置真、不再重说。 */
  private tuckHinted = false;
  /** 藏身阈值：主端按 --tuck-probe 给 2.5 或 6.0（native main.rs:5648），渲染端只消费。 */
  private tuckLimit = TUCK_IDLE_SECS;
  private idleSecs = 0;
  private peekDx = 0;
  private peekSign = 1;
  /** native user_active（main.rs:4609：光标在窗框外扩 3px 内）的 pointerenter/leave 近似。 */
  private userActive = false;
  /** 拖拽标记：beginDrag/endDrag 之间为真（此间 ticker 冻结，状态机不推进）。 */
  private dragging = false;
  /** 上一帧秒表（仅算帧间 dt 用；猫相位另取绝对时钟，见 draw）。 */
  private lastFrameAt: number | null = null;
  /** 上一次真的发出去的 PET_RESIZE 载荷：渲染端去重，静置 0 流量、动画期逐帧有行。 */
  private lastSent: {
    x: number; y: number; width: number; height: number;
    pinInWin: Point; center: Point; peekDx: number; e: number;
  } | null = null;

  // —— companion（行为引擎）：位置权威在渲染端，停稳才落盘一次 ——
  private readonly engine: CompanionEngine | null = null;
  /** 气泡展开度 0..1：窗口宽 82 + 90·be；猫的钉位由 computePetLayout 保。 */
  private bubbleExpand = 0;
  /** 当前气泡往哪边长（近哪边就往反方向长，气窗绝不出屏）。 */
  private bubbleGrowLeft = false;
  private bubbleText = "";
  /** 上一帧气泡是否在场（canRoam 的闸门；引擎自己不知道窗口几何）。 */
  private bubbleActive = false;
  /** 气泡命中区（基址坐标，随 be 变宽）。 */
  private bubbleBox: BubbleBox | null = null;
  /** 引擎时钟：rAF 的毫秒值直接喂 update，和绘制同一根秒表。 */
  private lastCompanionAt: number | null = null;

  constructor(private readonly opts: PixelPetRendererOptions) {
    // willReadFrequently：点击穿透逐像素读 alpha（getImageData），不建这张快路径会退回 GPU 读回。
    this.ctx = opts.canvas.getContext("2d", { willReadFrequently: true, alpha: true })!;
    // 立绘是 512 高的位图，缩到 ~56px：高质量降采样少一圈锯齿，4fps 档也不吃性能。
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    const { u, s } = this.profile.catScale(0);
    // 绘制中心 = 窗口内钉位点 + 该形态的 centerOffset·s（猫 −17/+4.5；猫娘 0/+79）。
    // 窗口内钉位点与基址一样归 profile：standard 档就是 82×108 与 (41,39)，逐字节等于旧常量。
    this.cat = {
      center: this.centerFor(this.profile.pin, s),
      u,
      mood: "idle",
      t: 0,
      energy: 1,
      mouse: null,
      blink: 0,
      jumpY: 0,
      pet: 0,
      pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
      quiet: false,
    };
    if (opts.companion) {
      let storage: Storage | null = null;
      try { storage = window.localStorage; } catch { storage = null; }
      this.engine = new CompanionEngine({
        storage,
        now: () => performance.now(),
        wallNow: () => Date.now(),
        onMove: (position) => this.onCompanionMove(position),
        onSettle: (position) => this.onCompanionSettle(position),
      });
    }
    this.girlSprite.addEventListener("load", () => {
      this.girlSpriteReady = true;
      // 不等 fps 闸：4fps 档最坏要 250ms，开机第一眼就在那儿空着。
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlSprite.addEventListener("error", () => {
      this.girlSpriteFailed = true;
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlSprite.src = GIRL_SPRITE.src;

    this.girlAnim.addEventListener("load", () => {
      this.girlAnimReady = true;
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlAnim.addEventListener("error", () => {
      // 图集坏了不是灾难：静态立绘还在，动作退回刚体变换。
      console.warn("[verge] girl-anim 图集加载失败，退回静态立绘");
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlAnim.src = GIRL_ANIM.src;
  }

  async init(): Promise<void> {
    this.applyZoom(this.zoom);
    this.opts.onLoad();
    this.start();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * 主进程把窗口尺寸放大到 基址 × zoom（window-manager.ts 的 applyPetWindowZoom），
   * 这里把 zoom 折进 ctx 变换：绘制空间恒回 `profile.base`（标准档＝82×108）的
   * 基址几何，钉位在缩放后仍落在同一比例点上——对位 Live2D 时代「模型缩放去匹配窗口」。
   */
  applyZoom(zoom: number): void {
    this.zoom = zoom > 0 ? zoom : 1;
    this.resize(this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.opts.canvas.width = Math.max(1, Math.round(width * dpr));
    this.opts.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, 0, 0);
  }

  /** 拖窗期间必须停 ticker：DWM 拽影要的是逐位不变的快照（Task 5 尖峰已证 82×108 有效）。 */
  pause(): void {
    this.paused = true;
    this.stop();
  }

  resume(): void {
    this.paused = false;
    this.start();
  }

  dispose(): void {
    this.stop();
  }

  /**
   * 免打扰状态（Task 11）：main 侧到点自醒 / 菜单反馈后由 main.ts 调进来。
   * 状态一变就立即重绘一帧，月牙的下落不等下一个 fps 闸（4fps 档最坏要等 250ms，
   * 手感上就是「右键完月牙迟迟不上屏」）。
   */
  setQuiet(quiet: boolean): void {
    if (this.quiet === quiet) return;
    this.quiet = quiet;
    this.engine?.setQuiet(quiet);
    if (!this.paused) this.draw(performance.now());
  }

  /**
   * 贴边藏身开关（Task 12）：唯一入口是主端 applyTuckState 的广播
   * （菜单与 VERGE_SET_TUCK 两条写盘路径共用那个收口）。关掉后不许再滑，
   * 且**当场补画一帧**——「取消勾选立刻回位」的体感等不起 4fps 档的 250ms。
   */
  setTuckEnabled(enabled: boolean): void {
    if (this.tuckEnabled === enabled) return;
    this.tuckEnabled = enabled;
    if (!this.paused) this.draw(performance.now());
  }

  /** user_active 的门（native main.rs:4609/4902）：进场清零闲置、离场开始计时。 */
  setUserActive(active: boolean): void {
    this.userActive = active;
    this.engine?.setUserActive(active);
  }

  /**
   * 几何基线（VERGE_GET_PET_GEOMETRY 的返回）：init 拉一次、每次拖拽结束再拉一次
   * （换屏只由主端读 screen，渲染端不许自己算——位置权威在 main）。
   * bounds 是窗口**实际落位**（= applied，含 peek 的夹取结果），catOrigin 反推为
   * bounds − peek：静置时 peek 恒 0（init/拖拽结束），display 推送时才可能非零。
   */
  syncGeometry(geo: {
    bounds: WorkArea;
    workArea: WorkArea;
    tuckEnabled: boolean;
    tuckHinted: boolean;
    tuckLimit: number;
  }): void {
    this.workArea = { ...geo.workArea };
    this.tuckEnabled = geo.tuckEnabled;
    this.tuckHinted = geo.tuckHinted;
    this.tuckLimit = geo.tuckLimit;
    this.applyWindowPosition(geo.bounds);
  }

  /** display-metrics-changed 重夹取后主端的推送（VERGE_PET_GEOMETRY）。 */
  syncWindowBounds(bounds: WorkArea, workArea: WorkArea): void {
    this.workArea = { ...workArea };
    this.applyWindowPosition(bounds);
  }

  private applyWindowPosition(bounds: WorkArea): void {
    // 反推：win_pos(catOrigin) = applied − peek（computePetLayout 的 peek 分支加的正是它；
    // 夹取饱和的边角会被每帧 clampRestoreOrigin 自愈，不留双权威）。
    this.catOrigin = { x: bounds.x - this.peekDx, y: bounds.y };
    this.idleSecs = 0;
    this.engine?.setPosition({ ...this.catOrigin });
    this.requestBounds("pet", 0, this.catOrigin, this.workArea!, this.peekDx);
    if (!this.paused) this.draw(performance.now());
  }

  /**
   * 拖拽起点的 peek 吸收（native main.rs:4796-4801）：把藏身位移并进基准位、peek 归零。
   * applied_pos 可证不变（:4804）——win_pos 补回同量、偏移项归零，窗口一步都不许动，
   * 否则「拖一只藏着的猫」会从猫真正在的位置拽飞 40px。
   */
  beginDrag(): void {
    this.dragging = true;
    this.idleSecs = 0;
    // 抓起来就闭嘴：气泡窗比猫宽 90px，拖着它走会连着气泡一起搬，
    // 松手后窗口还得缩回去——干脆在起手就把气泡收掉。
    this.engine?.beginDrag(performance.now());
    this.engine?.dismissBubble();
    this.bubbleActive = false;
    this.bubbleExpand = 0;
    this.bubbleBox = null;
    if (this.catOrigin && Math.abs(this.peekDx) > 0.5) {
      this.catOrigin = { ...unTuckForDrag(this.catOrigin, this.peekDx), y: this.catOrigin.y };
      this.peekDx = 0;
      if (this.workArea) this.requestBounds("pet", 0, this.catOrigin, this.workArea, 0);
    }
  }

  /**
   * 拖拽收口（勘误 8 的顺序）：main.ts 必须先 window.cyrene.setDragging(false) 开回
   * 主端位置门，再调这里。position = flushMove 真的发给 controller 的落位（peek 已在
   * beginDrag 吸收，拖完窗口位即新 catOrigin）。拿不到落位（pointercancel）就维持旧值，
   * 由紧随的 getPetGeometry 重拉自愈。
   *
   * velocity 是松手前最后 ~150ms 的速度（px/s）：超过阈值就进入投掷物理，
   * 否则按「放下」原地落定（引擎会在此处发一次 settle，主端落盘）。
   */
  endDrag(position: Point | null, velocity: Point = { x: 0, y: 0 }): void {
    this.dragging = false;
    this.lastFrameAt = null;
    this.lastCompanionAt = performance.now();
    if (!this.catOrigin) return;
    this.idleSecs = 0;
    if (position) {
      this.catOrigin = { x: position.x, y: position.y };
      this.peekDx = 0;
    }
    this.engine?.endDrag({ ...this.catOrigin }, velocity, performance.now());
    this.sendBoundsForContent();
  }

  isQuiet(): boolean {
    return this.quiet;
  }

  // —— companion 查询/互动面（main.ts 与右键菜单的接口）——

  getCompanionSnapshot(): CompanionSnapshot | null {
    return this.engine?.getSnapshot() ?? null;
  }

  /** 让它自己走过去（调试/引导用；正常漫游由引擎按闲置表发起）。 */
  roamTo(target: Point): void {
    if (!this.engine) return;
    if (this.catOrigin) this.engine.setPosition({ ...this.catOrigin });
    this.engine.roamTo(target);
  }

  handleCommand(command: PetCommand): void {
    // 手势命令不走引擎：它不动数值、也不该被引擎的合并窗吞掉，纯粹演一次。
    const gestureId = GESTURE_COMMANDS[command];
    if (gestureId) {
      this.playGesture(gestureId);
      return;
    }
    // 走到这里的只剩五项数值互动；类型上 `GESTURE_COMMANDS` 已经排除了手势分支。
    this.engine?.handleCommand(command as "pet" | "feed" | "play" | "toggle-sleep" | "status", performance.now());
    // 用户主动互动的数值立刻落盘：等到下一次漫游停稳才存，摸摸攒的亲密度会白丢。
    this.engine?.save();
  }

  /** 开窗问候（主端确认不在安静期后调）：按时段一句，安静期引擎自己拒收。 */
  greet(): boolean {
    return this.engine?.greet(performance.now()) ?? false;
  }

  /**
   * agent 工作状态 → 六档演出（`WORK_PRESENTATIONS` 的执行端）。
   *
   * 档位**改变**才演一次：Working 会持续几分钟，每帧重放一遍手势就等于抽搐。
   * 气泡只在升高优先级时抢话筒（引擎自己管），所以「忙着呢」不会盖掉正在说的提醒。
   * 传 null（agent 空闲）只清表情与手势，不动自主行为。
   */
  setWorkStatus(tier: WorkStatusTier | null, now = performance.now()): void {
    if (tier === this.workTier) return;
    this.workTier = tier;
    this.workSince = now;
    if (tier === null) {
      this.setExpression(null);
      this.stopGesture();
      return;
    }
    const p = presentationOf(tier);
    this.setExpression(p.expression);
    if (p.gesture) this.playGesture(p.gesture, now);
    // 台词随机挑一句：同一个档位反复进出（跑一轮问答）每次都能听见不同的话。
    if (p.lines.length > 0) {
      const line = p.lines[Math.floor(Math.random() * p.lines.length)];
      this.engine?.say(line, tier === "提醒" ? 2 : 1, now);
    }
  }

  /** 当前工作档（null＝空闲）。诊断/测试用。 */
  getWorkTier(): WorkStatusTier | null {
    return this.workTier;
  }

  /**
   * 当前正在播的帧段 id（null＝还在静态立绘或矢量路径）。探针读它验手势命令真的换段了。
   * 只读，不改状态。
   */
  getGirlClipId(): string | null {
    if (this.form !== "girl" || !this.girlAnimReady) return null;
    return this.girlPlayer.clipId;
  }

  /**
   * 注视目标（`[x, y]` 窗口内容坐标，null＝没有目标，眼球回到自主游移）。
   *
   * 只喂给 `CatInput.mouse`：art.ts 拿它算瞳孔偏移，超出头部也照算（视线方向而非落点），
   * 所以窗口外的光标同样有效。四足与矢量猫娘都吃这个字段。
   */
  setGazeTarget(point: Point2 | null): void {
    const prev = this.gazeTarget;
    // 目标没动就不重绘：轮询每 120ms 一次，白画会把 4fps 档拉成 8fps，白烧电。
    if (prev === point) return;
    if (prev && point && Math.abs(prev[0] - point[0]) < 0.5 && Math.abs(prev[1] - point[1]) < 0.5) {
      this.gazeTarget = point;
      return;
    }
    this.gazeTarget = point;
    // 眼球是连续动画：立即重绘一帧，别等 4fps 闸（最坏 250ms，看起来像卡住）。
    if (!this.paused) this.draw(performance.now());
  }

  dismissBubble(): void {
    this.engine?.dismissBubble(performance.now());
  }

  /**
   * 气泡命中区（CSS 坐标，调用方给的是 pointer 事件的 clientX/Y）。
   * 气泡画在猫的反侧，点它 = 让它闭嘴；点猫身才是摸摸。
   */
  isPointOnBubble(cssX: number, cssY: number): boolean {
    const box = this.bubbleBox;
    if (!box || this.bubbleExpand <= 0) return false;
    const x = cssX / (this.zoom || 1);
    const y = cssY / (this.zoom || 1);
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  /** 主端把 user_active/安静状态喂进来的另一条路（几何同步时一并带上）。 */
  private onCompanionMove(position: Point): void {
    if (this.dragging) return;
    if (!this.catOrigin || !this.workArea) return;
    this.catOrigin = { x: position.x, y: position.y };
    // 走起来就不许再攒贴边：踢一脚闲置账（native 的 idle_t 也被动过就清零）。
    this.idleSecs = 0;
    this.sendBoundsForContent();
  }

  private onCompanionSettle(position: Point): void {
    if (!this.catOrigin || !this.workArea) return;
    this.catOrigin = { x: position.x, y: position.y };
    this.idleSecs = 0;
    this.sendBoundsForContent();
    // 停稳才落盘：漫游/投掷期间逐帧写盘会把这个设置文件写成高频 IO。
    window.verge?.settlePetPosition({ x: position.x, y: position.y });
    this.engine?.save();
  }

  private sendBoundsForContent(): void {
    if (!this.catOrigin || !this.workArea) return;
    if (this.bubbleExpand > 0) {
      this.requestBounds("bubble", this.bubbleExpand, this.catOrigin, this.workArea, 0);
      return;
    }
    this.requestBounds("pet", 0, this.catOrigin, this.workArea, this.peekDx);
  }

  /** 引擎能不能自主移动：藏身、展开、被抓着、agent 在干活的时候都不许。 */
  private canRoam(): boolean {
    if (!this.catOrigin || !this.workArea) return false;
    if (this.dragging || this.paused) return false;
    // agent 在干活时站定：她正「忙着呢」，边跑边敲代码读起来是抽帧故障而不是演出。
    if (this.workTier !== null) return false;
    if (this.bubbleActive || this.bubbleExpand > 0.001) return false;
    if (Math.abs(this.peekDx) > 0.5) return false;
    if (this.tuckEnabled) {
      const right = this.workArea.x + this.workArea.width;
      const nearRight = right - (this.catOrigin.x + this.profile.base.width) < EDGE_NEAR_PX;
      const nearLeft = this.catOrigin.x - this.workArea.x < EDGE_NEAR_PX;
      if (nearRight || nearLeft) return false;
    }
    return true;
  }

  /**
   * 每帧推进行为引擎 + 气泡窗的展开/收合。返回快照给 draw 翻译成 CatInput。
   * 几何窗口的展开度直接由 requestBounds("bubble", be) 驱动——和面板同一套协议。
   */
  private tickCompanion(now: number): CompanionSnapshot | null {
    const engine = this.engine;
    if (!engine || !this.catOrigin || !this.workArea) return null;
    const dtMs = this.lastCompanionAt === null ? 0 : Math.max(0, now - this.lastCompanionAt);
    this.lastCompanionAt = now;

    const snapshot = engine.update(now, {
      workArea: this.workArea,
      // 漫游夹的是「窗口」不是「猫」：catOrigin 是窗口原点，尺寸含档位与 zoom。
      size: { width: this.profile.base.width * this.zoom, height: this.profile.base.height * this.zoom },
      canRoam: this.canRoam(),
    });

    const bubble = snapshot.bubble;
    if (bubble) {
      if (bubble.text !== this.bubbleText) {
        // 新句子落位：先定朝哪边长（近哪边就往反方向），整段气泡都别再改向。
        this.bubbleText = bubble.text;
        this.bubbleGrowLeft = resolveGrowthDirection({
          catOrigin: this.catOrigin,
          workArea: this.workArea,
          current: { growUp: false, growLeft: this.bubbleGrowLeft },
          targetWidth: this.profile.bubbleWidth,
          profile: this.profile,
        }).growLeft;
      }
    }
    this.bubbleActive = bubble !== null;

    // 180ms 展开/收合。展开要等藏身退干净：be>0.05 后 computePetLayout 会走展开分支，
    // 带着 peek 切分支会让窗口瞬移。
    const target = bubble ? 1 : 0;
    const step = Math.min(0.25, dtMs / 1000) / 0.18;
    if (target > this.bubbleExpand) {
      if (Math.abs(this.peekDx) < 0.5) this.bubbleExpand = Math.min(target, this.bubbleExpand + step);
    } else if (target < this.bubbleExpand) {
      this.bubbleExpand = Math.max(target, this.bubbleExpand - step);
    }

    const baseW = this.profile.base.width;
    const rectW = baseW + (this.profile.bubbleWidth - baseW) * this.bubbleExpand;
    this.bubbleBox = bubble && this.bubbleExpand > 0
      ? bubbleBoxRect(rectW, this.bubbleGrowLeft, bubble.text)
      : null;

    this.sendBoundsForContent();
    return snapshot;
  }

  getCanvas(): HTMLCanvasElement {
    return this.opts.canvas;
  }

  /**
   * 交互区贴猫体而不是整窗矩形（native main.rs:4401-4409：cat_rect 中点在绘制中心右 17s / 上 6s）。
   * 返回的是**基址坐标**，不随 zoom 缩放；Task 11/12 若拿它做命中判定，必须 ×zoom
   * 才对得上放大窗（对位 readAlpha 的 css 坐标也要走同一系数）。
   */
  getHitAreaDefs(): HitAreaDef[] {
    return [{ name: this.form, rect: this.getHitRect() }];
  }

  /**
   * 当前命中矩形（css px，窗口内坐标）：吃**活的** pinInWin/e/profile。
   * 此前 getHitAreaDefs 钉死 pin/e:0 且零消费方；尺 #71 是它第一个真读者。
   */
  getHitRect(): { x: number; y: number; width: number; height: number } {
    return computeCatRect({
      pinInWin: this.lastSent?.pinInWin ?? this.profile.pin,
      e: this.lastSent?.e ?? 0,
      profile: this.profile,
    });
  }

  /**
   * 绘制原点 = 钉位 + 该形态的 `centerOffset·s`。
   * ⚠️ 之前这里写死猫的 (−17, +4.5)，猫娘也吃同一组数：她的脚支点在 viewBox (60,100)、
   * 墨高达 78 单位，按猫的原点画出去会顶到窗顶被裁掉（2026-10-25 真窗 CDP 实测 y=0）。
   * `FORM_GEOMETRY.girl.centerOffset` 是给这个函数用的，不是给测试用的。
   */
  private centerFor(pinInWin: Point, s: number): Point {
    const g = formGeometry(this.form);
    return { x: pinInWin.x + g.centerOffset.dx * s, y: pinInWin.y + g.centerOffset.dy * s };
  }

  /**
   * 尺的前提读数（R-D11 的「读数口」同源）：基址窗口尺寸与当前绘制原点。
   * 命中尺要判「墨是不是全在宠物基址里」，没有这两列就分不清
   * 「墨超界=画歪了」和「墨超界=气泡把窗口撑宽了」。
   */
  getLayoutInfo(): { base: { width: number; height: number }; center: Point; s: number } {
    const { s } = this.profile.catScale(this.lastSent?.e ?? 0);
    return { base: { ...this.profile.base }, center: { ...this.cat.center }, s };
  }

  /**
   * 形态×档位的唯一几何来源：基址、钉位、`u/s`、命中框、气泡宽度全部从这里算。
   * standard 档的每个数都等于旧常量（82×108 / (41,39) / scaleFor），所以默认档逐字节不变。
   */
  private profile: PetProfile = profileFor("cat", "standard");

  /** 形态/档位入口（Task 27 接 boot 读与下行）：换档必须当帧重发几何，窗口才会真的变大变小。 */
  setProfile(ref: { form: PetForm; tier: "small" | "standard" | "large" }): void {
    const next = profileFor(ref.form, ref.tier);
    if (next.form === this.profile.form && next.tier === this.profile.tier) return;
    this.profile = next;
    // 绘制中心与字号都吃当前档，先按最后一帧的 e 归位，再让 requestBounds 发新基址。
    const { u, s } = this.profile.catScale(this.lastSent?.e ?? 0);
    this.cat.u = u;
    this.cat.center = this.centerFor(this.lastSent?.pinInWin ?? this.profile.pin, s);
    this.setForm(next.form);
    if (this.catOrigin && this.workArea) {
      this.requestBounds("pet", 0, this.catOrigin, this.workArea, this.peekDx);
    }
    if (!this.paused) this.draw(performance.now());
  }

  getProfileRef(): { form: PetForm; tier: "small" | "standard" | "large" } {
    return { form: this.profile.form, tier: this.profile.tier };
  }

  /** CSS 坐标 → 设备像素的单点 alpha 采样，点击穿透的判据源。越界返回 0（= 穿透）。 */
  readAlpha(cssX: number, cssY: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const x = Math.floor(cssX * dpr);
    const y = Math.floor(cssY * dpr);
    if (x < 0 || y < 0 || x >= this.opts.canvas.width || y >= this.opts.canvas.height) return 0;
    return this.ctx.getImageData(x, y, 1, 1).data[3];
  }

  /**
   * PET_RESIZE 的唯一发送口（Task 12 起有调用方：藏身状态机每帧走这里；
   * P2 面板动画也接这条）。一次 computePetLayout、两处消费：
   * 1. 取整后的 bounds 发给主进程（渲染端不是位置权威，只是几何跟随者）；
   * 2. layout.pinInWin 折进绘制中心——peek **只进绘制偏移**，不进窗口位置
   *    （#38 事故：peek 进 win_pos 而绘制不补，猫反向补偿留在原地被窗裁没）。
   * 载荷带模型取证列（pinInWin/center/peekDx/e，不取整），GEOM 探针从此报实值。
   * 去重对「上一次真发过的载荷」比：bounds 两闸（0.5）之外模型列也参与——
   * 动画中 bounds 已贴边饱和不再变、peek 还在走，此时仍要发（探针要行、主端要新 peek）。
   */
  requestBounds(
    content: "pet" | "bubble" | "panel",
    g: number,
    catOrigin: Point,
    workArea: WorkArea,
    peekDx = 0,
  ): void {
    const e = content === "panel" ? g : 0;
    const be = content === "bubble" ? g : 0;
    const layout = computePetLayout({
      catOrigin,
      e,
      be,
      // 气泡朝哪边长由 tickCompanion 先按可用空间定好；面板档仍未接。
      growLeft: be > 0.001 ? this.bubbleGrowLeft : false,
      growUp: false,
      workArea,
      peekDx,
      profile: this.profile,
    });
    const { u, s } = this.profile.catScale(e);
    this.cat.u = u;
    // pinInWin 已含 peek_off（computePetLayout :121-123），猫随藏身走进窗口右侧。
    this.cat.center = this.centerFor(layout.pinInWin, s);
    const payload = {
      x: Math.round(layout.pos.x),
      y: Math.round(layout.pos.y),
      width: Math.round(layout.size.width),
      height: Math.round(layout.size.height),
      pinInWin: layout.pinInWin,
      center: this.cat.center,
      peekDx,
      e,
      base: { width: this.profile.base.width, height: this.profile.base.height },
    };
    const last = this.lastSent;
    const boundsStill =
      !!last &&
      Math.hypot(payload.x - last.x, payload.y - last.y) <= 0.5 &&
      Math.hypot(payload.width - last.width, payload.height - last.height) <= 0.5;
    const modelStill =
      !!last &&
      last.peekDx === payload.peekDx &&
      last.e === payload.e &&
      last.pinInWin.x === payload.pinInWin.x &&
      last.pinInWin.y === payload.pinInWin.y &&
      last.center.x === payload.center.x &&
      last.center.y === payload.center.y;
    if (boundsStill && modelStill) return;
    this.lastSent = payload;
    window.verge.resizePetWindow(payload);
    this.opts.onWindowGeometry?.();
  }

  /**
   * 贴边藏身每帧步进（native main.rs:4902-4974 的逐段对位）：
   * 闲置计账 → 收起态 workArea 夹取（:4171-4184）→ 六闸（shouldTuck）→
   * 贴边判定（基准位不含 peek，:4934-4935 的反抖注释）→ 首滑先解释（:4947-4961）→
   * 指数缓动与吸附（tuckStep）→ 30/4fps 档切换（peek_animating，:4973/:4355）。
   */
  private tickTuck(nowSec: number): boolean {
    if (!this.catOrigin || !this.workArea || this.dragging) return false;
    const dtRaw = this.lastFrameAt === null ? 0 : Math.max(0, nowSec - this.lastFrameAt);
    this.lastFrameAt = nowSec;

    // main.rs:4902-4905：user_active 清零，否则按**原始帧距**累计（不许吃 50ms 封顶）。
    if (this.userActive) this.idleSecs = 0;
    else this.idleSecs += dtRaw;

    // main.rs:4171-4184 收起态每帧夹取：换分辨率/拔屏后基准位可能被甩出工作区，
    // 夹回来；>0.5 的死区（:4180）防 DPI 抖动来回拽。peek 不参与——它是有意出窗的。
    const clamped = clampRestoreOrigin({
      saved: this.catOrigin,
      workArea: this.workArea,
      size: { width: this.profile.base.width, height: this.profile.base.height },
    });
    if (Math.hypot(clamped.x - this.catOrigin.x, clamped.y - this.catOrigin.y) > 0.5) {
      this.catOrigin = clamped;
    }

    // 六闸（shouldTuck，:4926-4931）。气泡开着/展开中的那几帧一律算「有气泡」：
    // 让它先退 peek，再把窗口长出去（be>0.05 会切掉 computePetLayout 的 peek 分支）。
    let peekTarget = 0;
    if (shouldTuck({
      tuckEnabled: this.tuckEnabled,
      userActive: this.userActive,
      idleSecs: this.idleSecs,
      limit: this.tuckLimit,
      e: 0,
      be: this.bubbleExpand,
      bubbleOpen: this.bubbleActive || this.bubbleExpand > 0.001,
    })) {
      // 贴边判定看基准位（含 peek 会翻转目标、边缘来回抖，:4934-4935）。
      const rightGap = this.workArea.x + this.workArea.width - (this.catOrigin.x + this.profile.base.width);
      const leftGap = this.catOrigin.x - this.workArea.x;
      if (Math.abs(rightGap) < EDGE_NEAR_PX) {
        this.peekSign = 1;
        peekTarget = 1;
      } else if (Math.abs(leftGap) < EDGE_NEAR_PX) {
        this.peekSign = -1;
        peekTarget = 1;
      }
    }

    // 头一次真要滑：先开口解释、这一帧按住不动（:4947-4961）。凭据在**决定说的那一刻**
    // 落盘不等滑到位；安静期该滑还是滑、解释延后（engaging && !quiet，:4955-4956）。
    const engaging = peekTarget > 0 && Math.abs(this.peekDx) < 0.5;
    const shout = tuckHintShout({
      tuckOn: this.tuckEnabled,
      hinted: this.tuckHinted,
      engaging: engaging && !this.quiet,
    });
    if (shout !== null) {
      this.tuckHinted = true;
      window.verge.tuckHinted();
      // P1 没有气泡绘制面（P2 接 canvas）：console 行留屏幕尺可对的取证点。
      console.log(`[verge] tuck_hint: ${shout.replace(/\n/g, " / ")}`);
      peekTarget = 0;
    }

    const targetDx = peekTarget * this.peekSign * TUCK_PEEK_PX;
    const prevDx = this.peekDx;
    this.peekDx = tuckStep(this.peekDx, targetDx, dtRaw, this.peekDx);
    // peek_animating（:4973-4974）：还在走/还没到位 → 30fps 档（native 的 33ms，:4355）。
    const peekAnimating =
      Math.abs(this.peekDx - prevDx) > 0.3 || Math.abs(this.peekDx - targetDx) > 0.5;

    this.sendBoundsForContent();
    return peekAnimating;
  }

  /** 三档 fps 的接线在 Task 11/12（hover/拖拽提帧）；这里先产面。 */
  setRedrawPolicy(fps: number): void {
    this.fps = fps;
    if (!this.paused) {
      this.stop();
      this.start();
    }
  }

  /**
   * GC 条款「render loop 走 rAF」：低 fps 档不靠 setInterval 定拍，而是 rAF 每帧回来
   * 先过 fps 闸——距上次重绘不足 1000/fps（- 容差）就只送下一帧请求、不重绘。
   * 被后台化/节流时 rAF 自然挂起，比自建 timer 更像 native 的 vsync 排程。
   */
  private start(): void {
    if (this.ticker || this.paused) return;
    this.lastDrawAt = performance.now();
    // rAF 重挂即新会话：帧距从 0 重算，暂停期的空洞不许灌进闲置计时或缓动 dt。
    this.lastFrameAt = null;
    const loop = (now: number): void => {
      if (now - this.lastDrawAt >= 1000 / this.fps - FPS_GATE_SLACK_MS) {
        this.lastDrawAt = now;
        this.draw(now);
      }
      this.ticker = window.requestAnimationFrame(loop);
    };
    this.ticker = window.requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.ticker) window.cancelAnimationFrame(this.ticker);
    this.ticker = 0;
  }

  /**
   * 猫娘立绘：绕脚心（center + jumpY − 走路起伏）旋转/缩放后贴图。
   * 支点必须与命中框、记号的基准同一条线（脚线），否则呼吸时脚会「离地漂」。
   */
  private paintGirlSprite(): void {
    const b = girlBodyFor(this.cat);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.pivot.x, b.pivot.y);
    ctx.rotate(b.rot);
    ctx.scale(b.sx * b.facing, b.sy);
    ctx.drawImage(this.girlSprite, -GIRL_SPRITE.anchorX * b.w, -b.h, b.w, b.h);
    ctx.restore();
  }

  /**
   * 图集里的一帧：脚心（anchorX/anchorY）对齐同一个支点。
   * k 把图集像素换算成绘制单位（inkRefPx → inkVb），与静态立绘是同一条 91vb 的尺，
   * 所以两套图切换时脚下不跳、身高不变。alpha 给交叉淡化用。
   */
  private paintGirlFrame(index: number, alpha: number, body: GirlAnimBody): void {
    const { sx, sy, sw, sh } = frameSourceRect(index);
    const w = GIRL_ANIM.cellW * body.k;
    const h = GIRL_ANIM.cellH * body.k;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(body.pivot.x, body.pivot.y);
    ctx.rotate(body.rot);
    ctx.scale(body.sx * body.facing, body.sy);
    ctx.drawImage(
      this.girlAnim, sx, sy, sw, sh,
      -GIRL_ANIM.anchorX * w, -GIRL_ANIM.anchorY * h, w, h,
    );
    ctx.restore();
  }

  /**
   * 每帧把「活动/环境手势/显式手势」翻译成要播的帧段（dsh-pet 的加权状态链）：
   * 1. 显式手势（点击反馈/workStatus）最高优先，一次性播完就回基础动作；
   * 2. 引擎自主抽到的小动作（snapshot.gesture，权重 80）只在换 id 时起播，
   *    否则每帧重置会把同一段动作钉在第一帧；
   * 3. 其余时间播活动对应的循环/长段（待机/走路/睡觉…）。
   */
  private tickGirlClip(now: number, snapshot: CompanionSnapshot | null): void {
    const activity = (snapshot?.activity ?? "idle") as GirlActivity;
    const explicit = this.explicitGesture;
    if (explicit) {
      // 与静态路径同口径：显式手势是一次性的，起播即消费，播完自动让位。
      this.explicitGesture = null;
      const clipId = gestureClipFor(explicit.id);
      if (clipId) {
        this.animGesture = { clipId, startedAt: explicit.startedAt };
        this.girlPlayer.setClip(clipId, explicit.startedAt, false);
      }
    } else {
      const ambient = snapshot?.gesture ?? null;
      if (ambient && ambient !== this.lastAmbientGesture) {
        const clipId = gestureClipFor(ambient);
        if (clipId) {
          this.animGesture = { clipId, startedAt: now };
          this.girlPlayer.setClip(clipId, now, false);
        }
      }
      this.lastAmbientGesture = ambient;
    }

    if (this.animGesture && this.girlPlayer.isDone(now)) this.animGesture = null;
    if (!this.animGesture) {
      const base = baseClipFor(activity, this.quiet);
      if (base !== this.girlPlayer.clipId) this.girlPlayer.setClip(base, now);
    }
  }

  private draw(now: number): void {
    // 猫相位 = 绝对时间（native main.rs:3945 `i.time` 直进 draw_cat :4736）：降帧只是
    // 采样稀，相位不许被帧率拖慢——「cat.t += dt 且封顶 50ms」在 4 fps 下时钟会慢 5 倍
    // （呼吸 4.2s 拉成 21s），已废。50ms 封顶只属于 P2 的缓动状态量（main.rs:4964/4362）。
    this.cat.t = now / 1000;
    // 藏身状态机走在绘制前：peek/夹取/发请求都发生在同一帧（native 的
    // layout-send 与 tick 分两段只是 egui 结构，1 帧差不可观察）。
    const peekAnimating = this.tickTuck(now / 1000);
    const snapshot = this.tickCompanion(now);
    // 手势/动作段先落定，再算重绘帧率：淡化期要 30fps，循环段至少比片段 fps 快一档。
    if (this.form === "girl" && this.girlAnimReady) this.tickGirlClip(now, snapshot);

    // 三档 fps：走路/投掷要 60，气泡/藏身缓动/计时动作 30，静坐 4。
    const moving = snapshot !== null
      && (snapshot.activity === "walk" || snapshot.activity === "thrown");
    // 计时动作（洗脸/哈欠/伸懒腰/歪头/摸摸/吃/玩）与落地压扁都是连续动画：
    // 留在 4fps 档会把它们切成一秒四格，动作越细腻越像卡带。
    const animating = snapshot !== null
      && (snapshot.activityProgress > 0 || snapshot.squash > 0);
    if (moving) this.fps = FPS_HOVER;
    else if (peekAnimating || this.bubbleExpand > 0 || animating) this.fps = FPS_ACTIVE;
    // agent 在干活时保持 30fps：手势（打字/点头）与粒子都在动，留在 4fps 档会一顿一顿。
    else if (this.workTier !== null) this.fps = FPS_ACTIVE;
    else this.fps = FPS_IDLE;
    // 帧动画自己的播放速率就是重绘下限：12fps 的待机在 4fps 档会让每张画多停两拍。
    // 下限取片段帧率的两倍（`redrawFloorFor`）：重绘与片段同频会凑成拍频，看起来一顿一顿。
    if (this.form === "girl" && this.girlAnimReady) {
      const need = this.girlPlayer.isFading(now)
        ? FPS_ACTIVE
        : redrawFloorFor(this.girlPlayer.clipId);
      this.fps = Math.max(this.fps, need);
    }

    this.lastSnapshot = snapshot ?? null;
    if (snapshot) this.applyCompanionPose(snapshot);
    // 免打扰在源头闸住「睡着」这条分支（native #53/#67）：月牙与 Zzz 屏幕互斥，
    // art.ts 里的 `!quiet` 条只压得掉 Zzz 的尾巴，压不掉已经躺下的 mood:"sleep" 本体。
    // quiet 期间 sleep 档被改写成 idle——月牙是唯一的记号，不许睡脸冒充。
    const sleepSuppressed = this.quiet;
    if (sleepSuppressed && this.cat.mood === "sleep") this.cat.mood = "idle";
    // 月牙记号的唯一数据源是 cat.quiet（art.ts :415 `if (quiet)`）：
    // setQuiet 只翻自身字段，draw 时必须回写进猫输入，否则月牙永远画不出来。
    this.cat.quiet = this.quiet;
    // agent 工作状态：粒子记号与表情都由档位表决定（表情走 expressionOverride，
    // 在 composeChannels / faceOf 那一层生效；这里只负责把粒子喂进覆盖层）。
    this.cat.workParticle = this.workTier === null ? "none" : presentationOf(this.workTier).particle;
    this.cat.workSince = this.workSince / 1000;
    // 注视：只有矢量路径吃 mouse（位图猫娘的脸是画死的，瞳孔不会转）。
    this.cat.mouse = this.form === "girl" && this.girlAnimReady ? null : this.gazeTarget;

    // 变换里已折 zoom，clear/气泡都要拿到 zoom 归一后的基址几何。
    const w = (this.opts.canvas.clientWidth || this.profile.base.width) / this.zoom;
    const h = (this.opts.canvas.clientHeight || this.profile.base.height) / this.zoom;
    this.ctx.clearRect(0, 0, w, h);
    let ops: DrawOp[];
    if (this.form === "girl") {
      if (this.girlAnimReady) {
        // 帧动画：上一段冻住的那一帧垫底，当前段按淡化进度压上去
        // （先画 prev 再画当前，中途不会出现整体透明度塌陷）。
        const sample = this.girlPlayer.sample(now);
        const body = girlAnimBodyFor(this.cat);
        if (sample.prev) this.paintGirlFrame(sample.prev.index, 1, body);
        this.paintGirlFrame(sample.index, sample.fade, body);
        // 立绘里的脸/身体是画死的；表情层不参与，屏幕记号照旧跟 mood/pet/quiet 走。
        ops = buildGirlOverlayOps(this.cat);
      } else if (this.girlSpriteReady) {
        this.paintGirlSprite();
        ops = buildGirlOverlayOps(this.cat);
      } else if (this.girlSpriteFailed) {
        const composed = this.composeChannels(now, this.lastSnapshot);
        ops = buildPetOps({
          ...this.cat,
          channels: composed.channels,
          expression: composed.expression,
          blink: Math.max(this.cat.blink, composed.blink),
          form: "girl",
        });
      } else {
        ops = [];
      }
    } else {
      ops = buildPetOps({ ...this.cat, form: this.form });
    }
    // 流量胶囊不再常驻：猫说话时窗口横长，气泡占右半边；读数搬进了侧边栏「网络」页。
    if (this.bubbleExpand > 0 && this.bubbleText) {
      ops.push(...buildBubbleOps({
        rectWidth: w,
        rectHeight: h,
        growLeft: this.bubbleGrowLeft,
        text: this.bubbleText,
        be: this.bubbleExpand,
      }));
    }
    paintOps(this.ctx, ops);
  }

  /** 形态切换（缺省 cat）。切形态清槽位：上一形算出的通道不许被下一形接着用。 */
  setForm(form: PetForm): void {
    if (form === this.form) return;
    this.form = form;
    this.slots = {};
    this.explicitGesture = null;
    // 形态也是行为引擎的分岔口：不同步这一步，猫娘的四档加权抽取永远不跑（她只会走四足那张平表）。
    this.engine?.setForm(form);
    this.animGesture = null;
    this.lastAmbientGesture = null;
    if (form === "girl") this.girlPlayer.reset("idle", performance.now());
    // 两个形态的绘制原点不同（猫 −17/+4.5s、猫娘 0/+79s）：切形态必须当场重算，
    // 否则等下一帧 requestBounds 才归位，中间会闪一帧「猫娘浮在猫的位置上」。
    const { s } = this.profile.catScale(this.lastSent?.e ?? 0);
    this.cat.center = this.centerFor(this.lastSent?.pinInWin ?? this.profile.pin, s);
    if (!this.paused) this.draw(performance.now());
  }

  /** 显式表情（workStatus/点击反馈）；传 null 回到 mood 级联。 */
  setExpression(expression: Expression | null): void {
    this.expressionOverride = expression;
  }

  /** 显式手势（P4 的点击反馈与 workStatus 演出用它）。 */
  playGesture(id: string, now = performance.now()): void {
    this.explicitGesture = { id, startedAt: now };
    // 立即重绘：4fps 档最坏要等 250ms，右键点「招招手」要当场动，不能等闸。
    if (!this.paused) this.draw(now);
  }

  stopGesture(): void {
    this.explicitGesture = null;
  }

  /** 触摸六类（引擎在猫形恒 false；同一入口两形态共用，反应只长在猫娘上）。 */
  touch(kind: TouchKind): void {
    this.engine?.touch(kind);
  }

  /**
   * 四层合成（Task 14）：body + gesture 两层按各自槽位采样，face 由表情档 + 眨眼算，
   * 合成成一组 channels 交给 buildPetOps。cat 形态**不进这里**（R-D2：四足走原路）。
   */
  private composeChannels(nowMs: number, snapshot: CompanionSnapshot | null): {
    channels: Partial<Record<string, number>>;
    expression: Expression;
    blink: number;
  } {
    const nowSec = nowMs / 1000;
    const blink = blinkAt(nowSec);

    // body 层：活动 → body clip（与四足同一张活动表，但取 clip 名）
    const activity = snapshot?.activity ?? "idle";
    const bodyId =
      activity === "walk" ? "walk"
      : activity === "drag" ? "drag"
      : activity === "thrown" ? "thrown"
      : activity === "sleep" ? "sleep"
      : activity === "groom" || activity === "yawn" || activity === "stretch" ? "stand"
      : "stand";
    const cur = this.slots.body;
    if (!cur || cur.id !== bodyId) this.slots.body = { id: bodyId, startedAt: nowMs };

    // gesture 层：显式片优先；否则按 activity 映射（tilt 那条）
    const mapped = activity === "tilt" ? "tilt" : null;
    const wantGesture = this.explicitGesture?.id ?? mapped;
    if (wantGesture) {
      const curG = this.slots.gesture;
      if (!curG || curG.id !== wantGesture || this.explicitGesture) {
        this.slots.gesture = {
          id: wantGesture,
          startedAt: this.explicitGesture?.id === wantGesture ? this.explicitGesture.startedAt : nowMs,
        };
        this.explicitGesture = null;
      }
    } else if (this.slots.gesture) {
      // 没有新片时槽位留到它自己演完（一次性片 p=1＝rest，画出来等于没有）；
      // 直接删槽会让 fps 判据读不到真实进度，也会让「连播四帧」变成「第一帧后消失」。
      const cur = gestureClip(this.slots.gesture.id);
      const p = cur.lasting
        ? ((nowMs - this.slots.gesture.startedAt) / cur.ms) % 1
        : (nowMs - this.slots.gesture.startedAt) / cur.ms;
      if (!cur.lasting && p >= 1) delete this.slots.gesture;
    }

    const slots: Slots = {};
    const b = bodyClip(this.slots.body!.id);
    slots.body = { clip: b, p: b.lasting ? ((nowMs - this.slots.body!.startedAt) / b.ms) % 1 : Math.min(1, (nowMs - this.slots.body!.startedAt) / b.ms) };
    const g = this.slots.gesture ? gestureClip(this.slots.gesture.id) : null;
    if (g && this.slots.gesture) {
      slots.gesture = {
        clip: g,
        p: g.lasting ? ((nowMs - this.slots.gesture.startedAt) / g.ms) % 1 : Math.min(1, (nowMs - this.slots.gesture.startedAt) / g.ms),
      };
    }
    const channels = mixPose(slots);
    const expression = this.expressionOverride ?? (snapshot ? MOOD_TO_EXPRESSION[snapshot.mood] : "neutral");
    // face 档里的眨眼/视线在 faceOf 里合（blink 只压 lid）
    void faceOf(expression, { t: nowSec, blink, mouse: null, energy: this.cat.energy, speaking: false });
    return { channels, expression, blink };
  }

  /** 行为快照 → 猫输入：动作进度只在这一个地方翻译，art.ts 不认识 companion。 */
  private applyCompanionPose(snapshot: CompanionSnapshot): void {
    this.cat.mood = snapshot.mood;
    this.cat.facing = snapshot.facing;
    this.cat.energy = snapshot.vitals.energy;
    const progress = snapshot.activityProgress;
    // 计时动作走一个正弦包络：0→1→0，起落都软，不会在半程「啪」地弹回站姿。
    const pulse = progress > 0 ? Math.sin(Math.PI * progress) : 0;
    this.cat.pose.walk = snapshot.activity === "walk" ? snapshot.step : 0;
    this.cat.pose.squash = snapshot.squash;
    this.cat.pose.paw = snapshot.activity === "groom" ? pulse : 0;
    this.cat.pose.yawn = snapshot.activity === "yawn" ? pulse : 0;
    this.cat.pose.stretch = snapshot.activity === "stretch" ? pulse : 0;
    this.cat.pose.tilt = snapshot.activity === "tilt" ? 13 * pulse : 0;
    this.cat.pet = snapshot.activity === "pet" ? Math.max(0.15, 1 - progress) : 0;
    this.cat.pose.engagement = snapshot.activity === "walk" ? 0.4 : 0;
  }
}

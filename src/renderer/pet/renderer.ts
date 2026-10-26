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
import {
  buildGirlOverlayOps,
  buildGirlPoseOverlayOps,
  girlAnimBodyFor,
  girlBodyFor,
  girlFaceBox,
  girlInkBox,
  girlPoseBodyFor,
  girlPoseFaceBox,
  girlPoseInkBox,
  type GirlAnimBody,
  type GirlFaceBox,
  type GirlPoseBody,
} from "./girl-sprite";
import { GIRL_SPRITE } from "./girl-sprite-meta";
import { GIRL_ANIM } from "./girl-anim-meta";
import {
  GIRL_POSE_ATLASES,
  type GirlAtlasId,
  type GirlPoseName,
  girlPoseCell,
  girlPoseGeom,
} from "./girl-pose-atlas";
import { frameSourceRect, gestureClipFor, type GirlActivity, type GirlClipId } from "./girl-anim";
import {
  GIRL_IDLE_SEED,
  createGirlIdle,
  girlIdleLeft,
  girlIdlePose,
  resetGirlIdle,
  stepGirlIdle,
  type GirlIdleState,
  type GirlLifePhase,
} from "./girl-idle";
import { GirlScenePlayer, girlBasePoseFor, girlBaseVisualFor, type GirlShown } from "./girl-scene";
import { gesturePoseFor } from "./girl-gesture";
import { blinkAt, bodyClip, gestureClip, mixPose, sampleClip, type Slots } from "./motion";
import { faceOf, MOOD_TO_EXPRESSION, type Expression } from "./face";
import {
  CompanionEngine,
  DIZZY_MS,
  PET_HOLD_MS,
  STARTLE_MS,
  clickKindFor,
  type CompanionActivity,
  type CompanionSnapshot,
  type TouchKind,
} from "./companion";
import { GirlTapTracker, classifyGirlTap } from "./girl-zones";
import { GirlPresence, restingPresence, type GirlPresencePose } from "./girl-presence";
import { buildGirlFxOps } from "./girl-fx";
import { buildAccessoryOps } from "./girl-accessory";
import {
  CATCH_FLASH_MS,
  CRITTER_LIFE_MS,
  buildCritterOps,
  catchCritter,
  critterAlive,
  critterAt,
  critterKindFor,
  spawnCritter,
  stepCritter,
  type CritterState,
} from "./girl-critter";
import { SNACK_MS, buildSnackOps, createSnack, snackAlive, stepSnack, type SnackState } from "./girl-snack";
import { wanderTarget } from "./girl-wander";
import { TOY, buildToyOps, createToy, kickToy, stepToy, toyAt, type ToyOps, type ToyState } from "./girl-toy";
import { TeaseTracker } from "./girl-tease";
import {
  WAND_MS,
  buildWandOps,
  catchWand,
  createWand,
  wandAlive,
  wandAt,
  wandTip,
  type WandState,
} from "./girl-wand";
import {
  BUBBLES_MS,
  bubbleAt,
  bubblePos,
  bubblesAlive,
  buildBubbleOps as buildToyBubbleOps,
  createBubbles,
  liveBubbleCount,
  popBubble,
  type BubbleState,
} from "./girl-bubbles";
import { LEAVES_MS, buildLeafOps, createLeaves, leavesAlive, type LeafState } from "./girl-leaves";
import { PRINT_GAP_MS, buildPrintOps, spawnPrint, stepPrints, type PawMark } from "./girl-prints";
import { FOLLOW_MS, followArrived, followNeedsStep, followTargetX } from "./girl-follow";
import { ACHIEVEMENT_MS, EMPTY_STATS, buildAchievementOps } from "./girl-achievements";
import { buildDreamOps } from "./girl-dream";
import { buildRpsOps, buildRpsPlayerOps, RPS_MS, type RpsState } from "./girl-rps";
import {
  BOX_MS,
  BOX_POP_MS,
  buildBoxOps,
  boxAlive,
  boxAt,
  boxHeadRect,
  boxPhase,
  boxRectFor,
  catchBox,
  createBox,
  knockBox,
  type BoxState,
} from "./girl-box";
import {
  LASER_MS,
  LASER_CATCH_MS,
  buildLaserOps,
  catchLaser,
  createLaser,
  laserAlive,
  laserAt,
  laserAtPoint,
  laserBoundsFor,
  type LaserState,
} from "./girl-laser";
import {
  BRUSH_MS,
  buildBrushOps,
  boostBrush,
  brushAlive,
  brushAt,
  brushStrokes,
  brushSweep,
  createBrush,
  type BrushState,
} from "./girl-brush";
import {
  CATNIP_MS,
  buildCatnipOps,
  catnipAlive,
  catnipAt,
  catnipAtPoint,
  catnipPhase,
  createCatnip,
  puffCatnip,
  type CatnipState,
} from "./girl-catnip";
import {
  PLANE_MS,
  PLANE_CATCH_MS,
  buildPlaneOps,
  catchPlane,
  createPlane,
  planeAlive,
  planeAt,
  planeAtPoint,
  type PlaneState,
} from "./girl-plane";
import {
  BIRD_MS,
  buildBirdOps,
  birdAlive,
  birdAt,
  birdAtPoint,
  birdClickable,
  createBird,
  scareBird,
  type BirdState,
} from "./girl-bird";
import {
  SCRATCH_MS,
  buildScratchOps,
  boostScratch,
  createScratch,
  scratchAlive,
  scratchAtPoint,
  scratchMarks,
  scratchPhase,
  scratchRectFor,
  type ScratchState,
} from "./girl-scratch";
import {
  BELL_MS,
  bellAlive,
  bellAt,
  bellAtPoint,
  bellRadius,
  buildBellOps,
  createBell,
  ringBell,
  type BellState,
} from "./girl-bell";
import {
  MOUSE_MS,
  buildMouseOps,
  catchMouse,
  createMouse,
  mouseAlive,
  mouseAt,
  mouseAtPoint,
  mouseRadius,
  type MouseState,
} from "./girl-mouse";
import {
  MOLE_MS,
  buildMoleOps,
  createMole,
  moleAlive,
  moleAtPoint,
  moleHeadAt,
  whackMole,
  type MoleState,
} from "./girl-mole";
import {
  HUG_MS,
  buildHugOps,
  createHug,
  hugAlive,
  hugAtPoint,
  tapHug,
  type HugState,
} from "./girl-hug";
import { RAIN_MS, buildRainOps, createRain, rainAlive, rainAmount, type RainState } from "./girl-rain";
import {
  TAIL_MS,
  buildTailOps,
  chaseTail,
  createTail,
  tailAlive,
  tailPhase,
  tailTipAt,
  type TailState,
} from "./girl-tail";
import {
  KNEAD_MS,
  buildKneadOps,
  createKnead,
  kneadAlive,
  kneadAtPoint,
  kneadPads,
  kneadPhase,
  pressKnead,
  type KneadState,
} from "./girl-knead";
import {
  ROLL_MS,
  buildRollOps,
  createRoll,
  flipRoll,
  rollAlive,
  rollAtPoint,
  rollPhase,
  rollSpin,
  type RollState,
} from "./girl-roll";
import {
  BOOK_MS,
  bookAlive,
  bookAtPoint,
  bookPhase,
  bookRectFor,
  buildBookOps,
  createBook,
  turnPage,
  type BookState,
} from "./girl-book";
import {
  GIFT_MS,
  buildGiftOps,
  createGift,
  giftAlive,
  giftAtPoint,
  giftPhase,
  giftRectFor,
  openGift,
  type GiftState,
} from "./girl-gift";
import {
  WISH_MS,
  buildWishOps,
  createWish,
  makeWish,
  wishAlive,
  wishAtPoint,
  wishPhase,
  wishStarAt,
  type WishState,
} from "./girl-wish";
import {
  HOP_MS,
  buildHopOps,
  createHopscotch,
  hopAlive,
  hopAtPoint,
  hopSquareAt,
  stepHop,
  type HopState,
} from "./girl-hopscotch";
import {
  SNOW_MS,
  buildSnowOps,
  createSnow,
  packSnow,
  snowAlive,
  snowAmount,
  snowPileAt,
  snowmanBuilt,
  type SnowState,
} from "./girl-snow";
import {
  FORTUNE_MS,
  buildFortuneOps,
  createFortune,
  fortuneAtPoint,
  fortunePhase,
  fortuneSlipAt,
  revealFortune,
  type FortuneState,
} from "./girl-fortune";
import { buildPurrOps } from "./girl-purr";
import { rpsFromCommand } from "../../shared/pet-rps";
import { GESTURE_COMMANDS, accessoryFromCommand, type PetCommand } from "../../shared/pet-commands";
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

/** 深夜提醒询问引擎的节拍。诊断把「距下一拍」报出去，验收才能卡点喂伪时钟。 */
const NIGHT_NUDGE_POLL_MS = 30_000;

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
  /** 连点计数器（只认猫娘）：2.4s 内第四下逗晕。 */
  private girlTaps = new GirlTapTracker();
  /**
   * 注视存在感（只认猫娘帧动画）：位图的脸是画死的，她「注意到你」只能靠整身。
   * 位置量是绘制空间像素/角度，每帧由 draw 喂 now，暂停即停。
   */
  private readonly girlPresence = new GirlPresence();
  private presencePose: GirlPresencePose = restingPresence();
  /** 「！」出现的绝对时刻；-1＝没有。渲染器只记时间，画多久由记号层决定。 */
  private noticeAt = -1;
  /** 脸红包络 0..1：片/互动给目标，按 180ms 时间常数缓动，切段不「啪」地亮。 */
  private blush = 0;
  private lastGirlFxAt: number | null = null;
  private lastFxCounts = { below: 0, above: 0 };
  /** 坐垫包络 0..1：rest 活动时展开，起身收回（与脸红同一条 180ms 缓动）。 */
  private cushion = 0;
  /**
   * 脚边的毛线球。物理在绘制空间跑（82px 窗子里），引擎只负责她的反应（toyBat）：
   * 球怎么滚是她窗子里的事，窗户怎么搬是引擎的事，两边不互相持有状态。
   */
  private toyState: ToyState | null = null;
  private lastToyAt: number | null = null;
  /** 下一次她自己扒拉球的时刻（闲置时才轮到，踢过一手就重新排）。 */
  private nextToyBatAt = 0;
  /** 光标快速甩两下的计数器：凑满了才让她扑（冷却在引擎）。 */
  private readonly tease = new TeaseTracker();
  /** 深夜提醒的轮询闸：每 30s 问引擎一次，去重（同一晚 45min）由引擎管。 */
  private lastNightNudgeCheckAt = 0;
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
  /**
   * 真姿态图集（v1.14.0）：站/坐/蜷/回头/伸懒腰/开心都是画好的整身，
   * 待机底子不再借跳舞帧压扁。与帧动画同时开拉，谁到用谁。
   */
  private readonly girlPoses = new Image();
  private girlPosesReady = false;
  /**
   * 真姿态图集 II（v1.15.0）：趴/哈欠/洗脸/歪头/招手/鞠躬/剪刀手/正坐。
   * 与图集 I 各拉各的：这张坏了只让趴那一族退回帧动画，坐/蜷照旧。
   */
  private readonly girlPoses2 = new Image();
  private girlPoses2Ready = false;
  /** 图集 id → 已就绪（姿态图两套分开拉，谁没到谁自己退回帧动画）。 */
  private girlAtlasReady(atlas: GirlAtlasId): boolean {
    return atlas === "poses2" ? this.girlPoses2Ready : this.girlPosesReady;
  }
  private girlPoseImage(atlas: GirlAtlasId): HTMLImageElement {
    return atlas === "poses2" ? this.girlPoses2 : this.girlPoses;
  }
  /** 当前这一幕：真姿态静帧，或一段帧动画。时间由 draw 的绝对 now 注入。 */
  private scene = new GirlScenePlayer({ kind: "clip", id: "idle", loop: true }, 0);
  /**
   * 正在演的手势（显式 playGesture 或 companion 抽到的 ambient），播完回基础动作。
   * v1.15 起手势可以是一张真姿态（招手/鞠躬/歪头…）或一段帧动画（点头/打字…）。
   * `id` 是手势原 id：诊断与探针问的是「她还在做那个动作吗」，两种演出都得答得上；
   * `until` 只对真姿态有意义（帧动画自己会报 done）。
   */
  private animGesture: {
    id: string;
    clipId: GirlClipId | null;
    startedAt: number;
    until: number;
  } | null = null;
  /** 当前这段手势是不是引擎抽的（换段时要让位给新姿态；用户点的手势不打断）。 */
  private ambientGestureActive = false;
  /** 已经演过自主小动作的站定段号；同一段只演一条，站定才不会变成连播舞蹈。 */
  private ambientGestureBout = -1;
  private lastAmbientGesture: string | null = null;
  /**
   * 待机编排（v1.13.0 起）：站→回头→坐→蜷→起身。状态机是纯函数，渲染器只在
   * 「她真的闲着」时推进；任何玩具/活动都挂起它。v1.14 起每一段都落到真姿态。
   */
  private idle: GirlIdleState = createGirlIdle(0, GIRL_IDLE_SEED);
  /** 帧时钟的基准不是构造时刻：第一帧要知道「从当下起跳」，不能继承 now=0 的旧时间线。 */
  private idleTickInited = false;
  /** 挂起（玩具/非 idle 活动）时只 reset 一次，不能每帧重置把 bouts 刷爆。 */
  private idleSuspended = false;
  /** 这一帧实际画出的脸框：诊断与探针读它，保证读数和屏幕同一拍。 */
  private lastFace: GirlFaceBox | null = null;

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

  /** 伴飞小虫：一只在飞或刚被捉住；null = 现在没有。 */
  private critter: CritterState | null = null;
  /** 下一次允许自发招虫的时刻；0 = 还没排过（首次要等 45–85s，见面就先放虫太吵）。 */
  private nextCritterAt = 0;
  /** 喂食的小鱼干道具；null = 没在演。 */
  private snack: SnackState | null = null;
  /** 逗猫棒 / 泡泡 / 落叶 / 猜拳 / 纸箱 / 激光 / 梳毛 / 薄荷 / 纸飞机 / 小鸟：各自一条时间线。 */
  private wand: WandState | null = null;
  private bubbles: BubbleState | null = null;
  private leaves: LeafState | null = null;
  private rps: RpsState | null = null;
  private box: BoxState | null = null;
  private laser: LaserState | null = null;
  private brush: BrushState | null = null;
  private catnip: CatnipState | null = null;
  private plane: PlaneState | null = null;
  private bird: BirdState | null = null;
  private scratch: ScratchState | null = null;
  private bell: BellState | null = null;
  private mouse: MouseState | null = null;
  private mole: MoleState | null = null;
  private hug: HugState | null = null;
  /** 雨天是氛围层：不占独演玩具槽，别的玩具开演也照下不误。 */
  private rain: RainState | null = null;
  /**
   * v1.13.0 九件新玩具。八件挤独演槽（tail/knead/roll/book/gift/wish/hopscotch/fortune），
   * 只有雪跟雨一样是氛围层：雪落着的时候她照常玩，两套天气互斥（引擎里各清对方的 until）。
   */
  private tail: TailState | null = null;
  private knead: KneadState | null = null;
  private roll: RollState | null = null;
  private book: BookState | null = null;
  private gift: GiftState | null = null;
  private wish: WishState | null = null;
  private hop: HopState | null = null;
  private snow: SnowState | null = null;
  private fortune: FortuneState | null = null;
  /** 今天那张签（引擎给的同一天同一档）：揭晓时要把档位原样还回去，引擎才认账。 */
  private fortuneToday: { tier: number; line: string } | null = null;
  /** 走路留下的爪印（屏幕坐标，窗口搬走时留在桌布上）。 */
  private prints: PawMark[] = [];
  private lastPrintAt = 0;
  /** 「跟我来」：起点、截止时刻与上一次下发目标，避免每帧重发把她钉在原地。 */
  private follow: { startX: number; until: number; lastTargetX: number; arrived: boolean } | null = null;
  /** 她真正睡着的起点（梦话云要等 1.8s）；-1 = 醒着。 */
  private sleepSince = -1;

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

    this.girlPoses.addEventListener("load", () => {
      this.girlPosesReady = true;
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlPoses.addEventListener("error", () => {
      // 真姿态缺席时回到帧动画里最接近的一段（girlBaseVisualFor 的 fallback），不空窗。
      console.warn("[verge] girl-poses 图集加载失败，待机退回帧动画");
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlPoses.src = GIRL_POSE_ATLASES.poses.src;

    this.girlPoses2.addEventListener("load", () => {
      this.girlPoses2Ready = true;
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlPoses2.addEventListener("error", () => {
      // 只有趴那一族缺席：照旧退回帧动画，坐/蜷不受牵连。
      console.warn("[verge] girl-poses2 图集加载失败，趴/欠身退回帧动画");
      if (this.form === "girl" && !this.paused) this.draw(performance.now());
    }, { once: true });
    this.girlPoses2.src = GIRL_POSE_ATLASES.poses2.src;
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
    if (command === "summon-critter") {
      this.summonCritter(performance.now());
      return;
    }
    if (command === "wander") {
      this.wander(performance.now());
      return;
    }
    const rpsSign = rpsFromCommand(command);
    if (rpsSign) {
      this.startRps(rpsSign, performance.now());
      return;
    }
    if (command === "wand" || command === "bubbles" || command === "leaves" || command === "follow") {
      const now = performance.now();
      if (command === "wand") this.startWand(now);
      else if (command === "bubbles") this.startBubbles(now);
      else if (command === "leaves") this.startLeaves(now);
      else this.startFollow(now);
      return;
    }
    if (command === "box" || command === "laser" || command === "brush"
      || command === "catnip" || command === "plane" || command === "bird") {
      const now = performance.now();
      if (command === "box") this.startBox(now);
      else if (command === "laser") this.startLaser(now);
      else if (command === "brush") this.startBrush(now);
      else if (command === "catnip") this.startCatnip(now);
      else if (command === "plane") this.startPlane(now);
      else this.startBird(now);
      return;
    }
    if (command === "scratch" || command === "bell" || command === "mouse"
      || command === "mole" || command === "hug" || command === "rain") {
      const now = performance.now();
      if (command === "scratch") this.startScratch(now);
      else if (command === "bell") this.startBell(now);
      else if (command === "mouse") this.startMouse(now);
      else if (command === "mole") this.startMole(now);
      else if (command === "hug") this.startHug(now);
      else this.startRain(now);
      return;
    }
    if (command === "tail" || command === "knead" || command === "roll"
      || command === "book" || command === "gift" || command === "wish"
      || command === "hopscotch" || command === "snow" || command === "fortune") {
      const now = performance.now();
      if (command === "tail") this.startTail(now);
      else if (command === "knead") this.startKnead(now);
      else if (command === "roll") this.startRoll(now);
      else if (command === "book") this.startBook(now);
      else if (command === "gift") this.startGift(now);
      else if (command === "wish") this.startWish(now);
      else if (command === "hopscotch") this.startHopscotch(now);
      else if (command === "snow") this.startSnow(now);
      else this.startFortune(now);
      return;
    }
    if (command === "quests" || command === "diary") {
      // 两本账都由引擎开口：渲染端只负责把气泡画出来。
      const now = performance.now();
      const said = command === "quests" ? this.engine?.questsReport(now) : this.engine?.diaryReport(now);
      if (said) {
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (command === "growth") {
      // 成长记录只是说一句：数值口径全在引擎里，渲染端不另算一份。
      const now = performance.now();
      if (this.engine?.growthReport(now)) {
        this.engine.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    const accessory = accessoryFromCommand(command);
    if (accessory) {
      const now = performance.now();
      if (this.engine?.setAccessory(accessory, now)) {
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (command === "feed") this.spawnSnack(performance.now());
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
    return this.scene.clipId();
  }

  /**
   * 猫娘存在感的读数口（CDP 验收用）：只读，不改状态。
   * `presence` 是缓动后的姿态量，`noticeAgeMs`/`dizzyLeft` 是记号层与引擎的同源读数。
   */
  getGirlDiagnostics(now = performance.now()): {
    presence: GirlPresencePose;
    noticeAgeMs: number;
    dizzyLeft: number;
    blush: number;
    clip: string | null;
    /** v1.14.0：当前画的是哪张真姿态（null＝帧动画/手势/矢量路径）。 */
    pose: GirlPoseName | null;
    /** 这一帧实际画出的脸框（绘制空间）。探针用它量坐/蜷时头降到哪。 */
    face: GirlFaceBox;
    /** 正在演的一次性手势的**片段**（v1.14 口径）；null＝基础段或这张手势是真姿态。 */
    gesture: string | null;
    /** 正在演的手势原 id（v1.15：真姿态手势没有片段，只有它会非空）。 */
    gestureId: string | null;
    /** 两套姿态图各自是否到位（v1.15）：探针用它区分「姿态没生效」与「图没加载」。 */
    atlases: { poses: boolean; poses2: boolean };
    fx: { below: number; above: number };
    cushion: number;
    /** v1.13.0 待机编排：探针按 until 等下一段，不用猜时长。 */
    idle: {
      phase: GirlLifePhase;
      /** 这一段的真姿态（life loop 的意图；手势/玩具时可以与此不同，看顶层 `pose`）。 */
      pose: GirlPoseName;
      since: number;
      until: number;
      left: number;
      /** 疲劳 0..1：越高越容易坐/蜷。 */
      weariness: number;
      rests: number;
      bouts: number;
      suspended: boolean;
    };
    toy: { x: number; y: number; vx: number; vy: number; rest: boolean; trail: number } | null;
    bondUpLeft: number;
    patCombo: number;
    startleLeft: number;
    pounces: number;
    teasePending: number;
    /** v1.9.0：装扮、纪念日、伴飞小虫与喂食道具的读数口。 */
    accessory: string;
    milestoneLeft: number;
    milestoneDays: number;
    critter: { kind: string; caught: boolean; x: number; y: number } | null;
    snack: { x: number; y: number; progress: number } | null;
    /** v1.10.0：玩具箱、跟随、爪印、梦话云与成就的读数口。 */
    wand: { x: number; y: number; caught: boolean; left: number } | null;
    /** `spots` 是真窗探针的点击靶：泡泡每帧在飘，读数与点击必须用同一拍坐标。 */
    bubbles: { live: number; left: number; spots: Array<{ x: number; y: number; r: number }> } | null;
    leaves: { left: number } | null;
    rps: { player: string; her: string; outcome: string; left: number } | null;
    /** v1.11.0：纸箱/激光/梳毛/薄荷/纸飞机/小鸟的读数口（探针与点击同一拍坐标）。 */
    box: {
      x: number; y: number; w: number; h: number; phase: string;
      head: { x: number; y: number; w: number; h: number } | null;
      knocks: number; caught: boolean; left: number;
    } | null;
    laser: { x: number; y: number; caught: boolean; left: number } | null;
    brush: { x: number; y: number; s: number; strokes: number; boosts: number; left: number } | null;
    catnip: { x: number; y: number; phase: string; puffs: number; left: number } | null;
    plane: { x: number; y: number; caught: boolean; left: number } | null;
    bird: { x: number; y: number; pose: string; clickable: boolean; left: number } | null;
    /** v1.12.0：猫抓板/铃铛球/发条鼠/打地鼠/抱抱/雨天与呼噜的读数口（与点击同一拍坐标）。 */
    scratch: { x: number; y: number; w: number; h: number; marks: number; phase: string; left: number } | null;
    bell: { x: number; y: number; r: number; rings: number; left: number } | null;
    mouse: { x: number; y: number; r: number; caught: boolean; left: number } | null;
    mole: { x: number; y: number; r: number; hits: number; activeSlot: number | null; left: number } | null;
    hug: { x: number; y: number; taps: number; left: number } | null;
    rain: { amount: number; left: number } | null;
    /** v1.13.0：追尾巴/踩奶/翻跟头/看书/礼物/许愿/跳格子/下雪/抽签的读数口（与点击同一拍坐标）。 */
    tail: { x: number; y: number; phase: string; hits: number; left: number } | null;
    knead: { x: number; y: number; phase: string; beats: number; left: number } | null;
    roll: { x: number; y: number; phase: string; flips: number; left: number } | null;
    book: { x: number; y: number; w: number; h: number; pages: number; phase: string; left: number } | null;
    gift: { x: number; y: number; w: number; h: number; opened: boolean; phase: string; left: number } | null;
    wish: { x: number; y: number; phase: string; wished: boolean; left: number } | null;
    hopscotch: {
      squares: Array<{ x: number; y: number; w: number; h: number }>;
      next: number; left: number;
    } | null;
    snow: {
      amount: number; built: boolean; left: number;
      piles: Array<{ x: number; y: number; w: number; h: number }>;
    } | null;
    fortune: { x: number; y: number; tier: number; revealed: boolean; phase: string; left: number } | null;
    purrLeft: number;
    prints: number;
    follow: { left: number; lastTargetX: number; arrived: boolean } | null;
    achievements: string[];
    achievement: { id: string; left: number } | null;
    stats: CompanionSnapshot["stats"];
    /** 她睡着的起点（performance.now）；-1＝醒着。 */
    sleepSince: number;
    /** 距下一拍深夜提醒询问还有多久（真窗验收要卡在拍点上伪时钟）。 */
    nightCheckInMs: number;
  } {
    const snapshot = this.engine?.getSnapshot();
    const face = this.girlFaceAt(now);
    const floorY = this.cat.center.y;
    const facing = this.cat.facing ?? 1;
    let boxDiag: {
      x: number; y: number; w: number; h: number; phase: string;
      head: { x: number; y: number; w: number; h: number } | null;
      knocks: number; caught: boolean; left: number;
    } | null = null;
    if (this.box) {
      const phase = boxPhase(this.box, now);
      if (phase !== "gone") {
        const rect = boxRectFor(this.box, now, face, floorY);
        const head = boxHeadRect(this.box, now, face);
        boxDiag = {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
          w: rect.w,
          h: rect.h,
          phase,
          head: { x: head.x + head.w / 2, y: head.y + head.h / 2, w: head.w, h: head.h },
          knocks: this.box.knocks,
          caught: this.box.poppedAt >= 0,
          left: this.box.poppedAt >= 0
            ? Math.max(0, BOX_POP_MS - (now - this.box.poppedAt))
            : Math.max(0, BOX_MS - (now - this.box.bornAt)),
        };
      }
    }
    let laserDiag: { x: number; y: number; caught: boolean; left: number } | null = null;
    if (this.laser && laserAlive(this.laser, now)) {
      const dot = laserAt(this.laser, now, laserBoundsFor(face, floorY));
      laserDiag = {
        x: dot.x,
        y: dot.y,
        caught: this.laser.caughtAt >= 0,
        left: this.laser.caughtAt >= 0
          ? Math.max(0, LASER_CATCH_MS - (now - this.laser.caughtAt))
          : Math.max(0, LASER_MS - (now - this.laser.bornAt)),
      };
    }
    let brushDiag: { x: number; y: number; s: number; strokes: number; boosts: number; left: number } | null = null;
    if (this.brush && brushAlive(this.brush, now)) {
      const sweep = brushSweep(this.brush, now, face, facing, floorY);
      brushDiag = {
        x: sweep.x,
        y: sweep.y,
        s: sweep.s,
        strokes: brushStrokes(this.brush, now),
        boosts: this.brush.boosts,
        left: Math.max(0, BRUSH_MS - (now - this.brush.bornAt)),
      };
    }
    let catnipDiag: { x: number; y: number; phase: string; puffs: number; left: number } | null = null;
    if (this.catnip) {
      const phase = catnipPhase(this.catnip, now);
      if (phase !== "gone") {
        const sprig = catnipAt(this.catnip, now, face, floorY, facing);
        catnipDiag = {
          x: sprig.x,
          y: sprig.y,
          phase,
          puffs: this.catnip.puffs,
          left: Math.max(0, CATNIP_MS - (now - this.catnip.bornAt)),
        };
      }
    }
    let planeDiag: { x: number; y: number; caught: boolean; left: number } | null = null;
    if (this.plane && planeAlive(this.plane, now)) {
      const pos = planeAt(this.plane, now, face, floorY);
      planeDiag = {
        x: pos.x,
        y: pos.y,
        caught: this.plane.caughtAt >= 0,
        left: this.plane.caughtAt >= 0
          ? Math.max(0, PLANE_CATCH_MS - (now - this.plane.caughtAt))
          : Math.max(0, PLANE_MS - (now - this.plane.bornAt)),
      };
    }
    let birdDiag: { x: number; y: number; pose: string; clickable: boolean; left: number } | null = null;
    if (this.bird) {
      const pos = birdAt(this.bird, now, face);
      if (pos.pose !== "gone") {
        birdDiag = {
          x: pos.x,
          y: pos.y,
          pose: pos.pose,
          clickable: birdClickable(this.bird, now, face),
          left: Math.max(0, BIRD_MS - (now - this.bird.bornAt)),
        };
      }
    }
    let scratchDiag: {
      x: number; y: number; w: number; h: number; marks: number; phase: string; left: number;
    } | null = null;
    if (this.scratch) {
      const phase = scratchPhase(this.scratch, now);
      if (phase !== "gone") {
        const rect = scratchRectFor(this.scratch, now, face, floorY);
        scratchDiag = {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
          w: rect.w,
          h: rect.h,
          marks: scratchMarks(this.scratch, now),
          phase,
          left: Math.max(0, SCRATCH_MS - (now - this.scratch.bornAt)),
        };
      }
    }
    let bellDiag: { x: number; y: number; r: number; rings: number; left: number } | null = null;
    if (this.bell && bellAlive(this.bell, now)) {
      const pos = bellAt(this.bell, now, face, floorY);
      bellDiag = {
        x: pos.x,
        y: pos.y,
        r: bellRadius(face),
        rings: this.bell.rings,
        left: Math.max(0, BELL_MS - (now - this.bell.bornAt)),
      };
    }
    let mouseDiag: { x: number; y: number; r: number; caught: boolean; left: number } | null = null;
    if (this.mouse && mouseAlive(this.mouse, now)) {
      const pos = mouseAt(this.mouse, now, face, floorY);
      mouseDiag = {
        x: pos.x,
        y: pos.y,
        r: mouseRadius(face),
        caught: this.mouse.caughtAt >= 0,
        left: Math.max(0, MOUSE_MS - (now - this.mouse.bornAt)),
      };
    }
    let moleDiag: {
      x: number; y: number; r: number; hits: number; activeSlot: number | null; left: number;
    } | null = null;
    if (this.mole && moleAlive(this.mole, now)) {
      const head = moleHeadAt(this.mole, now, face, floorY);
      moleDiag = {
        x: head ? head.x : face.cx,
        y: head ? head.y : floorY - 3,
        r: head ? head.r : Math.max(4.2, Math.min(7, face.w * 0.12)),
        hits: this.mole.hits,
        activeSlot: head ? head.active.slot : null,
        left: Math.max(0, MOLE_MS - (now - this.mole.bornAt)),
      };
    }
    let hugDiag: { x: number; y: number; taps: number; left: number } | null = null;
    if (this.hug && hugAlive(this.hug, now)) {
      hugDiag = {
        x: face.cx,
        y: face.bottom + face.h * 0.3,
        taps: this.hug.taps,
        left: Math.max(0, HUG_MS - (now - this.hug.bornAt)),
      };
    }
    let rainDiag: { amount: number; left: number } | null = null;
    if (this.rain && rainAlive(this.rain, now)) {
      rainDiag = {
        amount: rainAmount(this.rain, now),
        left: Math.max(0, RAIN_MS - (now - this.rain.bornAt)),
      };
    }
    let tailDiag: { x: number; y: number; phase: string; hits: number; left: number } | null = null;
    if (this.tail) {
      const phase = tailPhase(this.tail, now);
      if (phase !== "gone") {
        const tip = tailTipAt(this.tail, now, face, floorY);
        tailDiag = {
          x: tip.x,
          y: tip.y,
          phase,
          hits: this.tail.hits,
          left: Math.max(0, TAIL_MS - (now - this.tail.bornAt)),
        };
      }
    }
    let kneadDiag: { x: number; y: number; phase: string; beats: number; left: number } | null = null;
    if (this.knead) {
      const phase = kneadPhase(this.knead, now);
      if (phase !== "gone") {
        const pad = kneadPads(this.knead, now, face, floorY)[0];
        kneadDiag = {
          x: pad.x,
          y: pad.y,
          phase,
          beats: this.knead.beats,
          left: Math.max(0, KNEAD_MS - (now - this.knead.bornAt)),
        };
      }
    }
    let rollDiag: { x: number; y: number; phase: string; flips: number; left: number } | null = null;
    if (this.roll) {
      const phase = rollPhase(this.roll, now);
      if (phase !== "gone") {
        rollDiag = {
          x: face.cx,
          y: face.bottom + face.h * 0.3,
          phase,
          flips: this.roll.flips,
          left: Math.max(0, ROLL_MS - (now - this.roll.bornAt)),
        };
      }
    }
    let bookDiag: {
      x: number; y: number; w: number; h: number; pages: number; phase: string; left: number;
    } | null = null;
    if (this.book) {
      const phase = bookPhase(this.book, now);
      if (phase !== "gone") {
        const rect = bookRectFor(this.book, now, face);
        bookDiag = {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
          w: rect.w,
          h: rect.h,
          pages: this.book.page,
          phase,
          left: Math.max(0, BOOK_MS - (now - this.book.bornAt)),
        };
      }
    }
    let giftDiag: {
      x: number; y: number; w: number; h: number; opened: boolean; phase: string; left: number;
    } | null = null;
    if (this.gift) {
      const phase = giftPhase(this.gift, now);
      if (phase !== "gone") {
        const rect = giftRectFor(this.gift, now, face, floorY);
        giftDiag = {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h / 2,
          w: rect.w,
          h: rect.h,
          opened: this.gift.openedAt >= 0,
          phase,
          left: Math.max(0, GIFT_MS - (now - this.gift.bornAt)),
        };
      }
    }
    let wishDiag: { x: number; y: number; phase: string; wished: boolean; left: number } | null = null;
    if (this.wish) {
      const phase = wishPhase(this.wish, now);
      if (phase !== "gone") {
        const star = wishStarAt(this.wish, now, face);
        wishDiag = {
          x: star.x,
          y: star.y,
          phase,
          wished: this.wish.wishedAt >= 0,
          left: Math.max(0, WISH_MS - (now - this.wish.bornAt)),
        };
      }
    }
    let hopDiag: {
      squares: Array<{ x: number; y: number; w: number; h: number }>;
      next: number; left: number;
    } | null = null;
    if (this.hop && hopAlive(this.hop, now)) {
      const squares = [0, 1, 2].map((index) => {
        const sq = hopSquareAt(this.hop!, now, face, floorY, index as 0 | 1 | 2);
        return { x: sq.x + sq.w / 2, y: sq.y + sq.h / 2, w: sq.w, h: sq.h };
      });
      hopDiag = {
        squares,
        next: this.hop.next,
        left: Math.max(0, HOP_MS - (now - this.hop.bornAt)),
      };
    }
    let snowDiag: {
      amount: number; built: boolean; left: number;
      piles: Array<{ x: number; y: number; w: number; h: number }>;
    } | null = null;
    if (this.snow && snowAlive(this.snow, now)) {
      snowDiag = {
        amount: snowAmount(this.snow, now),
        built: snowmanBuilt(this.snow),
        left: Math.max(0, SNOW_MS - (now - this.snow.bornAt)),
        piles: [0, 1, 2].map((i) => {
          const pile = snowPileAt(this.snow!, now, face, floorY, i);
          return { x: pile.x, y: pile.y, w: pile.w, h: pile.h };
        }),
      };
    }
    let fortuneDiag: { x: number; y: number; tier: number; revealed: boolean; phase: string; left: number } | null = null;
    if (this.fortune) {
      const phase = fortunePhase(this.fortune, now);
      if (phase !== "gone") {
        const slip = fortuneSlipAt(this.fortune, now, face);
        fortuneDiag = {
          x: slip.x + slip.w / 2,
          y: slip.y + slip.h / 2,
          tier: this.fortuneToday?.tier ?? 0,
          revealed: this.fortune.revealed,
          phase,
          left: Math.max(0, FORTUNE_MS - (now - this.fortune.bornAt)),
        };
      }
    }
    return {
      presence: { ...this.presencePose },
      noticeAgeMs: this.noticeAt < 0 ? -1 : now - this.noticeAt,
      dizzyLeft: snapshot?.dizzyLeft ?? 0,
      blush: this.blush,
      clip: this.getGirlClipId(),
      pose: this.form === "girl" ? this.scene.poseId() : null,
      face: this.lastFace ?? this.girlFaceAt(now),
      gesture: this.animGesture?.clipId ?? null,
      gestureId: this.animGesture?.id ?? null,
      atlases: { poses: this.girlPosesReady, poses2: this.girlPoses2Ready },
      fx: { ...this.lastFxCounts },
      cushion: this.cushion,
      idle: {
        phase: this.idle.phase,
        pose: girlIdlePose(this.idle.phase),
        since: this.idle.since,
        until: this.idle.until,
        left: girlIdleLeft(this.idle, now),
        weariness: this.idle.weariness,
        rests: this.idle.rests,
        bouts: this.idle.bouts,
        suspended: this.idleSuspended,
      },
      toy: this.toyState
        ? {
            x: this.toyState.x, y: this.toyState.y,
            vx: this.toyState.vx, vy: this.toyState.vy,
            rest: this.toyState.rest, trail: this.toyState.trail.length,
          }
        : null,
      bondUpLeft: snapshot?.bondUpLeft ?? 0,
      patCombo: snapshot?.patCombo ?? 0,
      startleLeft: snapshot?.startleLeft ?? 0,
      pounces: snapshot?.pounces ?? 0,
      teasePending: this.tease.pending,
      accessory: snapshot?.accessory ?? "none",
      milestoneLeft: snapshot?.milestoneLeft ?? 0,
      milestoneDays: snapshot?.milestoneDays ?? 0,
      critter: this.critter
        ? {
            kind: this.critter.kind,
            caught: this.critter.caughtAt >= 0,
            x: this.critter.x,
            y: this.critter.y,
          }
        : null,
      snack: this.snack
        ? {
            x: this.snack.x, y: this.snack.y,
            progress: Math.max(0, Math.min(1, (now - this.snack.bornAt) / SNACK_MS)),
          }
        : null,
      wand: this.wand
        ? {
            ...wandTip(this.wand, now, this.girlFaceAt(now), this.cat.facing ?? 1),
            caught: this.wand.caughtAt >= 0,
            left: Math.max(0, WAND_MS - (now - this.wand.bornAt)),
          }
        : null,
      bubbles: this.bubbles
        ? {
            live: liveBubbleCount(this.bubbles, now),
            left: Math.max(0, BUBBLES_MS - (now - this.bubbles.bornAt)),
            spots: this.bubbles.bubbles
              .filter((b) => b.poppedAt < 0)
              .map((b) => bubblePos(this.bubbles!, b, now, this.cat.center.y)),
          }
        : null,
      leaves: this.leaves
        ? { left: Math.max(0, LEAVES_MS - (now - this.leaves.bornAt)) }
        : null,
      rps: this.rps && now - this.rps.bornAt < RPS_MS
        ? { ...this.rps, left: Math.max(0, RPS_MS - (now - this.rps.bornAt)) }
        : null,
      box: boxDiag,
      laser: laserDiag,
      brush: brushDiag,
      catnip: catnipDiag,
      plane: planeDiag,
      bird: birdDiag,
      scratch: scratchDiag,
      bell: bellDiag,
      mouse: mouseDiag,
      mole: moleDiag,
      hug: hugDiag,
      rain: rainDiag,
      tail: tailDiag,
      knead: kneadDiag,
      roll: rollDiag,
      book: bookDiag,
      gift: giftDiag,
      wish: wishDiag,
      hopscotch: hopDiag,
      snow: snowDiag,
      fortune: fortuneDiag,
      purrLeft: snapshot?.purrLeft ?? 0,
      prints: this.prints.length,
      follow: this.follow
        ? { left: Math.max(0, this.follow.until - now), lastTargetX: this.follow.lastTargetX, arrived: this.follow.arrived }
        : null,
      achievements: snapshot?.achievements ?? [],
      achievement: snapshot?.achievementId && snapshot.achievementLeft > 0
        ? { id: snapshot.achievementId, left: snapshot.achievementLeft }
        : null,
      stats: snapshot?.stats ?? { ...EMPTY_STATS },
      sleepSince: this.sleepSince,
      nightCheckInMs: Math.max(0, NIGHT_NUDGE_POLL_MS - (now - this.lastNightNudgeCheckAt)),
    };
  }

  /**
   * 脸红的唯一目标表：片名优先（coverFace 已映射成 shy、shiver 映射成 wink），
   * 其次是「正在被摸」。睡着/免打扰不红——闭着眼脸红读不出来，只会像脏点。
   */
  private girlBlushTarget(snapshot: CompanionSnapshot | null): number {
    if (this.cat.mood === "sleep" || this.quiet) return 0;
    const clip = this.scene.clipId();
    if (clip === "shy" || clip === "sitShy") return 0.95;
    if (clip === "wink") return 0.55;
    if (clip === "happy" || clip === "wave" || clip === "peace") return 0.5;
    if (this.scene.poseId() === "joy") return 0.5;
    if (snapshot?.activity === "pet") return 0.35 + 0.35 * Math.sin(Math.PI * snapshot.activityProgress);
    if (this.cat.mood === "happy") return 0.3;
    return 0;
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
    const now = performance.now();
    this.gazeTarget = point;
    // 追光标只长在猫娘上：四足没有「扑」的骨架，硬搬会变成整窗瞬移。
    if (this.form === "girl" && point) this.maybePounce(point, now);
    // 眼球是连续动画：立即重绘一帧，别等 4fps 闸（最坏 250ms，看起来像卡住）。
    if (!this.paused) this.draw(now);
  }

  /**
   * 光标快速甩两下 → 引擎的扑。渲染端只做两件事：换算窗口坐标、给可去范围；
   * 「累不累、能不能扑」全由引擎（冷却/睡着/安静/被拖）与 TeaseTracker（甩得够不够快）判。
   */
  private maybePounce(point: Point2, now: number): void {
    const engine = this.engine;
    if (!engine || !this.catOrigin || !this.workArea) return;
    const zoom = this.zoom || 1;
    const w = this.profile.base.width * zoom;
    const h = this.profile.base.height * zoom;
    // 只对她身边 190px 内的快速甩动起反应：隔着半屏挥鼠标不该让她突然起跑。
    if (Math.abs(point[0] - w / 2) > 190 || Math.abs(point[1] - h / 2) > 240) return;
    if (!this.tease.feed(point[0], point[1], now)) return;
    engine.pounce(this.catOrigin.x + point[0], now, {
      minX: this.workArea.x,
      maxX: this.workArea.x + this.workArea.width - w,
    });
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
    if (this.bubbleActive || this.bubbleExpand > 0.001) {
      // 「跟我来」就是一路说着话跟过去：气泡开着也得允许迈步。
      if (this.follow === null) return false;
    }
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

    // 深夜提醒：每 30s 问一次；同一晚 45min 只一次由引擎去重。放在 update 之前，
    // 这样 setBubble 的句子能立刻出现在这一帧的快照里，不用等下一拍。
    if (this.form === "girl" && now - this.lastNightNudgeCheckAt >= NIGHT_NUDGE_POLL_MS) {
      this.lastNightNudgeCheckAt = now;
      engine.nightNudge(now);
    }

    const snapshot = engine.update(now, {
      workArea: this.workArea,
      // 漫游夹的是「窗口」不是「猫」：catOrigin 是窗口原点，尺寸含档位与 zoom。
      size: { width: this.profile.base.width * this.zoom, height: this.profile.base.height * this.zoom },
      canRoam: this.canRoam(),
    });
    this.tickFollow(now, snapshot);

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

  /**
   * 毛线球的一生：第一次要在 girl 形态里落地才生成（她还没出现时不该先有一只球）。
   * 位置取她脚边前侧；`x` 收进基址窗，球不会被画到窗外去。
   */
  private ensureToy(now: number): ToyState {
    if (!this.toyState) {
      const w = this.profile.base.width;
      const facing = this.cat.facing ?? 1;
      const x = Math.min(w - 12, Math.max(12, this.cat.center.x + facing * 26));
      this.toyState = createToy(x, this.cat.center.y);
      this.lastToyAt = null;
      this.nextToyBatAt = now + 12_000 + Math.random() * 10_000;
    }
    return this.toyState;
  }

  /**
   * 每帧推进毛线球 + 她自己偶尔扒拉一下。
   * 球在**绘制空间**里滚：`floorY` 是她的脚线，左/右以基址宽为界（气泡展开不算她家变宽）。
   * 自动扒拉只在她闲着、球在脚边、且不是安静/睡着时发生——一个睡着的她不会有手去拨球。
   */
  private tickToy(now: number, snapshot: CompanionSnapshot | null): ToyOps | null {
    if (this.form !== "girl") {
      this.lastToyAt = null;
      return null;
    }
    const toy = this.ensureToy(now);
    const dt = this.lastToyAt === null ? 0 : Math.max(0, now - this.lastToyAt);
    this.lastToyAt = now;
    const floorY = this.cat.center.y;
    const w = this.profile.base.width;
    stepToy(toy, dt / 1000, { left: 5, right: w - 5, floorY });

    const idle = snapshot !== null && (snapshot.activity === "idle" || snapshot.activity === "rest");
    const near = Math.abs(toy.x - this.cat.center.x) <= 40;
    if (toy.rest && idle && near && !this.quiet && this.cat.mood !== "sleep" && now >= this.nextToyBatAt) {
      if (this.engine?.toyBat(now, true)) {
        kickToy(toy, this.cat.facing ?? 1, TOY.kickPower * (0.5 + Math.random() * 0.25));
        this.nextToyBatAt = now + 14_000 + Math.random() * 12_000;
      } else {
        // 她这会儿正忙着别的（手势/动作）：过几秒再试，别每帧都问。
        this.nextToyBatAt = now + 8_000;
      }
    }
    return buildToyOps({ state: toy, floorY });
  }

  /**
   * 伴飞小虫的一生：闲着且醒着的时候自己招一只（12s 后飞走），
   * 或由右键「放只小虫逗逗她」当场放一只。四足形态恒没有（她没有耳朵去听翅膀）。
   */
  private tickCritter(now: number, face: ReturnType<typeof girlFaceBox>, snapshot: CompanionSnapshot | null): DrawOp[] {
    if (this.form !== "girl") {
      this.critter = null;
      return [];
    }
    if (this.critter) {
      stepCritter(this.critter, now, face);
      if (this.critter.caughtAt >= 0) {
        if (now - this.critter.caughtAt > CATCH_FLASH_MS) this.critter = null;
      } else if (!critterAlive(this.critter, now)) {
        this.critter = null;
        this.nextCritterAt = now + 30_000 + Math.random() * 45_000;
      }
    }
    const idle = snapshot !== null
      && (snapshot.activity === "idle" || snapshot.activity === "rest")
      && snapshot.mood !== "sleep";
    if (this.nextCritterAt === 0) this.nextCritterAt = now + 45_000 + Math.random() * 40_000;
    if (!this.critter && idle && !this.quiet && now >= this.nextCritterAt) {
      this.summonCritter(now, false);
    }
    return this.critter ? buildCritterOps(this.critter, now, face) : [];
  }

  /**
   * 当场放一只小虫（菜单/自主共用）。`manual` 决定要不要立刻重开一帧：
   * 自主调用发生在 draw 里，重画会自指。
   */
  private summonCritter(now: number, redraw = true): boolean {
    if (this.form !== "girl") return false;
    const kind = critterKindFor(new Date(Date.now()).getHours());
    this.critter = spawnCritter({ now, kind, seed: Math.random() });
    this.nextCritterAt = now + CRITTER_LIFE_MS + 30_000 + Math.random() * 45_000;
    if (redraw && !this.paused) this.draw(now);
    return true;
  }

  /** 喂食时的小鱼干：只是一段道具动画，数值仍由引擎结算。 */
  private spawnSnack(now: number): void {
    if (this.form !== "girl" || this.quiet || this.cat.mood === "sleep") return;
    this.snack = createSnack(now, this.girlFaceAt(now), this.cat.center.y, this.cat.facing ?? 1);
  }

  private tickSnack(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.snack) {
      this.snack = null;
      return [];
    }
    if (!snackAlive(this.snack, now)) {
      this.snack = null;
      return [];
    }
    stepSnack(this.snack, now, face, this.cat.center.y);
    return buildSnackOps(this.snack, now, face);
  }

  /**
   * 陪她散一段步：落点由 `wanderTarget` 现算（贴着屏边会自己掉头），
   * 走路由引擎接管——和自主漫游同一条物理与落盘链。
   */
  private wander(now: number): boolean {
    if (this.form !== "girl" || !this.engine || !this.catOrigin || !this.workArea) return false;
    const target = wanderTarget({
      origin: this.catOrigin,
      size: { width: this.profile.base.width * this.zoom, height: this.profile.base.height * this.zoom },
      workArea: this.workArea,
      facing: this.cat.facing ?? 1,
      random: Math.random(),
    });
    if (!target) return false;
    // 气泡开着时 canRoam 恒 false（引擎不许边说话边走），stepWalk 下一帧就会把 walk
    // 掰回 idle——菜单点了像没反应。散步是用户明确下的令：先把话收掉再迈步。
    this.engine.dismissBubble(now);
    this.bubbleActive = false;
    this.bubbleExpand = 0;
    this.bubbleBox = null;
    this.engine.roamTo(target);
    if (!this.paused) this.draw(now);
    return true;
  }

  /**
   * 当前脸框（绘制空间）：所有头顶道具共用同一把锚尺。
   * 姿态是静帧、动画按帧采样——两种幕的脸框都从各自那份逐格实测元数据来。
   */
  private girlFaceAt(now: number): GirlFaceBox {
    const shown = this.scene.sample(now).current;
    return this.faceForShown(shown, girlPoseBodyFor(this.cat), girlAnimBodyFor(this.cat));
  }

  private faceForShown(
    shown: GirlShown, poseBody: GirlPoseBody, animBody: GirlAnimBody,
  ): GirlFaceBox {
    return shown.kind === "pose"
      ? girlPoseFaceBox(poseBody, shown.id)
      : girlFaceBox(animBody, shown.index);
  }

  /** 菜单可能比下一帧更早到达：睡着/被拖/被抛要读引擎当下状态，不能只看上一帧的 cat.mood。 */
  private girlBusyForToys(): boolean {
    const activity = this.engine?.getSnapshot().activity;
    return this.cat.mood === "sleep" || activity === "sleep" || activity === "drag" || activity === "thrown";
  }

  /**
   * 起一件独演玩具前，先把上一件收干净：头顶/脚边只留一条时间线。
   * 被顶掉的那一件不结算（梳毛中途换玩具＝没梳完，不计数也不说话）。
   */
  private clearSoloToys(): void {
    this.wand = null;
    this.bubbles = null;
    this.leaves = null;
    this.rps = null;
    this.box = null;
    this.laser = null;
    this.brush = null;
    this.catnip = null;
    this.plane = null;
    this.bird = null;
    this.scratch = null;
    this.bell = null;
    this.mouse = null;
    this.mole = null;
    this.hug = null;
    this.tail = null;
    this.knead = null;
    this.roll = null;
    this.book = null;
    this.gift = null;
    this.wish = null;
    this.hop = null;
    this.fortune = null;
    this.fortuneToday = null;
  }

  /** 本地闸门（安静/拖拽/睡着/被抛）；引擎另有更细的闸（眩晕/活动中）。 */
  private soloToyAllowed(): boolean {
    return this.form === "girl" && !this.quiet && !this.dragging && !this.girlBusyForToys();
  }

  private startWand(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    this.clearSoloToys();
    this.wand = createWand(now);
    this.engine?.say("羽毛在这儿——", 1, now, true);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBubbles(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    this.clearSoloToys();
    this.bubbles = createBubbles(now, this.girlFaceAt(now));
    this.engine?.say("看，泡泡——", 1, now, true);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startLeaves(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (!this.engine?.leafToss(now)) return false;
    this.clearSoloToys();
    this.leaves = createLeaves(now, this.girlFaceAt(now));
    if (!this.paused) this.draw(now);
    return true;
  }

  private startRps(sign: "rock" | "scissors" | "paper", now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    const result = this.engine?.rpsPlay(sign, now);
    if (!result) return false;
    this.clearSoloToys();
    this.rps = { ...result, bornAt: now };
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBox(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.boxStart(now)) return false;
    this.clearSoloToys();
    this.box = createBox(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startLaser(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.laserStart(now)) return false;
    this.clearSoloToys();
    this.laser = createLaser(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBrush(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.brushStart(now)) return false;
    this.clearSoloToys();
    this.brush = createBrush(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startCatnip(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.catnipStart(now)) return false;
    this.clearSoloToys();
    this.catnip = createCatnip(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startPlane(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.planeStart(now)) return false;
    this.clearSoloToys();
    this.plane = createPlane(now, this.cat.facing ?? 1);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBird(now: number): boolean {
    // 小鸟只是来看她一眼：睡着也允许落在窗框上，只有被拖/被抛时不许。
    if (this.form !== "girl" || this.quiet || this.dragging) return false;
    const activity = this.engine?.getSnapshot().activity;
    if (activity === "drag" || activity === "thrown") return false;
    if (this.engine && !this.engine.birdVisit(now)) return false;
    this.clearSoloToys();
    this.bird = createBird(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startScratch(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.scratchStart(now)) return false;
    this.clearSoloToys();
    this.scratch = createScratch(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBell(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.bellStart(now)) return false;
    this.clearSoloToys();
    this.bell = createBell(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startMouse(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.mouseStart(now)) return false;
    this.clearSoloToys();
    this.mouse = createMouse(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startMole(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.moleStart(now)) return false;
    this.clearSoloToys();
    this.mole = createMole(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startHug(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.hugStart(now)) return false;
    this.clearSoloToys();
    this.hug = createHug(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startRain(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.rainStart(now)) return false;
    // 雨是背景：不 clearSoloToys，她可以一边玩一边听雨。
    this.rain = createRain(now);
    // 引擎那侧的互斥已经清了 snowUntil；渲染端这份粒子也得当场收，不然两套天气同屏。
    this.snow = null;
    if (!this.paused) this.draw(now);
    return true;
  }

  private startTail(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.tailStart(now)) return false;
    this.clearSoloToys();
    this.tail = createTail(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startKnead(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.kneadStart(now)) return false;
    this.clearSoloToys();
    this.knead = createKnead(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startRoll(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.rollStart(now)) return false;
    this.clearSoloToys();
    this.roll = createRoll(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startBook(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.bookStart(now)) return false;
    this.clearSoloToys();
    this.book = createBook(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startGift(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.giftStart(now)) return false;
    this.clearSoloToys();
    this.gift = createGift(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startWish(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.wishStart(now)) return false;
    this.clearSoloToys();
    this.wish = createWish(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startHopscotch(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.hopscotchStart(now)) return false;
    this.clearSoloToys();
    this.hop = createHopscotch(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startSnow(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    if (this.engine && !this.engine.snowStart(now)) return false;
    // 雪跟雨一样是氛围层：不占独演槽，雪里也能滚铃铛球。
    this.rain = null;
    this.snow = createSnow(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  /**
   * 每日抽签：签是「今天的那张」，由引擎落盘并按天固定——渲染端只拿了结果挂到签纸上。
   * 引擎拒绝（安静/忙/四足）时连签纸都不挂，不制造一张假签。
   */
  private startFortune(now: number): boolean {
    if (!this.soloToyAllowed()) return false;
    const today = this.engine?.fortuneStart(now) ?? null;
    if (!today) return false;
    this.clearSoloToys();
    this.fortuneToday = today;
    this.fortune = createFortune(now);
    if (!this.paused) this.draw(now);
    return true;
  }

  private startFollow(now: number): boolean {
    if (this.form !== "girl" || !this.engine || !this.catOrigin) return false;
    if (!this.engine.followStart(now)) return false;
    this.follow = {
      startX: this.catOrigin.x,
      until: now + FOLLOW_MS,
      lastTargetX: this.catOrigin.x,
      arrived: false,
    };
    if (!this.paused) this.draw(now);
    return true;
  }

  /**
   * 「跟我来」每帧一拍：光标横向落点 → 目标窗口原点；只有目标挪够远才重发漫游。
   * 到时/睡着/被拖/agent 忙/用户点她都收工——跟随是邀请，不是自动驾驶。
   */
  private tickFollow(now: number, snapshot: CompanionSnapshot): void {
    const follow = this.follow;
    if (!follow) return;
    const timeout = now >= follow.until;
    const blocked = this.form !== "girl" || this.quiet || this.dragging || this.workTier !== null
      || snapshot.activity === "sleep" || snapshot.activity === "drag" || snapshot.activity === "thrown";
    if (timeout || blocked) {
      this.follow = null;
      if (timeout) this.engine?.followStop(now, false);
      return;
    }
    if (!this.catOrigin || !this.workArea || !this.gazeTarget) return;
    const zoom = this.zoom || 1;
    const width = this.profile.base.width * zoom;
    const targetX = followTargetX(follow.startX, this.gazeTarget[0], width, {
      minX: this.workArea.x,
      maxX: this.workArea.x + this.workArea.width - width,
    });
    if (followArrived(targetX, this.catOrigin.x)) {
      if (!follow.arrived) {
        follow.arrived = true;
        this.engine?.followStop(now, true);
      }
      return;
    }
    follow.arrived = false;
    if (followNeedsStep(targetX, follow.lastTargetX)) {
      follow.lastTargetX = targetX;
      this.engine?.roamTo({ x: targetX, y: this.catOrigin.y }, now);
    }
  }

  private tickWand(now: number): DrawOp[] {
    if (this.form !== "girl" || !this.wand) {
      this.wand = null;
      return [];
    }
    if (!wandAlive(this.wand, now)) {
      const missed = this.wand.caughtAt < 0;
      this.wand = null;
      if (missed) this.engine?.wandEnd(now, false);
      return [];
    }
    return buildWandOps(this.wand, now, this.girlFaceAt(now), this.cat.facing ?? 1);
  }

  private tickBubbles(now: number): DrawOp[] {
    if (this.form !== "girl" || !this.bubbles) {
      this.bubbles = null;
      return [];
    }
    if (!bubblesAlive(this.bubbles, now)) {
      this.bubbles = null;
      return [];
    }
    return buildToyBubbleOps(this.bubbles, now, this.cat.center.y);
  }

  private tickLeaves(now: number): DrawOp[] {
    if (this.form !== "girl" || !this.leaves) {
      this.leaves = null;
      return [];
    }
    if (!leavesAlive(this.leaves, now)) {
      this.leaves = null;
      return [];
    }
    return buildLeafOps(this.leaves, now, this.girlFaceAt(now), this.cat.center.y);
  }

  private tickRps(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.rps) {
      this.rps = null;
      return [];
    }
    const age = now - this.rps.bornAt;
    if (age >= RPS_MS) {
      this.rps = null;
      return [];
    }
    const ops = buildRpsOps(this.rps.her, age, face, now / 1000);
    ops.push(...buildRpsPlayerOps(this.rps.player, face, this.cat.center.y));
    return ops;
  }

  private tickBox(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.box) {
      this.box = null;
      return [];
    }
    if (!boxAlive(this.box, now)) {
      this.box = null;
      return [];
    }
    return buildBoxOps(this.box, now, face, this.cat.center.y);
  }

  private tickLaser(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.laser) {
      this.laser = null;
      return [];
    }
    if (!laserAlive(this.laser, now)) {
      const missed = this.laser.caughtAt < 0;
      this.laser = null;
      if (missed) this.engine?.laserEnd(now, false);
      return [];
    }
    return buildLaserOps(this.laser, now, face, this.cat.center.y);
  }

  private tickBrush(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.brush) {
      this.brush = null;
      return [];
    }
    if (!brushAlive(this.brush, now)) {
      // 六秒正好四趟：走到自然收尾就是整轮梳完；中途被别的玩具顶掉的不结算。
      this.brush = null;
      this.engine?.brushEnd(now, true);
      return [];
    }
    return buildBrushOps(this.brush, now, face, this.cat.facing ?? 1, this.cat.center.y);
  }

  private tickCatnip(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.catnip) {
      this.catnip = null;
      return [];
    }
    if (!catnipAlive(this.catnip, now)) {
      this.catnip = null;
      this.engine?.catnipEnd(now, true);
      return [];
    }
    return buildCatnipOps(this.catnip, now, face, this.cat.center.y, this.cat.facing ?? 1);
  }

  private tickPlane(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.plane) {
      this.plane = null;
      return [];
    }
    if (!planeAlive(this.plane, now)) {
      const missed = this.plane.caughtAt < 0;
      this.plane = null;
      if (missed) this.engine?.planeEnd(now, false);
      return [];
    }
    return buildPlaneOps(this.plane, now, face, this.cat.center.y);
  }

  private tickBird(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.bird) {
      this.bird = null;
      return [];
    }
    if (!birdAlive(this.bird, now, face)) {
      this.bird = null;
      return [];
    }
    return buildBirdOps(this.bird, now, face);
  }

  private tickScratch(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.scratch) {
      this.scratch = null;
      return [];
    }
    if (!scratchAlive(this.scratch, now)) {
      this.scratch = null;
      // 整整一轮走完才算磨过爪；被别的玩具顶掉的已在 clearSoloToys 里静默作废。
      this.engine?.scratchEnd(now, true);
      return [];
    }
    return buildScratchOps(this.scratch, now, face, this.cat.center.y);
  }

  private tickBell(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.bell) {
      this.bell = null;
      return [];
    }
    if (!bellAlive(this.bell, now)) {
      const rings = this.bell.rings;
      this.bell = null;
      this.engine?.bellEnd(now, rings);
      return [];
    }
    return buildBellOps(this.bell, now, face, this.cat.center.y);
  }

  private tickMouse(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.mouse) {
      this.mouse = null;
      return [];
    }
    if (!mouseAlive(this.mouse, now)) {
      const missed = this.mouse.caughtAt < 0;
      this.mouse = null;
      if (missed) this.engine?.mouseMiss(now);
      return [];
    }
    return buildMouseOps(this.mouse, now, face, this.cat.center.y);
  }

  private tickMole(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.mole) {
      this.mole = null;
      return [];
    }
    if (!moleAlive(this.mole, now)) {
      const hits = this.mole.hits;
      this.mole = null;
      this.engine?.moleEnd(now, hits);
      return [];
    }
    return buildMoleOps(this.mole, now, face, this.cat.center.y);
  }

  private tickHug(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.hug) {
      this.hug = null;
      return [];
    }
    if (!hugAlive(this.hug, now)) {
      this.hug = null;
      return [];
    }
    return buildHugOps(this.hug, now, face, this.cat.center.y);
  }

  /** 追尾巴：整轮走完才记一次；被顶掉的那一轮在 clearSoloToys 里静默作废。 */
  private tickTail(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.tail) {
      this.tail = null;
      return [];
    }
    if (!tailAlive(this.tail, now)) {
      this.tail = null;
      this.engine?.tailEnd(now, true);
      return [];
    }
    return buildTailOps(this.tail, now, face, this.cat.center.y);
  }

  private tickKnead(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.knead) {
      this.knead = null;
      return [];
    }
    if (!kneadAlive(this.knead, now)) {
      this.knead = null;
      // 踩完整轮才记一笔，顺手把呼噜续上（引擎里起呼噜）。
      this.engine?.kneadEnd(now, true);
      return [];
    }
    return buildKneadOps(this.knead, now, face, this.cat.center.y);
  }

  private tickRoll(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.roll) {
      this.roll = null;
      return [];
    }
    if (!rollAlive(this.roll, now)) {
      this.roll = null;
      this.engine?.rollEnd(now, true);
      return [];
    }
    return buildRollOps(this.roll, now, face, this.cat.center.y);
  }

  private tickBook(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.book) {
      this.book = null;
      return [];
    }
    if (!bookAlive(this.book, now)) {
      this.book = null;
      this.engine?.bookEnd(now, true);
      return [];
    }
    return buildBookOps(this.book, now, face);
  }

  private tickGift(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.gift) {
      this.gift = null;
      return [];
    }
    if (!giftAlive(this.gift, now)) {
      // 没拆的礼物自己走掉：不计数、也不说风凉话。
      this.gift = null;
      return [];
    }
    return buildGiftOps(this.gift, now, face, this.cat.center.y);
  }

  private tickWish(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.wish) {
      this.wish = null;
      return [];
    }
    if (!wishAlive(this.wish, now)) {
      this.wish = null;
      return [];
    }
    return buildWishOps(this.wish, now, face);
  }

  private tickHopscotch(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.hop) {
      this.hop = null;
      return [];
    }
    if (!hopAlive(this.hop, now)) {
      this.hop = null;
      return [];
    }
    return buildHopOps(this.hop, now, face, this.cat.center.y);
  }

  private tickFortune(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (this.form !== "girl" || !this.fortune) {
      this.fortune = null;
      this.fortuneToday = null;
      return [];
    }
    if (fortunePhase(this.fortune, now) === "gone") {
      this.fortune = null;
      this.fortuneToday = null;
      return [];
    }
    return buildFortuneOps(this.fortune, now, face);
  }

  /** 雪跟雨同为氛围层：不占独演槽，最长 SNOW_MS；雪人的结算由点击那一拍完成。 */
  private tickSnow(now: number, face: ReturnType<typeof girlFaceBox>): DrawOp[] {
    if (!this.snow) return [];
    if (this.form !== "girl" || !snowAlive(this.snow, now)) {
      this.snow = null;
      return [];
    }
    const zoom = this.zoom || 1;
    const w = (this.opts.canvas.clientWidth || this.profile.base.width) / zoom;
    const h = (this.opts.canvas.clientHeight || this.profile.base.height) / zoom;
    return buildSnowOps(this.snow, now, w, h, face, this.cat.center.y);
  }

  /** 雨是氛围层：跟独演玩具各走各的表，最长 RAIN_MS。 */
  private tickRain(now: number): DrawOp[] {
    if (!this.rain) return [];
    if (this.form !== "girl" || !rainAlive(this.rain, now)) {
      this.rain = null;
      return [];
    }
    const zoom = this.zoom || 1;
    const w = (this.opts.canvas.clientWidth || this.profile.base.width) / zoom;
    const h = (this.opts.canvas.clientHeight || this.profile.base.height) / zoom;
    return buildRainOps(this.rain, now, w, h);
  }

  /** 呼噜的计时在引擎里：这里只按剩余毫秒画声纹，不另存一份。 */
  private tickPurr(now: number, face: ReturnType<typeof girlFaceBox>, snapshot: CompanionSnapshot | null): DrawOp[] {
    if (this.form !== "girl") return [];
    return buildPurrOps(face, snapshot?.purrLeft ?? 0, now);
  }

  private tickPrints(now: number, snapshot: CompanionSnapshot | null): DrawOp[] {
    stepPrints(this.prints, now);
    if (this.form !== "girl" || !this.catOrigin) {
      this.prints = [];
      return [];
    }
    const moving = snapshot !== null && (snapshot.activity === "walk" || snapshot.activity === "thrown");
    const zoom = this.zoom || 1;
    if (moving && now - this.lastPrintAt >= PRINT_GAP_MS) {
      this.lastPrintAt = now;
      const facing = this.cat.facing ?? 1;
      spawnPrint(this.prints, now, this.cat.center.x - facing * 2, this.catOrigin.x, this.cat.center.y + 2, facing, zoom);
    }
    return buildPrintOps(this.prints, now, this.catOrigin.x, zoom);
  }

  /** 头顶那一层：玩具 + 梦话云 + 成就徽章，三条时间线共用同一张脸框。 */
  private collectGirlAboveOps(
    now: number,
    face: ReturnType<typeof girlFaceBox>,
    snapshot: CompanionSnapshot | null,
  ): DrawOp[] {
    const ops = [
      ...this.tickWand(now),
      ...this.tickBubbles(now),
      ...this.tickLeaves(now),
      ...this.tickRps(now, face),
      ...this.tickLaser(now, face),
      ...this.tickBrush(now, face),
      ...this.tickCatnip(now, face),
      ...this.tickPlane(now, face),
      ...this.tickBird(now, face),
      ...this.tickScratch(now, face),
      ...this.tickBell(now, face),
      ...this.tickMouse(now, face),
      ...this.tickMole(now, face),
      ...this.tickHug(now, face),
      // v1.13.0：九件新玩具里八件走独演槽，雪是氛围层（在雨之前画）。
      ...this.tickTail(now, face),
      ...this.tickKnead(now, face),
      ...this.tickRoll(now, face),
      ...this.tickBook(now, face),
      ...this.tickGift(now, face),
      ...this.tickWish(now, face),
      ...this.tickHopscotch(now, face),
      ...this.tickFortune(now, face),
      ...this.tickPurr(now, face, snapshot),
      // 纸箱压在所有道具之上：她钻进去时箱身必须挡住整个人。
      ...this.tickBox(now, face),
    ];
    ops.push(...buildDreamOps(now, this.sleepSince, face, this.quiet, this.cat.mood));
    if (snapshot?.achievementId && snapshot.achievementLeft > 0) {
      const age = ACHIEVEMENT_MS - snapshot.achievementLeft;
      ops.push(...buildAchievementOps(snapshot.achievementId, age, face, now / 1000));
    }
    // 雪丝盖在雨丝下面（两者引擎里互斥，同屏只可能有一层）。
    ops.push(...this.tickSnow(now, face));
    // 雨丝盖在最上面：这是「此刻窗外」的氛围层，只输给气泡。
    ops.push(...this.tickRain(now));
    return ops;
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
   *
   * `zoom` 是**绘制空间→窗口 CSS 坐标**的唯一系数。窗口宽度在气泡展开时是
   * bubbleWidth 而不是 base×zoom，拿 innerWidth/base 反推 zoom 会算出 2.09 这种假值，
   * 探针据此喂进来坐标就全落到命中框外（2026-10-25 真窗验收踩过）。量尺一律读这里。
   */
  getLayoutInfo(): { base: { width: number; height: number }; center: Point; s: number; zoom: number } {
    const { s } = this.profile.catScale(this.lastSent?.e ?? 0);
    return { base: { ...this.profile.base }, center: { ...this.cat.center }, s, zoom: this.zoom };
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
   * 姿态图里的一格：与 `paintGirlFrame` 同一条「绕脚心、按 inkRefPx→inkVb」的变换链。
   * 真坐/真蜷的身子已经在图里，这里只叠呼吸与朝向，**不许再压扁**。
   */
  private paintGirlPose(pose: GirlPoseName, alpha: number, body: GirlPoseBody): void {
    const geom = girlPoseGeom(pose);
    const cell = girlPoseCell(pose);
    const col = cell % geom.cols;
    const row = Math.floor(cell / geom.cols);
    const w = geom.cellW * body.k;
    const h = geom.cellH * body.k;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(body.pivot.x, body.pivot.y);
    ctx.rotate(body.rot);
    ctx.scale(body.sx * body.facing, body.sy);
    ctx.drawImage(
      this.girlPoseImage(geom.atlas),
      col * geom.cellW, row * geom.cellH,
      geom.cellW, geom.cellH,
      -geom.anchorX * w, -geom.anchorY * h, w, h,
    );
    ctx.restore();
  }

  /** 画一幕：姿态与动画各有各的刚体，交叉淡化时两幕必须各算各的 `k`。 */
  private paintGirlShown(
    shown: GirlShown, alpha: number, body: GirlAnimBody | GirlPoseBody,
  ): void {
    if (shown.kind === "pose") {
      // 姿态与它的图集同生同死：图集 II 没到就不画这一格（否则 drawImage 拿到空图）。
      if (this.girlAtlasReady(girlPoseGeom(shown.id).atlas)) {
        this.paintGirlPose(shown.id, alpha, body as GirlPoseBody);
      }
    } else if (this.girlAnimReady) {
      this.paintGirlFrame(shown.index, alpha, body as GirlAnimBody);
    }
  }

  /**
   * 待机编排一拍：只在「活动=idle 且没有独演玩具」时推进，其余时刻挂起。
   * 挂起只 reset 一次（玩完回来一整支舞）；进入挂起时也 reset，保证下一次 idle
   * 从舞开头起算，而不是接着玩之前那段剩几秒的疲惫。
   */
  /** 返回 true＝这一拍换了段（含挂起/恢复）：自主小动作要让位给新姿态。 */
  private tickGirlIdle(now: number, activity: GirlActivity): boolean {
    if (!this.idleTickInited) {
      this.idleTickInited = true;
      this.idle = createGirlIdle(now, GIRL_IDLE_SEED);
      return true;
    }
    const canIdle = activity === "idle" && !this.girlToyOnScreen();
    if (!canIdle) {
      if (!this.idleSuspended) {
        this.idleSuspended = true;
        this.idle = resetGirlIdle(this.idle, now);
        return true;
      }
      return false;
    }
    if (this.idleSuspended) {
      this.idleSuspended = false;
      this.idle = resetGirlIdle(this.idle, now);
      return true;
    }
    const before = this.idle;
    this.idle = stepGirlIdle(this.idle, now, { quiet: this.quiet });
    return this.idle !== before;
  }

  /** 独演道具/点心/小虫/跟随任一在场：待机编排让位，别在她玩的时候坐下。 */
  private girlToyOnScreen(): boolean {
    return this.wand !== null || this.bubbles !== null || this.leaves !== null
      || this.rps !== null || this.box !== null || this.laser !== null
      || this.brush !== null || this.catnip !== null || this.plane !== null
      || this.bird !== null || this.scratch !== null || this.bell !== null
      || this.mouse !== null || this.mole !== null || this.hug !== null
      || this.tail !== null || this.knead !== null || this.roll !== null
      || this.book !== null || this.gift !== null || this.wish !== null
      || this.hop !== null || this.fortune !== null
      || this.snack !== null || this.critter !== null || this.follow !== null;
  }

  /**
   * 每帧把「活动/环境手势/显式手势」翻译成这一幕（v1.14 的真姿态优先链）：
   * 1. 显式手势（点击反馈/workStatus）最高优先，一次性播完就回基础姿态；
   * 2. 引擎自主抽到的小动作（snapshot.gesture，权重 80）只在换 id 时起播；
   *    她坐着/蜷着/回头时这条闸关掉，否则编排永远走不到「歇一会」；
   * 3. 其余时间由 `girlBaseVisualFor` 给真姿态：站/看/坐/蜷/伸懒腰/开心，
   *    走路/梳毛/被拖等只能靠帧动画的活动才回动画段。
   */
  private tickGirlScene(now: number, snapshot: CompanionSnapshot | null): void {
    const activity = (snapshot?.activity ?? "idle") as GirlActivity;
    const boutChanged = this.tickGirlIdle(now, activity);
    // 换段＝她正要坐/蜷/回头：引擎抽的余兴动作必须当场让位，否则新姿态永远上不了台。
    if (boutChanged && this.ambientGestureActive) {
      this.animGesture = null;
      this.ambientGestureActive = false;
    }
    const explicit = this.explicitGesture;
    if (explicit) {
      // 与静态路径同口径：显式手势是一次性的，起播即消费，播完自动让位。
      this.explicitGesture = null;
      this.startGirlGesture(explicit.id, explicit.startedAt, false);
    } else {
      const ambient = snapshot?.gesture ?? null;
      // 待机编排才吃「站定且已经站了一拍」的闸：坐/蜷/回头时被抽中会把歇息打断成抽搐。
      // 非 idle 的活动（摸头 → pet、挠脚、喂食、休息…）里的 ambient 是**互动回馈**，
      // 必须照演——否则点脸只换了底片，看门的那一下就没了。
      // 玩具在场时一律不接——很多玩具开局会塞一条 ambient，那是道具演出的余兴，
      // 不该把「玩玩具时站定」的底子换成一整段帧动画。刚换段的前 600ms 也不接，
      // 让新姿态有机会被看见（换段瞬间接一段帧动画，读起来像姿态没生效）。
      const ambientAllowed = !this.girlToyOnScreen()
        && (activity !== "idle"
          || (this.idle.phase === "stand"
            && this.ambientGestureBout !== this.idle.bouts
            && now - this.idle.since > 600));
      if (ambientAllowed && ambient && ambient !== this.lastAmbientGesture) {
        if (this.startGirlGesture(ambient, now, true)) this.ambientGestureBout = this.idle.bouts;
      }
      this.lastAmbientGesture = ambient;
    }

    // 收尾有两种：帧动画自己报 done；真姿态按表举够时长（帧动画的 done 对静帧永远 false）。
    if (this.animGesture) {
      const poseDone = this.animGesture.clipId === null && now >= this.animGesture.until;
      if (poseDone || this.scene.isDone(now)) {
        this.animGesture = null;
        this.ambientGestureActive = false;
      }
    }
    if (!this.animGesture) {
      this.scene.setVisual(girlBaseVisualFor({
        activity,
        phase: this.idle.phase,
        quiet: this.quiet,
        posesReady: this.girlPosesReady,
        poses2Ready: this.girlPoses2Ready,
      }), now);
    }
  }

  /**
   * 起一个手势：有真姿态就用真姿态（招手/鞠躬/剪刀手/歪头/洗脸/哈欠/伸懒腰），
   * 没有对应画的（点头/摇头/打字/发抖/跳/拍手/捂脸/喝一口）照旧借帧动画。
   * 返回 false＝这个手势既不认识、也没有兜底片段（什么也没发生）。
   */
  private startGirlGesture(id: string, at: number, ambient: boolean): boolean {
    const pose = gesturePoseFor(id);
    if (pose && this.girlPoseReadyFor(pose.pose)) {
      this.animGesture = { id, clipId: null, startedAt: at, until: at + pose.holdMs };
      this.ambientGestureActive = ambient;
      this.scene.setVisual({ kind: "pose", id: pose.pose }, at);
      return true;
    }
    if (!this.girlAnimReady) return false;
    const clipId = gestureClipFor(id);
    if (!clipId) return false;
    this.animGesture = { id, clipId, startedAt: at, until: at };
    this.ambientGestureActive = ambient;
    this.scene.setVisual({ kind: "clip", id: clipId, loop: false }, at);
    return true;
  }

  /** 某张姿态的图集在不在屏上（两套图各拉各的）。 */
  private girlPoseReadyFor(pose: GirlPoseName): boolean {
    return this.girlAtlasReady(girlPoseGeom(pose).atlas);
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
    // 梦话云要等「真的睡熟」：每次进入 sleep 重新起表，醒来立刻抹掉。
    if (snapshot?.activity === "sleep") {
      if (this.sleepSince < 0) this.sleepSince = now;
    } else {
      this.sleepSince = -1;
    }
    // 手势/动作段先落定，再算重绘帧率：淡化期要 30fps，循环段至少比片段 fps 快一档。
    if (this.form === "girl" && (this.girlAnimReady || this.girlPosesReady || this.girlPoses2Ready)) {
      this.tickGirlScene(now, snapshot);
    }

    // 坐垫包络与脸红共用一条 180ms 时间常数；镜头外的缓动量只在这里推一次。
    // 坐垫认「基础姿态」而不是正在演的那一段：坐着挥手时垫子不许跟着收回去。
    const dtFx = this.lastGirlFxAt === null ? 0 : Math.max(0, Math.min(90, now - this.lastGirlFxAt));
    this.lastGirlFxAt = now;
    const basePose = this.form === "girl"
      ? girlBasePoseFor((snapshot?.activity ?? "idle") as GirlActivity, this.idle.phase, this.quiet)
      : null;
    const cushionTarget = this.form === "girl" && (snapshot?.activity === "rest" || basePose === "sit") ? 1 : 0;
    this.cushion += (cushionTarget - this.cushion) * (1 - Math.exp(-dtFx / 180));
    if (this.cushion < 0.01) this.cushion = 0;
    const cushionMoving = Math.abs(cushionTarget - this.cushion) > 0.01;

    // 三档 fps：走路/投掷/滚球要 60，气泡/藏身缓动/计时动作 30，静坐 4。
    const moving = snapshot !== null
      && (snapshot.activity === "walk" || snapshot.activity === "thrown");
    // 计时动作（洗脸/哈欠/伸懒腰/歪头/摸摸/吃/玩）与落地压扁都是连续动画：
    // 留在 4fps 档会把它们切成一秒四格，动作越细腻越像卡带。
    const animating = snapshot !== null
      && (snapshot.activityProgress > 0 || snapshot.squash > 0);
    // 一次性的记号也不能冻在 4fps：升档 2.6s、连击 3.2s、惊醒 1.6s 都是连续演出。
    const fxAnimating = snapshot !== null
      && (snapshot.bondUpLeft > 0 || snapshot.patCombo > 1 || snapshot.startleLeft > 0);
    const toyMoving = this.form === "girl" && this.toyState !== null && !this.toyState.rest;
    // 新玩具/爪印/徽章都是连续演出：4fps 会把泡泡和爪印切成幻灯片。
    const propAnimating = this.form === "girl" && (
      this.wand !== null || this.bubbles !== null || this.leaves !== null
      || this.rps !== null || this.prints.length > 0
      || this.box !== null || this.laser !== null || this.brush !== null
      || this.catnip !== null || this.plane !== null || this.bird !== null
      || this.scratch !== null || this.bell !== null || this.mouse !== null
      || this.mole !== null || this.hug !== null || this.rain !== null
      || this.tail !== null || this.knead !== null || this.roll !== null
      || this.book !== null || this.gift !== null || this.wish !== null
      || this.hop !== null || this.snow !== null || this.fortune !== null
      || (snapshot !== null && snapshot.purrLeft > 0)
      || (snapshot !== null && snapshot.achievementLeft > 0)
    );
    if (moving || toyMoving) this.fps = FPS_HOVER;
    else if (peekAnimating || this.bubbleExpand > 0 || animating || fxAnimating || cushionMoving || propAnimating) this.fps = FPS_ACTIVE;
    // agent 在干活时保持 30fps：手势（打字/点头）与粒子都在动，留在 4fps 档会一顿一顿。
    else if (this.workTier !== null) this.fps = FPS_ACTIVE;
    else this.fps = FPS_IDLE;
    // 帧动画自己的播放速率就是重绘下限：12fps 的待机在 4fps 档会让每张画多停两拍。
    // 下限取片段帧率的两倍（`redrawFloorFor`）；真姿态是静帧，12fps 足够呼吸与慢摆。
    if (this.form === "girl" && (this.girlAnimReady || this.girlPosesReady || this.girlPoses2Ready)) {
      const need = this.scene.isFading(now) ? FPS_ACTIVE : this.scene.redrawFloor();
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
    this.cat.mouse = this.form === "girl" && (this.girlAnimReady || this.girlPosesReady || this.girlPoses2Ready)
      ? null
      : this.gazeTarget;

    // 变换里已折 zoom，clear/气泡都要拿到 zoom 归一后的基址几何。
    const w = (this.opts.canvas.clientWidth || this.profile.base.width) / this.zoom;
    const h = (this.opts.canvas.clientHeight || this.profile.base.height) / this.zoom;
    this.ctx.clearRect(0, 0, w, h);
    // 球先推进一拍再画：同一帧里踢/滚/她自己扒拉都落在同一张画上。
    const toyArt = this.tickToy(now, snapshot);
    // 爪印落在桌布上：每帧推进一次，三个渲染回退分支共用。
    const printOps = this.tickPrints(now, snapshot);
    let ops: DrawOp[];
    if (this.form === "girl") {
      if (this.girlAnimReady || this.girlPosesReady || this.girlPoses2Ready) {
        // 上一幕冻住的那一格垫底，当前幕按淡化进度压上去
        // （先画 prev 再画当前，中途不会出现整体透明度塌陷）。
        const sample = this.scene.sample(now);
        const shown = sample.current;
        const activity = (snapshot?.activity ?? "idle") as CompanionActivity;
        const dizzyLeft = Math.max(0, Math.min(1, (snapshot?.dizzyLeft ?? 0) / DIZZY_MS));
        const startleLeft = Math.max(0, Math.min(STARTLE_MS, snapshot?.startleLeft ?? 0));
        const startle = startleLeft / STARTLE_MS;

        // 1) 先拿「不叠加存在感」的刚体算头心：脸框逐格实测，倾斜/侧移只有 2px 级，
        //    晚一帧回喂不影响观感，但避免了解不出来的自指。
        const baseFace = this.faceForShown(shown, girlPoseBodyFor(this.cat), girlAnimBodyFor(this.cat));
        const zoom = this.zoom || 1;
        // 注视目标是窗口内容 css 坐标，绘制空间要除 zoom（与 isPointOnBubble/tapAt 同口径）。
        let gaze: Point2 | null = this.gazeTarget && dizzyLeft <= 0
          ? [this.gazeTarget[0] / zoom, this.gazeTarget[1] / zoom]
          : null;
        // 激光笔在眼前晃：她的视线归红点，不归用户光标。
        if (this.laser && this.laser.caughtAt < 0) {
          const dot = laserAt(this.laser, now, laserBoundsFor(baseFace, this.cat.center.y));
          gaze = [dot.x, dot.y];
        }
        // 走路/拖拽/投掷的方向归物理，睡着与被逗晕时不跟。
        const allowTurn = (activity === "idle" || activity === "rest") && dizzyLeft <= 0;
        const awake = this.cat.mood !== "sleep" && !this.quiet;
        const presence = this.girlPresence.update({
          now,
          gaze,
          head: [baseFace.cx, baseFace.cy],
          facing: this.cat.facing ?? 1,
          allowTurn,
          awake,
        });
        this.presencePose = presence.pose;
        if (presence.notice) {
          this.noticeAt = now;
          // 引擎是台词的唯一出口：它按优先级 0 排队，绝不盖掉 agent 的工作播报。
          this.engine?.notice(now);
        }

        // 2) 脸红包络：目标由「正在播的一幕 + 互动」给，按 180ms 缓动（dt 在 fps 之前已算）。
        const targetBlush = this.girlBlushTarget(snapshot);
        this.blush += (targetBlush - this.blush) * (1 - Math.exp(-dtFx / 180));
        if (this.blush < 0.01) this.blush = 0;

        // 3) 最终刚体：存在感的倾斜/侧移/朝向叠在动作刚体上，眩晕只加一点抖。
        //    姿态与动画各算各的 k：交叉淡化时两幕必须各自对齐脚心，否则中途会跳一下身高。
        const motion = {
          leanDeg: this.presencePose.leanDeg,
          shiftX: this.presencePose.shiftX,
          facing: this.presencePose.facing,
          dizzy: dizzyLeft,
          startle,
        };
        const bodyFor = (which: GirlShown) => which.kind === "pose"
          ? girlPoseBodyFor(this.cat, motion)
          : girlAnimBodyFor(this.cat, motion);
        const body = bodyFor(shown);
        const clip = this.scene.clipId();
        const pose = this.scene.poseId();
        const frame = shown.kind === "clip" ? shown.index : 0;
        const finalFace = this.faceForShown(shown, girlPoseBodyFor(this.cat, motion), girlAnimBodyFor(this.cat, motion));
        const finalInk = shown.kind === "pose"
          ? girlPoseInkBox(girlPoseBodyFor(this.cat, motion), shown.id)
          : girlInkBox(girlAnimBodyFor(this.cat, motion), shown.index);
        this.lastFace = finalFace;
        const fx = buildGirlFxOps({
          body,
          frame,
          face: finalFace,
          ink: finalInk,
          nowSec: now / 1000,
          nowMs: now,
          mood: this.cat.mood,
          pet: this.cat.pet,
          presence: this.presencePose,
          blush: this.blush,
          noticeAgeMs: this.noticeAt < 0 ? -1 : now - this.noticeAt,
          dizzyLeft,
          squash: this.cat.pose.squash ?? 0,
          activity,
          step: this.cat.pose.walk ?? 0,
          lift: Math.max(0, Math.min(1, -this.cat.jumpY / 26)),
          groundY: this.cat.center.y,
          notes: this.cat.mood === "happy" || clip === "happy" || clip === "wave"
            || clip === "peace" || pose === "joy",
          quiet: this.quiet,
          cushion: this.cushion,
          bondUpLeft: snapshot?.bondUpLeft ?? 0,
          patCombo: snapshot?.patCombo ?? 0,
          startleLeft,
          milestoneLeft: snapshot?.milestoneLeft ?? 0,
          milestoneDays: snapshot?.milestoneDays ?? 0,
        });
        this.lastFxCounts = { below: fx.below.length, above: fx.above.length };
        // 装扮锚在最终刚体的脸框上：倾斜/侧移/转身时跟着一起动。
        const accessoryOps = buildAccessoryOps({
          body,
          frame,
          face: finalFace,
          nowSec: now / 1000,
          activity,
          facing: body.facing,
          accessory: snapshot?.accessory ?? "none",
        });
        // 道具先推进一拍：小虫/鱼干与人物落在同一张画上。
        const snackOps = this.tickSnack(now, finalFace);
        const critterOps = this.tickCritter(now, finalFace, snapshot);
        const aboveOps = this.collectGirlAboveOps(now, finalFace, snapshot);
        // 投影必须压在人物下面：分两趟画，投影一趟、人物+记号一趟。
        // 球的影子压在坐垫/地面投影之上，球身在她之后——她从球后面走过去时球仍然在前面。
        paintOps(this.ctx, fx.below);
        paintOps(this.ctx, printOps);
        if (toyArt) paintOps(this.ctx, toyArt.below);
        if (sample.prev) this.paintGirlShown(sample.prev, 1, bodyFor(sample.prev));
        this.paintGirlShown(shown, sample.fade, body);
        // 装扮压在人物上、球之前：蝴蝶结在发顶，铃铛在颈圈上。
        paintOps(this.ctx, accessoryOps);
        if (toyArt) paintOps(this.ctx, toyArt.above);
        // 立绘里的脸/身体是画死的；表情层不参与，屏幕记号照旧跟 mood/pet/quiet 走。
        // 姿态的记号钉在「当前这张脸」的头顶：蜷起来时 Zzz 跟着头降。
        const overlayOps = shown.kind === "pose"
          ? buildGirlPoseOverlayOps(this.cat, shown.id, girlPoseBodyFor(this.cat, motion))
          : buildGirlOverlayOps(this.cat);
        ops = [...overlayOps, ...snackOps, ...fx.above, ...critterOps, ...aboveOps];
      } else if (this.girlSpriteReady) {
        if (toyArt) paintOps(this.ctx, toyArt.below);
        paintOps(this.ctx, printOps);
        this.paintGirlSprite();
        const fallbackBody = girlAnimBodyFor(this.cat);
        paintOps(this.ctx, buildAccessoryOps({
          body: fallbackBody,
          frame: 0,
          nowSec: now / 1000,
          activity: (snapshot?.activity ?? "idle") as CompanionActivity,
          facing: fallbackBody.facing,
          accessory: snapshot?.accessory ?? "none",
        }));
        if (toyArt) paintOps(this.ctx, toyArt.above);
        ops = [...buildGirlOverlayOps(this.cat), ...this.collectGirlAboveOps(now, girlFaceBox(fallbackBody, 0), snapshot)];
      } else if (this.girlSpriteFailed) {
        if (toyArt) paintOps(this.ctx, toyArt.below);
        const composed = this.composeChannels(now, this.lastSnapshot);
        const fallbackBody = girlAnimBodyFor(this.cat);
        ops = [
          ...printOps,
          ...buildPetOps({
            ...this.cat,
            channels: composed.channels,
            expression: composed.expression,
            blink: Math.max(this.cat.blink, composed.blink),
            form: "girl",
          }),
          ...this.collectGirlAboveOps(now, girlFaceBox(fallbackBody, 0), snapshot),
        ];
        if (toyArt) ops.push(...toyArt.above);
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
    this.girlTaps.reset();
    this.girlPresence.reset();
    this.presencePose = restingPresence();
    this.noticeAt = -1;
    this.blush = 0;
    this.lastGirlFxAt = null;
    this.lastFxCounts = { below: 0, above: 0 };
    this.toyState = null;
    this.lastToyAt = null;
    this.nextToyBatAt = 0;
    this.tease.reset();
    this.cushion = 0;
    this.critter = null;
    this.snack = null;
    this.wand = null;
    this.bubbles = null;
    this.leaves = null;
    this.rps = null;
    this.box = null;
    this.laser = null;
    this.brush = null;
    this.catnip = null;
    this.plane = null;
    this.bird = null;
    this.scratch = null;
    this.bell = null;
    this.mouse = null;
    this.mole = null;
    this.hug = null;
    this.rain = null;
    this.tail = null;
    this.knead = null;
    this.roll = null;
    this.book = null;
    this.gift = null;
    this.wish = null;
    this.hop = null;
    this.snow = null;
    this.fortune = null;
    this.fortuneToday = null;
    this.prints = [];
    this.lastPrintAt = 0;
    this.follow = null;
    this.sleepSince = -1;
    // 形态也是行为引擎的分岔口：不同步这一步，猫娘的四档加权抽取永远不跑（她只会走四足那张平表）。
    this.engine?.setForm(form);
    this.animGesture = null;
    this.ambientGestureActive = false;
    this.ambientGestureBout = -1;
    this.lastAmbientGesture = null;
    // 待机编排换人重来：下一帧从站定起跳，旧形态的姿态/趴伏量当场清掉。
    this.idleTickInited = false;
    this.idleSuspended = false;
    this.lastFace = null;
    this.cat.pose.sprawl = 0;
    if (form === "girl") {
      // 硬重置而不是 crossfade：切形态不该看见上一形态残留的一帧。
      this.scene = new GirlScenePlayer({ kind: "clip", id: "idle", loop: true }, performance.now());
    }
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
   * 指针点击的统一入口（css 坐标 + 按住时长）。
   * - 四足：完全回到老的 `clickKindFor → touch` 口径，一支签都不多吃；
   * - 猫娘：长按仍是摩挲；轻点按落点分区（头/身/脚），2.4s 内第四下改成逗晕。
   *
   * 分区只决定「回哪一句、摆哪个手势」，是否晕只跟点多快有关——所以计数器
   * 在分区之前走，晕了就不再叠一条普通反应。
   */
  tapAt(cssX: number, cssY: number, heldMs: number, now = performance.now()): void {
    if (this.form !== "girl") {
      this.engine?.touch(clickKindFor(heldMs), now);
      return;
    }
    // 人已经伸手了：跟随到此为止（她停下来看你，而不是继续往光标走）。
    this.follow = null;
    if (heldMs >= PET_HOLD_MS) {
      this.engine?.touch("pet", now);
      this.engine?.save();
      return;
    }
    const zoom = this.zoom || 1;
    const dx = cssX / zoom;
    const dy = cssY / zoom;
    // 雪堆画在最上层（天气层），点它先于脚边的一切玩具：这里是 82px 窗里唯一「能伸手」的雪。
    if (this.snow && snowAlive(this.snow, now)) {
      const tapFaceForSnow = this.girlFaceAt(now);
      // 三堆挨得比堆身还近（相邻中心只差 5px，堆宽 12），按「先命中」会把右边两下
      // 全算到左边那堆头上；一掌拍最近的那堆才符合眼睛看到的落点。
      let hitPile = -1;
      let hitDist = Infinity;
      for (let i = 0; i < 3; i += 1) {
        const pile = snowPileAt(this.snow, now, tapFaceForSnow, this.cat.center.y, i);
        if (dx < pile.x || dx > pile.x + pile.w || dy < pile.y || dy > pile.y + pile.h) continue;
        const dist = Math.hypot(dx - (pile.x + pile.w / 2), dy - (pile.y + pile.h / 2));
        if (dist < hitDist) {
          hitDist = dist;
          hitPile = i;
        }
      }
      if (hitPile >= 0) {
        const packed = packSnow(this.snow, now, hitPile);
        if (packed && snowmanBuilt(this.snow) && this.engine?.snowmanMade(now)) {
          this.engine.save();
        }
        if (!this.paused) this.draw(now);
        return;
      }
    }
    // 泡泡和逗猫棒都悬在脸附近：先按各自的小命中区判，点不中才落到摸头/挠脚。
    if (this.bubbles) {
      const id = bubbleAt(this.bubbles, now, this.cat.center.y, dx, dy);
      if (id !== null && this.engine?.bubblePop(now)) {
        popBubble(this.bubbles, id, now);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    if (this.wand && wandAt(this.wand, now, this.girlFaceAt(now), this.cat.facing ?? 1, dx, dy)) {
      if (this.engine?.wandEnd(now, true)) {
        catchWand(this.wand, now);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    const tapFace = this.girlFaceAt(now);
    // v1.11.0 六件新玩具画在小虫和毛线球之上：命中顺序跟绘制顺序走。
    // 尤其纸箱整只盖住脚边的球，球却先被点中过一次（v1.11 真窗探针 O1 抓到）。
    const tapFacing = this.cat.facing ?? 1;
    const tapFloorY = this.cat.center.y;
    // v1.13.0 九件新玩具画在抱抱与旧玩具之上：命中按绘制倒序，最上层先判。
    // 签纸挂在脸侧、星子浮在头顶、书在胸前——都落在 hugAtPoint 的大椭圆里，
    // 不先拦下来，点星子会被读成「再抱一下」。
    if (this.fortune && fortuneAtPoint(this.fortune, now, tapFace, dx, dy)) {
      const today = this.fortuneToday;
      if (today && revealFortune(this.fortune, today)) {
        if (this.engine?.fortuneReveal(today.tier, now)) this.engine.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.hop && hopAlive(this.hop, now)) {
      const idx = hopAtPoint(this.hop, now, tapFace, tapFloorY, dx, dy);
      if (idx >= 0) {
        const step = stepHop(this.hop, now, idx);
        if (step === "wrong") {
          this.engine?.hopscotchMiss(now);
        } else if (step === "done" && this.engine?.hopscotchDone(now)) {
          this.engine.save();
        }
        if (!this.paused) this.draw(now);
        return;
      }
    }
    if (this.wish && wishAtPoint(this.wish, now, tapFace, dx, dy)) {
      if (makeWish(this.wish, now)) {
        if (this.engine?.wishMake(now)) this.engine.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.gift && giftAtPoint(this.gift, now, tapFace, tapFloorY, dx, dy)) {
      if (openGift(this.gift, now)) {
        if (this.engine?.giftOpen(now)) this.engine.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.book && bookAtPoint(this.book, now, tapFace, dx, dy)) {
      if (turnPage(this.book, now) && !this.paused) this.draw(now);
      return;
    }
    if (this.roll && rollAtPoint(this.roll, now, tapFace, tapFloorY, dx, dy)) {
      if (flipRoll(this.roll, now) === "flip" && !this.paused) this.draw(now);
      return;
    }
    if (this.knead && kneadAtPoint(this.knead, now, tapFace, tapFloorY, dx, dy)) {
      if (pressKnead(this.knead, now) && !this.paused) this.draw(now);
      return;
    }
    // 尾巴尖一直在动：先判「这一下是不是落在尖上」，冷却里的连点被吞掉也不许穿过去摸头。
    if (this.tail && tailPhase(this.tail, now) === "chase") {
      const tip = tailTipAt(this.tail, now, tapFace, tapFloorY);
      if (Math.hypot(dx - tip.x, dy - tip.y) <= tip.r + 4) {
        if (chaseTail(this.tail, now, tapFace, tapFloorY, dx, dy) === "dizzy") {
          this.engine?.tailDizzy(now);
        }
        if (!this.paused) this.draw(now);
        return;
      }
    }
    // 抱抱时她整个人都张着手：点上身＝再抱紧一点，这一下不算摸头。
    if (this.hug && hugAtPoint(tapFace, dx, dy)) {
      if (tapHug(this.hug, now)) {
        this.engine?.hugTap(now, this.hug.taps);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.box) {
      const hit = boxAt(this.box, now, tapFace, tapFloorY, dx, dy);
      if (hit === "head" && this.engine?.boxCatch(now)) {
        catchBox(this.box, now);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
      if (hit !== null) {
        // 点箱面＝敲门；冷却期内的连点吞掉，不许穿过箱子摸到她。
        if (knockBox(this.box, now)) {
          this.engine?.boxKnock(now);
          this.engine?.save();
          if (!this.paused) this.draw(now);
        }
        return;
      }
    }
    if (this.laser && laserAtPoint(this.laser, now, laserBoundsFor(tapFace, tapFloorY), tapFace, dx, dy)) {
      if (this.engine?.laserEnd(now, true)) {
        catchLaser(this.laser, now);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    if (this.brush && brushAt(this.brush, now, tapFace, tapFacing, tapFloorY, dx, dy)) {
      if (boostBrush(this.brush, now, dx, dy)) {
        this.engine?.brushBoost(now);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.catnip && catnipAtPoint(this.catnip, now, tapFace, tapFloorY, tapFacing, dx, dy)) {
      if (puffCatnip(this.catnip, now)) {
        this.engine?.catnipPuff(now);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.plane && planeAtPoint(this.plane, now, tapFace, tapFloorY, dx, dy)) {
      if (this.engine?.planeEnd(now, true)) {
        catchPlane(this.plane, now, tapFace, tapFloorY);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    if (this.bird && birdAtPoint(this.bird, now, tapFace, dx, dy)) {
      if (scareBird(this.bird, now)) {
        this.engine?.birdFlee(now);
        this.engine?.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    // v1.12.0 地面四件（抓板/铃铛/发条鼠/地鼠）画在毛线球与爪印之上：命中先于球。
    if (this.scratch && scratchAtPoint(this.scratch, now, tapFace, tapFloorY, dx, dy)) {
      if (boostScratch(this.scratch, now)) {
        this.engine?.scratchBoost(now);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.bell && bellAtPoint(this.bell, now, tapFace, tapFloorY, dx, dy)) {
      if (ringBell(this.bell, now)) {
        this.engine?.bellRing(now, this.bell.rings);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.mouse && mouseAtPoint(this.mouse, now, tapFace, tapFloorY, dx, dy)) {
      if (catchMouse(this.mouse, now, tapFace, tapFloorY)) {
        this.engine?.mouseCatch(now);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    if (this.mole && moleAtPoint(this.mole, now, tapFace, tapFloorY, dx, dy)) {
      if (whackMole(this.mole, now, tapFace, tapFloorY)) {
        this.engine?.moleWhack(now, this.mole.hits);
        this.engine?.save();
        if (!this.paused) this.draw(now);
      }
      return;
    }
    // 伴飞小虫先截：它绕着脸飞，落在「头」分区里；不先拦，捉虫会被读成摸头。
    if (this.critter && critterAt(this.critter, now, tapFace, dx, dy)) {
      // 先问引擎：睡着/被拖着时捉不到，这一下应该继续走分区而不是被吞掉。
      if (this.engine?.catchCritter(now)) {
        catchCritter(this.critter, now);
        this.engine.save();
        if (!this.paused) this.draw(now);
        return;
      }
    }
    // 毛线球先截：它就在脚边，落在「脚」分区里；不先拦，点球会被读成挠脚。
    if (this.toyState && toyAt(this.toyState, dx, dy, 4)) {
      // 点在球的哪半边就往哪边弹——和真拨一下球的手感一致，不用先判她的朝向。
      const dir = dx < this.toyState.x ? 1 : -1;
      kickToy(this.toyState, dir, TOY.kickPower * (0.9 + Math.random() * 0.2));
      this.engine?.toyBat(now, false);
      this.nextToyBatAt = now + 14_000 + Math.random() * 12_000;
      if (!this.paused) this.draw(now);
      return;
    }
    const zone = classifyGirlTap(dx, dy, this.getHitRect());
    if (this.girlTaps.tap(now).dizzy) {
      this.engine?.dizzy(now);
      // 4fps 档最坏要等 250ms，连点的第四下必须当场有反应。
      if (!this.paused) this.draw(now);
      return;
    }
    this.engine?.touch(zone === "head" ? "head" : zone === "feet" ? "feet" : "poke", now);
    this.engine?.save();
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

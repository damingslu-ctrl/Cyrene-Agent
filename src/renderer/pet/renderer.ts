/// <reference path="../types/cyrene.d.ts" />
import {
  BUB_W,
  clampRestoreOrigin,
  computeCatRect,
  computePetLayout,
  PET_H,
  PET_W,
  PIN,
  resolveGrowthDirection,
  scaleFor,
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
import { paintOps } from "./ops";
import { buildBubbleOps, buildCatOps, bubbleBoxRect, type BubbleBox, type CatInput } from "./art";
import { CompanionEngine, type CompanionSnapshot } from "./companion";
import type { PetCommand } from "../../shared/pet-commands";

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
  private zoom = 1;
  /** rAF 句柄。0 = 没在跑；拖窗期 pause() 冻结绘制，DWM 快照逐位不变（Task 5 尖峰）。 */
  private ticker = 0;
  private paused = false;
  private fps = FPS_IDLE;
  /** fps 闸的上一次重绘时刻；闸挡掉的是重绘，挡不掉猫时钟（猫相位取绝对 t）。 */
  private lastDrawAt = 0;
  /** 免打扰（Task 11）：true 时猫画月牙、不许睡着（月牙与 Zzz 屏幕互斥，native #67）。 */
  private quiet = false;

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
    const { u, s } = scaleFor(0);
    // 绘制中心 = 窗口内钉位点 + (-17s, +4.5s)（native main.rs:4373-4384：猫内容在 viewBox 里偏右下）。
    // P1 窗口恒为 82×108 收起档，pinInWin 恒等于 PIN；Task 12 展开几何后再随 pin 走。
    this.cat = {
      center: { x: PIN.x - 17 * s, y: PIN.y + 4.5 * s },
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
   * 这里把 zoom 折进 ctx 变换：绘制空间恒回 82×108 基址几何，PIN 在缩放后
   * 仍落在窗口内容的 (41, 39)——对位 Live2D 时代「模型缩放去匹配窗口」的职责。
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
    this.engine?.handleCommand(command, performance.now());
    // 用户主动互动的数值立刻落盘：等到下一次漫游停稳才存，摸摸攒的亲密度会白丢。
    this.engine?.save();
  }

  /** 开窗问候（主端确认不在安静期后调）：按时段一句，安静期引擎自己拒收。 */
  greet(): boolean {
    return this.engine?.greet(performance.now()) ?? false;
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

  /** 引擎能不能自主移动：藏身、展开、被抓着的时候都不许。 */
  private canRoam(): boolean {
    if (!this.catOrigin || !this.workArea) return false;
    if (this.dragging || this.paused) return false;
    if (this.bubbleActive || this.bubbleExpand > 0.001) return false;
    if (Math.abs(this.peekDx) > 0.5) return false;
    if (this.tuckEnabled) {
      const right = this.workArea.x + this.workArea.width;
      const nearRight = right - (this.catOrigin.x + PET_W) < EDGE_NEAR_PX;
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
      // 漫游夹的是「窗口」不是「猫」：catOrigin 是窗口原点，尺寸含 zoom。
      size: { width: PET_W * this.zoom, height: PET_H * this.zoom },
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
          targetWidth: BUB_W,
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

    const rectW = PET_W + (BUB_W - PET_W) * this.bubbleExpand;
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
    return [{ name: "cat", rect: computeCatRect({ pinInWin: { x: PIN.x, y: PIN.y }, e: 0 }) }];
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
    });
    const { u, s } = scaleFor(e);
    this.cat.u = u;
    // 绘制中心 = 窗口内钉位点 + (-17s, +4.5s)（native main.rs:4373-4384）；
    // pinInWin 已含 peek_off（computePetLayout :121-123），猫随藏身走进窗口右侧。
    this.cat.center = { x: layout.pinInWin.x - 17 * s, y: layout.pinInWin.y + 4.5 * s };
    const payload = {
      x: Math.round(layout.pos.x),
      y: Math.round(layout.pos.y),
      width: Math.round(layout.size.width),
      height: Math.round(layout.size.height),
      pinInWin: layout.pinInWin,
      center: this.cat.center,
      peekDx,
      e,
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
      size: { width: PET_W, height: PET_H },
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
      const rightGap = this.workArea.x + this.workArea.width - (this.catOrigin.x + PET_W);
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

  private draw(now: number): void {
    // 猫相位 = 绝对时间（native main.rs:3945 `i.time` 直进 draw_cat :4736）：降帧只是
    // 采样稀，相位不许被帧率拖慢——「cat.t += dt 且封顶 50ms」在 4 fps 下时钟会慢 5 倍
    // （呼吸 4.2s 拉成 21s），已废。50ms 封顶只属于 P2 的缓动状态量（main.rs:4964/4362）。
    this.cat.t = now / 1000;
    // 藏身状态机走在绘制前：peek/夹取/发请求都发生在同一帧（native 的
    // layout-send 与 tick 分两段只是 egui 结构，1 帧差不可观察）。
    const peekAnimating = this.tickTuck(now / 1000);
    const snapshot = this.tickCompanion(now);

    // 三档 fps：走路/投掷要 60，气泡/藏身缓动/计时动作 30，静坐 4。
    const moving = snapshot !== null
      && (snapshot.activity === "walk" || snapshot.activity === "thrown");
    // 计时动作（洗脸/哈欠/伸懒腰/歪头/摸摸/吃/玩）与落地压扁都是连续动画：
    // 留在 4fps 档会把它们切成一秒四格，动作越细腻越像卡带。
    const animating = snapshot !== null
      && (snapshot.activityProgress > 0 || snapshot.squash > 0);
    if (moving) this.fps = FPS_HOVER;
    else if (peekAnimating || this.bubbleExpand > 0 || animating) this.fps = FPS_ACTIVE;
    else this.fps = FPS_IDLE;

    if (snapshot) this.applyCompanionPose(snapshot);
    // 免打扰在源头闸住「睡着」这条分支（native #53/#67）：月牙与 Zzz 屏幕互斥，
    // art.ts 里的 `!quiet` 条只压得掉 Zzz 的尾巴，压不掉已经躺下的 mood:"sleep" 本体。
    // quiet 期间 sleep 档被改写成 idle——月牙是唯一的记号，不许睡脸冒充。
    const sleepSuppressed = this.quiet;
    if (sleepSuppressed && this.cat.mood === "sleep") this.cat.mood = "idle";
    // 月牙记号的唯一数据源是 cat.quiet（art.ts :415 `if (quiet)`）：
    // setQuiet 只翻自身字段，draw 时必须回写进猫输入，否则月牙永远画不出来。
    this.cat.quiet = this.quiet;

    // 变换里已折 zoom，clear/气泡都要拿到 zoom 归一后的基址几何。
    const w = (this.opts.canvas.clientWidth || PET_W) / this.zoom;
    const h = (this.opts.canvas.clientHeight || PET_H) / this.zoom;
    this.ctx.clearRect(0, 0, w, h);
    const ops = buildCatOps(this.cat);
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

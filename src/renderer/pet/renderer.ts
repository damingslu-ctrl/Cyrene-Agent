/// <reference path="../types/cyrene.d.ts" />
import {
  computeCatRect,
  computePetLayout,
  PET_H,
  PET_W,
  PIN,
  scaleFor,
  type Point,
  type WorkArea,
} from "../../shared/pet-geometry";
import { paintOps } from "./ops";
import { buildCapsuleOps, buildCatOps, type CatInput } from "./art";

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
   * P1 只做两档步进：面板/气泡在 P2 才带 e 动画。
   * P1 无调用方——这是 Task 12 的消费面（brief Interfaces 钉住的产出契约）。
   */
  requestBounds(
    content: "pet" | "bubble" | "panel",
    g: number,
    catOrigin: Point,
    workArea: WorkArea,
    peekDx = 0,
  ): void {
    const layout = computePetLayout({
      catOrigin,
      e: content === "panel" ? g : 0,
      be: content === "bubble" ? g : 0,
      growLeft: false,
      growUp: false,
      workArea,
      peekDx,
    });
    window.verge.resizePetWindow({
      x: Math.round(layout.pos.x),
      y: Math.round(layout.pos.y),
      width: Math.round(layout.size.width),
      height: Math.round(layout.size.height),
    });
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

    // 变换里已折 zoom，clear/胶囊都要拿到 zoom 归一后的基址几何。
    const w = (this.opts.canvas.clientWidth || PET_W) / this.zoom;
    const h = (this.opts.canvas.clientHeight || PET_H) / this.zoom;
    this.ctx.clearRect(0, 0, w, h);
    paintOps(this.ctx, [
      ...buildCatOps(this.cat),
      // P1 没有流量数据源：up/down 照实传 null（胶囊显示 "--"，「没连上内核」≠「连着但没流量」）；
      // e=0、unread=0、无气泡。胶囊锚在窗口矩形 + growLeft，不跟猫体变换走（native main.rs:4976-4987）。
      ...buildCapsuleOps({
        rectWidth: w,
        rectHeight: h,
        e: 0,
        growLeft: false,
        up: null,
        down: null,
        unreadCount: 0,
        bubbleVisible: false,
      }),
    ]);
  }
}

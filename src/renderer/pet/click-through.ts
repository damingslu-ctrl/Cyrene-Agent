import type { PixelPetRenderer } from "./renderer";

export interface ClickThroughOptions {
  /**
   * 像素 alpha (0-255) 达到该值即视为落在猫身上、可点；低于它＝透明＝穿透。
   * 沿用 live2d/click-through.ts 的默认 10：半透明的抗锯齿边缘仍要判为可点。
   */
  alphaThreshold?: number;
  /** `true` = 窗口捕获指针；`false` = 点击穿透到桌面。 */
  onInteractive?: (interactive: boolean) => void;
}

/**
 * 与 live2d/click-through.ts 同判据（alphaThreshold ?? 10、rAF 合帧、状态变化才发 IPC），
 * 差别只在取样从 gl.readPixels 换成 canvas 2D 的 getImageData（renderer.readAlpha）。
 *
 * 上游「取不到 alpha 就宽松返回 true」那条分支（`if (!gl) return true`）在这里没有对应态：
 * 2D context 在 renderer 构造时就存在，不存在「init 前采样失败」；越界读与上游同口径
 * 判穿透（live2d/click-through.ts 的 drawingBuffer 越界分支返回 false）。
 */
export class ClickThroughController {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: PixelPetRenderer;
  private readonly alphaThreshold: number;
  private readonly onInteractive?: (interactive: boolean) => void;

  private rafId: number | null = null;
  private pendingPoint: { x: number; y: number } | null = null;
  private currentState: boolean | null = null;
  /** 最后已知的光标屏幕位：窗口自己挪动时，用它重判「现在光标下面是什么」。 */
  private lastPoint: { x: number; y: number } | null = null;
  private paused = false;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: PixelPetRenderer,
    options: ClickThroughOptions = {},
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.alphaThreshold = options.alphaThreshold ?? 10;
    this.onInteractive = options.onInteractive;

    canvas.addEventListener("pointermove", this.handleMove);
    canvas.addEventListener("pointerleave", this.handleLeave);
  }

  pause(): void {
    this.paused = true;
    this.cancelPending();
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    // 复位状态缓存：恢复判定而不是短路在过期的「已经可交互」上。
    this.currentState = null;
    // 拖拽结束时窗口已被搬走、光标却还没动过：按最后光标点补判一次，
    // 否则松手到下一次 move 之间，猫身上是穿透的。
    this.refreshAfterWindowMove();
  }

  /**
   * 漫游/气泡展开/拖拽把窗口在光标底下挪走之后调用：同一屏幕点按新窗口坐标重判。
   * rAF 合帧——一次动画里连发多帧 PET_RESIZE 也只算一次。
   */
  refreshAfterWindowMove(): void {
    if (this.disposed || this.paused) return;
    if (!this.lastPoint) return;
    this.pendingPoint = { ...this.lastPoint };
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.flush);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.canvas.removeEventListener("pointermove", this.handleMove);
    this.canvas.removeEventListener("pointerleave", this.handleLeave);
  }

  private handleMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    // 拖拽暂停期间也记位置：松手后的补判要用拖到的那个点，而不是起手点。
    this.lastPoint = { x: event.clientX, y: event.clientY };
    if (this.paused) return;
    this.pendingPoint = { ...this.lastPoint };
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.flush);
    }
  };

  private handleLeave = (): void => {
    // 光标出窗：窗口再动与它无关，不许拿旧点把命中状态翻回来。
    this.lastPoint = null;
    this.cancelPending();
  };

  private flush = (): void => {
    this.rafId = null;
    if (this.disposed || this.paused) return;
    const point = this.pendingPoint;
    this.pendingPoint = null;
    if (!point) return;

    const interactive = this.hitTestAlpha(point.x, point.y);
    if (interactive === this.currentState) return; // 幂等：状态没变就不发 IPC
    this.currentState = interactive;
    this.onInteractive?.(interactive);
  };

  /** CSS 坐标 → 窗口内容坐标（canvas 在 82×108 窗里铺满，rect 偏移恒为 0，仍按上游算）。 */
  private hitTestAlpha(cssX: number, cssY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.readAlpha(cssX - rect.left, cssY - rect.top) >= this.alphaThreshold;
  }

  private cancelPending(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingPoint = null;
  }
}

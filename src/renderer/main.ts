import "./ui/theme";
import { PixelPetRenderer } from "./pet/renderer";
import { ClickThroughController } from "./pet/click-through";

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #live2d-canvas not found");

if (!window.cyrene) {
  (window as unknown as { cyrene: unknown }).cyrene = {
    minimize: () => {},
    hide: () => {},
    quit: () => {},
    setInteractive: (_: boolean) => Promise.resolve(),
    moveBy: (_dx: number, _dy: number) => {},
    moveTo: (_x: number, _y: number) => {},
    setDragging: (_isDragging: boolean) => {},
    captureFrame: () => Promise.resolve(null),
    getCursorPosition: () => Promise.resolve(null),
    onPetZoom: (_cb: (zoom: number) => void) => () => {},
    onPetVisibilityChanged: (_cb: (visible: boolean) => void) => () => {},
  };
}

declare global {
  interface Window {
    // live2dSpeech 的 IPC 面先保留（口型在 P5 才接），当前不接渲染器。
    live2dSpeech?: {
      onPrepare: (callback: () => void) => () => void;
      onMouthStart: (callback: (payload: { durationMs: number }) => void) => () => void;
      onMouthStop: (callback: () => void) => () => void;
    };
  }
}

let clickThrough: ClickThroughController | null = null;
let petZoomOff: (() => void) | null = null;
let petVisibilityOff: (() => void) | null = null;
let petVisible = true;
const disposers: Array<() => void> = [];

function trackDispose(off: () => void): void {
  disposers.push(off);
}

function addTrackedEventListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
): void {
  target.addEventListener(type, listener);
  trackDispose(() => target.removeEventListener(type, listener));
}

const renderer = new PixelPetRenderer({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  onLoad: () => {
    console.log("[Cyrene] Pixel pet renderer ready");

    clickThrough = new ClickThroughController(canvas, renderer, {
      onInteractive: (interactive) => void window.cyrene.setInteractive(interactive),
    });

    // Apply the persisted zoom on load and track future changes. The main
    // process has already resized the window to base × zoom; this rescales
    // the canvas transform to match.
    petZoomOff = window.cyrene.onPetZoom((zoom) => renderer.applyZoom(zoom));
    petVisibilityOff = window.cyrene.onPetVisibilityChanged((visible) => {
      petVisible = visible;
      if (!visible) {
        clickThrough?.pause();
        renderer.pause();
        return;
      }
      if (!isDragging) {
        renderer.resume();
        clickThrough?.resume();
      }
    });

    // 启动竞态修复：主进程在渲染进程就绪前发的 PET_ZOOM 事件会被丢弃。
    // 注册监听后主动从磁盘读一次 petZoom 并应用，确保重启后模型大小生效。
    window.settings?.getGeneral().then((cfg) => {
      if (cfg?.petZoom && cfg.petZoom !== 1) {
        renderer.applyZoom(cfg.petZoom);
      }
    }).catch(() => { /* 设置读取失败不影响加载 */ });

    (window as unknown as { __cyrene: unknown }).__cyrene = {
      renderer,
      clickThrough,
      getPetDiagnostics: () => ({
        paused: renderer.isPaused(),
        petVisible,
        isDragging,
      }),
    };
  },
  onError: (err) => {
    console.error("[Cyrene] Failed to init pixel pet renderer:", err);
  },
});

renderer.init();

addTrackedEventListener(window, "resize", () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});

window.addEventListener("beforeunload", () => {
  clickThrough?.dispose();
  clickThrough = null;
  petZoomOff?.();
  petZoomOff = null;
  petVisibilityOff?.();
  petVisibilityOff = null;
  renderer.dispose();
  for (const off of disposers) off();
  disposers.length = 0;
});

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pendingPosition: { x: number; y: number } | null = null;
let rafId: number | null = null;
let dragOverlay: HTMLImageElement | null = null;
let dragToken = 0;

let dragOverlayUrl: string | null = null;

function clearDragOverlay(): void {
  if (dragOverlay) {
    dragOverlay.remove();
    dragOverlay = null;
  }
  if (dragOverlayUrl) {
    URL.revokeObjectURL(dragOverlayUrl);
    dragOverlayUrl = null;
  }
  canvas.style.visibility = "";
}

function captureCanvasBlob(): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      // 2D canvas 保留自己的 backing bitmap，渲染器 pause 后 toBlob 读到的
      // 仍是最后一帧画好的内容（对位旧 WebGL 时代的 preserveDrawingBuffer）。
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch (err) {
      console.warn("[Cyrene] canvas.toBlob failed", err);
      resolve(null);
    }
  });
}

async function showDragOverlay(token: number): Promise<void> {
  const blob = await captureCanvasBlob();
  if (!blob || token !== dragToken || !isDragging) return;

  const url = URL.createObjectURL(blob);
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.draggable = false;
  img.style.position = "fixed";
  img.style.inset = "0";
  img.style.width = "100vw";
  img.style.height = "100vh";
  img.style.objectFit = "contain";
  img.style.pointerEvents = "none";
  img.style.userSelect = "none";
  img.style.zIndex = "10";

  img.onload = () => {
    if (token !== dragToken || !isDragging) {
      URL.revokeObjectURL(url);
      return;
    }
    dragOverlay?.remove();
    dragOverlay = img;
    dragOverlayUrl = url;
    document.body.appendChild(img);
    canvas.style.visibility = "hidden";
  };
  img.onerror = () => URL.revokeObjectURL(url);
}

function scheduleMoveTo(screenX: number, screenY: number): void {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  if (!Number.isFinite(dragOffsetX) || !Number.isFinite(dragOffsetY)) return;
  pendingPosition = {
    x: screenX - dragOffsetX,
    y: screenY - dragOffsetY,
  };
  if (rafId === null) {
    rafId = requestAnimationFrame(flushMove);
  }
}

function flushMove(): void {
  rafId = null;
  if (pendingPosition) {
    window.cyrene.moveTo(pendingPosition.x, pendingPosition.y);
    pendingPosition = null;
  }
}

function cancelPendingMove(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingPosition = null;
}

function finishDrag(): void {
  isDragging = false;
  dragToken += 1;
  cancelPendingMove();
  clearDragOverlay();
  if (petVisible) {
    renderer.resume();
  }
  window.cyrene.setDragging(false);
  if (petVisible) clickThrough?.resume();
}

// Click-through is driven per-pixel by ClickThroughController on pointermove.
// We only need enter/leave to bookend the cursor's stay in the window:
// entering hands control to the controller, leaving the window entirely
// means there's nothing to capture (and no move will fire), so pass through.
addTrackedEventListener(canvas, "pointerenter", () => {
  clickThrough?.resume();
});

addTrackedEventListener(canvas, "pointercancel", () => {
  if (isDragging) finishDrag();
});

addTrackedEventListener(canvas, "pointerleave", () => {
  if (isDragging) return;
  void window.cyrene.setInteractive(false);
});

addTrackedEventListener(canvas, "pointerdown", (e) => {
  const event = e as PointerEvent;
  // 只认左键：右键是「安静半小时」的手势，不能被拖窗顺手吃掉。
  if (event.button !== 0) return;
  if (isDragging) return;
  if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;
  if (!Number.isFinite(window.screenX) || !Number.isFinite(window.screenY)) return;
  isDragging = true;
  dragToken += 1;
  const token = dragToken;
  dragOffsetX = event.screenX - window.screenX;
  dragOffsetY = event.screenY - window.screenY;
  cancelPendingMove();
  clickThrough?.pause();
  renderer.pause();
  void window.cyrene.setInteractive(true);
  window.cyrene.setDragging(true);
  try {
    (event.target as Element).setPointerCapture(event.pointerId);
  } catch {}
  void showDragOverlay(token);
});

addTrackedEventListener(canvas, "pointermove", (e) => {
  const event = e as PointerEvent;
  if (!isDragging) return;
  scheduleMoveTo(event.screenX, event.screenY);
});

addTrackedEventListener(canvas, "pointerup", (e) => {
  const event = e as PointerEvent;
  if (!isDragging) return;
  scheduleMoveTo(event.screenX, event.screenY);
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  flushMove();
  finishDrag();

  try {
    (event.target as Element).releasePointerCapture(event.pointerId);
  } catch {}

  const rect = canvas.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) void window.cyrene.setInteractive(false);
});

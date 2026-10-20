import "./ui/theme";
import { CONSOLE_PREFIX } from "../shared/brand";
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
let quietChangedOff: (() => void) | null = null;
let tuckChangedOff: (() => void) | null = null;
let geometryChangedOff: (() => void) | null = null;
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
    console.log(`${CONSOLE_PREFIX} Pixel pet renderer ready`);

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

    // 免打扰（Task 11）：启动先读一次盘上状态（跨重启的安静期），再订安静状态变更的下行。
    // 落盘的变化才算数（brief 验收判据），屏幕上的月牙只是它的影子。
    window.verge?.isQuiet().then((quiet) => renderer.setQuiet(quiet))
      .catch(() => { /* 状态读取失败不影响加载：月牙缺失比启动失败轻 */ });
    quietChangedOff = window.verge?.onQuietChanged(({ quietUntil }) => {
      // payload 带的是**当下** quietUntil：写盘（右键菜单 / toggle）时是未来的截止，
      // 到点自醒当场清盘后是 null（native main.rs:2515-2517）。判据按真语义一条通用：
      // 还落在未来就还是安静。
      renderer.setQuiet(quietUntil !== null && Date.now() < quietUntil);
    }) ?? null;

    // —— Task 12 贴边藏身与显示器变更 ——
    // 几何基线起帧拉一次。null = 主端还没窗——不许兜底拼一份假基线：
    // 状态机没有基线就不跑（没窗本就没有猫）。
    void window.verge?.getPetGeometry().then((geo) => {
      if (geo) renderer.syncGeometry(geo);
    }).catch(() => { /* 拉不到基线：藏身不启动，不影响猫本身画出来 */ });
    geometryChangedOff = window.verge?.onPetGeometryChanged(({ bounds, workArea }) => {
      // display-metrics-changed 主端重夹取后的推送：渲染端跟着重建 catOrigin，
      // 它自己不发位置指令——位置权威始终在 main。
      renderer.syncWindowBounds(bounds, workArea);
    }) ?? null;
    tuckChangedOff = window.verge?.onTuckChanged(({ tuckEnabled }) => {
      renderer.setTuckEnabled(tuckEnabled);
    }) ?? null;

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
    console.error(`${CONSOLE_PREFIX} Failed to init pixel pet renderer:`, err);
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
  quietChangedOff?.();
  quietChangedOff = null;
  tuckChangedOff?.();
  tuckChangedOff = null;
  geometryChangedOff?.();
  geometryChangedOff = null;
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
      console.warn(`${CONSOLE_PREFIX} canvas.toBlob failed`, err);
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

function flushMove(): { x: number; y: number } | null {
  rafId = null;
  if (pendingPosition) {
    const flushed = pendingPosition;
    window.cyrene.moveTo(flushed.x, flushed.y);
    pendingPosition = null;
    return flushed;
  }
  return null;
}

function cancelPendingMove(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingPosition = null;
}

function finishDrag(finalPos: { x: number; y: number } | null): void {
  isDragging = false;
  dragToken += 1;
  cancelPendingMove();
  clearDragOverlay();
  // 勘误 8 的顺序：先 setDragging(false) 开回主端位置门，再让渲染端重算并补发
  // bounds——反过来会把这次 PET_RESIZE 的位置变化吞在闸门里，猫停在拖拽起点。
  // setDragging(false) 同时让 controller 把最后一次 moveTo 落位并持久化。
  window.cyrene.setDragging(false);
  renderer.endDrag(finalPos);
  // 拖后重拉一次基线（一拖一次 invoke，不是每帧开销）：
  // - pointercancel 没有 finalPos，真实落位只有主端知道；
  // - 跨屏拖拽后 workArea 也要跟着换屏——显示器查询的权威在 main。
  void window.verge?.getPetGeometry().then((geo) => {
    if (geo) renderer.syncGeometry(geo);
  }).catch(() => { /* 拿不到基线：状态机停在旧值，等下一次成功拉取 */ });
  if (petVisible) {
    renderer.resume();
    clickThrough?.resume();
  }
}

// Click-through is driven per-pixel by ClickThroughController on pointermove.
// We only need enter/leave to bookend the cursor's stay in the window:
// entering hands control to the controller, leaving the window entirely
// means there's nothing to capture (and no move will fire), so pass through.
addTrackedEventListener(canvas, "pointerenter", () => {
  clickThrough?.resume();
  // user_active（native main.rs:4609）：光标进窗即闲置清零、藏身闸门断粮、贴着边也退回。
  renderer.setUserActive(true);
});

addTrackedEventListener(canvas, "pointercancel", () => {
  if (isDragging) finishDrag(null);
});

addTrackedEventListener(canvas, "pointerleave", () => {
  if (isDragging) return;
  void window.cyrene.setInteractive(false);
  renderer.setUserActive(false);
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
  // peek 吸收走在冻结快照之前（native main.rs:4796-4801）：applied_pos 可证不变，
  // 拖一只藏着的猫从它**真在的位置**起拖，不许跳。
  renderer.beginDrag();
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
  const finalPos = flushMove();
  finishDrag(finalPos);

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

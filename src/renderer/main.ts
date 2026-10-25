import "./ui/theme";
import { CONSOLE_PREFIX } from "../shared/brand";
import { PixelPetRenderer } from "./pet/renderer";
import { clickKindFor } from "./pet/companion";
import { ClickThroughController } from "./pet/click-through";

const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #pet-canvas not found");

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
let petCommandOff: (() => void) | null = null;
let workStatusOff: (() => void) | null = null;
let profileOff: (() => void) | null = null;
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
  companion: true,
  // 漫游/气泡把窗口在静止光标底下搬走时，穿透判定必须按新窗口坐标重算一次。
  onWindowGeometry: () => clickThrough?.refreshAfterWindowMove(),
  onLoad: () => {
    console.log(`${CONSOLE_PREFIX} Pixel pet renderer ready`);

    clickThrough = new ClickThroughController(canvas, renderer, {
      onInteractive: (interactive) => void window.cyrene.setInteractive(interactive),
    });

    // 注视跟随从这里开始轮询：init 之前 canvas 还没有尺寸，换算出来的目标点没有意义。
    startGazePolling();

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
    window.verge?.isQuiet().then((quiet) => {
      renderer.setQuiet(quiet);
      // 开窗先打个招呼；安静期由引擎拒收，不吵人。
      if (!quiet) renderer.greet();
    }).catch(() => { /* 状态读取失败不影响加载：月牙缺失比启动失败轻 */ });
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
    // 右键菜单的互动动作（摸摸/喂/玩/睡/状态）：菜单在主端，执行权在渲染端。
    petCommandOff = window.verge?.onPetCommand((command) => {
      renderer.handleCommand(command);
    }) ?? null;

    // —— agent 工作状态（六档演出）——
    // 主进程是单一权威，桌宠只是订阅者。先订后读，避免开窗瞬间漏掉已经在跑的那一轮。
    let workPushed = false;
    workStatusOff = window.verge?.onWorkStatus((status) => {
      workPushed = true;
      renderer.setWorkStatus(status?.tier ?? null);
    }) ?? null;
    void window.verge?.getWorkStatus().then((status) => {
      if (!workPushed) renderer.setWorkStatus(status?.tier ?? null);
    }).catch(() => { /* 读不到就当没在干活：不演比演错轻 */ });

    // —— v1.5.0 形态与档位：boot 读 + 下行订阅（先订后读，boot 不盖掉已到的下行）——
    let profilePushed = false;
    profileOff = window.verge?.onProfileUpdate((ref) => {
      profilePushed = true;
      renderer.setProfile(ref);
    }) ?? null;
    void window.verge?.getProfile().then((ref) => {
      if (ref && !profilePushed) renderer.setProfile(ref);
    }).catch(() => { /* 读不到就停在 cat/standard：猫照画 */ });

    (window as unknown as { __cyrene: unknown }).__cyrene = {
      renderer,
      clickThrough,
      getPetDiagnostics: () => ({
        paused: renderer.isPaused(),
        petVisible,
        isDragging,
        // 尺 #71 / #74 的读数口：命中矩形、形态、档位。这三个键从此不许静默改名。
        hitRect: renderer.getHitRect(),
        form: (renderer as unknown as { form: string }).form,
        tier: renderer.getProfileRef().tier,
        // 同上：基址窗口与绘制原点。尺 #71 要靠它们把「宠物本体」与「气泡」分开量。
        layout: renderer.getLayoutInfo(),
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
  // 窗口尺寸变了，同一光标点下的像素也变了（气泡展开尤其明显）。
  clickThrough?.refreshAfterWindowMove();
});

/**
 * 注视跟随：让眼球跟着光标转。
 *
 * 为什么是轮询而不是 pointermove：桌宠窗口默认 `setIgnoreMouseEvents(true, {forward:true})`，
 * 光标在**透明像素**上时渲染端收不到 pointermove（点击穿透的本意）——那正好是「猫看着鼠标
 * 走过去」这段最想有反应的时刻。所以按固定节流问主进程要一次全局光标位置。
 *
 * 换算：主端给屏幕坐标，窗口自己的 screenX/screenY 是屏幕坐标，canvas 铺满窗口，
 * 两者相减就是窗口内容坐标（zoom 已折在 canvas 的 transform 里，不需要再除）。
 * 离窗口太远就不必算：视线偏移在 400px 外已经饱和，省掉无谓的帧。
 */
const GAZE_POLL_MS = 120;
const GAZE_MAX_DISTANCE_PX = 420;
let gazeTimer: number | null = null;

function stopGazePolling(): void {
  if (gazeTimer !== null) {
    window.clearInterval(gazeTimer);
    gazeTimer = null;
  }
  renderer.setGazeTarget(null);
}

function startGazePolling(): void {
  if (gazeTimer !== null) return;
  gazeTimer = window.setInterval(() => {
    if (!petVisible || isDragging) return;
    void window.cyrene.getCursorPosition().then((cursor) => {
      if (!cursor) return;
      // 窗口原点在漫游时会动，每帧现取，不能缓存。
      const ox = window.screenX, oy = window.screenY;
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;
      const x = cursor.x - ox;
      const y = cursor.y - oy;
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      if (Math.hypot(x - cx, y - cy) > GAZE_MAX_DISTANCE_PX) {
        renderer.setGazeTarget(null);
        return;
      }
      renderer.setGazeTarget([x, y]);
    }).catch(() => { /* 拿不到光标就当没有目标：眼球回到自主游移 */ });
  }, GAZE_POLL_MS);
}

window.addEventListener("beforeunload", () => {
  stopGazePolling();
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
  petCommandOff?.();
  petCommandOff = null;
  workStatusOff?.();
  workStatusOff = null;
  profileOff?.();
  profileOff = null;
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

/** 按下后走满这个距离才算「拖」；以下都算「点」。 */
const DRAG_THRESHOLD_PX = 4;
/** 投掷速度只取松手前这段轨迹，早年拖得多快不算。 */
const VELOCITY_WINDOW_MS = 150;

let pressPending = false;
let pressStartX = 0;
let pressStartY = 0;
let pressAtMs = 0;
let moveSamples: Array<{ x: number; y: number; t: number }> = [];

/**
 * 单点＝戳一下（poke），按住 ≥500ms 且没拖过 4px＝摩挲（pet）。
 * 双击→玩 已退役：连点被引擎的 2.5s 合并窗收掉，「玩」仍有右键菜单直达（口径差⑮）。
 */
function reportTouch(heldMs: number): void {
  renderer.touch(clickKindFor(heldMs));
}

/**
 * 滚轮互动：向上=摸摸，向下=逗它玩。
 *
 * 滚轮只在光标**压在猫身上**时收得到（透明处窗口是穿透的，wheel 不会转发），
 * 这恰好是「对着它滚」的语义，不需要额外的命中判定。
 * 触控板一次滑动会连发几十个 wheel：用「合流窗 + 冷却」把它压成一次互动，
 * 否则会连摸十下、每秒刷一句台词。
 */
const WHEEL_MERGE_MS = 260;
const WHEEL_COOLDOWN_MS = 1400;
let wheelAccum = 0;
let wheelLastAt = 0;
let wheelFiredAt = 0;

function onWheel(event: WheelEvent): void {
  if (isDragging || renderer.isPaused()) return;
  const now = performance.now();
  // 合流窗：距上一滚超过窗口就算新的一拨，累加量清零重新判方向。
  if (now - wheelLastAt > WHEEL_MERGE_MS) wheelAccum = 0;
  wheelLastAt = now;
  wheelAccum += event.deltaY;
  if (Math.abs(wheelAccum) < 40) return;
  if (now - wheelFiredAt < WHEEL_COOLDOWN_MS) return;
  wheelFiredAt = now;
  // deltaY < 0 是向上滚（远离用户）：摸摸；向下：逗她玩。
  renderer.handleCommand(wheelAccum < 0 ? "pet" : "play");
  wheelAccum = 0;
}

function recordMoveSample(screenX: number, screenY: number, now: number): void {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
  moveSamples.push({ x: screenX, y: screenY, t: now });
  const cutoff = now - VELOCITY_WINDOW_MS;
  while (moveSamples.length > 2 && moveSamples[0].t < cutoff) moveSamples.shift();
}

/** 松手速度（px/s）：窗口轨迹的屏幕坐标差除以时间，够快引擎就转投掷物理。 */
function takeThrowVelocity(): { x: number; y: number } {
  const first = moveSamples[0];
  const last = moveSamples[moveSamples.length - 1];
  moveSamples = [];
  if (!first || !last) return { x: 0, y: 0 };
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0.016) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

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

function finishDrag(
  finalPos: { x: number; y: number } | null,
  velocity: { x: number; y: number } = { x: 0, y: 0 },
): void {
  isDragging = false;
  pressPending = false;
  moveSamples = [];
  dragToken += 1;
  cancelPendingMove();
  clearDragOverlay();
  // 勘误 8 的顺序：先 setDragging(false) 开回主端位置门，再让渲染端重算并补发
  // bounds——反过来会把这次 PET_RESIZE 的位置变化吞在闸门里，猫停在拖拽起点。
  // setDragging(false) 同时让 controller 把最后一次 moveTo 落位并持久化。
  window.cyrene.setDragging(false);
  renderer.endDrag(finalPos, velocity);
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

// 滚轮单独登记：要 `passive: false` 才能 preventDefault（滚轮在桌宠上不该滚任何东西），
// 而 `addTrackedEventListener` 只收 (target, type, listener) 三参。
const onWheelEvent = (event: Event): void => {
  event.preventDefault();
  onWheel(event as WheelEvent);
};
canvas.addEventListener("wheel", onWheelEvent, { passive: false });
trackDispose(() => canvas.removeEventListener("wheel", onWheelEvent));

function beginDragAt(event: PointerEvent): void {
  if (!Number.isFinite(window.screenX) || !Number.isFinite(window.screenY)) {
    pressPending = false;
    return;
  }
  isDragging = true;
  pressPending = false;
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
  void showDragOverlay(token);
}

/** 松手/点头落点已在窗外：下一次移动之前窗口不该继续吃指针。 */
function releaseOutside(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) void window.cyrene.setInteractive(false);
}

addTrackedEventListener(canvas, "pointercancel", () => {
  pressPending = false;
  moveSamples = [];
  if (isDragging) finishDrag(null);
});

addTrackedEventListener(canvas, "pointerleave", () => {
  // 按住期间不放行：capture 还在，松手会回来，此刻撤互动会把 capture 冲掉。
  if (isDragging || pressPending) return;
  void window.cyrene.setInteractive(false);
  renderer.setUserActive(false);
});

addTrackedEventListener(canvas, "pointerdown", (e) => {
  const event = e as PointerEvent;
  // 只认左键：右键是「安静半小时」的手势，不能被拖窗顺手吃掉。
  if (event.button !== 0) return;
  if (isDragging || pressPending) return;
  if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;

  // 气泡比猫宽：点在气泡上先让它闭嘴，不拖窗、也不算摸摸。
  const rect = canvas.getBoundingClientRect();
  if (renderer.isPointOnBubble(event.clientX - rect.left, event.clientY - rect.top)) {
    renderer.dismissBubble();
    return;
  }

  pressPending = true;
  pressStartX = event.screenX;
  pressStartY = event.screenY;
  pressAtMs = performance.now();
  moveSamples = [];
  recordMoveSample(event.screenX, event.screenY, performance.now());
  // 先按住 capture：4px 阈值内滑出窗也能收到 pointerup。
  try {
    (event.target as Element).setPointerCapture(event.pointerId);
  } catch {}
});

addTrackedEventListener(canvas, "pointermove", (e) => {
  const event = e as PointerEvent;
  if (isDragging) {
    recordMoveSample(event.screenX, event.screenY, performance.now());
    scheduleMoveTo(event.screenX, event.screenY);
    return;
  }
  if (!pressPending) return;
  if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;
  const dx = event.screenX - pressStartX;
  const dy = event.screenY - pressStartY;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  beginDragAt(event);
});

addTrackedEventListener(canvas, "pointerup", (e) => {
  const event = e as PointerEvent;

  if (isDragging) {
    recordMoveSample(event.screenX, event.screenY, performance.now());
    const velocity = takeThrowVelocity();
    scheduleMoveTo(event.screenX, event.screenY);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const finalPos = flushMove();
    finishDrag(finalPos, velocity);

    try {
      (event.target as Element).releasePointerCapture(event.pointerId);
    } catch {}

    releaseOutside(event);
    return;
  }

  if (pressPending) {
    pressPending = false;
    moveSamples = [];
    reportTouch(performance.now() - pressAtMs);
    try {
      (event.target as Element).releasePointerCapture(event.pointerId);
    } catch {}
    releaseOutside(event);
  }
});

import { app, BrowserWindow, screen, type NativeImage } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { createPetWindow, normalizePetZoom, PET_WINDOW_BASE_HEIGHT, PET_WINDOW_BASE_WIDTH, type PetWindowSettingsSlice } from "../startup/create-pet-window";
import {
  createCallWindow,
  createReactChatWindowShell,
  createStickerManagerWindow,
  loadReactChatWindowPage,
  loadOnboardingWindowPage,
  createOnboardingBrowserWindow,
  type ReactChatWindowHandle,
  showReactChatWindow,
} from "./create-aux-windows";
import { CHAT_READY_TIMEOUT_MS, loadWindowForStartup } from "./startup-window-load";
import { createMusicPlayerWindow } from "./create-music-player-window";
import { broadcastToAllWindows } from "./broadcast";
import { PetWindowMoveController } from "../pet-window-movement";
import { CURRENT_DISCLAIMER_VERSION } from "../../shared/disclaimer";
import { shouldApplyBounds, type PetBounds, type PetResizePayload } from "./pet-bounds";
import { clampBoundsToWorkArea } from "../../shared/pet-geometry";
import { formatGeomProbe } from "../verge/geom-probe";

const PET_WINDOW_RESOURCE_RELEASE_DELAY_MS = 30_000;

export interface WindowManagerOptions {
  getCurrentAppIconPath: () => string;
  isDev: boolean;
  loadPetWindowSettingsSlice: () => PetWindowSettingsSlice;
  persistPetWindowPosition: (position: { x: number; y: number }) => void;
  /**
   * 宠物窗右键菜单挂载（Task 11）：由组合根把 verge 模块的菜单/免打扰装配好后注入。
   * window-manager 不 import verge（依赖窄向），窗壳只负责在每次建窗时喊一声。
   */
  attachPetContextMenu?: (win: BrowserWindow) => void;
}

export interface WindowManager {
  hasCurrentDisclaimerConsent?(): boolean;
  createOnboardingWindow?(): Promise<BrowserWindow>;
  showOnboardingWindow?(): void;
  closeOnboardingWindow?(): void;
  createPetWindow(showOnReady?: boolean): BrowserWindow;
  /** 创建（或复用）未加载页面的聊天窗口壳；页面加载由显式 load() 驱动。 */
  createReactChatWindowShell(): ReactChatWindowHandle;
  /** 打开聊天窗口：必要时创建壳并加载页面，然后显示并分发会话。 */
  openReactChatWindow(sessionId?: string): Promise<BrowserWindow>;
  openSettings(section?: string): Promise<void>;
  openScheduledTasks(): Promise<void>;
  createStickerManagerWindow(): void;
  createCallWindow(): void;
  createMusicPlayerWindow(): void;

  showPetWindow(): void;
  hidePetWindow(): void;
  togglePetWindow(): void;
  minimizePetWindow(): void;
  setPetWindowAlwaysOnTop(alwaysOnTop: boolean): void;
  setPetWindowInteractive(interactive: boolean): void;
  setPetWindowDragging(isDragging: boolean): void;
  movePetWindowRelative(dx: number, dy: number): void;
  movePetWindowTo(x: number, y: number): void;
  applyPetWindowZoom(zoom: number): void;
  setPetWindowBounds(payload: PetResizePayload): void;
  /** 组合根拉几何基线用（Task 12 VERGE_GET_PET_GEOMETRY）：无窗返回 null。 */
  getPetWindowBounds(): PetBounds | null;
  capturePetWindowFrame(): Promise<string | null>;
  capturePetWindow(): Promise<Electron.NativeImage | null>;
  getCursorScreenPosition(): { x: number; y: number };
  setIconForAllWindows(icon: NativeImage): void;
  sendToPetWindow(channel: string, payload?: unknown): void;
  broadcast(channel: string, payload: unknown): void;

  onPetWindowReady(handler: (win: BrowserWindow) => void): void;
  onPetWindowClosed(handler: () => void): void;
  onPetWindowMoved(handler: (position: { x: number; y: number }) => void): void;

  dispose(): void;
}

/**
 * 紧挨着 setSize 之前放开尺寸上下限。
 *
 * Windows 上 `resizable: false` 的窗每落一次尺寸，Chromium 就把 min/max 重新锁成该尺寸，
 * 于是「放大能成、缩小必被夹回」——面板 248×482 收不回 82×108，且是静默失效。
 * 四档尖峰实测（docs/verge/spikes/p1-window.md）：创建时放开一次没用，只有紧挨着
 * setSize 之前放开才有效。
 */
function unlockWindowSize(win: BrowserWindow): void {
  win.setMinimumSize(1, 1);
  win.setMaximumSize(100000, 100000);
}

export function createWindowManager(options: WindowManagerOptions): WindowManager {
  let petWindow: BrowserWindow | null = null;
  let onboardingWindow: BrowserWindow | null = null;
  let chatShell: ReactChatWindowHandle | null = null;
  let chatLoadPromise: Promise<void> | null = null;
  let petWindowReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  const readyHandlers: Array<(win: BrowserWindow) => void> = [];
  const closedHandlers: Array<() => void> = [];
  const movedHandlers: Array<(position: { x: number; y: number }) => void> = [];
  let petWindowDragging = false;
  let lastGeomProbeAt = Number.NEGATIVE_INFINITY;
  // 渲染端的 PET_RESIZE 载荷宽高恒是**基址**（renderer.ts 把 zoom 折进 ctx.setTransform，
  // 不动载荷），主端是物理尺寸的唯一权威：落位前要乘回 zoom。不乘的话，applyPetWindowZoom
  // 刚把窗长到 123×162，渲染端下一帧（约 16ms 后）就把它缩回 82×108——屏幕层⑤实测到的
  // 「petZoom 静默失效」正是这条。native 没有缩放档，这是 fork 侧两条通道的对账。
  let petWindowZoom = 1;

  // native main.rs:4171-4184 的每帧 workArea 夹取搬到事件驱动：显示器拓扑/工作区
  // 一变（拔副屏、改缩放、换任务栏高度）就把窗夹回当前屏，猫不许丢在已消失的坐标上。
  // 偏离 native 一处并记录在案：native 只改内存 pet_pos，这里额外落盘——我们的保存点
  // 活在 state 文件里，若不跟着夹，重启后猫会再次出现在坏坐标上。
  const onDisplayMetricsChanged = (): void => {
    const win = getUsablePetWindow();
    if (!win) return;
    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const clamped = clampBoundsToWorkArea(bounds, workArea);
    // shouldApplyBounds 返回的 delta 对象恒真（勘误：判 .move，不判对象）——
    // 已在位的一字不动，也不许多发一次 persist。
    if (!shouldApplyBounds(bounds, clamped).move) return;
    win.setBounds(clamped, false);
    options.persistPetWindowPosition({ x: clamped.x, y: clamped.y });
    // 渲染端不是位置权威，但它得知道位置被主端改了：推新几何，让它重建 catOrigin。
    win.webContents.send(IPC.VERGE_PET_GEOMETRY, {
      bounds: win.getBounds(),
      workArea,
    });
  };
  screen.on("display-metrics-changed", onDisplayMetricsChanged);

  const petWindowMoveController = new PetWindowMoveController(
    () => petWindow,
    (position) => {
      options.persistPetWindowPosition(position);
    },
  );

  function getUsablePetWindow(): BrowserWindow | null {
    if (!petWindow || petWindow.isDestroyed()) return null;
    return petWindow;
  }

  function cancelPetWindowResourceRelease(): void {
    if (petWindowReleaseTimer === null) return;
    clearTimeout(petWindowReleaseTimer);
    petWindowReleaseTimer = null;
  }

  function schedulePetWindowResourceRelease(window: BrowserWindow): void {
    cancelPetWindowResourceRelease();
    if (window.isDestroyed() || window.isVisible()) return;
    petWindowReleaseTimer = setTimeout(() => {
      petWindowReleaseTimer = null;
      if (petWindow !== window || window.isDestroyed() || window.isVisible()) return;
      window.destroy();
    }, PET_WINDOW_RESOURCE_RELEASE_DELAY_MS);
  }

  function hasCurrentDisclaimerConsent(): boolean {
    const version = options.loadPetWindowSettingsSlice().disclaimerAcceptedVersion;
    return version === undefined || version === CURRENT_DISCLAIMER_VERSION;
  }

  async function createOnboardingWindow(): Promise<BrowserWindow> {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) return onboardingWindow;
    const window = createOnboardingBrowserWindow();
    onboardingWindow = window;
    let appIsQuitting = false;
    app.once("before-quit", () => { appIsQuitting = true; });
    window.on("close", (event) => {
      if (!hasCurrentDisclaimerConsent() && !appIsQuitting) {
        event.preventDefault();
        app.quit();
      }
    });
    window.on("closed", () => {
      if (onboardingWindow === window) onboardingWindow = null;
    });
    try {
      await loadOnboardingWindowPage(window);
      return window;
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  function showOnboardingWindow(): void {
    const existing = onboardingWindow;
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    void createOnboardingWindow()
      .then((window) => { window.show(); window.focus(); })
      .catch((error) => {
        console.error("[WindowManager] onboarding window failed to load:", error);
        app.quit();
      });
  }

  function setPetWindow(window: BrowserWindow, showOnReady = true): void {
    petWindow = window;
    window.once("ready-to-show", () => {
      if (petWindow !== window || window.isDestroyed()) return;
      if (showOnReady) {
        window.show();
      } else {
        schedulePetWindowResourceRelease(window);
      }
      for (const handler of readyHandlers) {
        try { handler(window); } catch (err) { console.error("[WindowManager] ready handler failed:", err); }
      }
    });
    window.on("hide", () => schedulePetWindowResourceRelease(window));
    window.on("show", cancelPetWindowResourceRelease);
    window.on("closed", () => {
      cancelPetWindowResourceRelease();
      petWindowMoveController.dispose();
      const wasCurrentPetWindow = petWindow === window;
      if (wasCurrentPetWindow) petWindow = null;
      if (!wasCurrentPetWindow) return;
      // 拖拽中的窗口被销毁（渲染进程崩、退出、换屏重建）时没人再发 setDragging(false)，
      // 位置门会永远关着、PET_RESIZE 退化成只发尺寸。关门时把闸门本身复位。
      petWindowDragging = false;
      for (const handler of closedHandlers) {
        try { handler(); } catch (err) { console.error("[WindowManager] closed handler failed:", err); }
      }
    });
    window.on("moved", () => {
      const win = petWindow;
      if (!win || win.isDestroyed()) return;
      try {
        const [x, y] = win.getPosition();
        for (const handler of movedHandlers) {
          try { handler({ x, y }); } catch (err) { console.error("[WindowManager] moved handler failed:", err); }
        }
      } catch {
        // ignore
      }
    });
  }

  return {
    hasCurrentDisclaimerConsent,
    createOnboardingWindow,
    showOnboardingWindow,
    closeOnboardingWindow(): void {
      onboardingWindow?.close();
    },
    createPetWindow(showOnReady = true): BrowserWindow {
      if (petWindow && !petWindow.isDestroyed()) return petWindow;
      const shouldShowOnReady = showOnReady && hasCurrentDisclaimerConsent();
      const win = createPetWindow(
        {
          getCurrentAppIconPath: options.getCurrentAppIconPath,
          isDev: options.isDev,
          loadGeneralSettings: options.loadPetWindowSettingsSlice,
        },
        { showOnReady: shouldShowOnReady },
      );
      setPetWindow(win, shouldShowOnReady);
      // 右键菜单（Task 11）：每次建窗都重挂一次——窗口销毁时 webContents 上的监听
      // 随窗口一起没了，不应有跨窗口残留（挂载本身查 win.isDestroyed，不重复注册也无害）。
      options.attachPetContextMenu?.(win);
      const settings = options.loadPetWindowSettingsSlice();
      // 建窗时 createPetWindow 已按 petZoom 定过物理尺寸，这里的换算基线必须同步 seeding，
      // 否则首帧 PET_RESIZE 会按 zoom=1 把窗缩回基址（core-bootstrap 要到建窗之后才调
      // applyPetWindowZoom，中间渲染端完全可能先发来请求）。
      petWindowZoom = normalizePetZoom(settings.petZoom);
      const alwaysOnTop = settings.petAlwaysOnTop ?? true;
      win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
      return win;
    },

    createReactChatWindowShell(): ReactChatWindowHandle {
      if (chatShell && !chatShell.window.isDestroyed()) return chatShell;
      const window = createReactChatWindowShell();
      const handle: ReactChatWindowHandle = {
        window,
        load(sessionId?: string): Promise<void> {
          // load() 缓存同一个 Promise：重复调用不会二次加载；
          // sessionId 通过 show() 分发，而非重新加载页面。
          if (!chatLoadPromise || window.isDestroyed()) {
            chatLoadPromise = loadWindowForStartup({
              window,
              load: () => loadReactChatWindowPage(window, sessionId),
              timeoutMs: CHAT_READY_TIMEOUT_MS,
            }).catch((error) => {
              console.error("[WindowManager] chat page load failed:", error);
              throw error;
            });
          }
          return chatLoadPromise;
        },
        show(sessionId?: string): void {
          if (!hasCurrentDisclaimerConsent()) {
            showOnboardingWindow();
            return;
          }
          showReactChatWindow(sessionId);
        },
      };
      chatShell = handle;
      chatLoadPromise = null;
      return handle;
    },

    async openReactChatWindow(sessionId?: string): Promise<BrowserWindow> {
      const handle = this.createReactChatWindowShell();
      if (!hasCurrentDisclaimerConsent()) {
        showOnboardingWindow();
        return handle.window;
      }
      await handle.load(sessionId);
      handle.show(sessionId);
      return handle.window;
    },

    async openSettings(section = "appearance"): Promise<void> {
      const window = await this.openReactChatWindow();
      window.webContents.send(IPC.SETTINGS_SWITCH_SECTION, section);
    },
    async openScheduledTasks(): Promise<void> {
      const window = await this.openReactChatWindow();
      window.webContents.send(IPC.SETTINGS_SWITCH_SECTION, "tasks");
    },
    createStickerManagerWindow,
    createCallWindow,
    createMusicPlayerWindow,

    showPetWindow(): void {
      if (!hasCurrentDisclaimerConsent()) {
        this.hidePetWindow();
        return;
      }
      const win = getUsablePetWindow();
      if (win) {
        win.show();
        return;
      }
      // 窗口不存在（如被意外销毁）时兜底重建，保证托盘/设置永远能救回桌宠
      this.createPetWindow(true);
    },
    hidePetWindow(): void {
      getUsablePetWindow()?.hide();
    },
    togglePetWindow(): void {
      if (!hasCurrentDisclaimerConsent()) {
        this.hidePetWindow();
        return;
      }
      const win = getUsablePetWindow();
      if (!win) {
        this.createPetWindow(true);
        return;
      }
      win.isVisible() ? win.hide() : win.show();
    },
    minimizePetWindow(): void {
      getUsablePetWindow()?.minimize();
    },
    setPetWindowAlwaysOnTop(alwaysOnTop: boolean): void {
      const win = getUsablePetWindow();
      if (!win) return;
      win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
    },
    setPetWindowInteractive(interactive: boolean): void {
      const win = getUsablePetWindow();
      if (!win) return;
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    setPetWindowDragging(isDragging: boolean): void {
      petWindowDragging = isDragging;
      const win = getUsablePetWindow();
      if (!win) return;
      if (!isDragging) petWindowMoveController.finishDragging();
      try {
        win.setOpacity(isDragging ? 0.99 : 1.0);
      } catch (error) {
        console.warn("[WindowManager] Failed to update pet window dragging opacity:", error);
      }
    },
    movePetWindowRelative(dx: number, dy: number): void {
      petWindowMoveController.moveRelative(dx, dy);
    },
    movePetWindowTo(x: number, y: number): void {
      petWindowMoveController.queueAbsolute(x, y);
    },
    applyPetWindowZoom(zoom: number): void {
      const win = getUsablePetWindow();
      if (!win) return;
      // 窗口尺寸的两个 setSize 来源之一（另一个见 setPetWindowBounds）：zoom 按
      // 基址等比放大，PET_RESIZE 发的是基址档、由这里同一系数换算成物理尺寸。
      petWindowZoom = normalizePetZoom(zoom);
      const width = Math.round(PET_WINDOW_BASE_WIDTH * petWindowZoom);
      const height = Math.round(PET_WINDOW_BASE_HEIGHT * petWindowZoom);
      // 长窗之后位置要重新夹：贴右边缘的猫从 82 长到 123，物理矩形会探出工作区
      // 41px，而这条通道没有下一帧 PET_RESIZE 替它兜底。用已证的 setSize +
      // setPosition 两条指令，不换成 setBounds（spike 只验过前者在 resizable:false
      // 下能挣脱尺寸锁）。
      const { workArea } = screen.getDisplayMatching(win.getBounds());
      const clamped = clampBoundsToWorkArea({ ...win.getBounds(), width, height }, workArea);
      unlockWindowSize(win);
      win.setSize(width, height);
      const applied = win.getBounds();
      const clampedMoved = Math.hypot(clamped.x - applied.x, clamped.y - applied.y) > 0.5;
      if (clampedMoved) win.setPosition(clamped.x, clamped.y, false);
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PET_ZOOM, zoom);
        // 渲染端反推的 catOrigin 要跟着新落位走，否则它下一次请求会把窗拽回屏外。
        if (clampedMoved) {
          win.webContents.send(IPC.VERGE_PET_GEOMETRY, { bounds: win.getBounds(), workArea });
        }
      }
    },
    setPetWindowBounds(payload: PetResizePayload): void {
      const win = getUsablePetWindow();
      if (!win) return;
      const physical: PetBounds = {
        x: payload.x,
        y: payload.y,
        width: Math.round(payload.width * petWindowZoom),
        height: Math.round(payload.height * petWindowZoom),
      };
      // 渲染端的 workArea 夹取是按基址算的（computePetLayout 拿 PET_W/OPEN_W），
      // zoom>1 时物理矩形要多探出 (zoom−1)×宽 才贴得上同一条边。这里按 native
      // main.rs:4171-4184 的口径用**实际尺寸**再夹一次；zoom=1 时物理＝基址，
      // 这条夹取恒等，P1 已验的落位一字不动。
      const { workArea } = screen.getDisplayMatching(win.getBounds());
      const clamped = clampBoundsToWorkArea(physical, workArea);
      const clampedMoved = Math.hypot(clamped.x - physical.x, clamped.y - physical.y) > 0.5;
      // 去重读实时 getBounds()：窗口可能被用户拖拽或换屏/DPI 改动过，
      // 缓存"请求值"会和实际落位脱节。
      const delta = shouldApplyBounds(win.getBounds(), clamped);
      // 位置的权威是 PetWindowMoveController（它落盘保存点），本通道只是渲染端
      // 按几何请求跟随。拖拽期间关掉位置门，否则 controller 的 pendingPosition
      // 会在请求之后 flush，把猫拽回旧位（橡皮筋）。尺寸门照常开。
      const applyMove = delta.move && !petWindowDragging;
      // native 的两条门分开发两条指令（main.rs:4308-4315），先尺寸后位置。
      if (delta.size) {
        unlockWindowSize(win);
        win.setSize(clamped.width, clamped.height);
      }
      if (applyMove) win.setPosition(clamped.x, clamped.y, false);
      // 夹取真的挪了窗就得把落位回推：渲染端的位置权威是它自己反推的 catOrigin，
      // 不告诉它，下一帧照样请求原坐标，两条门每帧重开（60fps 的空转 setPosition）。
      if (clampedMoved && applyMove && !win.isDestroyed()) {
        win.webContents.send(IPC.VERGE_PET_GEOMETRY, { bounds: win.getBounds(), workArea });
      }
      if (!delta.size && !applyMove) return;
      if (process.env.VERGE_GEOM_PROBE) {
        // native 每 0.5s 一行（main.rs:4389）：这里同样节流，否则 60fps 下 stderr
        // 自己会盖掉它要测的东西。形状差异要记住：native 在绘制 pass 里**无条件**按
        // 0.5s 打，我们只在「真发出一条指令」时打——落位稳定后 GEOM 就不再有行，
        // 所以屏幕尺取多帧证据必须持续重发请求，不能靠静置（spikes 待验证项 4）。
        const t = performance.now() / 1000;
        if (t - lastGeomProbeAt > 0.5) {
          lastGeomProbeAt = t;
          const actual = win.getBounds();
          console.error(formatGeomProbe({
            t,
            applied: applyMove ? clamped : null,
            actual,
            // Task 12 载荷已扩：这四列是渲染端随 bounds 同帧发来的模型取证量，
            // 不再打 `-`（旧载荷缺列时仍打 `-`——没有证据就承认没有证据）。
            // 单位对账：pos/size 两列是**物理**（乘过 zoom、夹过 workArea），
            // pin/center/peek/e 是渲染端的**基址**模型量。zoom≠1 时拿 pin 对 pos
            // 要自己乘 zoom，读屏幕尺的人必须知道这一点。
            pin: payload.pinInWin ?? null,
            center: payload.center ?? null,
            peekDx: payload.peekDx ?? null,
            e: payload.e ?? null,
            dpr: screen.getDisplayMatching(actual).scaleFactor,
          }));
        }
      }
    },
    getPetWindowBounds(): PetBounds | null {
      const win = getUsablePetWindow();
      if (!win) return null;
      const { x, y, width, height } = win.getBounds();
      return { x, y, width, height };
    },
    async capturePetWindowFrame(): Promise<string | null> {
      const image = await this.capturePetWindow();
      return image ? image.toDataURL() : null;
    },
    async capturePetWindow(): Promise<Electron.NativeImage | null> {
      const win = getUsablePetWindow();
      if (!win) return null;
      try {
        return await win.webContents.capturePage();
      } catch (err) {
        console.error("[WindowManager] capturePetWindow failed:", err);
        return null;
      }
    },
    getCursorScreenPosition(): { x: number; y: number } {
      return screen.getCursorScreenPoint();
    },
    setIconForAllWindows(icon: NativeImage): void {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setIcon(icon);
      }
    },
    sendToPetWindow(channel: string, payload?: unknown): void {
      const win = getUsablePetWindow();
      if (!win) return;
      if (payload === undefined) win.webContents.send(channel);
      else win.webContents.send(channel, payload);
    },
    broadcast(channel: string, payload: unknown): void {
      broadcastToAllWindows(channel, payload);
    },

    onPetWindowReady(handler: (win: BrowserWindow) => void): void {
      readyHandlers.push(handler);
      if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
        try { handler(petWindow); } catch (err) { console.error("[WindowManager] ready handler failed:", err); }
      }
    },
    onPetWindowClosed(handler: () => void): void {
      closedHandlers.push(handler);
    },
    onPetWindowMoved(handler: (position: { x: number; y: number }) => void): void {
      movedHandlers.push(handler);
    },

    dispose(): void {
      cancelPetWindowResourceRelease();
      petWindowMoveController.dispose();
      screen.off("display-metrics-changed", onDisplayMetricsChanged);
    },
  };
}

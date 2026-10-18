import { app, BrowserWindow, screen, type NativeImage } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { createPetWindow, PET_WINDOW_BASE_HEIGHT, PET_WINDOW_BASE_WIDTH, type PetWindowSettingsSlice } from "../startup/create-pet-window";
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
import { shouldApplyBounds, type PetBounds } from "./pet-bounds";
import { formatGeomProbe } from "../verge/geom-probe";

const PET_WINDOW_RESOURCE_RELEASE_DELAY_MS = 30_000;

export interface WindowManagerOptions {
  getCurrentAppIconPath: () => string;
  isDev: boolean;
  loadPetWindowSettingsSlice: () => PetWindowSettingsSlice;
  persistPetWindowPosition: (position: { x: number; y: number }) => void;
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
  setPetWindowBounds(bounds: PetBounds): void;
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
      const settings = options.loadPetWindowSettingsSlice();
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
      // 基址等比放大，PET_RESIZE 按几何档取绝对值，二者后写者赢。
      const width = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
      const height = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);
      win.setSize(width, height);
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PET_ZOOM, zoom);
      }
    },
    setPetWindowBounds(bounds: PetBounds): void {
      const win = getUsablePetWindow();
      if (!win) return;
      // 去重读实时 getBounds()：窗口可能被用户拖拽或换屏/DPI 改动过，
      // 缓存"请求值"会和实际落位脱节。
      const delta = shouldApplyBounds(win.getBounds(), bounds);
      // 位置的权威是 PetWindowMoveController（它落盘保存点），本通道只是渲染端
      // 按几何请求跟随。拖拽期间关掉位置门，否则 controller 的 pendingPosition
      // 会在请求之后 flush，把猫拽回旧位（橡皮筋）。尺寸门照常开。
      const applyMove = delta.move && !petWindowDragging;
      // native 的两条门分开发两条指令（main.rs:4308-4315），先尺寸后位置。
      if (delta.size) win.setSize(bounds.width, bounds.height);
      if (applyMove) win.setPosition(bounds.x, bounds.y, false);
      if (!delta.size && !applyMove) return;
      if (process.env.VERGE_GEOM_PROBE) {
        // native 每 0.5s 一行（main.rs:4389）：这里同样节流，否则 60fps 下 stderr
        // 自己会盖掉它要测的东西。
        const t = performance.now() / 1000;
        if (t - lastGeomProbeAt > 0.5) {
          lastGeomProbeAt = t;
          const actual = win.getBounds();
          console.error(formatGeomProbe({
            t,
            applied: bounds,
            actual,
            // 这四列属猫模型，main 拿不到（见 geom-probe.ts）；打 `-` 而不是猜。
            pin: null,
            center: null,
            peekDx: null,
            e: null,
            dpr: screen.getDisplayMatching(actual).scaleFactor,
          }));
        }
      }
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
    },
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { once: vi.fn() },
  createdWindows: [] as Array<ReturnType<typeof createFakeWindow>>,
  createPetWindow: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })) },
}));
vi.mock("../startup/create-pet-window", () => ({
  createPetWindow: mocks.createPetWindow,
  PET_WINDOW_BASE_HEIGHT: 500,
  PET_WINDOW_BASE_WIDTH: 400,
}));
vi.mock("./create-aux-windows", () => ({
  createCallWindow: vi.fn(), createReactChatWindowShell: vi.fn(), createStickerManagerWindow: vi.fn(),
  loadReactChatWindowPage: vi.fn(), loadOnboardingWindowPage: vi.fn(), createOnboardingBrowserWindow: vi.fn(),
  showReactChatWindow: vi.fn(),
}));
vi.mock("./startup-window-load", () => ({ CHAT_READY_TIMEOUT_MS: 1, loadWindowForStartup: vi.fn() }));
vi.mock("./create-music-player-window", () => ({ createMusicPlayerWindow: vi.fn() }));
vi.mock("./broadcast", () => ({ broadcastToAllWindows: vi.fn() }));
vi.mock("../pet-window-movement", () => ({ PetWindowMoveController: class { dispose() {} finishDragging() {} moveRelative() {} queueAbsolute() {} } }));
vi.mock("../../shared/disclaimer", () => ({ CURRENT_DISCLAIMER_VERSION: "current" }));

function createFakeWindow() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  let visible = false;
  let destroyed = false;
  let bounds = { x: 0, y: 0, width: 82, height: 108 };
  return {
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    once: vi.fn((event: string, listener: (...args: any[]) => void) => {
      const wrapped = (...args: any[]) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== wrapped));
        listener(...args);
      };
      listeners.set(event, [...(listeners.get(event) ?? []), wrapped]);
    }),
    emit(event: string) { for (const listener of [...(listeners.get(event) ?? [])]) listener(); },
    hide: vi.fn(() => { visible = false; for (const listener of [...(listeners.get("hide") ?? [])]) listener(); }),
    show: vi.fn(() => { visible = true; for (const listener of [...(listeners.get("show") ?? [])]) listener(); }),
    destroy: vi.fn(() => { destroyed = true; for (const listener of [...(listeners.get("closed") ?? [])]) listener(); }),
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => visible),
    setAlwaysOnTop: vi.fn(),
    getPosition: vi.fn(() => [0, 0]),
    getBounds: vi.fn(() => ({ ...bounds })),
    setBounds: vi.fn((next: { x: number; y: number; width: number; height: number }) => {
      bounds = { ...next };
    }),
  };
}

import { createWindowManager } from "./window-manager";

describe("pet window resource release", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.createdWindows = [];
    mocks.createPetWindow.mockImplementation(() => {
      const window = createFakeWindow();
      mocks.createdWindows.push(window);
      return window;
    });
  });

  it("destroys a hidden pet window after 30 seconds and recreates it when shown", () => {
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon",
      isDev: false,
      loadPetWindowSettingsSlice: () => ({ disclaimerAcceptedVersion: "current", petAlwaysOnTop: true }),
      persistPetWindowPosition: vi.fn(),
    });
    const firstWindow = manager.createPetWindow();

    manager.hidePetWindow();
    vi.advanceTimersByTime(29_999);
    expect(firstWindow.destroy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(firstWindow.destroy).toHaveBeenCalledOnce();

    manager.showPetWindow();
    expect(mocks.createdWindows).toHaveLength(2);
    expect(mocks.createdWindows[1].setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
  });

  it("cancels delayed destruction when shown again before the timeout", () => {
    const manager = createWindowManager({
      getCurrentAppIconPath: () => "icon",
      isDev: false,
      loadPetWindowSettingsSlice: () => ({ disclaimerAcceptedVersion: "current" }),
      persistPetWindowPosition: vi.fn(),
    });
    const window = manager.createPetWindow();

    manager.hidePetWindow();
    vi.advanceTimersByTime(20_000);
    manager.showPetWindow();
    vi.advanceTimersByTime(30_000);

    expect(window.destroy).not.toHaveBeenCalled();
    expect(mocks.createdWindows).toHaveLength(1);
    expect(window.show).toHaveBeenCalledOnce();
  });
});

describe("pet window bounds channel", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.createdWindows = [];
    mocks.createPetWindow.mockImplementation(() => {
      const window = createFakeWindow();
      mocks.createdWindows.push(window);
      return window;
    });
  });

  function buildManager() {
    return createWindowManager({
      getCurrentAppIconPath: () => "icon",
      isDev: false,
      loadPetWindowSettingsSlice: () => ({ disclaimerAcceptedVersion: "current" }),
      persistPetWindowPosition: vi.fn(),
    });
  }

  it("同一 bounds 连发两次只发一条 DWM 指令", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();
    const bounds = { x: 300, y: 400, width: 82, height: 108 };

    win.setBounds({ ...bounds }); // 预置到位，模拟窗口已在该 bounds
    manager.setPetWindowBounds(bounds);
    manager.setPetWindowBounds(bounds);

    expect(win.setBounds).toHaveBeenCalledTimes(1);
  });

  it("0.4px 抖动被吞，0.6px 位移发指令；收起→面板档尺寸变化必发", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();
    manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
    expect(win.setBounds).toHaveBeenCalledTimes(1);

    manager.setPetWindowBounds({ x: 300.4, y: 400, width: 82, height: 108 });
    expect(win.setBounds).toHaveBeenCalledTimes(1);

    manager.setPetWindowBounds({ x: 300, y: 400.6, width: 82, height: 108 });
    expect(win.setBounds).toHaveBeenCalledTimes(2);

    manager.setPetWindowBounds({ x: 300, y: 400, width: 248, height: 482 });
    expect(win.setBounds).toHaveBeenCalledTimes(3);
    expect(win.getBounds()).toEqual({ x: 300, y: 400, width: 248, height: 482 });
  });

  it("宠物窗尚未创建时请求被忽略（不抛错）", () => {
    const manager = buildManager();
    expect(() => manager.setPetWindowBounds({ x: 0, y: 0, width: 82, height: 108 })).not.toThrow();
  });
});

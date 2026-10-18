import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { once: vi.fn() },
  createdWindows: [] as Array<ReturnType<typeof createFakeWindow>>,
  createPetWindow: vi.fn(),
  // 位置权威的动作要有账：测试名字声称 controller 权威，就得看得见它被动过。
  moveController: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })) },
}));
vi.mock("../startup/create-pet-window", () => ({
  createPetWindow: mocks.createPetWindow,
  PET_WINDOW_BASE_HEIGHT: 108,
  PET_WINDOW_BASE_WIDTH: 82,
}));
vi.mock("./create-aux-windows", () => ({
  createCallWindow: vi.fn(), createReactChatWindowShell: vi.fn(), createStickerManagerWindow: vi.fn(),
  loadReactChatWindowPage: vi.fn(), loadOnboardingWindowPage: vi.fn(), createOnboardingBrowserWindow: vi.fn(),
  showReactChatWindow: vi.fn(),
}));
vi.mock("./startup-window-load", () => ({ CHAT_READY_TIMEOUT_MS: 1, loadWindowForStartup: vi.fn() }));
vi.mock("./create-music-player-window", () => ({ createMusicPlayerWindow: vi.fn() }));
vi.mock("./broadcast", () => ({ broadcastToAllWindows: vi.fn() }));
vi.mock("../pet-window-movement", () => ({
  PetWindowMoveController: class {
    dispose() { mocks.moveController("dispose"); }
    finishDragging() { mocks.moveController("finishDragging"); }
    moveRelative() { mocks.moveController("moveRelative"); }
    queueAbsolute() { mocks.moveController("queueAbsolute"); }
  },
}));
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
    setOpacity: vi.fn(),
    getPosition: vi.fn(() => [bounds.x, bounds.y]),
    getBounds: vi.fn(() => ({ ...bounds })),
    // 尺寸与位置是两条独立指令（native main.rs:4308-4315），fake 必须分开记账。
    setSize: vi.fn((width: number, height: number) => {
      bounds = { ...bounds, width, height };
    }),
    setPosition: vi.fn((x: number, y: number) => {
      bounds = { ...bounds, x, y };
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

  it("只有位置越阈 → 只发 setPosition；只有尺寸越阈 → 只发 setSize（native 两条门）", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();

    manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
    expect(win.setPosition).toHaveBeenCalledTimes(1);
    expect(win.setSize).not.toHaveBeenCalled();

    manager.setPetWindowBounds({ x: 300, y: 400, width: 248, height: 482 });
    expect(win.setPosition).toHaveBeenCalledTimes(1);
    expect(win.setSize).toHaveBeenCalledTimes(1);
    expect(win.getBounds()).toEqual({ x: 300, y: 400, width: 248, height: 482 });
  });

  it("位移 0.4 + 尺寸 0.4：一条指令都不发（合成 4 维求和会误判成 0.566 > 0.5）", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();
    manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
    const moveCalls = win.setPosition.mock.calls.length;
    const sizeCalls = win.setSize.mock.calls.length;

    manager.setPetWindowBounds({ x: 300.4, y: 400, width: 82.4, height: 108 });
    expect(win.setPosition).toHaveBeenCalledTimes(moveCalls);
    expect(win.setSize).toHaveBeenCalledTimes(sizeCalls);

    // 正对照：同一方向推到 0.6 必须发，证明上面是「被吞」不是「通道没通」
    manager.setPetWindowBounds({ x: 300.6, y: 400, width: 82.6, height: 108 });
    expect(win.setPosition).toHaveBeenCalledTimes(moveCalls + 1);
    expect(win.setSize).toHaveBeenCalledTimes(sizeCalls + 1);
  });

  it("同一 bounds 连发两次只发一套指令", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();
    const bounds = { x: 300, y: 400, width: 248, height: 482 };

    manager.setPetWindowBounds(bounds);
    manager.setPetWindowBounds(bounds);

    expect(win.setPosition).toHaveBeenCalledTimes(1);
    expect(win.setSize).toHaveBeenCalledTimes(1);
  });

  it("拖拽期间位置门关闭、尺寸门照常（位置权威是 PetWindowMoveController）", () => {
    const manager = buildManager();
    const win = manager.createPetWindow();
    manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
    expect(win.setPosition).toHaveBeenCalledTimes(1);

    manager.setPetWindowDragging(true);
    expect(mocks.moveController.mock.calls.flat()).not.toContain("finishDragging");
    manager.setPetWindowBounds({ x: 600, y: 700, width: 82, height: 108 });
    expect(win.setPosition).toHaveBeenCalledTimes(1);

    manager.setPetWindowBounds({ x: 600, y: 700, width: 248, height: 482 });
    expect(win.setSize).toHaveBeenCalledTimes(1);

    manager.setPetWindowDragging(false);
    expect(mocks.moveController.mock.calls.flat()).toContain("finishDragging");
    manager.setPetWindowBounds({ x: 600, y: 700, width: 248, height: 482 });
    // 拖拽一收，位置门重新打开并补发请求——否则猫会停在拖拽起点不动。
    expect(win.setPosition).toHaveBeenCalledTimes(2);
    expect(win.getBounds()).toEqual({ x: 600, y: 700, width: 248, height: 482 });
  });

  it("拖拽中的窗口被销毁：closed 里复位拖拽门，重建后的窗口位置门照常开", () => {
    const manager = buildManager();
    const first = manager.createPetWindow();
    manager.setPetWindowDragging(true);
    // 渲染进程崩 / 退出 / 换屏重建：没人再发 setDragging(false)，闸门只能由 closed 兜底。
    first.destroy();

    const second = manager.createPetWindow();
    expect(second).not.toBe(first);
    manager.setPetWindowBounds({ x: 500, y: 600, width: 248, height: 482 });
    expect(second.setPosition).toHaveBeenCalledTimes(1);
    expect(second.setSize).toHaveBeenCalledTimes(1);
    // 正对照：同一 manager 上没被拖拽污染过的通道确实通
    expect(second.getBounds()).toEqual({ x: 500, y: 600, width: 248, height: 482 });
  });

  it("宠物窗尚未创建时请求被忽略（不抛错）", () => {
    const manager = buildManager();
    expect(() => manager.setPetWindowBounds({ x: 0, y: 0, width: 82, height: 108 })).not.toThrow();
  });
});

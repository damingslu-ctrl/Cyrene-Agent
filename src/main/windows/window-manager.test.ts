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
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    // 探针块要读 DPI（window-manager.ts 的 GEOM 行）。缺这个 mock 时，谁在 shell 里
    // export 过 VERGE_GEOM_PROBE=1 再跑 vitest，就会在 ipc 回调里抛错——假失败。
    getDisplayMatching: vi.fn(() => ({ scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } })),
  },
}));
// 基址走真模块：PET_W 一改，夹具必须跟着变，否则 zoom 断言拿旧基址当基准。
vi.mock("../startup/create-pet-window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../startup/create-pet-window")>();
  return { ...actual, createPetWindow: mocks.createPetWindow };
});
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
  let bounds = { x: 0, y: 0, width: Math.round(PET_W), height: Math.round(PET_H) };
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
import { PET_H, PET_W } from "../../shared/pet-geometry";

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
    // animate 只标 macOS，但出货只有 win/nsis 也要把 false 传到底：删掉这个字面量
    // 现在没有任何测试会红，所以在这里把它钉住。
    expect(win.setPosition.mock.calls[0]?.[2]).toBe(false);
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

  it("VERGE_GEOM_PROBE=1：只在真发指令时打行，被拖拽闸门吞掉的位置报 applied -,-", () => {
    vi.stubEnv("VERGE_GEOM_PROBE", "1");
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { lines.push(String(args[0])); });
    try {
      const manager = buildManager();
      manager.createPetWindow();
      manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("applied 300,400\tactual 300,400 82x108");

      // 同一 bounds 再发：两条门都吞 → 探针也不许多出第二行
      manager.setPetWindowBounds({ x: 300, y: 400, width: 82, height: 108 });
      expect(lines).toHaveLength(1);

      // 新 manager 才有新的 0.5s 节流窗口：拖拽中尺寸门照发，位置门没发过指令
      lines.length = 0;
      const second = buildManager();
      second.createPetWindow();
      second.setPetWindowDragging(true);
      second.setPetWindowBounds({ x: 300, y: 400, width: 248, height: 482 });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("applied -,-\tactual 0,0 248x482");
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("宠物窗尚未创建时请求被忽略（不抛错）", () => {
    const manager = buildManager();
    expect(() => manager.setPetWindowBounds({ x: 0, y: 0, width: 82, height: 108 })).not.toThrow();
  });
});

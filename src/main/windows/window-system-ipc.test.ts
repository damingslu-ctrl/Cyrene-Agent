// main 侧纯 node 环境：不写 jsdom  pragma——被测支路是主进程 IPC handler，
// 与渲染端无关。electron 用 vi.mock 打桩（配方对位 create-aux-windows.test.ts:1-38），
// ipcMain 必须一并给：ipc-scope.ts 顶层 import 它（仅作默认参数，但要得到具名导出才不炸）。
import { describe, expect, it, vi } from "vitest";

const { browserWindowOptions } = vi.hoisted(() => ({ browserWindowOptions: [] as unknown[] }));

vi.mock("electron", () => ({
  app: { getAppPath: () => "/app" },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  },
  BrowserWindow: class {
    loadURL = vi.fn();
    show = vi.fn();
    constructor(options?: unknown) {
      browserWindowOptions.push(options);
    }
  },
}));

import { IPC } from "../../shared/ipc-channels";
import { WINDOW_BACKGROUNDS } from "../../shared/palette-from-cat";
import { createIpcScope, type IpcScopeMainLike } from "../application/ipc-scope";
import { registerWindowSystemIpc } from "./window-system-ipc";
import type { PetResizePayload } from "./pet-bounds";
import type { WindowManager } from "./window-manager";

/**
 * 搭一条假 ipcMain → createIpcScope → registerWindowSystemIpc 的接线，
 * 取出 VERGE_PET_RESIZE 的 listener 直接调用——不碰真 electron ipcMain，
 * windowManager 只给 setPetWindowBounds 一个方法（本支路只消费这一个）。
 */
function setup() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const fakeMain: IpcScopeMainLike = {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
      return undefined;
    }),
    handle: vi.fn(() => undefined),
    removeHandler: vi.fn(() => undefined),
    removeListener: vi.fn(() => undefined),
  };
  const windowManager = { setPetWindowBounds: vi.fn() } as unknown as WindowManager;
  registerWindowSystemIpc({
    get windowManager() {
      return windowManager;
    },
    ipc: createIpcScope(fakeMain),
    quit: vi.fn(),
  });
  const resizeListener = listeners.get(IPC.VERGE_PET_RESIZE);
  if (!resizeListener) throw new Error(`no listener registered for ${IPC.VERGE_PET_RESIZE}`);
  return {
    send: (payload: unknown) => resizeListener({}, payload),
    setPetWindowBounds: windowManager.setPetWindowBounds as ReturnType<typeof vi.fn>,
    fire: (channel: string) => listeners.get(channel)?.({}),
  };
}

/** 合法载荷：bounds 四数取整（渲染端契约）+ 取证列齐（pinInWin/center/peekDx/e，不取整）。 */
function makePayload(): PetResizePayload {
  return {
    x: 1838,
    y: 400,
    width: 82,
    height: 108,
    pinInWin: { x: 81.4, y: 39 },
    center: { x: 64.4, y: 42.4 },
    peekDx: 12.5,
    e: 0,
  };
}

describe("window-system-ipc VERGE_PET_RESIZE 载荷校验", () => {
  it("正对照：合法载荷原对象直达 setPetWindowBounds（取证列不剥不掉）", () => {
    const { send, setPetWindowBounds } = setup();
    const payload = makePayload();
    send(payload);
    expect(setPetWindowBounds).toHaveBeenCalledTimes(1);
    // 引用相等：既证明没被剥字段/篡改，也证明没被中间层重建成新对象。
    expect(setPetWindowBounds.mock.calls[0]![0]).toBe(payload);
  });

  it("width 为 NaN：整帧丢弃，setPetWindowBounds 不许被调用", () => {
    const { send, setPetWindowBounds } = setup();
    send({ ...makePayload(), width: Number.NaN });
    expect(setPetWindowBounds).not.toHaveBeenCalled();
  });

  it("height 为 0：Number.isFinite 过得了但 >0 闸拦下（window-system-ipc.ts:59）", () => {
    const { send, setPetWindowBounds } = setup();
    send({ ...makePayload(), height: 0 });
    expect(setPetWindowBounds).not.toHaveBeenCalled();
  });

  it("payload 为 null：!!n 闸门丢弃", () => {
    const { send, setPetWindowBounds } = setup();
    send(null);
    expect(setPetWindowBounds).not.toHaveBeenCalled();
  });

  it("缺字段的旧四数载荷都齐以外的形状（缺 width/height）：丢弃", () => {
    const { send, setPetWindowBounds } = setup();
    send({ x: 100, y: 200 });
    expect(setPetWindowBounds).not.toHaveBeenCalled();
  });

  it("x 为 undefined：四数任一不有限即丢（undefined 不是 number，Number.isFinite 判 false）", () => {
    const { send, setPetWindowBounds } = setup();
    send({ ...makePayload(), x: undefined });
    expect(setPetWindowBounds).not.toHaveBeenCalled();
  });
});

it("chrome://gpu 窗带派生浅色底（C4 的第三处：此前是 Electron 默认白）", () => {
  const { fire } = setup();
  fire(IPC.SETTINGS_OPEN_CHROME_GPU);
  const opts = browserWindowOptions.at(-1) as { backgroundColor?: string };
  expect(opts?.backgroundColor).not.toBeUndefined();
  expect(opts?.backgroundColor).toBe(WINDOW_BACKGROUNDS["pearl-white"]);
});

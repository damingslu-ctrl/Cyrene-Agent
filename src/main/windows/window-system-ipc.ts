import { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { WINDOW_BACKGROUNDS } from "../../shared/palette-from-cat";
import { createIpcScope, type IpcScope } from "../application/ipc-scope";
import { clearUsage, getUsageReport } from "../token-usage-store";
import {
  musicPlayerWindow,
} from "./window-state";
import type { WindowManager } from "./window-manager";
import type { PetResizePayload } from "./pet-bounds";

export interface WindowSystemIpcDependencies {
  get windowManager(): WindowManager | null;
  /** 传入共享 scope 以便退出时统一注销；缺省时使用独立 scope。 */
  ipc?: IpcScope;
  /**
   * 退出应用。由组合根注入（`() => app.quit()`），使本模块不直接依赖 electron app，
   * 同时保留 before-quit 受控退出链路。
   */
  quit(): void;
}

/**
 * 注册窗口控制与系统入口相关的 IPC handler。
 *
 * 注意：TOKEN_USAGE_GET 本质属于用量统计领域，当前仅因改动最小而临时
 * 挂靠在此；后续拆分统计模块时应二次归位。
 */
export function registerWindowSystemIpc(deps: WindowSystemIpcDependencies): void {
  const ipc = deps.ipc ?? createIpcScope();
  ipc.handle(IPC.WINDOW_SET_INTERACTIVE, (_event, interactive: boolean) => {
    deps.windowManager?.setPetWindowInteractive(interactive);
  });

  ipc.on(IPC.WINDOW_MOVE, (_event, dx: number, dy: number) => {
    deps.windowManager?.movePetWindowRelative(dx, dy);
  });

  ipc.on(IPC.WINDOW_MOVE_TO, (_event, x: number, y: number) => {
    deps.windowManager?.movePetWindowTo(x, y);
  });

  ipc.on(IPC.WINDOW_SET_DRAGGING, (_event, isDragging: boolean) => {
    deps.windowManager?.setPetWindowDragging(isDragging);
  });

  // 渲染端每帧驱动猫窗几何（收起 82×108 ↔ 面板 248×482）：单向消息，
  // 不用 invoke——返回值无人消费，而 invoke 会给每帧留下一条待结算的 promise。
  // 契约：bounds 四个数已由渲染端 Math.round 取整（native 的 request_inner_size
  // 收整像素，main.rs:4308-4315）。这里不重复取整——窗口栅格按 DIP 记账，
  // 小数位只会让 shouldApplyBounds 的 0.5 阈永远猜不准。
  // Task 12 扩载荷：pinInWin/center/peekDx/e 为模型取证列，仅供 GEOM 探针，
  // 不参与 shouldApplyBounds——位置/尺寸两闸只认 bounds 四数（native 两闸独立）。
  ipc.on(IPC.VERGE_PET_RESIZE, (_event, payload: PetResizePayload) => {
    const n = payload as unknown as Record<string, unknown> | null;
    const ok =
      !!n &&
      Number.isFinite(n.x) && Number.isFinite(n.y) &&
      Number.isFinite(n.width) && Number.isFinite(n.height) &&
      (n.width as number) > 0 && (n.height as number) > 0;
    if (!ok) return; // 坏载荷直接丢帧：几何下一帧自会重发，不许把 NaN 喂给 setBounds
    deps.windowManager?.setPetWindowBounds(payload);
  });

  // 桌宠窗口自身的最小化/隐藏入口。两者曾随 index.ts 拆分（711a40d9）被误删，
  // preload 侧 window.cyrene.minimize()/hide() 一直保留，此处按原语义补回。
  ipc.on(IPC.WINDOW_MINIMIZE, () => {
    deps.windowManager?.minimizePetWindow();
  });

  ipc.on(IPC.WINDOW_CLOSE, () => {
    deps.windowManager?.hidePetWindow();
  });

  ipc.handle(IPC.WINDOW_CAPTURE_FRAME, async () => deps.windowManager?.capturePetWindowFrame() ?? null);
  ipc.handle(IPC.WINDOW_GET_CURSOR_POSITION, () => deps.windowManager?.getCursorScreenPosition() ?? { x: 0, y: 0 });

  ipc.on(IPC.CALL_OPEN, () => {
    deps.windowManager?.createCallWindow();
  });

  // 音乐播放器窗口控制
  ipc.on(IPC.MUSIC_PLAYER_MINIMIZE, () => {
    musicPlayerWindow?.minimize();
  });
  ipc.on(IPC.MUSIC_PLAYER_CLOSE, () => {
    musicPlayerWindow?.close();
  });
  ipc.handle(IPC.MUSIC_OPEN_PLAYER, () => {
    deps.windowManager?.createMusicPlayerWindow();
    return true;
  });
  ipc.handle(IPC.MUSIC_OPEN_SETTINGS, (_event, section?: string) => {
    return deps.windowManager?.openSettings(section ?? "music").then(() => true) ?? false;
  });

  // 渲染端请求打开设置页指定标签（如头像菜单跳"常规"）：复用主进程统一推送路径
  ipc.handle(IPC.SETTINGS_REQUEST_SWITCH_SECTION, (_event, section?: string) => {
    return deps.windowManager?.openSettings(section ?? "appearance").then(() => true) ?? false;
  });

  ipc.on(IPC.SETTINGS_OPEN_CHROME_GPU, async () => {
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      // chrome://gpu 是 Chromium 自绘的浅色页；这里仍取派生值而不是留空，
      // 否则暗色主题下会先闪一块 Electron 默认白（C4 的第三处原生面）。
      backgroundColor: WINDOW_BACKGROUNDS["pearl-white"],
    });
    win.loadURL("chrome://gpu");
    win.show();
  });

  // Token 用量查询 IPC（临时挂靠，后续归到统计模块）
  // 上限 366：用量统计页的 52 周热力图需要一整年的按天数据。
  ipc.handle(IPC.TOKEN_USAGE_GET, async (_event, days: number) => {
    return getUsageReport(Math.max(1, Math.min(366, Number(days) || 7)));
  });
  ipc.handle(IPC.TOKEN_USAGE_CLEAR, async () => {
    await clearUsage();
  });

  ipc.on(IPC.LIVE2D_SPEECH_PREPARE, () => {
    deps.windowManager?.sendToPetWindow(IPC.LIVE2D_SPEECH_PREPARE);
  });
  ipc.on(IPC.LIVE2D_MOUTH_START, (_event, payload: { durationMs?: number }) => {
    deps.windowManager?.sendToPetWindow(IPC.LIVE2D_MOUTH_START, { durationMs: Number(payload?.durationMs ?? 0) });
  });
  ipc.on(IPC.LIVE2D_MOUTH_STOP, () => {
    deps.windowManager?.sendToPetWindow(IPC.LIVE2D_MOUTH_STOP);
  });

  // 退出是应用级请求而非窗口操作：deps.quit() 最终走 app.quit()，
  // 触发 before-quit 受控退出，由 ShutdownCoordinator 完成固定阶段清理后再退出。
  ipc.on(IPC.APP_QUIT, () => {
    deps.quit();
  });
}

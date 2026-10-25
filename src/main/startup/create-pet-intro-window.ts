import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import {
  computePetIntroBounds,
  type PetIntroRect,
} from "./pet-intro-geometry";

export interface CreatePetIntroWindowContext {
  isDev: boolean;
  /** 桌宠窗当前 bounds（DIP）；动画脚底与它对齐。 */
  petBounds: PetIntroRect;
  /** 动画结束、窗口销毁后回调一次；创建失败时立即回调。 */
  onDone(): void;
}

/**
 * 动画 91 帧 / 15fps ≈ 6.07s，页面自己报完成（title 通道）就提前关。
 * 这一档兜底只防「页面没加载出来 / 渲染卡死」——宁可早退也不能永远盖住桌宠。
 */
const INTRO_FALLBACK_MS = 12_000;

/**
 * 桌宠登场动画窗：透明、置顶、不吃焦点、鼠标穿透。
 *
 * 页面与主进程之间只用 `document.title` 汇一个「放完了」的暗号：
 * 动画窗没有 preload、没有 IPC 面，任何新 channel 都不会因为这段动画而多一个发送方。
 */
export function createPetIntroWindow(ctx: CreatePetIntroWindowContext): BrowserWindow | null {
  let win: BrowserWindow;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    try {
      ctx.onDone();
    } catch (err) {
      console.error("[PetIntro] onDone callback failed:", err);
    }
  };

  try {
    const workArea = screen.getDisplayMatching(ctx.petBounds).workArea;
    const bounds = computePetIntroBounds(ctx.petBounds, workArea);
    win = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, "screen-saver");
    win.webContents.on("page-title-updated", (_event, title) => {
      if (title === "pet-intro-done") finish();
    });
    win.webContents.on("did-fail-load", () => finish());
    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    win.on("closed", () => {
      if (!finished) {
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        try {
          ctx.onDone();
        } catch (err) {
          console.error("[PetIntro] onDone callback failed:", err);
        }
      }
    });

    timer = setTimeout(finish, INTRO_FALLBACK_MS);
    if (ctx.isDev) {
      void win.loadURL("http://localhost:5173/pet-intro.html").catch(finish);
    } else {
      void win.loadFile(path.join(app.getAppPath(), "dist", "renderer", "pet-intro.html")).catch(finish);
    }
    return win;
  } catch (error) {
    console.error("[PetIntro] Failed to create intro window:", error);
    if (!finished) {
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        ctx.onDone();
      } catch (err) {
        console.error("[PetIntro] onDone callback failed:", err);
      }
    }
    return null;
  }
}

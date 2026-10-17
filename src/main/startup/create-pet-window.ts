import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { IPC } from "../../shared/ipc-channels";

/**
 * 桌宠窗口的基础尺寸（zoom=1.0 时收起档）。与 `src/shared/pet-geometry.ts` 的
 * PET_W/PET_H 同一口径：猫画布就是窗口，面板/气泡档由渲染端经 PET_RESIZE 长出去。
 */
export const PET_WINDOW_BASE_WIDTH = 82;
export const PET_WINDOW_BASE_HEIGHT = 108;

/**
 * 仅创建阶段需要的 GeneralSettings 切片。
 * 避免反向依赖 index.ts 中的完整 loadGeneralSettings。
 */
export interface PetWindowSettingsSlice {
  petWindowX?: number;
  petWindowY?: number;
  /** 桌宠缩放因子；离屏判定需按缩放后的实际窗口尺寸计算。 */
  petZoom?: number;
  /** 桌宠窗口置顶设置；窗口重建时需重新应用。 */
  petAlwaysOnTop?: boolean;
  disclaimerAcceptedVersion?: string;
}

export interface CreatePetWindowContext {
  loadGeneralSettings: () => PetWindowSettingsSlice;
  getCurrentAppIconPath: () => string;
  isDev: boolean;
}

export interface CreatePetWindowOptions {
  /** 窗口 ready 后是否立即 show；默认 true。启动闪屏场景可先隐藏，等闪屏关闭再显示。 */
  showOnReady?: boolean;
}

/**
 * 创建主桌宠窗口。
 * 只负责机械构造：恢复上次坐标、创建 BrowserWindow、加载 URL/文件、
 * 绑定 show/hide 可见性广播。不含业务 getter 注入。
 */
export function createPetWindow(
  ctx: CreatePetWindowContext,
  options: CreatePetWindowOptions = {},
): BrowserWindow {
  const { showOnReady = true } = options;
  const settings = ctx.loadGeneralSettings();
  const transparent = true;
  // 窗口实际尺寸随 petZoom 等比缩放；创建尺寸与离屏判定保持一致。
  const zoom = typeof settings.petZoom === "number" && settings.petZoom > 0 ? settings.petZoom : 1;
  const petWidth = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
  const petHeight = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);
  let restoreX: number | undefined;
  let restoreY: number | undefined;

  if (settings.petWindowX !== undefined && settings.petWindowY !== undefined) {
    const display = screen.getDisplayMatching({
      x: settings.petWindowX,
      y: settings.petWindowY,
      width: petWidth,
      height: petHeight,
    });
    const wa = display.workArea;

    // 夹紧语义与 computePetLayout 收起档一致：把保存点拉回工作区内，整只猫可见。
    // 不再用「交集 ≥ 1/3 就照用、否则扔屏幕中央」——那是按 400×500 大窗定的比例，
    // 换成 82×108 后等于「27px 露头就放行」，剩下的猫身留在屏外。
    const lo = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
    restoreX = lo(settings.petWindowX, wa.x, wa.x + wa.width - petWidth);
    restoreY = lo(settings.petWindowY, wa.y, wa.y + wa.height - petHeight);
    if (restoreX !== settings.petWindowX || restoreY !== settings.petWindowY) {
      console.log(
        `[Cyrene] 桌宠保存位置已离屏（${settings.petWindowX},${settings.petWindowY}），` +
          `夹回工作区为 ${restoreX},${restoreY}`,
      );
    }
  }

  if (restoreX === undefined || restoreY === undefined) {
    // 无保存坐标：居中到主屏工作区，避免落在不可见区域
    const wa = screen.getPrimaryDisplay().workArea;
    restoreX = Math.round(wa.x + (wa.width - petWidth) / 2);
    restoreY = Math.round(wa.y + (wa.height - petHeight) / 2);
  }

  const win = new BrowserWindow({
    x: restoreX,
    y: restoreY,
    width: petWidth,
    height: petHeight,
    transparent,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    icon: ctx.getCurrentAppIconPath(),
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (ctx.isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  }

  // dev 也开穿透：Task 5 尖峰的结论是穿透只能在真桌面上验，把 dev 排除在外
  // 就等于每次调鼠标层都要先打一次生产包。交互由渲染端按命中区显式收回。
  win.setIgnoreMouseEvents(true, { forward: true });

  win.on("hide", () => {
    win.webContents.send(IPC.PET_VISIBILITY_CHANGED, false);
  });
  win.on("show", () => {
    win.webContents.send(IPC.PET_VISIBILITY_CHANGED, true);
  });

  win.once("ready-to-show", () => {
    if (showOnReady && !win.isDestroyed()) {
      win.show();
    }
  });

  return win;
}

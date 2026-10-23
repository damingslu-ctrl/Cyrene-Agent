/**
 * 宠物窗右键菜单的纯函数面与 Electron 菜单配方。
 *
 * 文案对位 native：
 * - 「安静半小时 / 安静中 · 剩 N 分 / 取消安静」：quiet_toggle 双向回执的菜单化
 *   （main.rs:2503 的翻转语义 + main.rs:2534 的剩余分钟口径「安静 剩 N 分」）。
 * - 「贴边藏身」开关：native 的 Persist.tuck 页脚开关（main.rs:970）。
 * - 「隐藏 / 退出」：托盘菜单的两条常驻动作。
 * 菜单纯动作：`params.x/y` 对宠物窗用不上，也不弹「拷贝图片」这类内容项。
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { armQuiet, isQuietNow, quietRemainingMinutes } from "./quiet-clock";
import type { VergeService } from "./verge-service";

export interface MenuItemInit {
  label: string;
  enabled?: boolean;
  checked?: boolean;
  action?: () => void;
}

export interface PetMenuInput {
  /** 免打扰到期时刻（epoch ms）；null = 不在安静期。 */
  quietUntil: number | null;
  /** 计算剩余分钟用的现在时刻。 */
  now: number;
  /** 贴边藏身开关当前值：菜单勾选态来自它。 */
  tuckEnabled: boolean;
}

export interface PetMenuActions {
  quiet: () => void;
  cancelQuiet: () => void;
  toggleTuck: () => void;
  hide: () => void;
  quit: () => void;
}

/**
 * 六条菜单项：安静半小时 / 安静中·剩 N 分（禁用）/ 取消安静 / 贴边藏身（勾）/ 隐藏 / 退出。
 * 安静期第一项换成「安静中 · 剩 N 分」且禁用，第二项「取消安静」亮起——仍点第一项 = 没有这回事。
 */
export function buildPetMenuItems(input: PetMenuInput, actions?: Partial<PetMenuActions>): MenuItemInit[] {
  const quietOn = isQuietNow(input.quietUntil, input.now);
  return [
    quietOn
      ? {
          label: `安静中 · 剩 ${quietRemainingMinutes(input.quietUntil!, input.now)} 分`,
          enabled: false,
          ...(actions?.quiet ? { action: actions.quiet } : {}),
        }
      : {
          label: "安静半小时",
          enabled: true,
          ...(actions?.quiet ? { action: actions.quiet } : {}),
        },
    { label: "取消安静", enabled: quietOn, ...(actions?.cancelQuiet ? { action: actions.cancelQuiet } : {}) },
    { label: "贴边藏身", enabled: true, checked: input.tuckEnabled, ...(actions?.toggleTuck ? { action: actions.toggleTuck } : {}) },
    { label: "隐藏", enabled: true, ...(actions?.hide ? { action: actions.hide } : {}) },
    { label: "退出", enabled: true, ...(actions?.quit ? { action: actions.quit } : {}) },
  ];
}

export interface PetContextMenuInput {
  window: BrowserWindow;
  /** VergeService（Task 4 的面）：quietUntil/tuckEnabled 读写权威。 */
  service: VergeService;
  /** 受控退出的路由不改道：菜单的「退出」与托盘同一条 quit 链路。 */
  quit: () => void;
  /**
   * quiet 写盘后的唯一收口：重排自醒钟 + 向渲染端广播**当下**的 quietUntil（不是恒 null）。
   * 菜单若绕过它，盘上就躺着一个没人看的截止——native 明令「到点当场清 quiet_until」
   * （main.rs:2515-2517），不清是欠账态；且若此前排过更近的陈旧截止，还会在旧点误触发、
   * 把这次合法的新 quiet 提前抹掉。月牙同理：渲染端的实时来源只有这条广播与开机
   * isQuiet()，不广播就得等重启才上屏。
   */
  onQuietStateChange(quietUntil: number | null): void;
  /**
   * tuck 开关写盘后的唯一收口（Task 12，applyQuietState 同构）：向渲染端广播当下值。
   * 「取消勾选立刻回位且不再藏」靠这条——渲染端的位置权威不在此，但闸门开关必须即时
   * 传达；菜单若绕过它，猫会一直藏到下次重启（VERGE_SET_TUCK 与此共用同一个函数）。
   */
  onTuckStateChange(enabled: boolean): void;
}

/**
 * 给宠物窗挂右键菜单（windows/context-menu.ts 同配方：webContents 的
 * context-menu 事件 → Menu.buildFromTemplate → popup）。宠物窗菜单纯动作，
 * 没有 params.x/y（弹在猫身上、不给坐标），也没有编辑/复制类内容项。
 *
 * 每次右键都现读 service 的 quietUntil/tuckEnabled——菜单快照必须反映当下，
 * 不能缓存一份在挂载时算好的 items。
 */
export function attachPetContextMenu(input: PetContextMenuInput): void {
  const { window, service, quit, onQuietStateChange, onTuckStateChange } = input;
  window.webContents.on("context-menu", (_event, _params) => {
    if (window.isDestroyed()) return;
    const now = Date.now();
    const items = buildPetMenuItems(
      { quietUntil: service.getState().quietUntil, now, tuckEnabled: service.getState().tuckEnabled },
      {
        quiet: () => {
          const next = armQuiet({ current: service.getState().quietUntil, now: Date.now() });
          service.setQuietUntil(next);
          // 落盘只是半件事：另半件是重排自醒钟 + 把**当下**截止广播上屏。
          // native 的「到点当场清」（main.rs:2515-2517）与剩余分钟口径（:2534）
          // 都挂在清盘动作上，绕开收口就等于写了个没人负责清的数。
          onQuietStateChange(next);
        },
        cancelQuiet: () => {
          // 再点一次是取消，不是续期（armQuiet 的反向路径）：清盘也走同一条 service 链。
          service.setQuietUntil(null);
          // 取消同样要走收口：rearm 让残留的旧定时器作废，广播 null 当场撤月牙（main.rs:2503 的翻转）。
          onQuietStateChange(null);
        },
        toggleTuck: () => {
          const next = !service.getState().tuckEnabled;
          service.setTuckEnabled(next);
          // 落盘 + 广播同一个收口（Task 11 quiet 的先例）：两处各写各的就会有一处漏上行。
          onTuckStateChange(next);
        },
        hide: () => {
          if (!window.isDestroyed()) window.hide();
        },
        quit,
      },
    );
    Menu.buildFromTemplate(toElectronTemplate(items, window)).popup({ window });
  });
}

/** MenuItemInit → Electron template：checked 生成 checkbox 型，动作闭进 click。 */
export function toElectronTemplate(
  items: MenuItemInit[],
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  items.forEach((item, index) => {
    if (index > 0 && (item.label === "隐藏" || item.label === "退出")) {
      // 放在「隐藏」前面这条分界线把「性格动作」与「窗口动作」分开（native 托盘同类分法）。
      if (!template.some((entry) => entry.type === "separator")) {
        // 只在藏身后插一次：上面 forEach 到 hide/quit 时前面的项都已经收好，
        // 用 findIndex 判而不是每次都 push，避免「隐藏→退出」两条各插一条。
        template.push({ type: "separator" });
      }
    }
    if (item.checked === undefined) {
      template.push({
        label: item.label,
        enabled: item.enabled,
        click: () => {
          if (window.isDestroyed()) return;
          item.action?.();
        },
      });
      return;
    }
    template.push({
      label: item.label,
      type: "checkbox",
      checked: item.checked,
      enabled: item.enabled,
      click: () => {
        if (window.isDestroyed()) return;
        item.action?.();
      },
    });
  });
  return template;
}


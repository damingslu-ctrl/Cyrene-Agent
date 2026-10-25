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
import type { PetCommand } from "../../shared/pet-commands";
import { accessoryCommandFor } from "../../shared/pet-commands";
import { ACCESSORIES, type AccessoryId } from "../../shared/pet-accessory";
import { RPS_LABELS, RPS_SIGNS, rpsCommandFor, type RpsSign } from "../../shared/pet-rps";
import { armQuiet, isQuietNow, quietRemainingMinutes } from "./quiet-clock";
import type { VergeService } from "./verge-service";
import { PET_FORMS, SIZE_TIERS, profileFor, type PetForm, type SizeTier } from "../../shared/pet-profile";

export interface MenuItemInit {
  label: string;
  enabled?: boolean;
  checked?: boolean;
  /** 这一项前面插一条分隔线（只在需要的那一项上置真，避免重复插）。 */
  separatorBefore?: boolean;
  action?: () => void;
  /** 子菜单（「让它做个动作」用）；有值时 `action` 不参与。 */
  submenu?: readonly MenuItemInit[];
}

export interface PetMenuInput {
  /** 免打扰到期时刻（epoch ms）；null = 不在安静期。 */
  quietUntil: number | null;
  /** 计算剩余分钟用的现在时刻。 */
  now: number;
  /** 贴边藏身开关当前值：菜单勾选态来自它。 */
  tuckEnabled: boolean;
  /** 形态与档位（v1.5.0）：菜单里两组单选。 */
  form: PetForm;
  tier: SizeTier;
}

/**
 * 「让它做个动作」的手势清单。顺序按「最常逗猫」排，标签是用户词不是代码 id。
 * 只收不改数值的表演手势（睡觉/吃东西会动 vitals，不混进来）。
 */
const GESTURE_MENU: ReadonlyArray<readonly [PetCommand, string]> = [
  ["wave", "招招手"],
  ["hop", "跳一下"],
  ["clap", "鼓鼓掌"],
  ["bow", "鞠个躬"],
  ["nod", "点点头"],
  ["tilt", "歪歪头"],
  ["stretch", "伸个懒腰"],
];

export interface PetMenuActions {
  quiet: () => void;
  cancelQuiet: () => void;
  toggleTuck: () => void;
  pet: () => void;
  feed: () => void;
  play: () => void;
  toggleSleep: () => void;
  status: () => void;
  /** 「让它做个动作」：发手势命令（不改数值）。 */
  gesture: (command: PetCommand) => void;
  /** 猫娘装扮：换件饰品/摘掉（四足形态下菜单项禁用）。 */
  accessory: (id: AccessoryId) => void;
  /** 招一只伴飞小虫（蝴蝶/流萤，按时段）。 */
  critter: () => void;
  /** 陪她散一段步：朝当前朝向走 60–160px。 */
  wander: () => void;
  /** 猫娘玩具箱：逗猫棒 / 泡泡 / 落叶 / 跟随 / 猜拳。 */
  wand: () => void;
  bubbles: () => void;
  leaves: () => void;
  follow: () => void;
  rps: (sign: RpsSign) => void;
  openNetwork: () => void;
  /** v1.5.0：形态与档位切换（落盘 + 广播在装配层，菜单只管发意图）。 */
  setForm: (form: PetForm) => void;
  setTier: (tier: SizeTier) => void;
  hide: () => void;
  quit: () => void;
}

/**
 * 互动 + 安静 + 窗口动作。前三条（安静/取消/藏身）位置保持不变：
 * 旧习惯与旧验收都按这个顺序认；互动动作接在它们后面，窗口动作另起一段。
 */
export function buildPetMenuItems(input: PetMenuInput, actions?: Partial<PetMenuActions>): MenuItemInit[] {
  const quietOn = isQuietNow(input.quietUntil, input.now);
  const bind = (action: (() => void) | undefined) => (action ? { action } : {});
  return [
    quietOn
      ? {
          label: `安静中 · 剩 ${quietRemainingMinutes(input.quietUntil!, input.now)} 分`,
          enabled: false,
          ...bind(actions?.quiet),
        }
      : {
          label: "安静半小时",
          enabled: true,
          ...bind(actions?.quiet),
        },
    { label: "取消安静", enabled: quietOn, ...bind(actions?.cancelQuiet) },
    { label: "贴边藏身", enabled: true, checked: input.tuckEnabled, ...bind(actions?.toggleTuck) },
    { label: "摸摸头", enabled: true, ...bind(actions?.pet) },
    { label: "喂小鱼干", enabled: true, ...bind(actions?.feed) },
    { label: "陪它玩", enabled: true, ...bind(actions?.play) },
    { label: "哄它睡觉", enabled: true, ...bind(actions?.toggleSleep) },
    { label: "它现在怎么样", enabled: true, ...bind(actions?.status) },
    // —— 猫娘专属三条：四足形态下置灰（她才有耳朵、裙摆和散步的腿） ——
    {
      label: "给她打扮",
      enabled: input.form === "girl" && !!actions?.accessory,
      submenu: ACCESSORIES.map((entry) => ({
        label: entry.name,
        enabled: input.form === "girl" && !!actions?.accessory,
        action: () => actions?.accessory?.(entry.id),
      })),
    },
    { label: "放只小虫逗逗她", enabled: input.form === "girl" && !!actions?.critter, ...bind(actions?.critter) },
    { label: "陪她散散步", enabled: input.form === "girl" && !!actions?.wander, ...bind(actions?.wander) },
    // —— v1.10.0 玩具箱：都能在 82px 窗里单独演一段，四足形态置灰 ——
    { label: "挥挥逗猫棒", enabled: input.form === "girl" && !!actions?.wand, ...bind(actions?.wand) },
    { label: "吹一串泡泡", enabled: input.form === "girl" && !!actions?.bubbles, ...bind(actions?.bubbles) },
    { label: "撒一把落叶", enabled: input.form === "girl" && !!actions?.leaves, ...bind(actions?.leaves) },
    { label: "跟我来", enabled: input.form === "girl" && !!actions?.follow, ...bind(actions?.follow) },
    {
      label: "猜拳",
      enabled: input.form === "girl" && !!actions?.rps,
      submenu: RPS_SIGNS.map((sign) => ({
        label: RPS_LABELS[sign],
        enabled: input.form === "girl" && !!actions?.rps,
        action: () => actions?.rps?.(sign),
      })),
    },
    // 「让它做个动作」：只演一次手势，不改数值。放在互动组末尾，与喂/玩区分开。
    {
      label: "让它做个动作",
      enabled: !!actions?.gesture,
      submenu: GESTURE_MENU.map(([cmd, label]) => ({
        label,
        enabled: !!actions?.gesture,
        action: () => actions?.gesture?.(cmd),
      })),
    },
    { label: "打开网络面板", enabled: true, ...bind(actions?.openNetwork) },
    // —— v1.5.0：形态两档 + 身形三档。尺寸数字从 profileFor 现算，不写字面量 ——
    ...PET_FORMS.map((f) => ({
      label: f === "cat" ? "形象：像素猫" : "形象：猫娘",
      checked: input.form === f,
      enabled: !!actions?.setForm,
      separatorBefore: f === "cat",
      action: () => actions?.setForm?.(f),
    })),
    ...SIZE_TIERS.map((t) => ({
      label: `身形：${t === "small" ? "小巧" : t === "standard" ? "标准" : "大"} (${profileFor(input.form, t).base.width}×${profileFor(input.form, t).base.height})`,
      checked: input.tier === t,
      enabled: !!actions?.setTier,
      action: () => actions?.setTier?.(t),
    })),
    { label: "隐藏", enabled: true, separatorBefore: true, ...bind(actions?.hide) },
    { label: "退出", enabled: true, ...bind(actions?.quit) },
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
  /**
   * 互动动作发给宠物窗（摸摸/喂食/玩耍/睡觉/状态）。菜单不持有宠物状态，
   * 只负责把意图送达；执行与落盘都在渲染端。
   */
  onPetCommand(command: PetCommand): void;
  /** 「打开网络面板」：唤起主窗并让它切到网络页。 */
  openNetworkPanel(): void;
  /**
   * v1.5.0：形态/档位落盘后的唯一收口（与 onQuietStateChange/onTuckStateChange 同构）。
   * 装配层负责向宠物窗广播 { form, tier } 两个字符串，并让渲染端按新基址重排。
   */
  onProfileStateChange(form: PetForm, tier: SizeTier): void;
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
  const { window, service, quit, onQuietStateChange, onTuckStateChange, onPetCommand, openNetworkPanel, onProfileStateChange } = input;
  window.webContents.on("context-menu", (_event, _params) => {
    if (window.isDestroyed()) return;
    const now = Date.now();
    const items = buildPetMenuItems(
      {
        quietUntil: service.getState().quietUntil,
        now,
        tuckEnabled: service.getState().tuckEnabled,
        form: service.getState().form,
        tier: service.getState().tier,
      },
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
        pet: () => onPetCommand("pet"),
        feed: () => onPetCommand("feed"),
        play: () => onPetCommand("play"),
        toggleSleep: () => onPetCommand("toggle-sleep"),
        status: () => onPetCommand("status"),
        gesture: (command) => onPetCommand(command),
        accessory: (id) => onPetCommand(accessoryCommandFor(id)),
        critter: () => onPetCommand("summon-critter"),
        wander: () => onPetCommand("wander"),
        wand: () => onPetCommand("wand"),
        bubbles: () => onPetCommand("bubbles"),
        leaves: () => onPetCommand("leaves"),
        follow: () => onPetCommand("follow"),
        rps: (sign) => onPetCommand(rpsCommandFor(sign)),
        openNetwork: () => openNetworkPanel(),
        setForm: (form) => {
          service.setForm(form);
          onProfileStateChange(form, service.getState().tier);
        },
        setTier: (tier) => {
          service.setTier(tier);
          onProfileStateChange(service.getState().form, tier);
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
  for (const item of items) {
    if (item.separatorBefore) template.push({ type: "separator" });
    // 子菜单：递归同一套转换（子项都是普通动作项，不带勾选态）。
    if (item.submenu) {
      template.push({
        label: item.label,
        enabled: item.enabled,
        submenu: toElectronTemplate(item.submenu as MenuItemInit[], window),
      });
      continue;
    }
    const click = () => {
      if (window.isDestroyed()) return;
      item.action?.();
    };
    if (item.checked === undefined) {
      template.push({ label: item.label, enabled: item.enabled, click });
      continue;
    }
    template.push({
      label: item.label,
      type: "checkbox",
      checked: item.checked,
      enabled: item.enabled,
      click,
    });
  }
  return template;
}


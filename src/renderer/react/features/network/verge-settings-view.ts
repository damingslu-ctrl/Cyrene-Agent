/**
 * v1.26 设置页（Wave 3 T9-d）：Verge 那一侧的设置（`verge.yaml` + Windows 系统代理）的纯派生。
 *
 * 判定全放在这里，组件只接线——这样三条口径能被单测钉住，而不是藏在 JSX 里靠肉眼：
 * - `null` 是「盘上/注册表里没这把键」，画成「关着」就是说谎；开关的初值取注册表读回，不是 `verge.yaml`。
 * - 保存只发「跟基线比真的改过」的键：没碰过的复选框不许顺手替用户往盘上加一把键。
 * - 例外列表清空是「删掉那把键」（回到跟随默认），不是写一个空串（那是「一条都不豁免」）。
 */
import {
  MAX_BYPASS_LENGTH,
  type VergeSettingKey,
  type VergeSettingsPatch,
  type VergeSettingsReason,
  type VergeSettingsView,
} from "../../../../shared/verge-settings-types";
import {
  DEFAULT_SYSTEM_PROXY_BYPASS,
  type SystemProxyAlign,
  type SystemProxyReason,
  type SystemProxyStatus,
} from "../../../../shared/system-proxy-types";

export type VergeSettingsApi = Window["verge"]["settings"];

/** TUN 有三档：`null` 是 Verge 的「跟随内核」，不是「没写过」，所以不能压成复选框。 */
export const TUN_OPTIONS = ["on", "off", "follow"] as const;
export type TunOption = (typeof TUN_OPTIONS)[number];

export interface VergeDraft {
  tun: TunOption;
  mixedPort: string;
  socksPort: string;
  httpPort: string;
  useDefaultBypass: boolean;
  bypass: string;
}

export type VergeFieldKey = keyof VergeDraft;

const PORT_FIELDS = [
  { draft: "mixedPort", setting: "verge_mixed_port" },
  { draft: "socksPort", setting: "verge_socks_port" },
  { draft: "httpPort", setting: "verge_port" },
] as const satisfies ReadonlyArray<{ draft: VergeFieldKey; setting: VergeSettingKey }>;

function tunFromView(value: boolean | null): TunOption {
  if (value === true) return "on";
  if (value === false) return "off";
  return "follow";
}

function tunToPatch(option: TunOption): boolean | null {
  if (option === "on") return true;
  if (option === "off") return false;
  return null;
}

/** 盘上的读数 → 表单初值；`null` 一律画成「空」而不是 0 或 false。 */
export function draftFromSettings(view: VergeSettingsView): VergeDraft {
  return {
    tun: tunFromView(view.enableTunMode),
    mixedPort: view.mixedPort === null ? "" : String(view.mixedPort),
    socksPort: view.socksPort === null ? "" : String(view.socksPort),
    httpPort: view.httpPort === null ? "" : String(view.httpPort),
    // Verge 自己把「用默认例外」当 true 起家和运行，没写过就是默认在生效。
    useDefaultBypass: view.useDefaultBypass !== false,
    bypass: view.systemProxyBypass ?? "",
  };
}

function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 65535 ? value : null;
}

/** 0 是合法值（Verge 拿它表示「这次启动随机挑一个」），空串才是「不改」。 */
export function isValidPort(raw: string): boolean {
  return raw.trim() === "" || parsePort(raw) !== null;
}

/** 控制字符与超长在 main 那边会被拒；页面先挡住，省得用户点保存才知道。 */
function bypassIsBad(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0) return false;
  return value.length > MAX_BYPASS_LENGTH || /[\u0000-\u001f\u007f]/.test(value);
}

/** 就地报错的字段：保存按钮按这个禁用，写面按同一个口径拒。 */
export function invalidVergeFields(draft: VergeDraft): VergeFieldKey[] {
  const bad: VergeFieldKey[] = [];
  for (const field of PORT_FIELDS) {
    if (!isValidPort(draft[field.draft])) bad.push(field.draft);
  }
  if (bypassIsBad(draft.bypass)) bad.push("bypass");
  return bad;
}

/** 只发真的改过的键。返回 `{}` 表示「没账要记」，组件据此禁用保存。 */
export function vergePatchFromDraft(baseline: VergeDraft, draft: VergeDraft): VergeSettingsPatch {
  const patch: VergeSettingsPatch = {};
  if (draft.tun !== baseline.tun) patch.enable_tun_mode = tunToPatch(draft.tun);
  for (const field of PORT_FIELDS) {
    if (draft[field.draft].trim() === baseline[field.draft].trim()) continue;
    const port = parsePort(draft[field.draft]);
    // 坏值不猜：它已经进了 invalidVergeFields，这里跳过才不会把 NaN 写进补丁。
    if (port !== null) patch[field.setting] = port;
  }
  if (draft.useDefaultBypass !== baseline.useDefaultBypass) {
    patch.use_default_bypass = draft.useDefaultBypass;
  }
  if (draft.bypass.trim() !== baseline.bypass.trim()) {
    const value = draft.bypass.trim();
    patch.system_proxy_bypass = value.length === 0 ? null : value;
  }
  return patch;
}

export type ProxySwitchState = "on" | "off" | "unset";

/** 开关当下到底是个什么状态：`null` 不冒充「关着」。 */
export function proxyStateOf(status: SystemProxyStatus): ProxySwitchState {
  if (status.enabled === true) return "on";
  if (status.enabled === false) return "off";
  return "unset";
}

/** 例外那一栏真正会写进系统的值：勾了默认就用默认那份，跟 main 的取法同一句。 */
export function effectiveBypass(draft: VergeDraft): string {
  return draft.useDefaultBypass ? DEFAULT_SYSTEM_PROXY_BYPASS : draft.bypass.trim();
}

/** 对齐回执 → 一句话。三种说法都要有：写成了、没写成、压根没到对齐这一步。 */
export function alignKeyOf(align: SystemProxyAlign): string {
  if (align.state === "aligned") return "network.verge.align.aligned";
  if (align.state === "failed") return "network.verge.align.failed";
  return `network.verge.align.skipped.${align.reason}`;
}

export function sysProxyReasonKey(reason: SystemProxyReason): string {
  return `network.verge.sysReason.${reason}`;
}

export function settingsReasonKey(reason: VergeSettingsReason): string {
  return `network.verge.reason.${reason}`;
}

export function settingLabelKey(key: VergeSettingKey): string {
  return `network.verge.key.${key}`;
}

/** `enable_system_proxy` 在 verge.yaml 里的那一行：开 / 关 / 没写过，三种都要说得出口。 */
export function yamlProxySwitchKey(value: boolean | null): string {
  if (value === true) return "network.verge.yamlOn";
  if (value === false) return "network.verge.yamlOff";
  return "network.verge.yamlUnset";
}

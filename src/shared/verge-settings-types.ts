/**
 * Wave 3 设置面的数据契约（主进程 ↔ 渲染端 ↔ preload 共用）。
 *
 * 白名单只有这一份：加一把键要同时改 `verge-settings.ts` 的判据与设置页的控件，
 * 少了任何一边就会出现「IPC 收得到、盘上写不进」或「盘上写了、页面上看不见」的半吊子。
 * 刻意不含 `enable_auto_launch`、`auto_check_update`、`clash_core` 这些——开机自启归注册表、
 * 更新归 Wave 4、内核选择归 T10，都不该由这个文件替 Verge 决定。
 */

export const VERGE_SETTING_KEYS = [
  "enable_system_proxy",
  "system_proxy_bypass",
  "use_default_bypass",
  "enable_tun_mode",
  "verge_mixed_port",
  "verge_socks_port",
  "verge_port",
] as const;

export type VergeSettingKey = (typeof VERGE_SETTING_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set<string>(VERGE_SETTING_KEYS);

export function isVergeSettingKey(value: unknown): value is VergeSettingKey {
  return typeof value === "string" && KEY_SET.has(value);
}

/** 每把键的显示名与设置页那一行的标签共用，避免「页面上叫 A、回执里叫 B」。 */
export const VERGE_SETTING_LABELS: Record<VergeSettingKey, string> = {
  "enable_system_proxy": "系统代理",
  "system_proxy_bypass": "代理例外",
  "use_default_bypass": "用默认例外",
  "enable_tun_mode": "TUN 模式",
  "verge_mixed_port": "混合端口",
  "verge_socks_port": "SOCKS 端口",
  "verge_port": "HTTP 端口",
};

export type VergeSettingValue = boolean | string | number | null;
export type VergeSettingsPatch = { [K in VergeSettingKey]?: VergeSettingValue };

/** `null` 一律是「盘上没写过 / 跟随默认」，不等于 `false`，也不等于 `0`。 */
export interface VergeSettingsView {
  enableSystemProxy: boolean | null;
  systemProxyBypass: string | null;
  useDefaultBypass: boolean | null;
  enableTunMode: boolean | null;
  mixedPort: number | null;
  socksPort: number | null;
  httpPort: number | null;
}

export const EMPTY_VERGE_SETTINGS_VIEW: VergeSettingsView = {
  enableSystemProxy: null,
  systemProxyBypass: null,
  useDefaultBypass: null,
  enableTunMode: null,
  mixedPort: null,
  socksPort: null,
  httpPort: null,
};

export type VergeSettingsReason =
  | "verge-running"
  | "not-found"
  | "bad-yaml"
  | "bad-key"
  | "bad-value"
  | "write-failed"
  | "read-failed";

export type VergeSettingsResult =
  | { ok: true; view: VergeSettingsView; changed: VergeSettingKey[] }
  | { ok: false; reason: VergeSettingsReason; view: VergeSettingsView; detail?: string };

export interface VergeSettingsRead {
  view: VergeSettingsView;
  /** null = 读到了；其余值说明「这一屏是空的，不是因为它们是 false」。 */
  reason: VergeSettingsReason | null;
  /** null 只在「连 Verge 的数据目录都没发现」时出现——那台机器压根没装过 Verge，别编一个路径。 */
  filePath: string | null;
  detail?: string;
}

/** 例外列表的落盘上限：注册表与 WinINET 都不是无限长的，超长要在写之前就说「不行」。 */
export const MAX_BYPASS_LENGTH = 2048;

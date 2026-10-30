/**
 * Wave 3 T9 系统代理的返回值契约（main ↔ preload ↔ 设置页共用）。
 *
 * `null` 一律是「盘上没这把键」，不等于 `false`：设置页的开关要能分清
 * 「Verge 关着」和「这台机器根本没人配过代理」，后者画成「关着」就是说谎。
 */

export interface SystemProxyStatus {
  enabled: boolean | null;
  server: string | null;
  bypass: string | null;
}

export const EMPTY_SYSTEM_PROXY_STATUS: SystemProxyStatus = { enabled: null, server: null, bypass: null };

export type SystemProxyReason =
  | "unsupported"
  | "bad-value"
  | "read-failed"
  | "write-failed"
  | "broadcast-failed"
  | "mismatch";

export type SystemProxyResult =
  | { ok: true; status: SystemProxyStatus }
  | { ok: false; reason: SystemProxyReason; status: SystemProxyStatus; detail?: string };

export interface SystemProxyRead {
  status: SystemProxyStatus;
  reason: SystemProxyReason | null;
  detail?: string;
}

export interface SystemProxyRequest {
  /** 开关本体。打开时必须同时给得出地址（不给就是「我不知道要指向哪」）。 */
  enabled: boolean;
  server?: string;
  /** `undefined` = 不碰例外；`null` = 删掉例外那一把键。 */
  bypass?: string | null;
}

/** 例外列表的落盘上限：这串最终进注册表，也会被 WinINET 逐个匹配，超长不是「更宽松」而是写坏。 */
export const MAX_SYSTEM_PROXY_BYPASS_LENGTH = 2048;

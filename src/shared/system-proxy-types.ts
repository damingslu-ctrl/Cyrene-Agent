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
  | "no-port"
  | "read-failed"
  | "write-failed"
  | "broadcast-failed"
  | "mismatch";

/** 与 WinINET 惯例同源的默认豁免：本机、私有段、回环网段——不含任何公网前缀。 */
export const DEFAULT_SYSTEM_PROXY_BYPASS = [
  "localhost",
  "127.*",
  "192.168.*",
  "10.*",
  "172.16.*", "172.17.*", "172.18.*", "172.19.*",
  "172.20.*", "172.21.*", "172.22.*", "172.23.*",
  "172.24.*", "172.25.*", "172.26.*", "172.27.*",
  "172.28.*", "172.29.*", "172.30.*", "172.31.*",
  "<local>",
].join(";");

export type SystemProxyResult =
  | { ok: true; status: SystemProxyStatus }
  | { ok: false; reason: SystemProxyReason; status: SystemProxyStatus; detail?: string };

/**
 * 「Verge 自己的那把 `enable_system_proxy`」有没有跟着改。
 *
 * 不改它的后果是具体的：Verge 下次启动或应用配置时，会按它账上那把开关重新写一遍
 * WinINET——用户在 Mochi 里打开的系统代理会被它悄悄关掉。所以主进程写完注册表后
 * 顺手把那把键对齐；对不齐也要说出来，因为「现在能上网」和「下次开机还能上网」是两件事。
 */
export type SystemProxyAlign =
  | { state: "aligned" }
  /** `not-applied` = 系统代理本身没写成，压根没到对齐这一步。 */
  | { state: "skipped"; reason: "verge-running" | "no-file" | "not-applied" }
  | { state: "failed"; detail?: string };

export type SystemProxySetResult = SystemProxyResult & { align: SystemProxyAlign };

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

/**
 * 设置页 → main 的唯一形状：只有开关。
 *
 * 地址与例外都不给页面递的机会——`server` 一进渲染端，就等于给任意前端一个
 * 「把全机流量指到别的主机」的口子；例外列表同理（它会进 WinINET，被所有应用读到）。
 * 这两样由 main 从内核与 verge.yaml 现算，页面只管显示算出来的结果。
 */
export interface SystemProxyToggle {
  enabled: boolean;
}

/** 例外列表的落盘上限：这串最终进注册表，也会被 WinINET 逐个匹配，超长不是「更宽松」而是写坏。 */
export const MAX_SYSTEM_PROXY_BYPASS_LENGTH = 2048;

/** 「网络」页与桌宠共用的只读数据类型。字段非必要不新增：页面与气泡都从这里取数。 */

export type ProxyMode = "rule" | "global" | "direct";

export type NetworkReason =
  | "no-config"
  | "no-controller"
  | "unauthorized"
  | "unreachable"
  | "timeout"
  | "bad-response";

export interface TrafficFrame {
  /** 字节/秒。 */
  up: number;
  down: number;
  /** 采样时刻（epoch ms）。 */
  at: number;
}

export interface ProxyNode {
  name: string;
  type: string;
  /** 最近一次延迟（ms）；null = 还没有数据。 */
  delay: number | null;
  /** 最近 10 次延迟，旧 → 新；失败记为 null。 */
  history: Array<number | null>;
  alive: boolean;
}

export interface ProxyGroup {
  name: string;
  type: string;
  now: string;
  nodes: ProxyNode[];
}

export interface ConnectionSummary {
  total: number;
  proxy: number;
  direct: number;
  reject: number;
}

export interface SubscriptionInfo {
  name: string;
  /** base64url 订阅名里解出的用户名；解不出时为空串。 */
  user: string;
  expireAt: number | null;
  updatedAt: number | null;
  upload: number;
  download: number;
  total: number;
}

export interface ControllerSnapshot {
  available: boolean;
  baseUrl: string | null;
  reason: NetworkReason | null;
  version: string | null;
}

export interface NetworkSnapshot {
  controller: ControllerSnapshot;
  mode: ProxyMode | null;
  groups: ProxyGroup[];
  connections: ConnectionSummary;
  subscription: SubscriptionInfo | null;
  traffic: TrafficFrame;
  /** 页头「刚刚更新」用；0 = 还没成功拉过。 */
  updatedAt: number;
}

export const EMPTY_TRAFFIC: TrafficFrame = { up: 0, down: 0, at: 0 };

/** main → 渲染端：完整快照（10s）或单帧流量（1.5s，避免重复搬节点树）。 */
export type NetworkUpdate =
  | { kind: "snapshot"; snapshot: NetworkSnapshot }
  | { kind: "traffic"; traffic: TrafficFrame };

export function emptyNetworkSnapshot(): NetworkSnapshot {
  return {
    controller: { available: false, baseUrl: null, reason: "no-config", version: null },
    mode: null,
    groups: [],
    connections: { total: 0, proxy: 0, direct: 0, reject: 0 },
    subscription: null,
    traffic: { ...EMPTY_TRAFFIC },
    updatedAt: 0,
  };
}

export const NETWORK_MODES: ReadonlyArray<ProxyMode> = ["rule", "global", "direct"];

export function isProxyMode(value: unknown): value is ProxyMode {
  return value === "rule" || value === "global" || value === "direct";
}

/** 写操作的回执：失败也回一份当下快照，页面不靠异常文案猜状态。 */
export interface NetworkActionFailure {
  ok: false;
  reason: NetworkReason;
  snapshot: NetworkSnapshot;
}

export type NetworkActionResult =
  | { ok: true; snapshot: NetworkSnapshot }
  | NetworkActionFailure;

export interface AutoSelectOutcome {
  group: string;
  previous: string;
  best: string | null;
  switched: boolean;
}

export type NetworkAutoSelectResult =
  | { ok: true; result: AutoSelectOutcome; snapshot: NetworkSnapshot }
  | NetworkActionFailure;

export type NetworkTestResult =
  | { ok: true; delays: Record<string, number>; snapshot: NetworkSnapshot }
  | NetworkActionFailure;

export function reasonOf(error: unknown): NetworkReason {
  const reason = typeof error === "object" && error !== null
    ? (error as { reason?: unknown }).reason
    : undefined;
  return reason === "no-config" || reason === "no-controller" || reason === "unauthorized"
    || reason === "unreachable" || reason === "timeout" || reason === "bad-response"
    ? reason
    : "unreachable";
}


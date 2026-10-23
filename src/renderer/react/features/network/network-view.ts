import type { ProxyNode } from "../../../../shared/network-types";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function scaled(value: number): { count: number; unit: (typeof UNITS)[number] } {
  let remaining = finiteNonNegative(value);
  let index = 0;
  while (remaining >= 1024 && index < UNITS.length - 1) {
    remaining /= 1024;
    index += 1;
  }
  return { count: remaining, unit: UNITS[index] };
}

/** 字节/秒 → 人读速率；坏帧（NaN/Infinity/负）落 0，不显示天文数字。 */
export function formatSpeed(bytesPerSecond: number): string {
  const { count, unit } = scaled(bytesPerSecond);
  if (unit === "B") return `${Math.round(count)} B/s`;
  return `${count.toFixed(1)} ${unit}/s`;
}

/** 累计字节 → 人读大小（订阅已用量/总量）。 */
export function formatBytes(bytes: number): string {
  const { count, unit } = scaled(bytes);
  if (unit === "B") return `${Math.round(count)} B`;
  return `${count.toFixed(1)} ${unit}`;
}

export type DelayTone = "good" | "medium" | "bad" | "none";

/** 延迟分档：≤150 好、≤400 中、其余差；0 与坏值是「没数据」。 */
export function delayTone(delay: number | null): DelayTone {
  if (delay === null || !Number.isFinite(delay) || delay <= 0) return "none";
  if (delay <= 150) return "good";
  if (delay <= 400) return "medium";
  return "bad";
}

/** 最近样本的成功比例（0..1）；没有任何样本返回 null（页面上显示「—」而不是 0%）。 */
export function nodeStability(history: Array<number | null>): number | null {
  if (history.length === 0) return null;
  const success = history.filter((entry) => entry !== null && Number.isFinite(entry) && entry > 0).length;
  return success / history.length;
}

/** 订阅已用占比，夹在 0..1；总量未知按 0。 */
export function subscriptionProgress(upload: number, download: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const used = finiteNonNegative(upload) + finiteNonNegative(download);
  return Math.min(1, used / total);
}

export type NodeSort = "speed" | "stability" | "name";

function stabilityRank(node: ProxyNode): number {
  const stability = nodeStability(node.history);
  return stability === null ? -1 : stability;
}

function delayRank(node: ProxyNode): number {
  return node.delay !== null && Number.isFinite(node.delay) && node.delay > 0 ? node.delay : Number.POSITIVE_INFINITY;
}

/** 节点列表排序：只出新数组，不改组里的原顺序（数据仍以快照为准）。 */
export function sortNodes(nodes: ProxyNode[], mode: NodeSort): ProxyNode[] {
  const copy = [...nodes];
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  if (mode === "stability") {
    return copy.sort((a, b) =>
      stabilityRank(b) - stabilityRank(a) || delayRank(a) - delayRank(b) || a.name.localeCompare(b.name, "zh-CN"),
    );
  }
  return copy.sort((a, b) =>
    delayRank(a) - delayRank(b) || a.name.localeCompare(b.name, "zh-CN"),
  );
}

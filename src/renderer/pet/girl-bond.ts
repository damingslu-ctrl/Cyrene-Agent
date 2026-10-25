/**
 * 猫娘的羁绊成长：亲密度 → 五档称号、升级时刻、相识天数。
 *
 * 全部是纯函数/常量，不读盘、不读时钟；落盘与「升级要说哪句」留在引擎里。
 * 阈值是**单调且互不相同**的，`bondTierOf` 对 0..1 之外的输入也给出合法档位——
 * 存档被改坏时宁可停在「初识」，也不能让 UI 读到 undefined 称号。
 */

export interface BondTier {
  id: "new" | "familiar" | "close" | "reliant" | "heart";
  name: string;
  /** 进入该档所需的最低亲密度（含）。 */
  min: number;
}

export const BOND_TIERS: readonly BondTier[] = [
  { id: "new", name: "初识", min: 0 },
  { id: "familiar", name: "熟悉", min: 0.22 },
  { id: "close", name: "亲近", min: 0.45 },
  { id: "reliant", name: "依赖", min: 0.66 },
  { id: "heart", name: "心意相通", min: 0.86 },
] as const;

/** 升级爱心爆发的视觉时长（渲染端诊断与记号层共用这条秒表）。 */
export const BOND_UP_MS = 2_600;

export interface BondState {
  /** 0 起（初识 = 0）。 */
  index: number;
  id: BondTier["id"];
  name: string;
  min: number;
  /** 下一档门槛；已是最高档时 = 1。 */
  nextAt: number;
}

export function bondTierOf(affinity: number): BondState {
  const value = Number.isFinite(affinity) ? Math.min(1, Math.max(0, affinity)) : 0;
  let index = 0;
  for (let i = BOND_TIERS.length - 1; i >= 0; i -= 1) {
    if (value >= BOND_TIERS[i].min) {
      index = i;
      break;
    }
  }
  const tier = BOND_TIERS[index];
  return {
    index,
    id: tier.id,
    name: tier.name,
    min: tier.min,
    nextAt: index + 1 < BOND_TIERS.length ? BOND_TIERS[index + 1].min : 1,
  };
}

/** 本地日历日序号（用 y/m/d 重组 UTC 零点，跨 DST 也不会少一天/多一天）。 */
function localDayNumber(ms: number): number {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 0;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1970, 0, 1)) / 86_400_000);
}

function dayNumberKey(day: number): string {
  const d = new Date(Date.UTC(1970, 0, 1) + day * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dayOfMonth}`;
}

/** 本地日期键（YYYY-MM-DD）：日常去重（晨间伸懒腰）用它。 */
export function dateKey(ms: number): string {
  return dayNumberKey(localDayNumber(ms));
}

/**
 * 「今晚」的键：凌晨 0–5 点仍算前一晚。
 * 用它做深夜提醒的去重，23:30 提过一次，00:30 就不会再说第二遍。
 */
export function nightKey(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return dayNumberKey(0);
  const hour = d.getHours();
  const day = localDayNumber(ms) - (hour < 5 ? 1 : 0);
  return dayNumberKey(day);
}

/**
 * 相识第几天：见面当天算第 1 天。
 * `metAt` 坏掉/未来时间一律回 1——「第 -3 天」比不显示更糟。
 */
export function daysTogether(metAt: number, nowMs: number): number {
  if (!Number.isFinite(metAt) || metAt <= 0 || !Number.isFinite(nowMs)) return 1;
  const diff = localDayNumber(nowMs) - localDayNumber(metAt);
  return Math.max(1, diff + 1);
}

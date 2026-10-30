/**
 * 订阅页的纯函数层：每行能点什么、地址怎么示人、失败怎么说话，都在这里判一次。
 *
 * 组件只负责接线。把闸门摆在这层的理由和主进程一样——`rowActions` 里那句
 * 「当前订阅不给自己切换到」和「内置项删不掉」如果散进 JSX，两处写歪一处不会有人红；
 * 而盘上的规矩（`profiles-store` 的 BUILTIN_UIDS / SELECTABLE_TYPES）已经在主进程兜底，
 * 这里歪了最多是按钮少了，不会是多写出一个字节。
 */
import type { ProfileResult, ProfileRow } from "../../../../shared/subscription-types";

export type SubscriptionApi = Window["verge"]["subscriptions"];

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 一行上四个动作的可用性；口径与主进程 `listProfiles` 的三个旗子一致。 */
export interface RowActions {
  select: boolean;
  update: boolean;
  remove: boolean;
  options: boolean;
}

export function rowActions(row: ProfileRow): RowActions {
  return {
    select: row.selectable && !row.current,
    // 本地文件没有可下载的地址（主进程同口径：`invalid` + 「本地订阅没有可下载的地址」）。
    update: row.selectable && row.url !== null,
    remove: !row.builtin,
    // with_proxy / update_interval 都只管"下载这件事"，没有地址就没什么可管。
    options: row.url !== null,
  };
}

/**
 * 地址只以主机名示人。
 *
 * 订阅 URL 里常带 token，整条印在界面上等于把凭据贴在截图里；
 * 解析不出来（被人手改歪过的账本）给 null，让页面显示占位而不是把原串吐出去。
 */
export function urlHost(url: string | null): string | null {
  if (url === null || url.trim() === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname !== "" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 自动更新间隔预设（秒）。下限由 shared 的 `MIN_UPDATE_INTERVAL` 管，这里全都在它之上；
 * 单位与主进程校验一致，不在此处另立一套。
 */
export const UPDATE_INTERVAL_CHOICES = [1800, 3600, 10800, 43200, 86400] as const;

/**
 * 下拉框里实际出现的档位：预设 + 盘上那个不属于预设的值。
 * 少了后半句，一个 720 秒的账本会被显示成「跟随默认」，改不动也说不清。
 */
export function intervalChoiceValues(value: number | null): number[] {
  const base: number[] = [...UPDATE_INTERVAL_CHOICES];
  if (value === null || base.includes(value)) return base;
  return [...base, value].sort((a, b) => a - b);
}

/** 秒数怎么念：整小时（且不少于一小时）按小时，其余按分钟。 */
export function intervalDuration(seconds: number): { unit: "minutes" | "hours"; n: number } {
  if (seconds >= 3600 && seconds % 3600 === 0) return { unit: "hours", n: seconds / 3600 };
  return { unit: "minutes", n: Math.max(1, Math.round(seconds / 60)) };
}

/**
 * 一次写之后页面该拿哪份列表。
 *
 * 成功时原样采纳（哪怕删掉最后一条真的是空列表）；失败时账本读不出来只会给空数组，
 * 这时候拿页面上现有的顶着——「一次失败把订阅列表变成空白」是最难复现的那种事故。
 */
export function rowsAfter(result: ProfileResult, current: ProfileRow[]): ProfileRow[] {
  if (result.ok) return result.rows;
  return result.rows.length > 0 ? result.rows : current;
}

/** 失败的结构化说明；成功返回 null，由调用方去摆成功回执。 */
export type SubFailure =
  | { kind: "gated" }
  | {
      kind: "failure";
      reasonKey: string;
      detail: string | null;
      replaced: boolean;
      /** 只在 http-status 这类原因里有；界面上要区分 403 与 500。 */
      status?: number;
    };

export function failureOf(result: ProfileResult): SubFailure | null {
  if (result.ok) return null;
  if (result.reason === "verge-running") return { kind: "gated" };
  const out: SubFailure = {
    kind: "failure",
    reasonKey: `network.sub.reason.${result.reason}`,
    detail: result.detail ?? null,
    replaced: result.replaced === true,
  };
  if (result.status !== undefined) return { ...out, status: result.status };
  return out;
}

/** merge 链里读不到的附件：切是切成功了，但那几份增强没吃进去，必须点名。 */
export function warningsText(warnings: string[], t: Translate): string {
  if (warnings.length === 0) return "";
  return t("network.sub.mergeMissing", { uids: warnings.join(" / "), n: warnings.length });
}

/** 导入按钮的可用性；主进程那侧还有一道（`bad-url`），这里只管别让人白点一次。 */
export function urlFormValid(raw: string): boolean {
  const text = raw.trim();
  if (text === "" || /\s/.test(text)) return false;
  return urlHost(text) !== null;
}

/**
 * 订阅页的数据契约（主进程 ↔ 渲染端共用）。
 *
 * 类型放 shared 而不是留在 main：渲染端要照着它画列表，preload 要照着它声明返回值。
 * `ProfileItem`/`ProfilesDoc` 那些**带未知字段**的形状刻意不进来——那是账本层的事，
 * 越过 IPC 只会让页面以为自己能改 Verge 的私有键。
 */

export interface ProfileRow {
  uid: string;
  type: string;
  /** 面板上那一行显示什么：自己填的备注 > 订阅 token 里的用户名 > 原名 > uid。 */
  label: string;
  url: string | null;
  desc: string | null;
  /** 毫秒；`updated` 在盘上是秒。0/缺失报 null，别把"没更新过"演成 1970。 */
  updatedAt: number | null;
  current: boolean;
  builtin: boolean;
  selectable: boolean;
  /**
   * `option.with_proxy` / `option.update_interval` 的原样回读。
   * `null` 表示账本里没写过＝跟随默认，和 `false` / `0` 是两种不同的盘上状态；
   * 页面必须拿得到初值，否则开关一开就是说谎的界面。
   */
  withProxy: boolean | null;
  updateInterval: number | null;
}

export type ProfileFailReason =
  | "verge-running"
  | "not-found"
  | "invalid"
  | "bad-yaml"
  | "bad-shape"
  | "uid-clash"
  | "profile-missing"
  | "bad-subscription"
  | "reload-failed"
  | "write-failed"
  | "read-failed"
  | "bad-url"
  | "too-many-redirects"
  | "bad-redirect"
  | "http-status"
  | "too-large"
  | "no-proxies"
  | "timeout"
  | "network";

/**
 * 每一次写都带 `rows`：失败时页面仍要显示旧列表，不能因为一次报错变成空白。
 * `replaced` 只在「正文已换新、但内核没吃下去」时为真——回滚还是重试是用户的决定，
 * 这个信息一旦漏报，下一次更新就会拿半新半旧的盘去做判断。
 */
export type ProfileResult =
  | { ok: true; rows: ProfileRow[]; warnings: string[]; uid?: string; proxyCount?: number }
  | { ok: false; reason: ProfileFailReason; rows: ProfileRow[]; detail?: string; status?: number; replaced?: boolean };

/** option 里只认这两个键，其余写进账本 Verge 也不认。 */
export const PROFILE_OPTION_KEYS = ["with_proxy", "update_interval"] as const;

/** 自动更新间隔下限（秒）。0 秒＝拿用户的网络给机场做压测。 */
export const MIN_UPDATE_INTERVAL = 60;

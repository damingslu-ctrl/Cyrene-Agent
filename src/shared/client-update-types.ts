/**
 * v1.26 客户端更新通道（Wave 4 T12）的纯类型与常量。
 *
 * 一本账拆三段（检查 / 下载 / 安装）而不是一个 stage 字符串，是因为这三段的「成了」
 * 不是同一件事：查到了新版不代表下好了，下好了不代表装上，装上了我们也已经退出了、
 * 无从知道。把它们压成一个字段，页面就只能替用户猜——所以每一段各留自己的回执，
 * 在途那一档（`phase`）单独说，不许被读成某一段已经完了。
 *
 * 类型放 shared 的理由与 `core-types.ts` 一样：页面、preload、main 要说同一套话。
 * 每加一档原因，渲染端的枚举锁就红一次，逼着补三份语言的措辞。
 */

/** 自托管安装包的落盘目录：只写 `<userData>/updates/`，别处一个字节都不碰。 */
export const UPDATE_DIR_NAME = "updates";

/**
 * 当下正在走哪一段。`idle` 也包括「上一次败了」——败是各段回执里的事，
 * 不是一种驻留状态，否则页面会出现「既在下载又已失败」这种自相矛盾的帧。
 */
export const CLIENT_UPDATE_PHASES = ["idle", "checking", "downloading", "installing"] as const;
export type ClientUpdatePhase = (typeof CLIENT_UPDATE_PHASES)[number];

/** 检查这一本账的下场。`latest` 说的是发布页那版不比我们新，不是「更新坏了」。 */
export const CLIENT_CHECK_OUTCOMES = ["available", "latest", "failed"] as const;
export type ClientCheckOutcome = (typeof CLIENT_CHECK_OUTCOMES)[number];

/**
 * 下载这一本账。`ready` 只承诺两件事：字节在 `<userData>/updates/` 里躺着，
 * 且它的 sha256 与发布页给的摘要对得上。不承诺装得上、不承诺装好。
 */
export const CLIENT_DOWNLOAD_OUTCOMES = ["ready", "failed"] as const;
export type ClientDownloadOutcome = (typeof CLIENT_DOWNLOAD_OUTCOMES)[number];

/**
 * 安装这一本账只有一档成功叫 `launched`：安装器被起来了、我们随后退出。
 * **成功升级本身我们永远看不见**——进程已经没了。唯一的凭据是下一次启动时
 * `currentVersion` 变成了那一版；所以卡片上「已启动安装器」不许写成「升级成功」。
 */
export const CLIENT_INSTALL_OUTCOMES = ["launched", "failed"] as const;
export type ClientInstallOutcome = (typeof CLIENT_INSTALL_OUTCOMES)[number];

/**
 * 失败原因。每档都必须在本层的某处被产出过（`update-service` 那把反向尺逐条扫源码），
 * 没生产者的词不许挂进来——T11 就因为留了四档这样的词，页面替 `no-port` 编过下载失败的话。
 */
export const CLIENT_UPDATE_REASONS = [
  /** 请求没回来 / 非 2xx / 到点断掉。检查与下载两头都用它。 */
  "network-failed",
  /** 回来的不是能读的 JSON、没有 tag、或 tag 不是合法 semver——读不出就不当「没有新版」。 */
  "bad-response",
  /** 发布页里没有 `Mochi-Setup-<version>.exe`（或同版本多到认不出哪颗）。 */
  "no-asset",
  /** 那份 release 不属于钉住的仓库：`html_url` 指的是别人的 repo。 */
  "wrong-source",
  /** 只有预发布/草稿：`releases/latest` 按语义不该给，给了也不装。 */
  "prerelease-only",
  /** 上游没给 sha256 凭据——一个字节都不下，而不是「先下回来看运气」。 */
  "digest-missing",
  /** 拿到手的字节不是它说的那个：网络坏了，或有人在中间换包。 */
  "digest-mismatch",
  /** 包比体积预算大（含 content-length 声明就超和边读边算超两趟）。 */
  "too-large",
  /** 落盘这一步败了：盘满、目录建不出来、rename 被占用。半包当场删掉，不上账。 */
  "write-failed",
  /** 想装的时候盘上没有那份 ready 的包（被清理掉了、或这条会话里根本没下过）。 */
  "no-package",
  /** 包还在，但它对不上当下认的那一版：换过了、或检查又往前走了一步。不许拿旧包冒充新升级。 */
  "stale-package",
  /** 我们自己那颗内核还在跑：安装器会硬关掉这个 App，协作退出就跑不到，代理与端口留在原地没人收。 */
  "core-running",
  /** 安装器没起来（spawn 抛错）：这是唯一一档「什么都没发生」的败，App 还在跑。 */
  "launch-failed",
  /** 已经有一趟在走了：重复点击不去新开一条连接，回这一档并带上正在走的那一段。 */
  "in-flight",
] as const;
export type ClientUpdateReason = (typeof CLIENT_UPDATE_REASONS)[number];

export interface ClientCheckReceipt {
  outcome: ClientCheckOutcome;
  at: number;
  /** 发布页那一版；`latest`/`failed` 时也可以有（读到了就该说得出）。 */
  latestVersion: string | null;
  reason: ClientUpdateReason | null;
  detail: string | null;
}

export interface ClientDownloadReceipt {
  outcome: ClientDownloadOutcome;
  at: number;
  version: string;
  /** 相对 `updates/` 的文件名；给页面说的是「Mochi-Setup-1.16.0.exe」这种可核对的东西。 */
  fileName: string;
  /** 落盘字节数。`ready` 才是真体积，`failed` 那趟的半包已经被删掉了，这里记 0。 */
  bytes: number;
  reason: ClientUpdateReason | null;
  detail: string | null;
}

export interface ClientInstallReceipt {
  outcome: ClientInstallOutcome;
  at: number;
  version: string;
  reason: ClientUpdateReason | null;
  detail: string | null;
}

export interface ClientUpdateState {
  /**
   * 当前跑的这版，来自 `app.getVersion()`——**不落盘、不记账**。
   * 盘上存一份「本机是 1.15.0」会留在原地骗人（手工换过 exe、装了一半、降过版），
   * 而 `launched` 那一档我们本来就无法知道结果；下一次启动读到的才是事实。
   */
  currentVersion: string;
  autoCheck: boolean;
  phase: ClientUpdatePhase;
  check: ClientCheckReceipt | null;
  download: ClientDownloadReceipt | null;
  install: ClientInstallReceipt | null;
}

/** 「改自动检查」这一趟落盘的下场：内存里改了 ≠ 盘上住了。 */
export interface ClientUpdateSave {
  ok: boolean;
  detail: string | null;
}

/**
 * 通道回给页面的形状：整份状态 + 只有开关那一条会填的落盘下场。
 *
 * 四条动作都回**整份** `ClientUpdateState` 而不是各自那一条回执，是因为「这次点击归哪本账」
 * 页面已经知道自己按了哪颗；把三本账一起给，卡片才不必为「刚点的是安装，但检查那本也更新了」
 * 这种帧自己拼一份状态出来。`saved` 与 `CoreView.update` 同构：只有对应那一条通道会填。
 */
export interface ClientUpdateView extends ClientUpdateState {
  saved: ClientUpdateSave | null;
}

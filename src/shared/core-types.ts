/**
 * v1.26 内核宿主（Wave 3 T10）的纯类型与常量。
 *
 * 三态与原因词表放 shared 是因为页面、preload、main 都要说同一套话：
 * `CoreReason` 每加一档，渲染端的枚举锁就红一次，逼着补三份语言的措辞。
 */

/** 内核从哪儿来（spec D2）。`external` 是默认态：控制器可达就不启进程。 */
export const CORE_MODES = ["external", "installed", "bundled"] as const;
export type CoreMode = (typeof CORE_MODES)[number];

/**
 * 这一档的内核是不是我们自己 spawn 起来的那颗。
 *
 * 定义放在 shared 是因为装配层与页面问的是同一件事，而两边答案一旦漂开，最坏的形状是
 * 「停止」按钮递给了 `external`——那点下去是替用户关掉他正在用的 Verge 的服务。
 * 用白名单而不是「不等于 external」：加一档 mode 时这里不会自动把它算成我们那颗，
 * `CORE_MODES` 那条枚举锁会红，逼着回答「新这一档归谁」。
 */
export function isOwnCoreMode(mode: CoreMode | null): boolean {
  return mode === "installed" || mode === "bundled";
}

/** 宿主自己的生命周期。`blocked` 是「够格起，但不该起」——单写者闸门挡下的那一档。 */
export const CORE_STATES = ["stopped", "starting", "running", "exited", "blocked"] as const;
export type CoreState = (typeof CORE_STATES)[number];

/**
 * 失败原因。每档都必须有话说得出，尤其 `self-heal-exhausted`：
 * 自愈打满之后不许继续静默重起，用户看到的必须是一句「为什么不再试了」。
 *
 * 这里只收「进程这一本账」能产出的词。下载/摘要/解压那几档曾经挂在这儿，T11 把它们
 * 归进 `CORE_UPDATE_REASONS`：`core-manager` 从不下载，留在这儿就是给页面准备一批
 * 永远不会被说出的句子——两本账各说各的话，枚举锁才拦得住「用更新的话解释进程」。
 */
export const CORE_REASONS = [
  "verge-running",
  "unsupported-platform",
  "no-binary",
  /** 订阅正文/merge 链合成不出那份配置（没选订阅、正文坏了）——配置写不出来就不 spawn。 */
  "no-config",
  "no-port",
  "spawn-failed",
  "not-ready",
  "exited",
  "self-heal-exhausted",
] as const;
export type CoreReason = (typeof CORE_REASONS)[number];

/** spec D2 的默认档：mixed 7897 / controller 9097。7897 是刻意躲开 Verge 常见的 7896。 */
export const DEFAULT_MIXED_PORT = 7897;
export const DEFAULT_CONTROLLER_PORT = 9097;
/** 默认档被占之后从这一号往上找空闲；两个端口都要独立可用才算数。 */
export const FALLBACK_PORT_START = 17890;
export const PORT_SCAN_LIMIT = 200;
/** 崩溃自愈的上限（spec D2「最多 3 次」）。打满之后只报原因，不再重起。 */
export const MAX_SELF_HEAL = 3;
/** 日志落在 Mochi 自己的 userData，不进 Verge 目录（spec D2 的边界）。 */
export const CORE_LOG_FILE = "core.log";
/** 自托管内核放 `<userData>/core/`，`-d` 指的就是这一层。 */
export const CORE_DIR_NAME = "core";

/** 借用安装的 Verge 内核时，可执行文件的名字族（本机实测：`verge-mihomo.exe` 与 `verge-mihomo-alpha.exe`）。 */
export const INSTALLED_CORE_PREFIX = "verge-mihomo";

/** 只读借用：这一档绝不写人家的安装目录，读到的路径只用来 spawn。 */
export interface CoreBinary {
  mode: CoreMode;
  exePath: string;
}

export interface CorePortPair {
  mixed: number;
  controller: number;
}

export interface CoreStatus {
  state: CoreState;
  mode: CoreMode | null;
  /** 真的起来了才有；页面不许在 null 上画一个「运行中」。 */
  pid: number | null;
  ports: CorePortPair | null;
  controller: string | null;
  reason: CoreReason | null;
  detail: string | null;
  /** 已经自愈过几次；上限是 MAX_SELF_HEAL。 */
  healAttempts: number;
  startedAt: number | null;
}

export const EMPTY_CORE_STATUS: CoreStatus = {
  state: "stopped",
  mode: null,
  pid: null,
  ports: null,
  controller: null,
  reason: null,
  detail: null,
  healAttempts: 0,
  startedAt: null,
};

/** 控制面口令的来处。`none` 是「这一班还没写过配置」，不是「内核没有口令」。 */
export const CORE_SECRET_SOURCES = ["verge", "mochi", "none"] as const;
export type CoreSecretSource = (typeof CORE_SECRET_SOURCES)[number];

/**
 * 内核那几条通道共用的一份回执。
 *
 * 之所以不是裸 `CoreStatus`：口令来源与「上次更新到底装没装上」这两档只有装配层知道，
 * 而它们是页面唯一能解释「内核在跑、网络页却说控制器不通」与「按了更新却没动静」的线索
 * ——把两处答案分两次问，页面就得自己猜哪一份更新。
 */
export interface CoreView {
  status: CoreStatus;
  secretSource: CoreSecretSource;
  /** 最近一次内核更新的下场；一次都没试过就是 null。 */
  update: CoreUpdateState | null;
}

/**
 * 一次内核更新的四种下场。
 *
 * 单列一档 `busy` 而不是折进 `failed`：「我们自己那颗还在跑，所以不换」是**设计**，
 * 不是故障——把它报成失败会让用户去找根本不存在的毛病，也会让页面把这句话染红。
 * 同样不给它配 `CoreReason`：那本词表说的是「内核为什么没在跑」，与换不换文件是两条轴。
 */
export const CORE_UPDATE_OUTCOMES = ["installed", "latest", "busy", "failed"] as const;
export type CoreUpdateOutcome = (typeof CORE_UPDATE_OUTCOMES)[number];

/**
 * 更新记录里允许出现的失败原因——更新这一条轴自己的词。
 *
 * 独立于 `CORE_REASONS` 而不是取它的子集：那本词表说的是「内核为什么没在跑」，
 * 这里的词说的是「这一次为什么没换上」。要是共用，页面就得替 `no-port` 编一句
 * 「下载为什么败」，而 `swap-failed`（文件换不动）也塞不进那本表里——
 * 两套话各自钉各自的枚举锁，才不会互相冒充。
 *
 * `no-asset` 与 `download-failed` 也分两档：「发布页里没有可装的正式包」与
 * 「有包但没拿到」是两种要用户做不同事的下场（等上游发版 vs 查网络）。
 */
export const CORE_UPDATE_REASONS = [
  "no-asset",
  "download-failed",
  "digest-missing",
  "digest-mismatch",
  "extract-failed",
  "swap-failed",
] as const;
export type CoreUpdateReason = (typeof CORE_UPDATE_REASONS)[number];

export interface CoreUpdateState {
  outcome: CoreUpdateOutcome;
  /** release 的 `tag_name`，如 `v1.19.33`；连发布页都没问到就是 null。 */
  tag: string | null;
  /** 挑中的资产原名。猜错资产时这一串就是案发现场，不许只报「下载失败」。 */
  asset: string | null;
  reason: CoreUpdateReason | null;
  detail: string | null;
  /** 这一次尝试的墙钟；页面用它说「刚才那次」而不是「一直这样」。 */
  at: number;
}

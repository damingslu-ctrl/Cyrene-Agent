/**
 * v1.26 内核宿主（Wave 3 T10b/T11）：「内核」卡片的全部判定。
 *
 * 判定放在纯模块里，是因为这张卡最贵的错不是画歪，而是**说假话**：
 * - `starting` 画成运行中：用户在 8 秒窗口里看到「运行中」，其实控制器还没答话；
 * - external 态给一颗能点的「停止」：那点下去是替用户关掉他正在用的 Verge 内核；
 * - 起失败时回一个勾：`start()` 从来不抛错，失败只写在 `state`/`reason` 里，
 *   按「有没有抛」判成败会永远判成成功。
 * - T11 加的一条同形：**「装上了」不等于「生效了」**。换文件与进程是两本账——
 *   更新那次的回执只准读 `view.update`，不许因为内核在跑就说新版已经用上了。
 * 这几条都能被单测钉住，所以不该留在 JSX 里。
 */
import {
  MAX_SELF_HEAL,
  isOwnCoreMode,
  type CoreMode,
  type CoreReason,
  type CoreSecretSource,
  type CoreState,
  type CoreStatus,
  type CoreUpdateOutcome,
  type CoreUpdateReason,
  type CoreUpdateState,
  type CoreView,
} from "../../../../shared/core-types";

/** 主进程 preload 暴露的内核接口（组件只用其中一部分）。 */
export type CoreApi = Window["verge"]["core"];

export type CoreAction = "start" | "stop" | "restart" | "update";

/** 进程那一侧的三个动作：它们汇回的是「此刻哪一态」；更新换的是文件，走另一本账。 */
export type CoreProcessAction = Exclude<CoreAction, "update">;

/**
 * 三种脸色。`neutral` 是专门为 `busy` 那一档加的：
 * 「我们自己那颗还在跑，所以没换文件」是**设计**，报成绿色像成功、报成红色像故障，
 * 两种都会把用户支去一件他不需要做的事上。
 */
export type CoreTone = "ok" | "neutral" | "error";

export function coreStateKey(state: CoreState): string {
  return `network.core.state.${state}`;
}

/** `mode === null` 是「这一班还没认领过任何内核」，不许冒充 external。 */
export function coreModeKey(mode: CoreMode | null): string {
  return `network.core.mode.${mode ?? "none"}`;
}

export function coreReasonKey(reason: CoreReason): string {
  return `network.core.reason.${reason}`;
}

export function coreSecretKey(source: CoreSecretSource): string {
  return `network.core.secret.${source}`;
}

export function coreUpdateKey(outcome: CoreUpdateOutcome): string {
  return `network.core.update.outcome.${outcome}`;
}

export function coreUpdateReasonKey(reason: CoreUpdateReason): string {
  return `network.core.update.reason.${reason}`;
}

/**
 * 这颗进程是不是我们起的。
 *
 * `external` 的 `pid` 是 null 却不是「没在跑」：控制器可达时我们也报 running，
 * 那颗进程归 Verge 的服务管。凡是会 kill 进程的动作，都只准对着我们自己起的那颗。
 * 算式不在这儿写：`isOwnCoreMode` 在 shared，装配层那一侧 kill 前问的是同一把尺——
 * 两处各写一遍时，最坏的漂法是页面把「停止」递给了 Verge 那颗。
 */
export function isOwnCore(status: CoreStatus): boolean {
  return isOwnCoreMode(status.mode);
}

/** 只有 running 才算在线；`starting` 与 `blocked` 都不许亮绿点。 */
export function coreOnline(state: CoreState): boolean {
  return state === "running";
}

export interface CoreActions {
  start: boolean;
  stop: boolean;
  restart: boolean;
  update: boolean;
  /** 三颗都不该点时那句解释；null 表示没什么要辩解的。 */
  hintKey: string | null;
}

/**
 * 四颗按钮该不该按下去。
 *
 * - `start`：只在「手上这颗还没在跑」时给——running/starting 时再点一次什么也不发生，
 *   灰着比让用户以为「点了没反应」好。
 * - `stop` / `restart`：都要 `isOwnCore`，否则按下去杀的是 Verge 的进程。
 * - 在途时四颗全灰：`startCoalesced` 会合并在途的那次起，但 restart 不合并，
 *   连点两下会真的起停起一遍。
 * - `update` **只看在途，不看内核在不在跑**。换不换得动只有装配层知道（它问的是内存里那颗
 *   进程），页面照 `state` 自己算一遍就是把同一条闸门写两处——漂开那次就是「灰着一棵
 *   没人知道为什么灰的按钮」。running 时点下去得到的是 `busy` 那句「先停内核再换文件」，
 *   而 `canSwap` 排在下载之前，这一次点击不烧那 22 MB。
 */
export function coreActions(status: CoreStatus, busy: boolean): CoreActions {
  const live = status.state === "running" || status.state === "starting";
  const own = isOwnCore(status);
  return {
    start: !busy && !live,
    stop: !busy && live && own,
    restart: !busy && live && own,
    update: !busy,
    hintKey: busy
      ? "network.core.hint.busy"
      : live && !own
        ? "network.core.hint.external"
        : null,
  };
}

/** 端口读数：`ports === null`（external 态）时不许写成 0。 */
export function corePortReadout(status: CoreStatus): string | null {
  if (!status.ports) return null;
  return `${status.ports.mixed} / ${status.ports.controller}`;
}

/** 已自愈几次；0 次不占一行——每张卡都挂一句「自愈 0/3」就没人看它了。 */
export function coreHealReadout(status: CoreStatus): string | null {
  if (status.healAttempts <= 0) return null;
  return `${Math.min(status.healAttempts, MAX_SELF_HEAL)}/${MAX_SELF_HEAL}`;
}

/**
 * 「已运行」只在数得清的时候给：external 的 `startedAt` 是**我们发现它**的时刻，
 * 不是它起来的时刻，把它写成「已运行 34 秒」是编出来的数字。
 */
export function coreUptimeMs(status: CoreStatus, now: number): number | null {
  if (status.state !== "running" || !isOwnCore(status)) return null;
  if (status.startedAt === null) return null;
  const elapsed = now - status.startedAt;
  return elapsed >= 0 ? elapsed : null;
}

/**
 * 有没有一句红字要端出来。
 *
 * 判据带上 `state !== "running"` 是防一手不可能：账上同时写着 running 和 reason，
 * 说明 `settle` 被谁绕过了——那种时候也不该在绿点上再叠一层「出问题了」。
 */
export function coreAttention(status: CoreStatus): boolean {
  return status.reason !== null && status.state !== "running";
}

/**
 * 卡片顶那句说明——五种「此刻这张卡在看什么」得说五种话。
 *
 * 「已经接管」与「还没接管」共用一句话是本卡片最难发现的一种谎，所以这条判定不许留在 JSX 里：
 * - 有 reason 且没在跑：先提醒用户去看下面那句红字。
 * - `starting`：可能是自愈在跑，也可能是用户刚点下去；这时候不能说「没在跑」。
 * - external 在跑：进程归 Verge，我们只是吃它的控制器。
 */
export function coreLeadKey(status: CoreStatus): string {
  if (coreAttention(status)) return "network.core.hint.attention";
  if (status.state === "starting") return "network.core.hint.starting";
  if (status.state === "running") {
    return isOwnCore(status) ? "network.core.hint.ownRunning" : "network.core.hint.externalRunning";
  }
  return "network.core.hint.idle";
}

export interface CoreReceipt {
  tone: CoreTone;
  textKey: string;
  detail: string | null;
}
/**
 * 回执该怎么说话——判据是**动作之后那份账**，不是「有没有抛错」。
 *
 * 失败时优先报 reason（那是一句能照着动手的话），没有 reason 才退到状态词。
 */
export function coreReceipt(action: CoreProcessAction, view: CoreView): CoreReceipt {
  const { status } = view;
  if (action === "stop") {
    return status.state === "stopped"
      ? { tone: "ok", textKey: "network.core.stopped", detail: null }
      : { tone: "error", textKey: "network.core.stopNotStopped", detail: status.detail };
  }
  if (status.state === "running") {
    // external 也是 running，但那不是我们起的：说「内核起来了」等于冒领别人的进程。
    if (!isOwnCore(status)) return { tone: "ok", textKey: "network.core.adopted", detail: null };
    return {
      tone: "ok",
      textKey: action === "restart" ? "network.core.restarted" : "network.core.started",
      detail: null,
    };
  }
  return {
    tone: "error",
    textKey: status.reason ? coreReasonKey(status.reason) : coreStateKey(status.state),
    detail: status.detail,
  };
}

/* ------------------------------------------------------------- T11 更新回执 */

/**
 * 四种下场的脸色。`latest` 与 `installed` 一样是 ok：「本来就是最新」是一次问得出结果的更新，
 * 不是失败；`busy` 是中性（见 {@link CoreTone}）；只有 `failed` 染红。
 */
export function coreUpdateTone(outcome: CoreUpdateOutcome): CoreTone {
  if (outcome === "failed") return "error";
  return outcome === "busy" ? "neutral" : "ok";
}

/**
 * 点过「更新内核」之后那句话。
 *
 * 读的是 `view.update` 而不是 `view.status`：换上文件与内核在不在跑是两件事，
 * 用后者当成功就是把「装上了」说成「用上了」。失败时 reason 排在下场之前——
 * 「发布页没给 sha256」比「没换成」更能让用户知道下一步该干什么。
 *
 * 回 null 只有一个形状：main 那侧连一次账都没落下（`update()` 每条出口都会 settle 一份，
 * 所以这是接线被绕过的信号）。这时候什么都不说，比编一句「更新完成」好。
 */
export function coreUpdateReceipt(update: CoreUpdateState | null): CoreReceipt | null {
  if (!update) return null;
  const textKey = update.outcome === "failed" && update.reason
    ? coreUpdateReasonKey(update.reason)
    : coreUpdateKey(update.outcome);
  return { tone: coreUpdateTone(update.outcome), textKey, detail: update.detail };
}

export interface CoreUpdateLine {
  tone: CoreTone;
  /** 那句下场（与回执同一把词表，页面两处不许各说一套）。 */
  outcomeKey: string;
  reasonKey: string | null;
  /** release 的 tag，如 `v1.19.33`；连发布页都没问到就是 null，这一行就不画版本号。 */
  tag: string | null;
  /**
   * 距今多久。`at` 比现在新（系统时钟回拨、或 main 与页面读的钟不同源）时给 null：
   * 「-40 分钟前」不是一句人话，宁可不写时间。
   */
  agoMs: number | null;
}

/**
 * 「上次更新」那一行——打开卡片时唯一能看见的历史。
 *
 * 回执条 5 秒就自己收掉了，而更新这件事的结果是要回头看第二眼的：
 * 装上了却没有生效（本机还装着 Verge），用户下次进这张卡得能认出「上次那次是装上了」。
 */
export function coreUpdateLine(update: CoreUpdateState | null, now: number): CoreUpdateLine | null {
  if (!update) return null;
  return {
    tone: coreUpdateTone(update.outcome),
    outcomeKey: coreUpdateKey(update.outcome),
    reasonKey: update.outcome === "failed" ? (update.reason ? coreUpdateReasonKey(update.reason) : null) : null,
    tag: update.tag,
    agoMs: now >= update.at ? now - update.at : null,
  };
}

/**
 * v1.26 内核宿主（Wave 3 T10b）：「内核」卡片的全部判定。
 *
 * 判定放在纯模块里，是因为这张卡最贵的错不是画歪，而是**说假话**：
 * - `starting` 画成运行中：用户在 8 秒窗口里看到「运行中」，其实控制器还没答话；
 * - external 态给一颗能点的「停止」：那点下去是替用户关掉他正在用的 Verge 内核；
 * - 起失败时回一个勾：`start()` 从来不抛错，失败只写在 `state`/`reason` 里，
 *   按「有没有抛」判成败会永远判成成功。
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
  type CoreView,
} from "../../../../shared/core-types";

/** 主进程 preload 暴露的内核接口（组件只用其中一部分）。 */
export type CoreApi = Window["verge"]["core"];

export type CoreAction = "start" | "stop" | "restart";

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
  /** 三颗都不该点时那句解释；null 表示没什么要辩解的。 */
  hintKey: string | null;
}

/**
 * 三颗按钮该不该按下去。
 *
 * - `start`：只在「手上这颗还没在跑」时给——running/starting 时再点一次什么也不发生，
 *   灰着比让用户以为「点了没反应」好。
 * - `stop` / `restart`：都要 `isOwnCore`，否则按下去杀的是 Verge 的进程。
 * - 在途时三颗全灰：`startCoalesced` 会合并在途的那次起，但 restart 不合并，
 *   连点两下会真的起停起一遍。
 */
export function coreActions(status: CoreStatus, busy: boolean): CoreActions {
  const live = status.state === "running" || status.state === "starting";
  const own = isOwnCore(status);
  return {
    start: !busy && !live,
    stop: !busy && live && own,
    restart: !busy && live && own,
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
  tone: "ok" | "error";
  textKey: string;
  detail: string | null;
}
/**
 * 回执该怎么说话——判据是**动作之后那份账**，不是「有没有抛错」。
 *
 * 失败时优先报 reason（那是一句能照着动手的话），没有 reason 才退到状态词。
 */
export function coreReceipt(action: CoreAction, view: CoreView): CoreReceipt {
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

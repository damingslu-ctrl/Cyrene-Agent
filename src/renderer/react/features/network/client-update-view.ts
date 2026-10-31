/**
 * v1.27 客户端更新（Wave 4 T12d）：「更新」卡片的全部判定。
 *
 * 判定放在纯模块里，是因为这张卡最贵的错不是画歪，而是**说假话**，而它有两种相反的方向：
 * - 把 `latest`（发布页那版不比我们新）染红：用户会去找一个根本不存在的毛病；
 *   把 `available` 说成「升级成功」更糟——一个字节都还没下。
 * - 反过来那一头更贵：**`launched` 不许写成「升级成功」**。安装器起来之后我们就退出了，
 *   「装好了」这件事在这班进程里永远无法知道；唯一的凭据是下次启动读到的版本号。
 *
 * 另有三条从状态机那条纪律抄下来的规矩，页面这一侧不许各算一遍：
 * - **三本账互不作废**。检查失败不许把已经核对好的包说成「没有」；所以「有没有得装」
 *   只看 `download.outcome === "ready"`，跟检查那本此刻写着什么无关。
 * - **`in-flight` 与 `core-running` 是中性色，不是红色**。前者是「你没等到」，后者是
 *   「按设计这次不换」——两种都别把用户支去一件不需要他做的事上。
 * - **闸门只在 main 那一侧**。三颗按钮只按「有没有一趟在走」灰，不在页面复算
 *   「有没有包」「内核在不在跑」：复算出来的灰是「灰着一棵没人知道为什么灰的按钮」，
 *   而真闸门拦下时回的那句 reason 才是能照着动手的话。
 */
import {
  CLIENT_CHECK_OUTCOMES,
  CLIENT_DOWNLOAD_OUTCOMES,
  CLIENT_INSTALL_OUTCOMES,
  CLIENT_UPDATE_PHASES,
  CLIENT_UPDATE_REASONS,
  type ClientCheckOutcome,
  type ClientCheckReceipt,
  type ClientDownloadOutcome,
  type ClientDownloadReceipt,
  type ClientInstallOutcome,
  type ClientInstallReceipt,
  type ClientUpdatePhase,
  type ClientUpdateReason,
  type ClientUpdateSave,
  type ClientUpdateView,
} from "../../../../shared/client-update-types";

/** 主进程 preload 暴露的更新接口（组件只用其中一部分）。 */
export type ClientUpdateApi = Window["verge"]["clientUpdate"];

/** 三颗动作按钮；读账（`state`）与改开关（`setAutoCheck`）不算动作，不在这张表里。 */
export type ClientAction = "check" | "download" | "install";

/** 三种脸色。`neutral` 给「按设计没做成」与「你没等到」那两档（见文件头）。 */
export type ClientTone = "ok" | "neutral" | "error";

/** 「再按一次」的确认窗：与桌宠「测速中退出」同一档口径，超时就自己退回原样，不留一颗待发的按钮。 */
export const CLIENT_CONFIRM_WINDOW_MS = 10_000;

/** 这一档 reason 拦下的不是故障，是设计。页面与 main 用同一把尺，两处各列一遍迟早漂开。 */
const NEUTRAL_REASONS: readonly ClientUpdateReason[] = ["in-flight", "core-running"];

export function clientPhaseKey(phase: ClientUpdatePhase): string {
  return `network.clientUpdate.phase.${phase}`;
}

export function clientCheckKey(outcome: ClientCheckOutcome): string {
  return `network.clientUpdate.check.${outcome}`;
}

export function clientDownloadKey(outcome: ClientDownloadOutcome): string {
  return `network.clientUpdate.download.${outcome}`;
}

export function clientInstallKey(outcome: ClientInstallOutcome): string {
  return `network.clientUpdate.install.${outcome}`;
}

export function clientReasonKey(reason: ClientUpdateReason): string {
  return `network.clientUpdate.reason.${reason}`;
}

/** 只有 idle 以外的三档算「有一趟在走」：败与成都会退回 idle，所以别把昨天那次失败读成还在跑。 */
export function clientBusy(phase: ClientUpdatePhase): boolean {
  return phase !== "idle";
}

export interface ClientActions {
  check: boolean;
  download: boolean;
  install: boolean;
  /** 武装中的那颗「安装」要说自己的话，不许顶着按钮名骗一次点击。 */
  installLabelKey: string;
}

/**
 * 三颗按钮该不该按下去。
 *
 * 三条一视同仁，而且**只看 `busy`**：`check` 的重复点击会并进那一趟、`download` 会先认盘上那颗、
 * `install` 的闸门（有没有包、内核在不在跑）在 main 那侧排在重算 sha256 之前——
 * 页面把它们各自的条件重算一遍，最坏的漂法是灰着一棵没人知道为什么灰的按钮。
 */
export function clientActions(busy: boolean, armed: boolean): ClientActions {
  return {
    check: !busy,
    download: !busy,
    install: !busy,
    installLabelKey: armed ? "network.clientUpdate.installConfirm" : "network.clientUpdate.install.button",
  };
}

/**
 * 卡片顶那句说明——「此刻这张卡在看什么」的七种形状，优先级写在这里而不是 JSX 里。
 *
 * 顺序有两处要紧：
 * - `phase` 排第一：在途时 `check` 里躺着的还是上一趟的账，读它会说成「已经发现了新版」，
 *   而那一趟此刻正在重写它。
 * - 「有包可装」排在检查之前：账本互不作废那条纪律，落到页面上就是这个次序。
 */
export function clientLeadKey(view: ClientUpdateView): string {
  if (view.phase !== "idle") return `network.clientUpdate.lead.${view.phase}`;
  if (view.install?.outcome === "launched") return "network.clientUpdate.lead.launched";
  if (view.download?.outcome === "ready") return "network.clientUpdate.lead.ready";
  if (view.check?.outcome === "available") return "network.clientUpdate.lead.available";
  if (view.check?.outcome === "latest") return "network.clientUpdate.lead.latest";
  if (view.check === null) return "network.clientUpdate.lead.never";
  return "network.clientUpdate.lead.checkFailed";
}

/** `at` 比现在新（时钟回拨、或 main 与页面不同源）时回 null：「-40 分钟前」不是一句人话。 */
function ago(at: number, now: number): number | null {
  return now >= at ? now - at : null;
}

export interface ClientLine {
  tone: ClientTone;
  outcomeKey: string;
  reasonKey: string | null;
  detail: string | null;
  /** 这一趟问到/用上的版本号；null 就不画版本。 */
  version: string | null;
  agoMs: number | null;
}

/**
 * 脸色：三本账共用这一把尺。
 *
 * `latest` 与 `ready` 与 `launched` 都是 ok（一次问得出结果的检查不是失败）；
 * `in-flight`／`core-running` 那两档走中性；只有其余的败才染红。
 */
export function clientTone(
  outcome: ClientCheckOutcome | ClientDownloadOutcome | ClientInstallOutcome,
  reason: ClientUpdateReason | null,
): ClientTone {
  if (outcome === "failed") return reason && NEUTRAL_REASONS.includes(reason) ? "neutral" : "error";
  return "ok";
}

/** 版本号取的是「这一趟认下的那一版」；`latest`/`failed` 时也可以有——读到了就该说得出。 */
export function clientCheckLine(check: ClientCheckReceipt | null, now: number): ClientLine | null {
  if (!check) return null;
  return {
    tone: clientTone(check.outcome, check.reason),
    outcomeKey: clientCheckKey(check.outcome),
    reasonKey: check.reason ? clientReasonKey(check.reason) : null,
    detail: check.detail,
    version: check.latestVersion,
    agoMs: ago(check.at, now),
  };
}

export interface ClientDownloadLine extends ClientLine {
  /** 相对 `updates/` 的文件名——可核对的东西，不是「一个包」。 */
  fileName: string | null;
  bytes: number | null;
}

/**
 * 下载那一行。
 *
 * `bytes` 只在 `ready` 时给：败的那趟记的是 0（半包当场删掉了），
 * 把它当成读数画出来就成了「已经下了 0 B」这种没人看得懂的话。
 */
export function clientDownloadLine(download: ClientDownloadReceipt | null, now: number): ClientDownloadLine | null {
  if (!download) return null;
  return {
    tone: clientTone(download.outcome, download.reason),
    outcomeKey: clientDownloadKey(download.outcome),
    reasonKey: download.reason ? clientReasonKey(download.reason) : null,
    detail: download.detail,
    version: download.version,
    agoMs: ago(download.at, now),
    fileName: download.fileName,
    bytes: download.outcome === "ready" ? download.bytes : null,
  };
}

export function clientInstallLine(install: ClientInstallReceipt | null, now: number): ClientLine | null {
  if (!install) return null;
  return {
    tone: clientTone(install.outcome, install.reason),
    outcomeKey: clientInstallKey(install.outcome),
    reasonKey: install.reason ? clientReasonKey(install.reason) : null,
    detail: install.detail,
    version: install.version,
    agoMs: ago(install.at, now),
  };
}

/**
 * 有没有一条「最新可装」的版本差要端出来。
 *
 * 两个条件都要：检查认下了那一版（`available`），而且它跟本机不是同一个号。
 * 把 `latest` 那一趟也画进「可装 v1.16.0」就是把「本来就是这版」说成还有一件事没做完。
 */
export function clientTargetVersion(view: ClientUpdateView): string | null {
  if (view.check?.outcome !== "available") return null;
  const latest = view.check.latestVersion;
  return latest && latest !== view.currentVersion ? latest : null;
}

/**
 * 开关那次落盘的下场——三态，不许把 null 演成成功。
 *
 * `null` 是「这四条通道谁也没写过盘」，那时候一句「已保存」都是编的；
 * `ok:false` 是**内存里已经改了、盘上没住**：话必须同时说这两件，
 * 只说其一都会让用户做错事（以为存住了，或以为根本没改成）。
 */
export function clientSaveLine(saved: ClientUpdateSave | null): { tone: ClientTone; textKey: string } | null {
  if (!saved) return null;
  return saved.ok
    ? { tone: "ok", textKey: "network.clientUpdate.save.ok" }
    : { tone: "error", textKey: "network.clientUpdate.save.failed" };
}

/**
 * 那条 catch 该说哪句。
 *
 * 只有 `install` 特殊：它抛错/没回音**不等于没装**——安装器起来之后这个 App 正在退出，
 * 回执发不出去是唯一一档「我们无从知道」的形状。所以那句说的是「可能已经起来了，
 * App 还在就再点一次」，而不是「失败了」。其余两条没有这种歧义。
 */
export function clientActionFailureKey(action: ClientAction): string {
  return action === "install" ? "network.clientUpdate.installNoReply" : "network.clientUpdate.ipcFailed";
}

/** 确认窗口的存活判定：`armedAt` 为 null 是没武装；过了那一窗就自己退回，不留一颗待发的按钮。 */
export function clientConfirmAlive(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now - armedAt >= 0 && now - armedAt <= CLIENT_CONFIRM_WINDOW_MS;
}

/* ---------------------------------------------------------------- 词表自检用 */

export const CLIENT_PHASE_KEYS = CLIENT_UPDATE_PHASES.map(clientPhaseKey);
export const CLIENT_CHECK_KEYS = CLIENT_CHECK_OUTCOMES.map(clientCheckKey);
export const CLIENT_DOWNLOAD_KEYS = CLIENT_DOWNLOAD_OUTCOMES.map(clientDownloadKey);
export const CLIENT_INSTALL_KEYS = CLIENT_INSTALL_OUTCOMES.map(clientInstallKey);
export const CLIENT_REASON_KEYS = CLIENT_UPDATE_REASONS.map(clientReasonKey);

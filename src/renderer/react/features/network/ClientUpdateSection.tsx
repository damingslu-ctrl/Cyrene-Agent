import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, RotateCcw, Search, Upload } from "lucide-react";
import type { ClientUpdateSave, ClientUpdateView } from "../../../../shared/client-update-types";
import { useTranslation } from "../../i18n";
import { NoticeBar, useNotice, type Notice } from "./network-detail-common";
import { formatBytes } from "./network-view";
import { formatDuration } from "./network-tabs";
import {
  clientActionFailureKey,
  clientActions,
  clientBusy,
  clientCheckLine,
  clientConfirmAlive,
  clientDownloadLine,
  clientInstallLine,
  clientLeadKey,
  clientPhaseKey,
  clientSaveLine,
  clientTargetVersion,
  type ClientAction,
  type ClientLine,
  type ClientUpdateApi,
} from "./client-update-view";

/** 账是活的：排程那条链会在页面看不见的时候改检查那本账，只读一次会一直停在点按钮那一瞬间。 */
const POLL_MS = 10_000;

const ACTIONS: readonly ClientAction[] = ["check", "download", "install"];

const LABEL_KEY: Record<ClientAction, string> = {
  check: "network.clientUpdate.check.button",
  download: "network.clientUpdate.download.button",
  // 这一颗的字由 `clientActions()` 给：武装中要说「再按一次」，不能顶着按钮名骗一次点击。
  install: "network.clientUpdate.install.button",
};

const ICON: Record<ClientAction, typeof Search> = {
  check: Search,
  download: Download,
  install: Upload,
};

/**
 * 一次动作之后那句回执。
 *
 * 三条不许演：
 * - **在途时不拿旧账冒充这一次**：`in-flight` 那档按设计不写账，读到的还是上一趟那本。
 * - **检查/下载「没走过去」不能报成 ok**：`update-service` 的 `check()`/`download()` 从不抛错，
 *   失败只写在账里——按「有没有抛」判成败会永远判成成功。所以这里读的是那一本对应的账，
 *   而三本账互不作废那条纪律落到页面上就是各读各的，不因为安装败了就把检查那行抹掉。
 * - **开关那次落盘的下场不住在这里**：它走 `saveState` 那一槽，理由写在 `setAutoCheck` 上头。
 */
function actionReceipt(
  view: ClientUpdateView,
  action: ClientAction,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): Notice {
  // 这一次被并到了别段那一趟上：`in-flight` 按设计**不写账**，所以手上这本还是上一趟的。
  // 拿它当「刚才那一下的下场」就是把昨天的账冒充成今天的——先说清楚这一趟没开新连接。
  if (clientBusy(view.phase)) {
    return { tone: "neutral", text: t("network.clientUpdate.receipt.inFlight", { phase: t(clientPhaseKey(view.phase)) }) };
  }
  const line = action === "check"
    ? clientCheckLine(view.check, now)
    : action === "download"
      ? clientDownloadLine(view.download, now)
      : clientInstallLine(view.install, now);
  // 账上连一笔都没有：那只能是 main 那侧绕过了「每段必落一笔」的规矩，这时候不编一句话填上。
  if (!line) return { tone: "neutral", text: t("network.clientUpdate.hint.noBook") };
  if (line.reasonKey) {
    return {
      tone: line.tone,
      text: line.detail
        ? `${t(line.outcomeKey)} · ${t(line.reasonKey)} · ${t("network.clientUpdate.saidDetail", { detail: line.detail })}`
        : `${t(line.outcomeKey)} · ${t(line.reasonKey)}`,
    };
  }
  return { tone: line.tone, text: `${t(line.outcomeKey)}${line.version ? ` · v${line.version}` : ""}` };
}

/** 三本账各画一行；行内容（脸色 / 版本 / 距今）全在纯模块里判好了，这里只负责排。 */
function LineItem({ labelKey, line }: { labelKey: string; line: ClientLine | null }) {
  const { t } = useTranslation();
  if (!line) return null;
  return (
    <li>
      {t(labelKey)}：
      <span className={`net-client-line net-client-line--${line.tone}`}>
        {t(line.outcomeKey)}
        {line.reasonKey ? ` · ${t(line.reasonKey)}` : ""}
        {line.version && ` · v${line.version}`}
        {line.agoMs !== null && ` · ${t("network.clientUpdate.ago", { dur: formatDuration(line.agoMs) })}`}
        {line.detail && ` · ${t("network.clientUpdate.saidDetail", { detail: line.detail })}`}
      </span>
    </li>
  );
}

/**
 * Wave 4 T12d：客户端更新卡片。
 *
 * 这张卡讲的事跟内核那张一样是两本账，但更窄也更重：**装的是这台机器上的 App 本身**。
 * 所以判定全在 `client-update-view.ts`，这里只画；组件层只留三条形而上的纪律：
 * - 一次点击之后画的是通道回来的那份**整账**，不是点之前手上的旧账——排程那条链随时会往里写。
 * - 「安装」两步：第一下只武装，第二下才发。这一颗按下去的结果是退出并被替换，没有反悔通路。
 * - `install` 那一下没有回音时不报失败也不报成功：那句话由 `clientActionFailureKey` 判，
 *   因为「安装器起来了、我们正在退出」与「什么都没发生」在界面上长得一模一样。
 */
export function ClientUpdateSection({ api }: { api?: ClientUpdateApi }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ClientUpdateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [pending, setPending] = useState<ClientAction | null>(null);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<ClientUpdateSave | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useNotice();
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  /** 静默重读不动 loading：定时轮询每 10 秒闪一次「加载中」比停在旧账上难看得多。 */
  const pull = useCallback(async (silent: boolean) => {
    if (!api) {
      setUnreachable(true);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const next = await api.state();
      if (!aliveRef.current) return;
      setView(next);
      setUnreachable(false);
    } catch {
      if (aliveRef.current) setUnreachable(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void pull(false);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void pull(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pull]);

  const run = async (action: ClientAction) => {
    if (!api || pending) return;
    setPending(action);
    setNotice(null);
    try {
      const next = await api[action]();
      if (!aliveRef.current) return;
      setView(next);
      // 回执读的是动作之后那份整账里**对应那一本**：安装那本败了不许顺手把检查那行抹掉。
      setNotice(actionReceipt(next, action, Date.now(), t));
    } catch {
      if (aliveRef.current) setNotice({ tone: "error", text: t(clientActionFailureKey(action)) });
    } finally {
      if (aliveRef.current) setPending(null);
    }
  };

  const clickInstall = () => {
    const at = Date.now();
    // 窗口是按点击那一刻判的，不按页面上那颗 `now`：定时器最坏会迟到一格，方向必须错向「再多按一次」。
    if (!clientConfirmAlive(armedAt, at)) {
      setArmedAt(at);
      setNotice({ tone: "neutral", text: t("network.clientUpdate.confirmHint") });
      return;
    }
    setArmedAt(null);
    void run("install");
  };

  const setAutoCheck = async (on: boolean) => {
    if (!api) return;
    setNotice(null);
    try {
      const next = await api.setAutoCheck(on);
      if (!aliveRef.current) return;
      setView(next);
      // 落盘的下场住在**本地这一槽**，不住在 `view.saved` 里：10 秒一轮的 `state()` 永远带
      // `saved: null`，画在派生行上会自己把「盘上没住」洗成什么都没说过。
      setSaveState(next.saved);
    } catch {
      if (aliveRef.current) setNotice({ tone: "error", text: t("network.clientUpdate.ipcFailed") });
    }
  };

  const busy = view !== null && clientBusy(view.phase);
  const armed = clientConfirmAlive(armedAt, now);
  const actions = clientActions(busy || pending !== null, armed);
  const target = view ? clientTargetVersion(view) : null;
  const saveLine = clientSaveLine(saveState);
  const downloadLine = view ? clientDownloadLine(view.download, now) : null;

  // 卡片不挂 `net-verge`：那个标记的意思一直是「这张卡读写 Verge 的东西」，而这张换的是本机 App。
  return (
    <section className="net-card net-section net-client" aria-label={t("network.clientUpdate.title")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <RefreshCw size={15} />
          {t("network.clientUpdate.title")}
        </span>
        {/* 亮起来的意思是「这一班真的有一趟在走」，不是「有新版」。 */}
        <span className={`net-status ${busy ? "is-online" : ""}`.trim()}>
          <span className="net-status__dot" aria-hidden="true" />
          {view ? t(clientPhaseKey(view.phase)) : t("network.clientUpdate.phase.unread")}
        </span>
      </div>

      <NoticeBar notice={notice} />

      {loading && view === null && <p className="net-hint">{t("network.detailLoading")}</p>}
      {unreachable && <p className="net-hint">{t("network.clientUpdate.ipcFailed")}</p>}

      {view && (
        <>
          <p className="net-hint">{t(clientLeadKey(view))}</p>

          <ul className="net-verge__facts">
            <li>
              {t("network.clientUpdate.currentLabel")}：v{view.currentVersion}
              {target && ` · ${t("network.clientUpdate.targetLabel", { version: target })}`}
            </li>
            {downloadLine && downloadLine.bytes !== null && (
              <li>
                {t("network.clientUpdate.packageLabel")}：<code>{downloadLine.fileName}</code> · {formatBytes(downloadLine.bytes)}
              </li>
            )}
            <LineItem labelKey="network.clientUpdate.check.label" line={clientCheckLine(view.check, now)} />
            <LineItem labelKey="network.clientUpdate.download.label" line={downloadLine} />
            <LineItem labelKey="network.clientUpdate.install.label" line={clientInstallLine(view.install, now)} />
          </ul>

          <label className="net-field net-field--row">
            <input
              type="checkbox"
              name="client_update_auto_check"
              checked={view.autoCheck}
              disabled={unreachable}
              onChange={(event) => void setAutoCheck(event.target.checked)}
            />
            <span className="net-field__label">{t("network.clientUpdate.autoCheck")}</span>
          </label>
          <p className="net-hint">{t("network.clientUpdate.autoCheckHint")}</p>
          {saveLine && (
            <div className={`net-notice net-notice--${saveLine.tone}`} role="status">
              {t(saveLine.textKey)}
              {saveState?.detail ? ` · ${t("network.clientUpdate.saidDetail", { detail: saveState.detail })}` : ""}
            </div>
          )}
        </>
      )}

      <div className="net-view__tools">
        {ACTIONS.map((action) => {
          const Icon = ICON[action];
          return (
            <button
              key={action}
              type="button"
              name={`client_update_${action}`}
              className={action === "install" ? "net-primary-button" : "net-ghost-button"}
              disabled={!actions[action] || unreachable}
              onClick={() => (action === "install" ? clickInstall() : void run(action))}
            >
              {action === "install" && armed ? <RotateCcw size={13} /> : <Icon size={13} />}
              {pending === action
                ? t("network.clientUpdate.working")
                : action === "install"
                  ? t(actions.installLabelKey)
                  : t(LABEL_KEY[action])}
            </button>
          );
        })}
        <button
          type="button"
          name="client_update_refresh"
          className="net-ghost-button"
          disabled={pending !== null || unreachable}
          onClick={() => void pull(false)}
        >
          <RefreshCw size={13} />
          {t("network.refresh")}
        </button>
      </div>
    </section>
  );
}

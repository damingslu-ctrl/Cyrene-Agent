import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Download, Play, RefreshCw, RotateCw, Square } from "lucide-react";
import { EMPTY_CORE_STATUS, type CoreView } from "../../../../shared/core-types";
import { useTranslation } from "../../i18n";
import { NoticeBar, useNotice } from "./network-detail-common";
import {
  coreActions,
  coreAttention,
  coreHealReadout,
  coreLeadKey,
  coreModeKey,
  coreOnline,
  corePortReadout,
  coreReasonKey,
  coreReceipt,
  coreSecretKey,
  coreStateKey,
  coreUptimeMs,
  coreUpdateLine,
  coreUpdateReceipt,
  type CoreAction,
  type CoreApi,
} from "./core-view";
import { formatDuration } from "./network-tabs";

/** 账是活的：崩溃与自愈发生在页面看不见的时候，只读一次会一直停在点按钮那一瞬间的账上。 */
const POLL_MS = 10_000;

const ACTIONS: readonly CoreAction[] = ["start", "stop", "restart", "update"];

const LABEL_KEY: Record<CoreAction, string> = {
  start: "network.core.start",
  stop: "network.core.stop",
  restart: "network.core.restart",
  update: "network.core.update.button",
};

const ICON: Record<CoreAction, typeof Play> = {
  start: Play,
  stop: Square,
  restart: RotateCw,
  update: Download,
};

/**
 * Wave 3 T10b/T11：内核宿主卡片。
 *
 * 这张卡讲两件事——**此刻这台机器上吃配置的进程是哪一颗**，以及**那颗文件是哪一版**，所以：
 * - 徽标只在 `running` 时亮绿；`starting` 与 `blocked` 走中性色（那 8 秒里控制器还没答话）。
 * - 会 kill 进程的两颗按钮只对我们自己起的那颗开放；借用 Verge 的控制器时整排灰掉并说明原因。
 * - 每次动作之后画的是回执里那份账，不是点击之前手上的旧账。
 * - 「更新内核」读的是另一本账（`view.update`）：换上文件不等于生效，
 *   所以它的回执永远不从 `status.state` 里借一个绿点。
 */
export function CoreSection({ api }: { api?: CoreApi }) {
  const { t } = useTranslation();
  const [view, setView] = useState<CoreView | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState<CoreAction | null>(null);
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
      const next = await api.status();
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

  const run = async (action: CoreAction) => {
    if (!api || busy) return;
    setBusy(action);
    setNotice(null);
    try {
      const next = await api[action]();
      if (!aliveRef.current) return;
      setView(next);
      // 更新读的是另一本账：`status.state` 那一颗绿点跟「文件换没换上」没有关系。
      const receipt = action === "update" ? coreUpdateReceipt(next.update) : coreReceipt(action, next);
      // 回执里连一次的账都没落下＝main 那侧被绕过；这时候不编一句话填上，让按钮自己安静回来。
      if (!receipt) return;
      setNotice({
        tone: receipt.tone,
        text: receipt.detail
          ? `${t(receipt.textKey)} · ${t("network.core.saidDetail", { detail: receipt.detail })}`
          : t(receipt.textKey),
      });
    } catch {
      if (aliveRef.current) setNotice({ tone: "error", text: t("network.core.ipcFailed") });
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  const status = view?.status ?? null;
  const actions = coreActions(status ?? EMPTY_CORE_STATUS, busy !== null);
  const online = status !== null && coreOnline(status.state);
  const heal = status ? coreHealReadout(status) : null;
  const ports = status ? corePortReadout(status) : null;
  const uptimeMs = status ? coreUptimeMs(status, now) : null;
  // 那句红字只在「账上有原因、而且没在跑」时端出来；判据只写在 coreAttention 一处。
  const attentionReason = status !== null && coreAttention(status) ? status.reason : null;
  // 「上次更新」那一行的脸色、词与时间差全在 core-view 里判好了，这里只负责排。
  const updateLine = view ? coreUpdateLine(view.update, now) : null;

  return (
    <section className="net-card net-section net-verge" aria-label={t("network.core.title")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <Cpu size={15} />
          {t("network.core.title")}
        </span>
        <span className={`net-status ${online ? "is-online" : ""}`.trim()}>
          <span className="net-status__dot" aria-hidden="true" />
          {status ? t(coreStateKey(status.state)) : t("network.core.state.unknown")}
        </span>
      </div>

      <NoticeBar notice={notice} />

      {loading && view === null && <p className="net-hint">{t("network.detailLoading")}</p>}
      {unreachable && <p className="net-hint">{t("network.core.ipcFailed")}</p>}

      {view && status && (
        <>
          <p className="net-hint">{t(coreLeadKey(status))}</p>

          {attentionReason && (
            <div className="net-notice net-notice--error" role="status">
              {t(coreReasonKey(attentionReason))}
              {status.detail ? ` · ${t("network.core.saidDetail", { detail: status.detail })}` : ""}
            </div>
          )}

          <ul className="net-verge__facts">
            <li>{t("network.core.modeLabel")}：{t(coreModeKey(status.mode))}</li>
            <li>{t("network.core.secretLabel")}：{t(coreSecretKey(view.secretSource))}</li>
            {status.controller && <li>{t("network.core.controllerLabel")}：<code>{status.controller}</code></li>}
            {ports && <li>{t("network.core.portsLabel")}：{ports}</li>}
            {status.pid !== null && <li>{t("network.core.pidLabel")}：{status.pid}</li>}
            {uptimeMs !== null && <li>{t("network.core.uptimeLabel")}：{formatDuration(uptimeMs)}</li>}
            {heal && <li>{t("network.core.healLabel")}：{heal}</li>}
            {updateLine && (
              <li>
                {t("network.core.update.lastLabel")}：
                <span className={`net-core-update net-core-update--${updateLine.tone}`}>
                  {t(updateLine.outcomeKey)}
                  {updateLine.reasonKey ? ` · ${t(updateLine.reasonKey)}` : ""}
                </span>
                {updateLine.tag && ` · ${updateLine.tag}`}
                {updateLine.agoMs !== null && ` · ${t("network.core.update.ago", { dur: formatDuration(updateLine.agoMs) })}`}
              </li>
            )}
          </ul>
        </>
      )}

      {/* 没试过更新时教一句「这一颗按下去会干什么」；有过账就让上面那一行说话，不必再念一遍。 */}
      {view && view.update === null && <p className="net-hint">{t("network.core.update.firstHint")}</p>}

      <div className="net-view__tools">
        {ACTIONS.map((action) => {
          const Icon = ICON[action];
          return (
            <button
              key={action}
              type="button"
              name={`core_${action}`}
              className={action === "start" ? "net-primary-button" : "net-ghost-button"}
              disabled={!actions[action] || unreachable}
              onClick={() => void run(action)}
            >
              <Icon size={13} />
              {busy === action ? t("network.core.working") : t(LABEL_KEY[action])}
            </button>
          );
        })}
        <button
          type="button"
          name="core_refresh"
          className="net-ghost-button"
          disabled={busy !== null || unreachable}
          onClick={() => void pull(false)}
        >
          <RefreshCw size={13} />
          {t("network.refresh")}
        </button>
      </div>

      {actions.hintKey && <p className="net-hint">{t(actions.hintKey)}</p>}
    </section>
  );
}

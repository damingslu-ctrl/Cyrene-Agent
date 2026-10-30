import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Play, RefreshCw, RotateCw, Square } from "lucide-react";
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
  type CoreAction,
  type CoreApi,
} from "./core-view";
import { formatDuration } from "./network-tabs";

/** 账是活的：崩溃与自愈发生在页面看不见的时候，只读一次会一直停在点按钮那一瞬间的账上。 */
const POLL_MS = 10_000;

const ACTIONS: readonly CoreAction[] = ["start", "stop", "restart"];

const LABEL_KEY: Record<CoreAction, string> = {
  start: "network.core.start",
  stop: "network.core.stop",
  restart: "network.core.restart",
};

/**
 * Wave 3 T10b：内核宿主卡片。
 *
 * 这张卡只讲一件事——**此刻这台机器上吃配置的进程是哪一颗**，所以：
 * - 徽标只在 `running` 时亮绿；`starting` 与 `blocked` 走中性色（那 8 秒里控制器还没答话）。
 * - 会 kill 进程的两颗按钮只对我们自己起的那颗开放；借用 Verge 的控制器时整排灰掉并说明原因。
 * - 每次动作之后画的是回执里那份账，不是点击之前手上的旧账。
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
      const receipt = coreReceipt(action, next);
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
          </ul>
        </>
      )}

      <div className="net-view__tools">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            name={`core_${action}`}
            className={action === "start" ? "net-primary-button" : "net-ghost-button"}
            disabled={!actions[action] || unreachable}
            onClick={() => void run(action)}
          >
            {action === "start"
              ? <Play size={13} />
              : action === "stop"
                ? <Square size={13} />
                : <RotateCw size={13} />}
            {busy === action ? t("network.core.working") : t(LABEL_KEY[action])}
          </button>
        ))}
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

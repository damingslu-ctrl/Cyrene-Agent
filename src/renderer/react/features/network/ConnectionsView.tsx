import { useState } from "react";
import { RefreshCw, X, XCircle } from "lucide-react";
import type { ConnectionDetail } from "../../../../shared/network-detail-types";
import { useTranslation } from "../../i18n";
import { DetailError, DetailLoading, NoticeBar, useDetail, useNotice } from "./network-detail-common";
import {
  CONNECTION_LIMIT,
  formatDuration,
  processName,
  type NetworkApi,
} from "./network-tabs";
import { formatBytes } from "./network-view";

/** 连接：明细列表 + 关一条 / 关全部（二次确认）。 */
export function ConnectionsView({ api }: { api?: NetworkApi }) {
  const { t } = useTranslation();
  const detail = useDetail(api, (client) => client.connections());
  const [pending, setPending] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useNotice();
  const all = detail.data ?? [];
  const rows = all.slice(0, CONNECTION_LIMIT);
  const now = Date.now();

  const closeOne = async (row: ConnectionDetail) => {
    if (!api || pending) return;
    setPending(row.id);
    try {
      const result = await api.closeConnection(row.id);
      if (result.ok) {
        setNotice({ tone: "ok", text: t("network.connectionsClosedOne") });
        await detail.reload();
      } else {
        setNotice({ tone: "error", text: t("network.connectionsCloseFailed", { reason: t(`network.reason.${result.reason}`) }) });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.connectionsCloseFailed", { reason: t("network.reason.unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const closeAll = async () => {
    if (!api || pending) return;
    setPending("all");
    try {
      const result = await api.closeAllConnections();
      if (result.ok) {
        setConfirmAll(false);
        setNotice({ tone: "ok", text: t("network.connectionsClosedAll") });
        await detail.reload();
      } else {
        setNotice({ tone: "error", text: t("network.connectionsCloseFailed", { reason: t(`network.reason.${result.reason}`) }) });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.connectionsCloseFailed", { reason: t("network.reason.unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="net-card net-section net-conns" aria-label={t("network.tabConnections")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <RefreshCw size={15} />{t("network.tabConnections")}
          <span className="net-card__count">{t("network.connectionsTotal", { n: all.length })}</span>
        </span>
        <div className="net-view__tools">
          {confirmAll ? (
            <div className="net-confirm" role="alertdialog" aria-label={t("network.connectionsCloseAllAsk", { n: rows.length })}>
              <span>{t("network.connectionsCloseAllAsk", { n: rows.length })}</span>
              <button
                type="button"
                className="net-danger-button"
                disabled={pending !== null}
                onClick={() => void closeAll()}
              >
                {t("network.connectionsConfirm")}
              </button>
              <button
                type="button"
                className="net-ghost-button"
                onClick={() => setConfirmAll(false)}
              >
                {t("network.connectionsCancel")}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="net-ghost-button"
                disabled={pending !== null || rows.length === 0}
                onClick={() => setConfirmAll(true)}
              >
                <XCircle size={13} />{t("network.connectionsCloseAll")}
              </button>
              <button
                type="button"
                className="net-icon-button"
                title={t("network.refresh")}
                aria-label={t("network.refresh")}
                disabled={detail.loading}
                onClick={() => void detail.reload()}
              >
                <RefreshCw size={14} className={detail.loading ? "is-spinning" : ""} />
              </button>
            </>
          )}
        </div>
      </div>

      <NoticeBar notice={notice} />
      {detail.loading && detail.data === null && <DetailLoading />}
      {detail.error && detail.data === null && <DetailError reason={detail.error} onRetry={() => void detail.reload()} />}
      {detail.error && detail.data !== null && (
        <div className="net-notice net-notice--error" role="status">
          {t("network.detailError", { reason: t(`network.reason.${detail.error}`) })}
        </div>
      )}
      {detail.data !== null && rows.length === 0 && <p className="net-empty">{t("network.connectionsEmpty")}</p>}
      {rows.length > 0 && (
        <>
          {all.length > CONNECTION_LIMIT && (
            <p className="net-hint">{t("network.connectionsTruncated", { n: CONNECTION_LIMIT })}</p>
          )}
          <ul className="net-conn-list">
            {rows.map((row) => (
              <li key={row.id} className="net-conn">
                <span className="net-conn__main">
                  <span className="net-conn__host" title={row.destination || row.host}>
                    {row.host || row.destination || "—"}
                  </span>
                  <span className="net-conn__meta">
                    <span>{row.network || "—"}</span>
                    <span>{processName(row.process) || t("network.connectionsUnknownProcess")}</span>
                    <span>{row.chains[0] || "—"}</span>
                    <span>{formatDuration(now - row.startedAt)}</span>
                  </span>
                </span>
                <span className="net-conn__traffic">
                  <span>↑ {formatBytes(row.upload)}</span>
                  <span>↓ {formatBytes(row.download)}</span>
                </span>
                <button
                  type="button"
                  className="net-icon-button net-icon-button--small net-conn__close"
                  title={t("network.connectionsClose")}
                  aria-label={t("network.connectionsClose")}
                  disabled={pending !== null}
                  onClick={() => void closeOne(row)}
                >
                  {pending === row.id ? <span className="net-spinner net-spinner--small" /> : <X size={13} />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

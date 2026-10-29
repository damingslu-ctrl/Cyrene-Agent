import { useState } from "react";
import { Gauge, RefreshCw, Server } from "lucide-react";
import type { ProviderInfo } from "../../../../shared/network-detail-types";
import { useTranslation } from "../../i18n";
import { DetailError, DetailLoading, NoticeBar, useDetail, useNotice } from "./network-detail-common";
import type { NetworkApi } from "./network-tabs";

/** 入站：内核加载的 providers（订阅载体 / 本地文件），可单个测速。 */
export function ProvidersView({ api }: { api?: NetworkApi }) {
  const { t } = useTranslation();
  const detail = useDetail(api, (client, force) => client.providers(force));
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const providers = detail.data ?? [];

  const check = async (provider: ProviderInfo) => {
    if (!api || pending) return;
    setPending(provider.name);
    try {
      const result = await api.providerCheck(provider.name);
      if (result.ok) {
        detail.apply(result.data);
        setNotice({ tone: "ok", text: t("network.providersChecked", { name: provider.name }) });
      } else {
        setNotice({ tone: "error", text: t("network.providersFailed", { reason: t(`network.reason.${result.reason}`) }) });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.providersFailed", { reason: t("network.reason.unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="net-card net-section net-providers" aria-label={t("network.tabProviders")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <Server size={15} />{t("network.tabProviders")}
          <span className="net-card__count">{t("network.providersCount", { n: providers.length })}</span>
        </span>
        <div className="net-view__tools">
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
      {detail.data !== null && providers.length === 0 && <p className="net-empty">{t("network.providersEmpty")}</p>}
      {providers.length > 0 && (
        <ul className="net-provider-list">
          {providers.map((provider) => (
            <li key={provider.name} className="net-provider">
              <span className="net-provider__main">
                <span className="net-provider__name">{provider.name}</span>
                <span className="net-provider__meta">
                  <span>{provider.vehicle || "—"}</span>
                  <span>{provider.updatedAt === null
                    ? t("network.providersNeverUpdated")
                    : t("network.providersUpdated", { time: new Date(provider.updatedAt).toLocaleString() })}</span>
                </span>
              </span>
              <span className={`net-provider__count ${provider.aliveCount === 0 ? "is-empty" : ""}`}>
                {t("network.providersNodes", { alive: provider.aliveCount, total: provider.nodeCount })}
              </span>
              <button
                type="button"
                className="net-ghost-button net-provider__check"
                disabled={pending !== null || provider.nodeCount === 0}
                onClick={() => void check(provider)}
              >
                {pending === provider.name
                  ? <><span className="net-spinner net-spinner--small" />{t("network.providersChecking")}</>
                  : <><Gauge size={13} />{t("network.providersCheck")}</>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

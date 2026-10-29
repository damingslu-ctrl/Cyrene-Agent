import { useState } from "react";
import { ListFilter, RefreshCw } from "lucide-react";
import { useTranslation } from "../../i18n";
import { DetailError, DetailLoading, useDebouncedValue, useDetail } from "./network-detail-common";
import { filterRules, type NetworkApi } from "./network-tabs";

const RULE_SEARCH_DEBOUNCE_MS = 200;

/** 规则：内核的整张规则表，搜索防抖 200ms。 */
export function RulesView({ api }: { api?: NetworkApi }) {
  const { t } = useTranslation();
  const detail = useDetail(api, (client, force) => client.rules(force));
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, RULE_SEARCH_DEBOUNCE_MS);
  const rules = detail.data ?? [];
  const shown = filterRules(rules, debounced);

  return (
    <section className="net-card net-section net-rules" aria-label={t("network.tabRules")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <ListFilter size={15} />{t("network.tabRules")}
          <span className="net-card__count">{t("network.rulesTotal", { n: rules.length })}</span>
          {debounced.trim() !== "" && (
            <span className="net-card__count">{t("network.rulesShown", { n: shown.length })}</span>
          )}
        </span>
        <div className="net-view__tools">
          <input
            className="net-search"
            type="search"
            value={query}
            placeholder={t("network.rulesSearchPlaceholder")}
            aria-label={t("network.rulesSearchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
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

      {detail.loading && detail.data === null && <DetailLoading />}
      {detail.error && detail.data === null && <DetailError reason={detail.error} onRetry={() => void detail.reload()} />}
      {detail.error && detail.data !== null && (
        <div className="net-notice net-notice--error" role="status">
          {t("network.detailError", { reason: t(`network.reason.${detail.error}`) })}
        </div>
      )}
      {detail.data !== null && shown.length === 0 && (
        <p className="net-empty">{rules.length === 0 ? t("network.rulesEmpty") : t("network.rulesNoMatch")}</p>
      )}
      {shown.length > 0 && (
        <ul className="net-rule-list">
          {shown.map((rule, index) => (
            <li key={`${rule.type}-${rule.payload}-${index}`} className="net-rule">
              <span className="net-rule__type">{rule.type}</span>
              <span className="net-rule__payload" title={rule.payload}>{rule.payload || "—"}</span>
              <span className="net-rule__proxy">{rule.proxy || "—"}</span>
              <span className="net-rule__size">{rule.size >= 0 ? rule.size : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

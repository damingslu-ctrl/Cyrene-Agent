import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  LOG_LEVELS,
  type CoreConfigView,
  type LogLevel,
} from "../../../../shared/network-detail-types";
import { useTranslation } from "../../i18n";
import { DetailError, DetailLoading, NoticeBar, useDetail, useNotice } from "./network-detail-common";
import {
  configSteps,
  draftFromView,
  invalidPorts,
  viewMatchesPatch,
  type ConfigDraft,
  type NetworkApi,
  type PortDraftKey,
} from "./network-tabs";

const TUN_STACKS = ["system", "gvisor", "mixed"] as const;

const PORT_FIELDS: Array<{ key: PortDraftKey; name: string; label: string }> = [
  { key: "mixedPort", name: "mixed-port", label: "network.settingsMixedPort" },
  { key: "port", name: "port", label: "network.settingsHttpPort" },
  { key: "socksPort", name: "socks-port", label: "network.settingsSocksPort" },
];

/** 设置：只画白名单里的键；保存逐个写、写后读回比对。 */
export function SettingsView({ api }: { api?: NetworkApi }) {
  const { t } = useTranslation();
  const detail = useDetail(api, (client) => client.getConfig());
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useNotice();

  useEffect(() => {
    if (detail.data) setDraft(draftFromView(detail.data));
  }, [detail.data]);

  const view: CoreConfigView | null = detail.data;
  const steps = view && draft ? configSteps(view, draft) : [];
  const bad = draft ? invalidPorts(draft) : [];

  const update = (patch: Partial<ConfigDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const save = async () => {
    if (!api || !view || !draft || saving || steps.length === 0 || bad.length > 0) return;
    setSaving(true);
    try {
      let latest = view;
      for (const step of steps) {
        const result = await api.setConfig(step);
        if (!result.ok) {
          setNotice({ tone: "error", text: t("network.settingsSaveFailed", { reason: t(`network.reason.${result.reason}`) }) });
          return;
        }
        if (!viewMatchesPatch(result.data, step)) {
          setNotice({ tone: "error", text: t("network.settingsMismatch", { keys: Object.keys(step).join(", ") }) });
          return;
        }
        latest = result.data;
      }
      detail.apply(latest);
      setDraft(draftFromView(latest));
      setNotice({ tone: "ok", text: t("network.settingsSaved", { n: steps.length }) });
    } catch {
      setNotice({ tone: "error", text: t("network.settingsSaveFailed", { reason: t("network.reason.unreachable") }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="net-card net-section net-settings" aria-label={t("network.tabSettings")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label"><Save size={15} />{t("network.settingsTitle")}</span>
        <div className="net-view__tools">
          <button
            type="button"
            className="net-primary-button"
            disabled={saving || steps.length === 0 || bad.length > 0}
            onClick={() => void save()}
          >
            <Save size={13} />{saving ? t("network.settingsSaving") : t("network.settingsSave")}
          </button>
        </div>
      </div>

      <NoticeBar notice={notice} />
      {detail.loading && detail.data === null && <DetailLoading />}
      {detail.error && detail.data === null && <DetailError reason={detail.error} onRetry={() => void detail.reload()} />}

      {view && draft && (
        <>
          <p className="net-hint">{t("network.settingsHint")}</p>
          <div className="net-settings__grid">
            <fieldset className="net-fieldset">
              <legend>{t("network.settingsPorts")}</legend>
              {PORT_FIELDS.map((field) => {
                const invalid = bad.includes(field.key);
                return (
                  <label key={field.key} className={`net-field ${invalid ? "is-invalid" : ""}`}>
                    <span className="net-field__label">{t(field.label)}</span>
                    <input
                      className="net-input"
                      type="number"
                      min={0}
                      max={65535}
                      name={field.name}
                      value={draft[field.key]}
                      placeholder={t("network.settingsPortPlaceholder")}
                      onChange={(event) => update({ [field.key]: event.target.value })}
                    />
                    {invalid && <span className="net-field__error">{t("network.settingsPortInvalid")}</span>}
                  </label>
                );
              })}
            </fieldset>

            <fieldset className="net-fieldset">
              <legend>{t("network.settingsLan")}</legend>
              <label className="net-field net-field--row">
                <input
                  type="checkbox"
                  name="allow-lan"
                  checked={draft.allowLan}
                  onChange={(event) => update({ allowLan: event.target.checked })}
                />
                <span className="net-field__label">{t("network.settingsAllowLan")}</span>
              </label>
              <label className="net-field net-field--row">
                <input
                  type="checkbox"
                  name="ipv6"
                  checked={draft.ipv6}
                  onChange={(event) => update({ ipv6: event.target.checked })}
                />
                <span className="net-field__label">{t("network.settingsIpv6")}</span>
              </label>
            </fieldset>

            <fieldset className="net-fieldset">
              <legend>{t("network.settingsLogLevel")}</legend>
              <label className="net-field">
                <span className="net-field__label">{t("network.settingsLogLevel")}</span>
                <select
                  className="net-select"
                  name="log-level"
                  value={draft.logLevel}
                  onChange={(event) => update({ logLevel: event.target.value as LogLevel })}
                >
                  {LOG_LEVELS.map((level) => (
                    <option key={level} value={level}>{t(`network.level.${level}`)}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="net-fieldset">
              <legend>{t("network.settingsTun")}</legend>
              <label className="net-field net-field--row">
                <input
                  type="checkbox"
                  name="tun.enable"
                  checked={draft.tunEnabled}
                  onChange={(event) => update({ tunEnabled: event.target.checked })}
                />
                <span className="net-field__label">{t("network.settingsTunEnable")}</span>
              </label>
              <label className="net-field">
                <span className="net-field__label">{t("network.settingsTunStack")}</span>
                <select
                  className="net-select"
                  name="tun.stack"
                  value={draft.tunStack}
                  onChange={(event) => update({ tunStack: event.target.value })}
                >
                  {TUN_STACKS.map((stack) => (
                    <option key={stack} value={stack}>{stack}</option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
          <p className="net-hint">
            {t("network.settingsMode")}：{view.mode ? t(`network.mode${view.mode === "rule" ? "Rule" : view.mode === "global" ? "Global" : "Direct"}`) : "—"}
            {" · "}
            {t("network.settingsModeHint")}
          </p>
        </>
      )}
    </section>
  );
}

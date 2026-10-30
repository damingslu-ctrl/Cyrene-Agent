import { useCallback, useEffect, useRef, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import type { SystemProxyAlign, SystemProxyRead } from "../../../../shared/system-proxy-types";
import type { VergeSettingsRead } from "../../../../shared/verge-settings-types";
import { useTranslation } from "../../i18n";
import { NoticeBar, useNotice } from "./network-detail-common";
import {
  alignKeyOf,
  draftFromSettings,
  effectiveBypass,
  invalidVergeFields,
  proxyStateOf,
  settingLabelKey,
  sysProxyReasonKey,
  vergePatchFromDraft,
  yamlProxySwitchKey,
  type VergeDraft,
  type VergeSettingsApi,
} from "./verge-settings-view";

const PORT_ROWS = [
  { key: "mixedPort", name: "verge_mixed_port", label: "network.verge.mixedPort" },
  { key: "socksPort", name: "verge_socks_port", label: "network.verge.socksPort" },
  { key: "httpPort", name: "verge_port", label: "network.verge.httpPort" },
] as const;

const TUN_ROWS = ["on", "off", "follow"] as const;

/**
 * Wave 3 T9：Verge 那一侧的设置。两张卡，各管各的落点：
 * - 系统代理写注册表（普通用户就能改），地址不归页面——页面只递一个布尔值。
 * - 下面这张写 `verge.yaml`，Verge 在跑时一个字节都不落。
 * 两张卡互不锁死：没装 Verge 的机器照样能开系统代理，反过来也不该拦住内核配置。
 */
export function VergeSettingsSection({ api }: { api?: VergeSettingsApi }) {
  const { t } = useTranslation();
  const [read, setRead] = useState<VergeSettingsRead | null>(null);
  const [proxy, setProxy] = useState<SystemProxyRead | null>(null);
  const [baseline, setBaseline] = useState<VergeDraft | null>(null);
  const [draft, setDraft] = useState<VergeDraft | null>(null);
  const [align, setAlign] = useState<SystemProxyAlign | null>(null);
  const [busy, setBusy] = useState<"save" | "toggle" | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [notice, setNotice] = useNotice();
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  /** 读回是唯一的真相：两张卡的每一次动作之后都重读一遍盘与注册表。 */
  const pull = useCallback(async (): Promise<VergeSettingsRead | null> => {
    if (!api) {
      setUnreachable(true);
      setLoading(false);
      return null;
    }
    try {
      const [nextRead, nextProxy] = await Promise.all([api.get(), api.proxyGet()]);
      if (!aliveRef.current) return null;
      setRead(nextRead);
      setProxy(nextProxy);
      setUnreachable(false);
      return nextRead;
    } catch {
      if (aliveRef.current) setUnreachable(true);
      return null;
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void pull().then((next) => {
      if (!next) return;
      const initial = draftFromSettings(next.view);
      setBaseline(initial);
      setDraft(initial);
    });
  }, [pull]);

  const bad = draft ? invalidVergeFields(draft) : [];
  const patch = baseline && draft ? vergePatchFromDraft(baseline, draft) : {};
  const dirty = Object.keys(patch).length > 0;
  const yamlGated = read !== null && read.reason !== null;
  const status = proxy?.status ?? null;
  // 读失败时手上根本没有读回来的值：徽标不许说「没配过」（那是对注册表的判断），读回清单也不该端出来。
  const proxyReason = proxy?.reason ?? null;
  const readFailed = proxyReason !== null;
  const switchState = status && !readFailed ? proxyStateOf(status) : "unset";
  const badgeKey = readFailed
    ? sysProxyReasonKey(proxyReason)
    : `network.verge.proxy${switchState === "on" ? "On" : switchState === "off" ? "Off" : "Unset"}`;

  const update = (next: Partial<VergeDraft>) => {
    setDraft((current) => (current ? { ...current, ...next } : current));
  };

  const refreshDraft = (next: VergeSettingsRead | null) => {
    if (!next) return;
    const initial = draftFromSettings(next.view);
    setBaseline(initial);
    setDraft(initial);
  };

  const toggleProxy = async (enabled: boolean) => {
    if (!api || busy) return;
    setBusy("toggle");
    setNotice(null);
    setAlign(null);
    try {
      const result = await api.proxySet({ enabled });
      setAlign(result.align);
      if (result.ok) {
        // 回执只说「拨成了」；指向哪儿由下面的读回清单说，那里才是注册表的值。
        // 把 server 塞进这句话里，地址缺席时就得写成「指向 没有可读的地址」那种疯话。
        setNotice({ tone: "ok", text: t(enabled ? "network.verge.proxyTurnedOn" : "network.verge.proxyTurnedOff") });
      } else {
        const said = t(sysProxyReasonKey(result.reason));
        setNotice({
          tone: "error",
          text: result.detail ? `${said} · ${t("network.verge.saidDetail", { detail: result.detail })}` : said,
        });
      }
      // 拨完开关照样要重读：状态以注册表读回来的为准，不许停在「按下去时以为的那一版」。
      // 草稿不参与——用户没保存的输入不该被一次无关的动作冲掉。
      await pull();
    } catch {
      setNotice({ tone: "error", text: t("network.verge.ipcFailed") });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!api || !draft || !dirty || bad.length > 0 || busy) return;
    setBusy("save");
    setNotice(null);
    try {
      const result = await api.set(patch);
      if (result.ok) {
        const names = result.changed.map((key) => t(settingLabelKey(key))).join(", ");
        setNotice({ tone: "ok", text: t("network.verge.saved", { n: result.changed.length, keys: names }) });
        refreshDraft(await pull());
      } else {
        const said = t(`network.verge.reason.${result.reason}`);
        setNotice({
          tone: "error",
          text: result.detail ? `${said} · ${t("network.verge.saidDetail", { detail: result.detail })}` : said,
        });
        // 写面整批原子：拒了就是盘上一个字节没动。重读只为把盘上的真值画准（闸门可能在两次点击之间换了），
        // 草稿留着让用户改完再试——一次拒绝不该吃掉他的输入。
        await pull();
      }
    } catch {
      setNotice({ tone: "error", text: t("network.verge.ipcFailed") });
    } finally {
      setBusy(null);
    }
  };

  const bypassWillWrite = draft ? effectiveBypass(draft) : "";

  return (
    <>
      <section className="net-card net-section net-verge" aria-label={t("network.verge.sysProxyTitle")}>
        <div className="net-card__head net-view__head">
          <span className="net-card__label">
            <ShieldCheck size={15} />
            {t("network.verge.sysProxyTitle")}
          </span>
          <span className={`net-status ${switchState === "on" ? "is-online" : "is-offline"}`}>
            <span className="net-status__dot" aria-hidden="true" />
            {t(badgeKey)}
          </span>
        </div>

        <NoticeBar notice={notice} />

        {unreachable && <p className="net-hint">{t("network.verge.ipcFailed")}</p>}

        <label className="net-field net-field--row">
          <input
            type="checkbox"
            name="enable_system_proxy"
            checked={switchState === "on"}
            disabled={busy !== null || unreachable}
            onChange={(event) => void toggleProxy(event.target.checked)}
          />
          <span className="net-field__label">{t("network.verge.sysProxySwitch")}</span>
        </label>
        <p className="net-hint">{t("network.verge.sysProxyHint")}</p>

        {status && !readFailed && (
          <ul className="net-verge__facts">
            <li>
              {status.server
                ? t("network.verge.pointsTo", { server: status.server })
                : t("network.verge.pointsUnknown")}
            </li>
            <li>
              {status.bypass
                ? t("network.verge.bypassRead", { value: status.bypass })
                : t("network.verge.bypassNone")}
            </li>
            {read && <li>{t(yamlProxySwitchKey(read.view.enableSystemProxy))}</li>}
          </ul>
        )}

        {readFailed && proxy?.detail && (
          <p className="net-verge__read-failed">{t("network.verge.saidDetail", { detail: proxy.detail })}</p>
        )}

        {align && (
          <p className={`net-verge__align is-${align.state}`} role="status">
            {t(alignKeyOf(align))}
            {align.state === "failed" && align.detail ? ` · ${align.detail}` : ""}
          </p>
        )}
      </section>

      <section className="net-card net-section net-verge" aria-label={t("network.verge.title")}>
        <div className="net-card__head net-view__head">
          <span className="net-card__label">
            <Save size={15} />
            {t("network.verge.title")}
          </span>
          <div className="net-view__tools">
            <button
              type="button"
              className="net-primary-button"
              disabled={busy !== null || !dirty || bad.length > 0 || yamlGated || unreachable}
              onClick={() => void save()}
            >
              <Save size={13} />
              {busy === "save" ? t("network.verge.saving") : t("network.verge.save")}
            </button>
          </div>
        </div>

        {loading && read === null && <p className="net-hint">{t("network.detailLoading")}</p>}
        {read?.filePath && <p className="net-hint"><code>{read.filePath}</code></p>}
        {yamlGated && read?.reason && (
          <p className="net-notice net-notice--error" role="status">
            {t(`network.verge.reason.${read.reason}`)}
            {read.detail ? ` · ${read.detail}` : ""}
          </p>
        )}

        {draft && (
          <>
            <p className="net-hint">{t("network.verge.yamlHint")}</p>
            <div className="net-settings__grid">
              <fieldset className="net-fieldset">
                <legend>{t("network.verge.ports")}</legend>
                {PORT_ROWS.map((row) => {
                  const invalid = bad.includes(row.key);
                  return (
                    <label key={row.key} className={`net-field ${invalid ? "is-invalid" : ""}`}>
                      <span className="net-field__label">{t(row.label)}</span>
                      <input
                        className="net-input"
                        type="number"
                        min={0}
                        max={65535}
                        name={row.name}
                        value={draft[row.key]}
                        placeholder={t("network.verge.portPlaceholder")}
                        onChange={(event) => update({ [row.key]: event.target.value } as Partial<VergeDraft>)}
                      />
                      {invalid && <span className="net-field__error">{t("network.verge.portInvalid")}</span>}
                    </label>
                  );
                })}
              </fieldset>

              <fieldset className="net-fieldset">
                <legend>{t("network.verge.tunGroup")}</legend>
                <label className="net-field">
                  <span className="net-field__label">{t("network.verge.tunMode")}</span>
                  <select
                    className="net-select"
                    name="enable_tun_mode"
                    value={draft.tun}
                    disabled={yamlGated}
                    onChange={(event) => update({ tun: event.target.value as VergeDraft["tun"] })}
                  >
                    {TUN_ROWS.map((option) => (
                      <option key={option} value={option}>{t(`network.verge.tun.${option}`)}</option>
                    ))}
                  </select>
                </label>
                <p className="net-hint">{t("network.verge.tunHint")}</p>
              </fieldset>

              <fieldset className="net-fieldset">
                <legend>{t("network.verge.bypass")}</legend>
                <label className="net-field net-field--row">
                  <input
                    type="checkbox"
                    name="use_default_bypass"
                    checked={draft.useDefaultBypass}
                    disabled={yamlGated}
                    onChange={(event) => update({ useDefaultBypass: event.target.checked })}
                  />
                  <span className="net-field__label">{t("network.verge.useDefault")}</span>
                </label>
                <label className={`net-field ${bad.includes("bypass") ? "is-invalid" : ""}`}>
                  <span className="net-field__label">{t("network.verge.bypassList")}</span>
                  <textarea
                    className="net-input net-verge__bypass"
                    name="system_proxy_bypass"
                    rows={3}
                    value={draft.bypass}
                    disabled={yamlGated || draft.useDefaultBypass}
                    onChange={(event) => update({ bypass: event.target.value })}
                  />
                  {bad.includes("bypass") && (
                    <span className="net-field__error">{t("network.verge.bypassInvalid")}</span>
                  )}
                </label>
                <p className="net-hint">{t("network.verge.bypassWillWrite", { value: bypassWillWrite })}</p>
                <p className="net-hint">{t("network.verge.bypassNote")}</p>
              </fieldset>
            </div>
          </>
        )}
      </section>
    </>
  );
}

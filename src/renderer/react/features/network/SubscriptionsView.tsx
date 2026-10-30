import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Link2, RefreshCw, Repeat, Rss, Trash2 } from "lucide-react";
import type { ProfileResult, ProfileRow } from "../../../../shared/subscription-types";
import { useTranslation } from "../../i18n";
import { DetailLoading, NoticeBar, useNotice } from "./network-detail-common";
import {
  failureOf,
  intervalChoiceValues,
  intervalDuration,
  rowActions,
  rowsAfter,
  urlFormValid,
  urlHost,
  warningsText,
  type SubFailure,
  type SubscriptionApi,
} from "./subscription-view";

/** 结果里那一行的显示名：主进程把新列表一起带回来了，就用账本上的 label，拿不到才退回原串。 */
function nameFromResult(result: ProfileResult, fallback: string): string {
  if (!result.ok || !result.uid) return fallback;
  return result.rows.find((entry) => entry.uid === result.uid)?.label ?? fallback;
}

/**
 * 订阅页（Wave 2）。
 *
 * 这一页每个按钮背后都是一次就地落盘，所以四条纪律写在明面上：
 * 1) 失败也采纳列表（`rowsAfter`）——账本读得出来就显示账本上的样子，读不出来才用现有的顶着；
 * 2) 一次只允许一笔写（`pending`）：两笔并发的账本写入会各自盖掉对方看不见的那半；
 * 3) 删除走二次确认（spec §4），内置项 Merge/Script 连按钮都不给；
 * 4) 主进程的单写者闸门拒收时（`verge-running`）说清是「等 Clash Verge 退出」，不演成普通操作失败。
 */
export function SubscriptionsView({ api }: { api?: SubscriptionApi }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const [mergeWarning, setMergeWarning] = useState("");
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const aliveRef = useRef(true);

  const sayFailure = useCallback((failure: SubFailure): string => {
    if (failure.kind === "gated") return t("network.sub.gated");
    const reason = failure.detail
      ?? (failure.status === undefined ? t(failure.reasonKey) : t(failure.reasonKey, { status: failure.status }));
    const replaced = failure.replaced ? ` ${t("network.sub.replaced")}` : "";
    return `${t("network.sub.failed", { reason })}${replaced}`;
  }, [t]);

  /** 一次写的统一收口：列表、回执、警告条都从这里出，别处不许自行 setRows。 */
  const apply = useCallback((result: ProfileResult, okText: string): void => {
    setRows((current) => rowsAfter(result, current));
    const failure = failureOf(result);
    if (failure) {
      setMergeWarning("");
      setNotice({ tone: "error", text: sayFailure(failure) });
      return;
    }
    if (result.ok) {
      setNotice({ tone: "ok", text: okText });
      setMergeWarning(warningsText(result.warnings, t));
    }
  }, [sayFailure, setNotice, t]);

  const load = useCallback(async (announce: boolean): Promise<void> => {
    if (!api) {
      setLoading(false);
      setNotice({ tone: "error", text: t("network.sub.noApi") });
      return;
    }
    setPending("reload");
    try {
      const result = await api.list();
      if (!aliveRef.current) return;
      const failure = failureOf(result);
      setRows(rowsAfter(result, []));
      if (failure) setNotice({ tone: "error", text: sayFailure(failure) });
      else if (announce) setNotice({ tone: "ok", text: t("network.sub.reloaded") });
    } catch {
      if (aliveRef.current) setNotice({ tone: "error", text: t("network.sub.loadFailed") });
    } finally {
      if (aliveRef.current) {
        setPending(null);
        setLoading(false);
      }
    }
  }, [api, sayFailure, setNotice, t]);

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = api?.onChanged((next) => {
      if (aliveRef.current) setRows(next);
    });
    void load(false);
    return () => {
      aliveRef.current = false;
      unsubscribe?.();
    };
  }, [api, load]);

  /** `sayOk` 拿到的是刚回来的结果：回执里要说的那一行之名，只有结果知道。 */
  const write = useCallback(
    async (
      key: string,
      call: () => Promise<ProfileResult>,
      sayOk: (result: ProfileResult) => string,
    ): Promise<ProfileResult | null> => {
      if (!api || pending !== null) return null;
      setPending(key);
      try {
        const result = await call();
        if (aliveRef.current) apply(result, sayOk(result));
        return result;
      } catch {
        if (aliveRef.current) {
          setNotice({ tone: "error", text: t("network.sub.failed", { reason: t("network.reason.unreachable") }) });
        }
        return null;
      } finally {
        if (aliveRef.current) setPending(null);
      }
    },
    [api, apply, pending, setNotice, t],
  );

  const importBy = async (call: () => Promise<ProfileResult>, key: string, fallback: string): Promise<void> => {
    const result = await write(key, call, (r) => t("network.sub.imported", { name: nameFromResult(r, fallback) }));
    if (result?.ok) {
      setUrl("");
      setDesc("");
    }
  };

  const importFromUrl = async (): Promise<void> => {
    if (!api || !urlFormValid(url)) return;
    const target = url.trim();
    const note = desc.trim();
    await importBy(() => api.importUrl(target, note || undefined), "import-url", target);
  };

  const importFromFile = async (): Promise<void> => {
    if (!api || pending !== null) return;
    setPending("pick");
    let picked: string | null;
    try {
      picked = (await api.pickFile()).path;
    } catch {
      picked = null;
    }
    setPending(null);
    // 取消对话框与对话框起不来都是「没有选中文件」：这时候什么都不说。
    if (picked === null) return;
    const note = desc.trim();
    const file = picked;
    await importBy(() => api.importFile(file, note || undefined), "import-file", file);
  };

  const select = async (row: ProfileRow): Promise<void> => {
    if (!api) return;
    await write(`select:${row.uid}`, () => api.select(row.uid), () => t("network.sub.selected", { name: row.label }));
  };

  const update = async (row: ProfileRow): Promise<void> => {
    if (!api) return;
    await write(`update:${row.uid}`, () => api.update(row.uid), (result) => {
      const name = nameFromResult(result, row.label);
      return result.ok && result.proxyCount !== undefined
        ? t("network.sub.updatedCount", { name, n: result.proxyCount })
        : t("network.sub.updated", { name });
    });
  };

  const remove = async (row: ProfileRow): Promise<void> => {
    if (!api) return;
    await write(`remove:${row.uid}`, () => api.remove(row.uid), () => t("network.sub.removed", { name: row.label }));
    setConfirmUid(null);
  };

  const saveOption = async (row: ProfileRow, patch: { with_proxy?: boolean; update_interval?: number }): Promise<void> => {
    if (!api) return;
    await write(`option:${row.uid}`, () => api.setOption(row.uid, patch), () => t("network.sub.optionSaved", { name: row.label }));
  };

  const busy = pending !== null;
  const currentRow = rows.find((row) => row.current);

  return (
    <section className="net-card net-section net-prof" aria-label={t("network.tabSubscriptions")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <Rss size={15} />{t("network.tabSubscriptions")}
          <span className="net-card__count">{t("network.sub.count", { n: rows.length })}</span>
        </span>
        <div className="net-view__tools">
          <button
            type="button"
            className="net-icon-button"
            title={t("network.refresh")}
            aria-label={t("network.refresh")}
            disabled={busy}
            onClick={() => void load(true)}
          >
            <RefreshCw size={14} className={pending === "reload" ? "is-spinning" : ""} />
          </button>
        </div>
      </div>

      <NoticeBar notice={notice} />
      {mergeWarning && <div className="net-notice net-notice--error" role="status">{mergeWarning}</div>}

      <div className="net-prof__import">
        <input
          className="net-input net-prof__url"
          type="url"
          value={url}
          placeholder={t("network.sub.urlPlaceholder")}
          aria-label={t("network.sub.urlLabel")}
          onChange={(event) => setUrl(event.target.value)}
        />
        <input
          className="net-input net-prof__desc"
          type="text"
          maxLength={200}
          value={desc}
          placeholder={t("network.sub.descPlaceholder")}
          aria-label={t("network.sub.descLabel")}
          onChange={(event) => setDesc(event.target.value)}
        />
        <button
          type="button"
          className="net-primary-button"
          disabled={busy || !api || !urlFormValid(url)}
          onClick={() => void importFromUrl()}
        >
          <Link2 size={13} />{t("network.sub.importUrl")}
        </button>
        <button
          type="button"
          className="net-ghost-button"
          disabled={busy || !api}
          onClick={() => void importFromFile()}
        >
          {pending === "pick"
            ? <span className="net-spinner net-spinner--small" />
            : <FileUp size={13} />}
          {t("network.sub.importFile")}
        </button>
      </div>
      <p className="net-hint">
        {t("network.sub.importHint")}
        {currentRow && <>{" · "}{t("network.sub.currentIs", { name: currentRow.label })}</>}
      </p>

      {loading && <DetailLoading />}
      {!loading && rows.length === 0 && <p className="net-empty">{t("network.sub.empty")}</p>}

      {rows.length > 0 && (
        <ul className="net-prof-list">
          {rows.map((row) => {
            const actions = rowActions(row);
            const host = urlHost(row.url);
            const interval = row.updateInterval;
            return (
              <li key={row.uid} className={`net-prof-row ${row.current ? "is-current" : ""}`}>
                <span className="net-prof-row__main">
                  <span className="net-prof-row__name">
                    {row.label}
                    {row.current && <span className="net-prof-row__tag is-current">{t("network.sub.current")}</span>}
                    {row.builtin && <span className="net-prof-row__tag">{t("network.sub.builtin")}</span>}
                    {!row.builtin && !row.selectable && (
                      <span className="net-prof-row__tag">{t("network.sub.attach")}</span>
                    )}
                  </span>
                  <span className="net-prof-row__meta">
                    <span>{row.type}</span>
                    <span>{host ?? t("network.sub.localFile")}</span>
                    <span>
                      {row.updatedAt === null
                        ? t("network.sub.neverUpdated")
                        : t("network.sub.updatedAt", { time: new Date(row.updatedAt).toLocaleString() })}
                    </span>
                  </span>
                </span>

                <span className="net-prof-row__ops">
                  {actions.select && (
                    <button type="button" className="net-ghost-button" disabled={busy} onClick={() => void select(row)}>
                      {pending === `select:${row.uid}`
                        ? <span className="net-spinner net-spinner--small" />
                        : <Repeat size={13} />}
                      {t("network.sub.select")}
                    </button>
                  )}
                  {actions.update && (
                    <button type="button" className="net-ghost-button" disabled={busy} onClick={() => void update(row)}>
                      {pending === `update:${row.uid}`
                        ? <span className="net-spinner net-spinner--small" />
                        : <RefreshCw size={13} />}
                      {t("network.sub.update")}
                    </button>
                  )}
                  {actions.remove && (confirmUid === row.uid ? (
                    <span
                      className="net-confirm"
                      role="alertdialog"
                      aria-label={t("network.sub.removeAsk", { name: row.label })}
                    >
                      <span>{t("network.sub.removeAsk", { name: row.label })}</span>
                      <button type="button" className="net-danger-button" disabled={busy} onClick={() => void remove(row)}>
                        {t("network.sub.confirmRemove")}
                      </button>
                      <button type="button" className="net-ghost-button" onClick={() => setConfirmUid(null)}>
                        {t("network.sub.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="net-icon-button"
                      title={t("network.sub.remove", { name: row.label })}
                      aria-label={t("network.sub.remove", { name: row.label })}
                      disabled={busy}
                      onClick={() => setConfirmUid(row.uid)}
                    >
                      <Trash2 size={13} />
                    </button>
                  ))}
                </span>

                {actions.options && (
                  <span className="net-prof-row__options">
                    <label className="net-field net-field--row">
                      <input
                        type="checkbox"
                        name={`with-proxy-${row.uid}`}
                        checked={row.withProxy === true}
                        disabled={busy}
                        onChange={(event) => void saveOption(row, { with_proxy: event.target.checked })}
                      />
                      <span className="net-field__label">{t("network.sub.withProxy")}</span>
                    </label>
                    <label className="net-field net-field--row">
                      <span className="net-field__label">{t("network.sub.interval")}</span>
                      <select
                        className="net-select"
                        name={`interval-${row.uid}`}
                        value={interval === null ? "" : String(interval)}
                        disabled={busy}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next) || next <= 0) return;
                          void saveOption(row, { update_interval: next });
                        }}
                      >
                        {/* 没写过就是没写过：这一档只能显示、不能当选，也没有「清空」的假出口。 */}
                        <option value="" disabled>{t("network.sub.intervalUnset")}</option>
                        {intervalChoiceValues(interval).map((seconds) => {
                          const said = intervalDuration(seconds);
                          return (
                            <option key={seconds} value={String(seconds)}>
                              {t(said.unit === "hours" ? "network.sub.intervalHours" : "network.sub.intervalMinutes", { n: said.n })}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    {interval === null && <span className="net-prof-row__note">{t("network.sub.intervalFollow")}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

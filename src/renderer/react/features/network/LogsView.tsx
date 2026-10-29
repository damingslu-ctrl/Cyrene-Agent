import { useEffect, useRef, useState } from "react";
import { Pause, Play, ScrollText } from "lucide-react";
import {
  LOG_LEVELS,
  type LogEntry,
  type LogLevel,
} from "../../../../shared/network-detail-types";
import type { NetworkReason } from "../../../../shared/network-types";
import { useTranslation } from "../../i18n";
import { filterLogs, pushLogEntry, type NetworkApi } from "./network-tabs";

const INITIAL_LEVEL: LogLevel = "info";

/** 日志：读缓冲 → 接流；暂停只停追加，级别是下限且换级别重启主进程那条流。 */
export function LogsView({ api }: { api?: NetworkApi }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<NetworkReason | null>(null);
  const [paused, setPaused] = useState(false);
  const [missed, setMissed] = useState(0);
  const [level, setLevel] = useState<LogLevel>(INITIAL_LEVEL);
  const pausedRef = useRef(false);
  const aliveRef = useRef(true);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    aliveRef.current = true;
    if (!api) {
      setStreamError("unreachable");
      return;
    }
    const off = api.onLog((entry) => {
      if (!aliveRef.current) return;
      if (pausedRef.current) {
        setMissed((count) => count + 1);
        return;
      }
      setEntries((current) => pushLogEntry(current, entry));
    });
    void (async () => {
      const initial = await api.getLogs().catch(() => null);
      if (!aliveRef.current) return;
      if (initial?.ok) setEntries(initial.data.entries);
      const started = await api.startLogs(INITIAL_LEVEL).catch(() => null);
      if (!aliveRef.current) return;
      if (started?.ok) {
        setStreaming(true);
        setStreamError(null);
      } else {
        setStreaming(false);
        setStreamError(started?.reason ?? (initial?.ok ? null : initial?.reason) ?? "unreachable");
      }
    })();
    return () => {
      aliveRef.current = false;
      off();
      void api.stopLogs();
    };
  }, [api]);

  const shown = filterLogs(entries, level);

  useEffect(() => {
    const element = listRef.current;
    if (element && !paused) element.scrollTop = element.scrollHeight;
  }, [shown.length, paused]);

  const changeLevel = (next: LogLevel) => {
    setLevel(next);
    if (!api) return;
    void api.startLogs(next).then((result) => {
      if (!result.ok) {
        setStreaming(false);
        setStreamError(result.reason);
      }
    }).catch(() => setStreamError("unreachable"));
  };

  return (
    <section className="net-card net-section net-logs" aria-label={t("network.tabLogs")}>
      <div className="net-card__head net-view__head">
        <span className="net-card__label">
          <ScrollText size={15} />{t("network.tabLogs")}
          <span className={`net-card__count ${streaming ? "is-live" : ""}`}>
            {streaming ? t("network.logsStreaming") : t("network.logsStopped")}
          </span>
        </span>
        <div className="net-view__tools">
          <select
            className="net-select"
            value={level}
            aria-label={t("network.logsLevel")}
            onChange={(event) => changeLevel(event.target.value as LogLevel)}
          >
            {LOG_LEVELS.map((option) => (
              <option key={option} value={option}>{t(`network.level.${option}`)}</option>
            ))}
          </select>
          <button
            type="button"
            className="net-ghost-button"
            aria-pressed={paused}
            onClick={() => { setPaused((current) => !current); setMissed(0); }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? t("network.logsResume") : t("network.logsPause")}
          </button>
        </div>
      </div>

      {paused && missed > 0 && (
        <div className="net-logs__paused" role="status">{t("network.logsPausedBadge", { n: missed })}</div>
      )}
      {streamError && (
        <div className="net-notice net-notice--error" role="status">
          {t("network.detailError", { reason: t(`network.reason.${streamError}`) })}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="net-empty">{t("network.logsEmpty")}</p>
      ) : (
        <ul className="net-log-list" ref={listRef}>
          {shown.map((entry, index) => (
            <li key={index} className={`net-log net-log--${entry.type}`}>
              <span className="net-log__time">
                {entry.at ? new Date(entry.at).toLocaleTimeString() : "—"}
              </span>
              <span className="net-log__level">
                {entry.type === "unknown" ? t("network.levelUnknown") : t(`network.level.${entry.type}`)}
              </span>
              <span className="net-log__text">{entry.payload}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

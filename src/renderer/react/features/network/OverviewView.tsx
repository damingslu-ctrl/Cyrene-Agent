import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Gauge,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type {
  NetworkSnapshot,
  ProxyMode,
  TrafficFrame,
} from "../../../../shared/network-types";
import { useTranslation } from "../../i18n";
import { MODE_HINT_KEY, MODE_KEY } from "./network-tabs";
import { formatBytes, formatSpeed, subscriptionProgress } from "./network-view";

function trailingPath(frames: TrafficFrame[], pick: (frame: TrafficFrame) => number): string {
  if (frames.length === 0) return "";
  const values = frames.map((frame) => Math.max(0, pick(frame)));
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 30;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatExpiry(expireAt: number | null, now: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!expireAt) return t("network.subscriptionNoExpire");
  if (expireAt <= now) return t("network.subscriptionExpired");
  const days = Math.ceil((expireAt - now) / 86_400_000);
  if (days <= 1) return t("network.subscriptionExpireSoon");
  return t("network.subscriptionExpire", { days });
}

function formatUpdated(updatedAt: number, now: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!updatedAt) return "";
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return t("network.updatedJustNow");
  if (seconds < 60) return t("network.updatedSeconds", { n: seconds });
  return t("network.updatedMinutes", { n: Math.floor(seconds / 60) });
}

interface OverviewViewProps {
  snapshot: NetworkSnapshot;
  pending: string | null;
  online: boolean;
  now: number;
  trafficFrames: TrafficFrame[];
  onMode: (mode: ProxyMode) => void;
}

/** 概览：实时流量、订阅与代理模式。 */
export function OverviewView({ snapshot, pending, online, now, trafficFrames, onMode }: OverviewViewProps) {
  const { t } = useTranslation();
  const traffic = snapshot.traffic;
  const subscription = snapshot.subscription;
  const connectionTotal = snapshot.connections.total;
  const connectionSegments = connectionTotal > 0
    ? [
        { key: "proxy", value: snapshot.connections.proxy },
        { key: "direct", value: snapshot.connections.direct },
        { key: "reject", value: snapshot.connections.reject },
      ]
    : [];
  const usedBytes = subscription ? subscription.upload + subscription.download : 0;

  return (
    <>
      <div className="net-hero">
        <section className="net-card net-traffic" aria-label={t("network.trafficTitle")}>
          <div className="net-card__head">
            <span className="net-card__label"><Gauge size={15} />{t("network.trafficTitle")}</span>
            <span className="net-card__meta">{formatUpdated(snapshot.updatedAt, now, t)}</span>
          </div>
          <div className="net-traffic__rates">
            <div className="net-rate">
              <span className="net-rate__icon net-rate__icon--down"><ArrowDown size={16} strokeWidth={2.2} /></span>
              <span className="net-rate__value">{formatSpeed(traffic.down)}</span>
              <span className="net-rate__label">{t("network.trafficDown")}</span>
            </div>
            <div className="net-rate">
              <span className="net-rate__icon net-rate__icon--up"><ArrowUp size={16} strokeWidth={2.2} /></span>
              <span className="net-rate__value">{formatSpeed(traffic.up)}</span>
              <span className="net-rate__label">{t("network.trafficUp")}</span>
            </div>
          </div>
          <div className="net-sparkline" aria-hidden="true">
            {trafficFrames.length > 1 ? (
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <path className="net-sparkline__fill" d={`${trailingPath(trafficFrames, (frame) => frame.down)} L100,30 L0,30 Z`} />
                <path className="net-sparkline__line" d={trailingPath(trafficFrames, (frame) => frame.down)} />
              </svg>
            ) : (
              <span className="net-sparkline__idle">{t("network.trafficIdle")}</span>
            )}
          </div>
          <div className="net-connections">
            <div className="net-connections__head">
              <span>{t("network.connections")}</span>
              <strong>{t("network.connectionsTotal", { n: connectionTotal })}</strong>
            </div>
            {connectionTotal > 0 ? (
              <>
                <div className="net-connections__bar">
                  {connectionSegments.map((segment) => (
                    <span
                      key={segment.key}
                      className={`net-connections__seg net-connections__seg--${segment.key}`}
                      style={{ width: `${(segment.value / connectionTotal) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="net-connections__legend">
                  <span><i className="net-dot net-dot--proxy" />{t("network.connectionsProxy")} {snapshot.connections.proxy}</span>
                  <span><i className="net-dot net-dot--direct" />{t("network.connectionsDirect")} {snapshot.connections.direct}</span>
                  <span><i className="net-dot net-dot--reject" />{t("network.connectionsReject")} {snapshot.connections.reject}</span>
                </div>
              </>
            ) : (
              <p className="net-connections__empty">{t("network.connectionsEmpty")}</p>
            )}
          </div>
        </section>

        <section className="net-card net-sub" aria-label={t("network.subscription")}>
          <div className="net-card__head">
            <span className="net-card__label"><ShieldCheck size={15} />{t("network.subscription")}</span>
            {subscription?.updatedAt && (
              <span className="net-card__meta">
                {t("network.subscriptionUpdated", { time: new Date(subscription.updatedAt).toLocaleDateString() })}
              </span>
            )}
          </div>
          {subscription ? (
            <>
              <div className="net-sub__identity">
                <strong>{subscription.user || t("network.subscriptionLocal")}</strong>
                <span className="net-sub__expiry"><Clock3 size={12} />{formatExpiry(subscription.expireAt, now, t)}</span>
              </div>
              <div className="net-sub__meter">
                <div className="net-sub__meter-head">
                  <span>{subscription.total > 0
                    ? t("network.subscriptionUsed", { used: formatBytes(usedBytes), total: formatBytes(subscription.total) })
                    : t("network.subscriptionNoTotal", { used: formatBytes(usedBytes) })}</span>
                  {subscription.total > 0 && <strong>{Math.round(subscriptionProgress(subscription.upload, subscription.download, subscription.total) * 100)}%</strong>}
                </div>
                {subscription.total > 0 && (
                  <div className="net-sub__track">
                    <span style={{ width: `${subscriptionProgress(subscription.upload, subscription.download, subscription.total) * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="net-sub__split">
                <span><ArrowUp size={12} />{formatBytes(subscription.upload)}</span>
                <span><ArrowDown size={12} />{formatBytes(subscription.download)}</span>
              </div>
            </>
          ) : (
            <p className="net-sub__empty">{t("network.subscriptionNone")}</p>
          )}
        </section>
      </div>

      <section className="net-card net-section" aria-label={t("network.mode")}>
        <div className="net-card__head">
          <span className="net-card__label"><Zap size={15} />{t("network.mode")}</span>
        </div>
        <div className="net-modes">
          {(["rule", "global", "direct"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`net-mode ${snapshot.mode === mode ? "is-active" : ""}`}
              aria-pressed={snapshot.mode === mode}
              disabled={pending !== null || !online}
              onClick={() => onMode(mode)}
            >
              <span className="net-mode__name">{t(MODE_KEY[mode])}</span>
              <span className="net-mode__hint">{t(MODE_HINT_KEY[mode])}</span>
              {snapshot.mode === mode && <Check className="net-mode__check" size={14} />}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

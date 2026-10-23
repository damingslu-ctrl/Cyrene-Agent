import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  emptyNetworkSnapshot,
  type NetworkReason,
  type NetworkSnapshot,
  type ProxyGroup,
  type ProxyMode,
  type ProxyNode,
  type TrafficFrame,
} from "../../../../shared/network-types";
import { useTranslation } from "../../i18n";
import {
  delayTone,
  formatBytes,
  formatSpeed,
  nodeStability,
  sortNodes,
  subscriptionProgress,
  type NodeSort,
} from "./network-view";
import "./NetworkPanel.css";

const TRAFFIC_POINTS = 40;

const MODE_KEY: Record<ProxyMode, string> = {
  rule: "network.modeRule",
  global: "network.modeGlobal",
  direct: "network.modeDirect",
};

const MODE_HINT_KEY: Record<ProxyMode, string> = {
  rule: "network.modeRuleHint",
  global: "network.modeGlobalHint",
  direct: "network.modeDirectHint",
};

type Notice = { tone: "ok" | "error"; text: string };

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

/** 主窗侧边栏的「网络」页：Clash Verge 的实时状态与全部常用操作都在这一页。 */
export function NetworkPanel() {
  const { t } = useTranslation();
  const api = window.verge?.network;
  const [snapshot, setSnapshot] = useState<NetworkSnapshot>(emptyNetworkSnapshot);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [groupName, setGroupName] = useState("");
  const [sort, setSort] = useState<NodeSort>("speed");
  const [now, setNow] = useState(() => Date.now());
  const [trafficFrames, setTrafficFrames] = useState<TrafficFrame[]>([]);
  const disposedRef = useRef(false);

  const applySnapshot = useCallback((next: NetworkSnapshot) => {
    setSnapshot(next);
    setGroupName((current) => {
      if (current && next.groups.some((group) => group.name === current)) return current;
      return next.groups[0]?.name ?? "";
    });
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    if (!api) {
      setLoading(false);
      setNotice({ tone: "error", text: t("network.reason.unreachable") });
      return;
    }
    const unsubscribe = api.onUpdate((update) => {
      if (disposedRef.current) return;
      if (update.kind === "snapshot") {
        applySnapshot(update.snapshot);
        return;
      }
      setSnapshot((current) => ({ ...current, traffic: update.traffic }));
      setTrafficFrames((current) => [...current, update.traffic].slice(-TRAFFIC_POINTS));
    });
    void api.refresh()
      .then((next) => {
        if (!disposedRef.current) applySnapshot(next);
      })
      .catch(() => {
        if (!disposedRef.current) setNotice({ tone: "error", text: t("network.reason.unreachable") });
      })
      .finally(() => {
        if (!disposedRef.current) setLoading(false);
      });
    return () => {
      disposedRef.current = true;
      unsubscribe();
    };
  }, [api, applySnapshot, t]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeGroup: ProxyGroup | null = useMemo(() => {
    if (snapshot.groups.length === 0) return null;
    return snapshot.groups.find((group) => group.name === groupName) ?? snapshot.groups[0];
  }, [groupName, snapshot.groups]);

  const sortedNodes = useMemo(
    () => (activeGroup ? sortNodes(activeGroup.nodes, sort) : []),
    [activeGroup, sort],
  );

  const reasonText = useCallback(
    (reason: NetworkReason) => t(`network.reason.${reason}`),
    [t],
  );

  const handleRefresh = async () => {
    if (!api || pending) return;
    setPending("refresh");
    setNotice(null);
    try {
      applySnapshot(await api.refresh());
    } catch {
      setNotice({ tone: "error", text: t("network.refreshFailed", { reason: reasonText("unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const handleMode = async (mode: ProxyMode) => {
    if (!api || pending || snapshot.mode === mode) return;
    setPending(`mode:${mode}`);
    setNotice(null);
    try {
      const result = await api.setMode(mode);
      if (result.ok) {
        applySnapshot(result.snapshot);
        setNotice({ tone: "ok", text: t(MODE_KEY[mode]) });
      } else {
        setNotice({ tone: "error", text: t("network.modeFailed", { reason: reasonText(result.reason) }) });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.modeFailed", { reason: reasonText("unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const handleSelect = async (node: ProxyNode) => {
    if (!api || pending || !activeGroup || activeGroup.now === node.name) return;
    const key = `node:${node.name}`;
    setPending(key);
    setNotice(null);
    try {
      const result = await api.selectNode(activeGroup.name, node.name);
      if (result.ok) applySnapshot(result.snapshot);
      else setNotice({ tone: "error", text: t("network.selectFailed", { reason: reasonText(result.reason) }) });
    } catch {
      setNotice({ tone: "error", text: t("network.selectFailed", { reason: reasonText("unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const handleTest = async () => {
    if (!api || pending || !activeGroup) return;
    setPending("test");
    setNotice(null);
    try {
      const result = await api.testGroup(activeGroup.name);
      if (result.ok) {
        applySnapshot(result.snapshot);
        setNotice({ tone: "ok", text: t("network.testDone") });
      } else {
        setNotice({ tone: "error", text: t("network.testFailed", { reason: reasonText(result.reason) }) });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.testFailed", { reason: reasonText("unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const handleAutoBest = async () => {
    if (!api || pending || !activeGroup) return;
    setPending("auto");
    setNotice(null);
    try {
      const result = await api.autoSelect(activeGroup.name);
      if (!result.ok) {
        setNotice({ tone: "error", text: t("network.testFailed", { reason: reasonText(result.reason) }) });
        return;
      }
      applySnapshot(result.snapshot);
      const outcome = result.result;
      if (outcome.switched && outcome.best) {
        setNotice({ tone: "ok", text: t("network.autoBestSwitched", { node: outcome.best }) });
      } else if (outcome.best) {
        setNotice({ tone: "ok", text: t("network.autoBestAlready", { node: outcome.best }) });
      } else {
        setNotice({ tone: "error", text: t("network.autoBestNone") });
      }
    } catch {
      setNotice({ tone: "error", text: t("network.testFailed", { reason: reasonText("unreachable") }) });
    } finally {
      setPending(null);
    }
  };

  const online = snapshot.controller.available;
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
    <div className="net-panel">
      <div className="net-panel__scroll">
        <div className="net-panel__inner">
          <header className="net-panel__header">
            <div className="net-panel__heading">
              <span className="net-panel__eyebrow">
                <Activity size={14} strokeWidth={2} aria-hidden="true" />
                Clash Verge
                {snapshot.controller.version ? ` · ${snapshot.controller.version}` : ""}
              </span>
              <h1 className="net-panel__title">{t("network.title")}</h1>
              <p className="net-panel__subtitle">{t("network.subtitle")}</p>
            </div>
            <div className="net-panel__actions">
              <span className={`net-status ${online ? "is-online" : "is-offline"}`}>
                <span className="net-status__dot" aria-hidden="true" />
                {online ? t("network.controllerOnline") : t("network.controllerOffline")}
              </span>
              <button
                className="net-icon-button"
                type="button"
                title={t("network.refresh")}
                aria-label={t("network.refresh")}
                disabled={pending !== null}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw size={16} className={pending === "refresh" ? "is-spinning" : ""} />
              </button>
            </div>
          </header>

          {notice && (
            <div className={`net-notice net-notice--${notice.tone}`} role="status">
              {notice.text}
            </div>
          )}

          {!online && !loading && (
            <div className="net-offline">
              <span className="net-offline__icon"><WifiOff size={22} strokeWidth={1.8} /></span>
              <div>
                <strong>{snapshot.controller.reason ? reasonText(snapshot.controller.reason) : t("network.controllerOffline")}</strong>
                <p>{t("network.offlineHint")}</p>
                {snapshot.controller.baseUrl && <code>{snapshot.controller.baseUrl}</code>}
              </div>
            </div>
          )}

          {loading && (
            <div className="net-loading">
              <span className="net-spinner" aria-hidden="true" />
              {t("network.loading")}
            </div>
          )}

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
                  onClick={() => void handleMode(mode)}
                >
                  <span className="net-mode__name">{t(MODE_KEY[mode])}</span>
                  <span className="net-mode__hint">{t(MODE_HINT_KEY[mode])}</span>
                  {snapshot.mode === mode && <Check className="net-mode__check" size={14} />}
                </button>
              ))}
            </div>
          </section>

          <section className="net-card net-section net-nodes" aria-label={t("network.nodes")}>
            <div className="net-card__head net-nodes__head">
              <span className="net-card__label">
                <Sparkles size={15} />{t("network.nodes")}
                <span className="net-card__count">{t("network.groups", { n: snapshot.groups.length })}</span>
              </span>
              <div className="net-sort" role="group" aria-label={t("network.sortLabel")}>
                {(["speed", "stability", "name"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={sort === mode ? "is-active" : ""}
                    aria-pressed={sort === mode}
                    onClick={() => setSort(mode)}
                  >
                    {t(mode === "speed" ? "network.sortSpeed" : mode === "stability" ? "network.sortStability" : "network.sortName")}
                  </button>
                ))}
              </div>
            </div>

            {snapshot.groups.length === 0 ? (
              <p className="net-empty">{t("network.emptyGroups")}</p>
            ) : (
              <>
                <div className="net-groups" role="tablist" aria-label={t("network.groups", { n: snapshot.groups.length })}>
                  {snapshot.groups.map((group) => (
                    <button
                      key={group.name}
                      type="button"
                      role="tab"
                      aria-selected={activeGroup?.name === group.name}
                      className={`net-group ${activeGroup?.name === group.name ? "is-active" : ""}`}
                      onClick={() => setGroupName(group.name)}
                    >
                      <span className="net-group__name">{group.name}</span>
                      <span className="net-group__now">{group.now || "—"}</span>
                    </button>
                  ))}
                </div>

                {activeGroup && (
                  <>
                    <div className="net-nodes__toolbar">
                      <span className="net-nodes__now">
                        {t("network.groupNow")} <strong>{activeGroup.now || "—"}</strong>
                      </span>
                      <div className="net-nodes__toolbar-actions">
                        <button type="button" className="net-ghost-button" disabled={pending !== null || !online} onClick={() => void handleTest()}>
                          <Gauge size={14} />{pending === "test" ? t("network.testing") : t("network.test")}
                        </button>
                        <button type="button" className="net-primary-button" disabled={pending !== null || !online} onClick={() => void handleAutoBest()}>
                          <Sparkles size={14} />{pending === "auto" ? t("network.autoBestBusy") : t("network.autoBest")}
                        </button>
                      </div>
                    </div>

                    {sortedNodes.length === 0 ? (
                      <p className="net-empty">{t("network.emptyNodes")}</p>
                    ) : (
                      <ul className="net-node-list">
                        {sortedNodes.map((node) => {
                          const current = activeGroup.now === node.name;
                          const stability = nodeStability(node.history);
                          const tone = delayTone(node.delay);
                          const busy = pending === `node:${node.name}`;
                          return (
                            <li key={node.name}>
                              <button
                                type="button"
                                className={`net-node ${current ? "is-current" : ""} ${node.alive ? "" : "is-dead"}`}
                                aria-pressed={current}
                                disabled={pending !== null || !online || !node.alive}
                                title={current ? t("network.selected") : t("network.switchTo", { node: node.name })}
                                onClick={() => void handleSelect(node)}
                              >
                                <span className="net-node__state">
                                  {current ? <Check size={14} strokeWidth={2.4} /> : <span className="net-node__dot" />}
                                </span>
                                <span className="net-node__main">
                                  <span className="net-node__name">{node.name}</span>
                                  <span className="net-node__meta">
                                    <span>{node.type || "Proxy"}</span>
                                    {!node.alive && <span className="net-node__dead">{t("network.dead")}</span>}
                                  </span>
                                </span>
                                <span className="net-node__history" aria-hidden="true">
                                  {node.history.slice(-10).map((sample, index) => (
                                    <i key={index} className={`net-bar net-bar--${delayTone(sample)}`} />
                                  ))}
                                </span>
                                <span className="net-node__stability">
                                  {stability === null ? t("network.noHistory") : t("network.stability", { percent: Math.round(stability * 100) })}
                                </span>
                                <span className={`net-node__delay net-delay--${tone}`}>
                                  {busy ? <span className="net-spinner net-spinner--small" /> : node.delay === null ? "—" : `${node.delay} ms`}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

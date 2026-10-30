import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, RefreshCw, WifiOff } from "lucide-react";
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
import { ConnectionsView } from "./ConnectionsView";
import { CoreSection } from "./CoreSection";
import { LogsView } from "./LogsView";
import { NetworkTabs } from "./NetworkTabs";
import { NodesView } from "./NodesView";
import { OverviewView } from "./OverviewView";
import { ProvidersView } from "./ProvidersView";
import { RulesView } from "./RulesView";
import { SettingsView } from "./SettingsView";
import { SubscriptionsView } from "./SubscriptionsView";
import { VergeSettingsSection } from "./VergeSettingsSection";
import { MODE_KEY, type NetworkTab } from "./network-tabs";
import type { NodeSort } from "./network-view";
import "./NetworkPanel.css";

const TRAFFIC_POINTS = 40;

type Notice = { tone: "ok" | "error"; text: string };

/** 主窗侧边栏的「网络」页：Clash Verge 的状态与全部操作，按页签分给七个视图。 */
export function NetworkPanel() {
  const { t } = useTranslation();
  const api = window.verge?.network;
  const subscriptionApi = window.verge?.subscriptions;
  const settingsApi = window.verge?.settings;
  const coreApi = window.verge?.core;
  const [snapshot, setSnapshot] = useState<NetworkSnapshot>(emptyNetworkSnapshot);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [groupName, setGroupName] = useState("");
  const [sort, setSort] = useState<NodeSort>("speed");
  const [now, setNow] = useState(() => Date.now());
  const [trafficFrames, setTrafficFrames] = useState<TrafficFrame[]>([]);
  const [tab, setTab] = useState<NetworkTab>("overview");
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

          <NetworkTabs active={tab} onChange={setTab} />

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

          {tab === "overview" && (
            <OverviewView
              snapshot={snapshot}
              pending={pending}
              online={online}
              now={now}
              trafficFrames={trafficFrames}
              onMode={(mode) => void handleMode(mode)}
            />
          )}

          {tab === "nodes" && (
            <NodesView
              snapshot={snapshot}
              activeGroup={activeGroup}
              activeGroupName={activeGroup?.name ?? ""}
              sort={sort}
              onSort={setSort}
              onGroup={setGroupName}
              pending={pending}
              online={online}
              onSelect={(node) => void handleSelect(node)}
              onTest={() => void handleTest()}
              onAutoBest={() => void handleAutoBest()}
            />
          )}

          {tab === "rules" && <RulesView api={api} />}
          {tab === "logs" && <LogsView api={api} />}
          {tab === "connections" && <ConnectionsView api={api} />}
          {tab === "providers" && <ProvidersView api={api} />}
          {tab === "subscriptions" && <SubscriptionsView api={subscriptionApi} />}
          {tab === "settings" && (
            <>
              {/* 内核排在最前：下面两张卡读的都是它的控制面，它没起来时那两张必然全瞎。 */}
              <CoreSection api={coreApi} />
              <SettingsView api={api} />
              <VergeSettingsSection api={settingsApi} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

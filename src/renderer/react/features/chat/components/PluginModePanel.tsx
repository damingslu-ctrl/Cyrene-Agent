import { AppstoreOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MarketPluginEntry,
  PluginListEntry,
  PluginManagementApi,
  PluginOverview,
  PluginRuntimeStatus,
} from "../../../../../shared/plugin-management";
import { useTranslation } from "../../../i18n";
import { Card } from "../../../components/ui/Card";
import { useFeedback } from "../../../components/feedback/FeedbackProvider";
import pluginIconUrl from "../../../assets/plugin.png?url";
import "./PluginModePanel.css";

interface PluginModePanelProps {
  api?: PluginManagementApi;
}

type HeaderAction = "refresh" | "import" | null;
type PanelView = "installed" | "market";

interface MarketState {
  phase: "idle" | "loading" | "ready" | "error";
  plugins: MarketPluginEntry[];
  error?: string;
  /** 被枚举的本地插件目录绝对路径；用户把插件文件夹放进这里再刷新 */
  directory?: string;
}

const STATUS_ORDER: Record<PluginRuntimeStatus, number> = {
  running: 0,
  starting: 1,
  failed: 2,
  stopping: 3,
  disabled: 4,
};

export function normalizePluginOverview(
  value: PluginOverview | PluginListEntry[],
): PluginOverview {
  return Array.isArray(value) ? { plugins: value, issues: [] } : value;
}

export function pluginToggleTarget(plugin: PluginListEntry): boolean {
  return plugin.status !== "running";
}

export function PluginModePanel({ api: providedApi }: PluginModePanelProps) {
  const { t } = useTranslation();
  // 统一反馈入口：删除插件走危险确认
  const feedback = useFeedback();
  const api = providedApi ?? window.plugins;
  const [overview, setOverview] = useState<PluginOverview>({ plugins: [], issues: [] });
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [headerAction, setHeaderAction] = useState<HeaderAction>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("installed");
  const [market, setMarket] = useState<MarketState>({ phase: "idle", plugins: [] });

  const reload = useCallback(async () => {
    if (!api) throw new Error(t("pluginPanel.apiUnavailable"));
    setOverview(normalizePluginOverview(await api.list()));
  }, [api, t]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reload]);

  // 每次切入本地目录视图都重新读取 userData/plugins；不监听不轮询
  const loadMarket = useCallback(async () => {
    if (!api) return;
    setMarket({ phase: "loading", plugins: [] });
    try {
      const result = await api.marketList();
      if (!result.ok) {
        setMarket({ phase: "error", plugins: [], error: result.error ?? t("pluginPanel.unknownError") });
      } else {
        setMarket({ phase: "ready", plugins: result.plugins, directory: result.directory });
      }
    } catch (cause) {
      setMarket({
        phase: "error",
        plugins: [],
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [api, t]);

  useEffect(() => {
    if (view === "market") void loadMarket();
  }, [view, loadMarket]);

  const visiblePlugins = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? overview.plugins.filter((plugin) =>
          plugin.name.toLowerCase().includes(keyword)
          || plugin.description.toLowerCase().includes(keyword)
          || plugin.author.toLowerCase().includes(keyword)
          || plugin.id.toLowerCase().includes(keyword))
      : overview.plugins;
    return [...filtered].sort((left, right) => {
      const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
      return statusDiff || left.name.localeCompare(right.name, "zh-CN");
    });
  }, [filter, overview.plugins]);

  const refreshPlugins = useCallback(async () => {
    if (!api) return;
    setHeaderAction("refresh");
    setError(null);
    try {
      setOverview(normalizePluginOverview(await api.rescan()));
      // 本地目录视图里点刷新同时重读目录；用户刚把插件文件夹放进去时要立刻看到
      if (view === "market") await loadMarket();
    } catch (cause) {
      setError(t("pluginPanel.refreshFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setHeaderAction(null);
    }
  }, [api, t, view, loadMarket]);

  const importPlugin = useCallback(async () => {
    if (!api) return;
    setHeaderAction("import");
    setError(null);
    try {
      const result = await api.importZip();
      if (!result.ok && !result.canceled) {
        setError(t("pluginPanel.importFailed", { error: result.error ?? t("pluginPanel.unknownError") }));
      } else if (result.ok) {
        if (result.overview) setOverview(normalizePluginOverview(result.overview));
        else await reload();
      }
    } catch (cause) {
      setError(t("pluginPanel.importFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setHeaderAction(null);
    }
  }, [api, reload, t]);

  const openPlugin = useCallback(async (plugin: PluginListEntry) => {
    if (!api) return;
    const action = `${plugin.id}:open`;
    setBusyAction(action);
    setError(null);
    try {
      const result = await api.open(plugin.id);
      if (!result.ok) setError(t("pluginPanel.openFailed", { error: result.error ?? t("pluginPanel.unknownError") }));
    } catch (cause) {
      setError(t("pluginPanel.openFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusyAction(null);
    }
  }, [api, t]);

  const togglePlugin = useCallback(async (plugin: PluginListEntry) => {
    if (!api) return;
    const action = `${plugin.id}:toggle`;
    setBusyAction(action);
    setError(null);
    try {
      const result = await api.setEnabled(plugin.id, pluginToggleTarget(plugin));
      if (!result.ok) {
        setError(t("pluginPanel.toggleFailed", { error: result.error ?? t("pluginPanel.unknownError") }));
      }
      await reload();
    } catch (cause) {
      setError(t("pluginPanel.toggleFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusyAction(null);
    }
  }, [api, reload, t]);

  const deletePlugin = useCallback(async (plugin: PluginListEntry) => {
    if (!api || plugin.source !== "user") return;
    // 删除插件程序目录：危险确认，默认聚焦取消
    const confirmed = await feedback.confirm({
      title: t("pluginPanel.delete"),
      message: t("pluginPanel.deleteConfirm", { name: plugin.name }),
      confirmText: t("pluginPanel.delete"),
      cancelText: t("common.cancel"),
      dangerous: true,
    });
    if (!confirmed) return;
    const action = `${plugin.id}:delete`;
    setBusyAction(action);
    setError(null);
    try {
      const result = await api.uninstall(plugin.id);
      if (!result.ok) {
        setError(t("pluginPanel.deleteFailed", { error: result.error ?? t("pluginPanel.unknownError") }));
      } else if (result.overview) {
        setOverview(normalizePluginOverview(result.overview));
      } else {
        await reload();
      }
    } catch (cause) {
      setError(t("pluginPanel.deleteFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusyAction(null);
    }
  }, [api, feedback, reload, t]);

  const inMarket = view === "market";
  const marketToggleLabel = inMarket ? t("pluginPanel.market.back") : t("pluginPanel.market.toggle");

  return (
    <div className="plugin-panel">
      <header className="plugin-panel__header">
        <div className="plugin-panel__heading">
          <img className="plugin-panel__heading-icon" src={pluginIconUrl} alt="" />
          <h1 className="plugin-panel__title">{inMarket ? t("pluginPanel.market.title") : t("pluginPanel.title")}</h1>
          <p className="plugin-panel__subtitle">{inMarket ? t("pluginPanel.market.subtitle") : t("pluginPanel.subtitle")}</p>
        </div>
        <div className="plugin-panel__header-actions">
          <button
            type="button"
            className={`plugin-panel__icon-button plugin-panel__market-toggle${inMarket ? " is-accent" : ""}`}
            onClick={() => setView(inMarket ? "installed" : "market")}
            disabled={!api}
            aria-label={marketToggleLabel}
            title={marketToggleLabel}
          >
            <img className="plugin-panel__market-icon" src={pluginIconUrl} alt="" />
            <span className="plugin-panel__market-toggle-label">{marketToggleLabel}</span>
          </button>
          <button
            type="button"
            className="plugin-panel__icon-button"
            onClick={() => void refreshPlugins()}
            disabled={!api || headerAction !== null}
            aria-label={t("pluginPanel.refresh")}
            title={t("pluginPanel.refresh")}
          >
            <ReloadOutlined spin={headerAction === "refresh"} />
          </button>
          <button
            type="button"
            className="plugin-panel__icon-button is-accent"
            onClick={() => void importPlugin()}
            disabled={!api || headerAction !== null}
            aria-label={t("pluginPanel.add")}
            title={t("pluginPanel.add")}
          >
            <PlusOutlined />
          </button>
        </div>
      </header>

      {!inMarket && (
        <div className="plugin-panel__search-row">
          <input
            className="plugin-panel__search"
            placeholder={t("pluginPanel.searchPlaceholder")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      )}

      {inMarket ? (
        <>
          <div className="plugin-panel__directory">
            <span className="plugin-panel__directory-label">{t("pluginPanel.market.directoryLabel")}</span>
            <code className="plugin-panel__directory-path">
              {market.directory ?? t("common.loading")}
            </code>
          </div>
          {market.phase === "loading" ? (
            <div className="plugin-panel__loading">{t("common.loading")}</div>
          ) : market.phase === "error" ? (
            <div className="plugin-panel__empty">
              {t("pluginPanel.market.loadFailed", { error: market.error ?? t("pluginPanel.unknownError") })}
            </div>
          ) : market.plugins.length === 0 ? (
            <div className="plugin-panel__empty">{t("pluginPanel.market.emptyHint")}</div>
          ) : (
            <div className="plugin-panel__grid">
              {market.plugins.map((entry) => (
                <Card as="article" className="plugin-card-ui" key={entry.id}>
                  <div className="plugin-card-ui__main">
                    <span className="plugin-card-ui__icon" aria-hidden="true">
                      <img src={pluginIconUrl} alt="" />
                    </span>
                    <div className="plugin-card-ui__body">
                      <div className="plugin-card-ui__name-row">
                        <strong className="plugin-card-ui__name">{entry.name}</strong>
                        <span className="plugin-card-ui__version">v{entry.version}</span>
                        <span className="plugin-card-ui__status">{t("pluginPanel.market.localBadge")}</span>
                      </div>
                      <p className="plugin-card-ui__description" title={entry.description}>{entry.description}</p>
                      <p className="plugin-card-ui__developer">
                        {t("pluginPanel.developer", { author: entry.author.trim() || t("pluginPanel.unknownDeveloper") })}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {(error || overview.issues.length > 0) && (
            <div className="plugin-panel__notices" role="status">
              {error && <div className="plugin-panel__notice is-error">{error}</div>}
              {overview.issues.map((issue, index) => (
                <div className="plugin-panel__notice" key={`${issue.path ?? issue.root}:${index}`}>{issue.message}</div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="plugin-panel__loading">{t("common.loading")}</div>
          ) : (
            <div className="plugin-panel__grid">
              {overview.plugins.length === 0 ? (
                <div className="plugin-panel__empty">{t("pluginPanel.emptyHint")}</div>
              ) : visiblePlugins.map((plugin) => {
                const transitioning = plugin.status === "starting" || plugin.status === "stopping";
                const cardBusy = busyAction?.startsWith(`${plugin.id}:`) === true;
                const canOpen = plugin.status === "running" && plugin.canOpen;
                const canDelete = plugin.source === "user" && !transitioning;
                const toggleText = plugin.status === "failed"
                  ? t("common.retry")
                  : plugin.status === "running"
                    ? t("pluginPanel.disable")
                    : t("pluginPanel.enable");
                return (
                  <Card as="article" className={`plugin-card-ui is-${plugin.status}`} key={plugin.id}>
                    <div className="plugin-card-ui__main">
                      <span className="plugin-card-ui__icon" aria-hidden="true">
                        {plugin.icon
                          ? <img src={plugin.icon} alt="" />
                          : <AppstoreOutlined />}
                      </span>
                      <div className="plugin-card-ui__body">
                        <div className="plugin-card-ui__name-row">
                          <strong className="plugin-card-ui__name">{plugin.name}</strong>
                          <span className="plugin-card-ui__version">v{plugin.version}</span>
                          <span className={`plugin-card-ui__status is-${plugin.status}`}>
                            {t(`pluginPanel.status.${plugin.status}`)}
                          </span>
                        </div>
                        <p className="plugin-card-ui__description" title={plugin.description}>{plugin.description}</p>
                        <p className="plugin-card-ui__developer">
                          {t("pluginPanel.developer", { author: plugin.author.trim() || t("pluginPanel.unknownDeveloper") })}
                        </p>
                        {plugin.error && <p className="plugin-card-ui__error" title={plugin.error}>{plugin.error}</p>}
                      </div>
                    </div>
                    <div className="plugin-card-ui__actions">
                      {plugin.canOpen && (
                        <button
                          type="button"
                          className="plugin-card-ui__button"
                          onClick={() => void openPlugin(plugin)}
                          disabled={!canOpen || cardBusy}
                          title={!canOpen ? t("pluginPanel.openRequiresRunning") : t("pluginPanel.open")}
                        >
                          {t("pluginPanel.open")}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`plugin-card-ui__button${plugin.status === "running" ? " is-enabled" : ""}`}
                        onClick={() => void togglePlugin(plugin)}
                        disabled={transitioning || cardBusy}
                      >
                        {toggleText}
                      </button>
                      <button
                        type="button"
                        className="plugin-card-ui__button is-danger"
                        onClick={() => void deletePlugin(plugin)}
                        disabled={!canDelete || cardBusy}
                        title={plugin.source === "builtin" ? t("pluginPanel.builtinCannotDelete") : t("pluginPanel.delete")}
                      >
                        {t("pluginPanel.delete")}
                      </button>
                    </div>
                  </Card>
                );
              })}
              {overview.plugins.length > 0 && visiblePlugins.length === 0 && (
                <div className="plugin-panel__empty">{t("pluginPanel.noMatch")}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PluginModePanel;

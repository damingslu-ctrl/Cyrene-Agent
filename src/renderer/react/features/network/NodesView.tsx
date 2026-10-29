import { Check, Gauge, Sparkles } from "lucide-react";
import type { NetworkSnapshot, ProxyGroup, ProxyNode } from "../../../../shared/network-types";
import { useTranslation } from "../../i18n";
import { delayTone, nodeStability, sortNodes, type NodeSort } from "./network-view";

interface NodesViewProps {
  snapshot: NetworkSnapshot;
  activeGroup: ProxyGroup | null;
  activeGroupName: string;
  sort: NodeSort;
  onSort: (sort: NodeSort) => void;
  onGroup: (name: string) => void;
  pending: string | null;
  online: boolean;
  onSelect: (node: ProxyNode) => void;
  onTest: () => void;
  onAutoBest: () => void;
}

/** 节点：策略组、排序与逐个切换。 */
export function NodesView({
  snapshot,
  activeGroup,
  activeGroupName,
  sort,
  onSort,
  onGroup,
  pending,
  online,
  onSelect,
  onTest,
  onAutoBest,
}: NodesViewProps) {
  const { t } = useTranslation();
  const sortedNodes = activeGroup ? sortNodes(activeGroup.nodes, sort) : [];

  return (
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
              onClick={() => onSort(mode)}
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
                aria-selected={activeGroupName === group.name}
                className={`net-group ${activeGroupName === group.name ? "is-active" : ""}`}
                onClick={() => onGroup(group.name)}
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
                  <button type="button" className="net-ghost-button" disabled={pending !== null || !online} onClick={onTest}>
                    <Gauge size={14} />{pending === "test" ? t("network.testing") : t("network.test")}
                  </button>
                  <button type="button" className="net-primary-button" disabled={pending !== null || !online} onClick={onAutoBest}>
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
                          onClick={() => onSelect(node)}
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
  );
}

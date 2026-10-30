import { Settings } from "lucide-react";
import { useTranslation } from "../../i18n";
import { NETWORK_TABS, NETWORK_TAB_KEY, type NetworkTab } from "./network-tabs";

interface NetworkTabsProps {
  active: NetworkTab;
  onChange: (tab: NetworkTab) => void;
}

/** 七个正文页签 + 页头齿轮（第八个页签「设置」）。 */
export function NetworkTabs({ active, onChange }: NetworkTabsProps) {
  const { t } = useTranslation();
  const settingsLabel = t(NETWORK_TAB_KEY.settings);
  return (
    <div className="net-tabs" role="tablist" aria-label={t("network.tabsLabel")}>
      {NETWORK_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={`net-tab ${active === tab ? "is-active" : ""}`}
          onClick={() => onChange(tab)}
        >
          {t(NETWORK_TAB_KEY[tab])}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={active === "settings"}
        aria-label={settingsLabel}
        title={settingsLabel}
        className={`net-tab net-tab--icon ${active === "settings" ? "is-active" : ""}`}
        onClick={() => onChange("settings")}
      >
        <Settings size={15} strokeWidth={1.9} />
      </button>
    </div>
  );
}

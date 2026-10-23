import { Network } from "lucide-react";
import { useTranslation } from "../../i18n";

interface NetworkModeButtonProps {
  active?: boolean;
  onClick?: () => void;
}

/** 侧栏「网络」入口：Clash Verge 的流量、订阅与节点都在这里。 */
export function NetworkModeButton({ active = false, onClick }: NetworkModeButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      className={`cy-side-action ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
      title={t("ui.network")}
      aria-pressed={active}
    >
      <span className="cy-side-action-icon">
        <Network size={18} strokeWidth={1.8} />
      </span>
      <span className="cy-side-action-label">{t("ui.network")}</span>
    </button>
  );
}

/** 明细页签共用的小件：按需加载、防抖、加载/错误块与回执条。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { NetworkDetailResult } from "../../../../shared/network-detail-types";
import type { NetworkReason } from "../../../../shared/network-types";
import { useTranslation } from "../../i18n";
import type { NetworkApi } from "./network-tabs";

/**
 * 回执条。`neutral` 只给「按设计没做成、但也不是故障」那一档（内核更新撞上我们自己的进程在跑）：
 * 那一档染绿会让人觉得已经换好了，染红会让他去找一个根本不存在的毛病。
 */
export type Notice = { tone: "ok" | "neutral" | "error"; text: string };

export interface DetailState<T> {
  data: T | null;
  loading: boolean;
  error: NetworkReason | null;
  reload: () => Promise<void>;
  apply: (data: T) => void;
}

/** 首屏加载 + 手动重读；失败只带回原因，不抛异常。 */
export function useDetail<T>(
  api: NetworkApi | undefined,
  load: (client: NetworkApi, force: boolean) => Promise<NetworkDetailResult<T>>,
): DetailState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<NetworkReason | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const aliveRef = useRef(true);

  const run = useCallback(async (force: boolean) => {
    if (!api) {
      setLoading(false);
      setError("unreachable");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await loadRef.current(api, force);
      if (!aliveRef.current) return;
      if (result.ok) setData(result.data);
      else setError(result.reason);
    } catch {
      if (aliveRef.current) setError("unreachable");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    aliveRef.current = true;
    void run(false);
    return () => { aliveRef.current = false; };
  }, [run]);

  const reload = useCallback(() => run(true), [run]);
  const apply = useCallback((next: T) => setData(next), []);
  return { data, loading, error, reload, apply };
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useNotice(): [Notice | null, (notice: Notice | null) => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice];
}

export function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return <div className={`net-notice net-notice--${notice.tone}`} role="status">{notice.text}</div>;
}

export function DetailLoading() {
  const { t } = useTranslation();
  return (
    <div className="net-loading">
      <span className="net-spinner" aria-hidden="true" />
      {t("network.detailLoading")}
    </div>
  );
}

export function DetailError({ reason, onRetry }: { reason: NetworkReason; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="net-view__error" role="alert">
      <p>{t("network.detailError", { reason: t(`network.reason.${reason}`) })}</p>
      <button type="button" className="net-ghost-button" onClick={onRetry}>
        <RefreshCw size={13} />{t("network.detailRetry")}
      </button>
    </div>
  );
}

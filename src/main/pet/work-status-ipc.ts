import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { WorkStatus } from "../../shared/work-status-types";
import type { WorkStatusService } from "./work-status";

/**
 * 工作状态的两条通道（v1.5.0 P3 Task 17）。
 *
 * - GET 只回 `WorkStatus | null`；**不带** VergeSnapshot 里的 statePath（Task 15 的最小面口径）。
 * - UPDATE 只发给宠物窗：`detail` 里可能是用户问句，不该发给插件面板宿主。
 */
export function registerWorkStatusIpc(
  ipc: IpcScope,
  deps: { service: WorkStatusService; sendToPetWindow: (channel: string, payload: unknown) => void },
): () => void {
  ipc.handle(IPC.VERGE_WORK_STATUS_GET, () => {
    const s = deps.service.get();
    return s ? { ...s } satisfies WorkStatus : null;
  });
  const off = deps.service.subscribe((status) => {
    deps.sendToPetWindow(IPC.VERGE_WORK_STATUS_UPDATE, status);
  });
  return () => {
    ipc.removeHandler(IPC.VERGE_WORK_STATUS_GET);
    off();
  };
}

import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { VergeService } from "./verge-service";

export function registerVergeIpc(ipc: IpcScope, service: VergeService): () => void {
  ipc.handle(IPC.VERGE_GET_SNAPSHOT, () => service.getSnapshot());
  // v1.5.0：宠物窗 boot 读形态/档位。只回两个字符串——VergeSnapshot 里有 statePath，
  // 不该发给宠物窗（Task 15 的「最小面」口径）。
  ipc.handle(IPC.VERGE_PROFILE_GET, () => {
    const s = service.getState();
    return { form: s.form, tier: s.tier };
  });
  return () => {
    ipc.removeHandler(IPC.VERGE_GET_SNAPSHOT);
    ipc.removeHandler(IPC.VERGE_PROFILE_GET);
  };
}

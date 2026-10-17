import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { VergeService } from "./verge-service";

export function registerVergeIpc(ipc: IpcScope, service: VergeService): () => void {
  ipc.handle(IPC.VERGE_GET_SNAPSHOT, () => service.getSnapshot());
  return () => ipc.removeHandler(IPC.VERGE_GET_SNAPSHOT);
}

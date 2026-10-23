import { IPC } from "../../shared/ipc-channels";
import {
  isProxyMode,
  reasonOf,
  type NetworkActionResult,
  type NetworkAutoSelectResult,
  type NetworkTestResult,
} from "../../shared/network-types";
import type { IpcScope } from "../application/ipc-scope";
import type { NetworkService } from "./network-service";

export interface NetworkIpcDeps {
  service: NetworkService;
  broadcast: (channel: string, payload: unknown) => void;
}

function isNonEmptyName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function registerNetworkIpc(ipc: IpcScope, deps: NetworkIpcDeps): () => void {
  const { service, broadcast } = deps;
  const unsubscribe = service.subscribe((update) => broadcast(IPC.VERGE_NETWORK_UPDATE, update));

  ipc.handle(IPC.VERGE_NETWORK_GET, () => {
    const snapshot = service.getSnapshot();
    if (snapshot.updatedAt === 0) void service.refresh();
    return snapshot;
  });

  ipc.handle(IPC.VERGE_NETWORK_REFRESH, () => service.refresh());

  ipc.handle(IPC.VERGE_NETWORK_SET_MODE, async (_event, mode: unknown): Promise<NetworkActionResult> => {
    if (!isProxyMode(mode)) {
      return { ok: false, reason: "bad-response", snapshot: service.getSnapshot() };
    }
    try {
      return { ok: true, snapshot: await service.setMode(mode) };
    } catch (error) {
      return { ok: false, reason: reasonOf(error), snapshot: service.getSnapshot() };
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_SELECT_NODE, async (
    _event,
    group: unknown,
    node: unknown,
  ): Promise<NetworkActionResult> => {
    if (!isNonEmptyName(group) || !isNonEmptyName(node)) {
      return { ok: false, reason: "bad-response", snapshot: service.getSnapshot() };
    }
    try {
      return { ok: true, snapshot: await service.selectNode(group, node) };
    } catch (error) {
      return { ok: false, reason: reasonOf(error), snapshot: service.getSnapshot() };
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_TEST_GROUP, async (_event, group: unknown): Promise<NetworkTestResult> => {
    if (!isNonEmptyName(group)) {
      return { ok: false, reason: "bad-response", snapshot: service.getSnapshot() };
    }
    try {
      return { ok: true, delays: await service.testGroup(group), snapshot: service.getSnapshot() };
    } catch (error) {
      return { ok: false, reason: reasonOf(error), snapshot: service.getSnapshot() };
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_AUTO_SELECT, async (_event, group: unknown): Promise<NetworkAutoSelectResult> => {
    if (!isNonEmptyName(group)) {
      return { ok: false, reason: "bad-response", snapshot: service.getSnapshot() };
    }
    try {
      return { ok: true, result: await service.autoSelect(group), snapshot: service.getSnapshot() };
    } catch (error) {
      return { ok: false, reason: reasonOf(error), snapshot: service.getSnapshot() };
    }
  });

  return () => {
    unsubscribe();
    ipc.removeHandler(IPC.VERGE_NETWORK_GET);
    ipc.removeHandler(IPC.VERGE_NETWORK_REFRESH);
    ipc.removeHandler(IPC.VERGE_NETWORK_SET_MODE);
    ipc.removeHandler(IPC.VERGE_NETWORK_SELECT_NODE);
    ipc.removeHandler(IPC.VERGE_NETWORK_TEST_GROUP);
    ipc.removeHandler(IPC.VERGE_NETWORK_AUTO_SELECT);
  };
}

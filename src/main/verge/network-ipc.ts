import { IPC } from "../../shared/ipc-channels";
import {
  errorDetailOf,
  isLogLevel,
  type CoreConfigPatch,
  type NetworkVoidResult,
} from "../../shared/network-detail-types";
import {
  isProxyMode,
  reasonOf,
  type NetworkActionResult,
  type NetworkAutoSelectResult,
  type NetworkTestResult,
} from "../../shared/network-types";
import type { IpcScope } from "../application/ipc-scope";
import { buildConfigPatch } from "./mihomo-client";
import type { NetworkService } from "./network-service";

export interface NetworkIpcDeps {
  service: NetworkService;
  broadcast: (channel: string, payload: unknown) => void;
}

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;

function isNonEmptyName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isConnectionId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

type DetailFailure = { ok: false; reason: ReturnType<typeof reasonOf>; detail?: string };

/** 失败回执：reason 是给用户看的分类，detail 是内核原话——没有就别硬凑一个空字段。 */
function detailFailure(error: unknown): DetailFailure {
  const detail = errorDetailOf(error);
  return detail ? { ok: false, reason: reasonOf(error), detail } : { ok: false, reason: reasonOf(error) };
}

export function registerNetworkIpc(ipc: IpcScope, deps: NetworkIpcDeps): () => void {
  const { service, broadcast } = deps;
  const unsubscribe = service.subscribe((update) => broadcast(IPC.VERGE_NETWORK_UPDATE, update));
  const unsubscribeLogs = service.subscribeLogs((entry) => broadcast(IPC.VERGE_NETWORK_LOG, entry));

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

  ipc.handle(IPC.VERGE_NETWORK_RULES, async (_event, force: unknown) => {
    try {
      return { ok: true as const, data: await service.fetchRules(force === true) };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_CONNECTIONS, async () => {
    try {
      return { ok: true as const, data: await service.fetchConnections() };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_CLOSE_CONNECTION, async (
    _event,
    id: unknown,
  ): Promise<NetworkVoidResult> => {
    if (!isConnectionId(id)) return { ok: false, reason: "bad-response" };
    try {
      await service.closeConnection(id);
      return { ok: true };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_CLOSE_ALL_CONNECTIONS, async (): Promise<NetworkVoidResult> => {
    try {
      await service.closeAllConnections();
      return { ok: true };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_PROVIDERS, async (_event, force: unknown) => {
    try {
      return { ok: true as const, data: await service.fetchProviders(force === true) };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_PROVIDER_CHECK, async (_event, name: unknown) => {
    if (!isNonEmptyName(name)) return { ok: false, reason: "bad-response" };
    try {
      return { ok: true as const, data: await service.providerCheck(name) };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_CONFIG_GET, async () => {
    try {
      return { ok: true as const, data: await service.fetchConfig() };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_CONFIG_SET, async (_event, patch: unknown) => {
    // 白名单在进服务之前就过一遍：坏键绝不落到内核那次 PATCH 上。
    try {
      buildConfigPatch(patch);
    } catch (error) {
      return detailFailure(error);
    }
    try {
      return { ok: true as const, data: await service.saveConfig(patch as CoreConfigPatch) };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_LOGS_START, async (_event, level: unknown): Promise<NetworkVoidResult> => {
    if (level !== undefined && !isLogLevel(level)) return { ok: false, reason: "bad-response" };
    try {
      await service.startLogs(level ?? "info");
      return { ok: true };
    } catch (error) {
      return detailFailure(error);
    }
  });

  ipc.handle(IPC.VERGE_NETWORK_LOGS_STOP, (): NetworkVoidResult => {
    service.stopLogs();
    return { ok: true };
  });

  ipc.handle(IPC.VERGE_NETWORK_LOGS_GET, () => ({ ok: true as const, data: service.getLogs() }));

  return () => {
    unsubscribe();
    unsubscribeLogs();
    ipc.removeHandler(IPC.VERGE_NETWORK_GET);
    ipc.removeHandler(IPC.VERGE_NETWORK_REFRESH);
    ipc.removeHandler(IPC.VERGE_NETWORK_SET_MODE);
    ipc.removeHandler(IPC.VERGE_NETWORK_SELECT_NODE);
    ipc.removeHandler(IPC.VERGE_NETWORK_TEST_GROUP);
    ipc.removeHandler(IPC.VERGE_NETWORK_AUTO_SELECT);
    ipc.removeHandler(IPC.VERGE_NETWORK_RULES);
    ipc.removeHandler(IPC.VERGE_NETWORK_CONNECTIONS);
    ipc.removeHandler(IPC.VERGE_NETWORK_CLOSE_CONNECTION);
    ipc.removeHandler(IPC.VERGE_NETWORK_CLOSE_ALL_CONNECTIONS);
    ipc.removeHandler(IPC.VERGE_NETWORK_PROVIDERS);
    ipc.removeHandler(IPC.VERGE_NETWORK_PROVIDER_CHECK);
    ipc.removeHandler(IPC.VERGE_NETWORK_CONFIG_GET);
    ipc.removeHandler(IPC.VERGE_NETWORK_CONFIG_SET);
    ipc.removeHandler(IPC.VERGE_NETWORK_LOGS_START);
    ipc.removeHandler(IPC.VERGE_NETWORK_LOGS_STOP);
    ipc.removeHandler(IPC.VERGE_NETWORK_LOGS_GET);
  };
}

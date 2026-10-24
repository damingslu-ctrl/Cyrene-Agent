/**
 * 主进程 IPC 注册 Scope：统一登记 handle/on 注册并在 dispose() 时整体注销。
 * - 同一 scope 内重复注册同一 channel 直接报错，避免重复注册污染。
 * - dispose() 幂等，按注册的逆序移除（仅为注销顺序，与退出清理阶段无关）。
 */

import { ipcMain } from "electron";
import { windowKindOf, type WindowKind } from "./window-kind";

export interface IpcScope {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
  on(channel: string, listener: (...args: any[]) => void): void;
  dispose(): void;
}

export interface IpcScopeMainLike {
  handle(channel: string, listener: (...args: any[]) => unknown): unknown;
  on(channel: string, listener: (...args: any[]) => void): unknown;
  removeHandler(channel: string): unknown;
  removeListener(channel: string, listener: (...args: any[]) => void): unknown;
}

type TrackedRegistration =
  | { kind: "handle"; channel: string; listener: (...args: any[]) => unknown }
  | { kind: "on"; channel: string; listener: (...args: any[]) => void };

export interface IpcScopeOptions {
  senderPolicy?: Readonly<Record<string, readonly WindowKind[]>>;
  classify?: (webContentsId: number) => WindowKind;
}

/**
 * 发送方闸门：**只对表里列出的通道生效**。表外通道照旧（328 处调用点零改动）。
 * 判据是 sender 的 webContents.id，不是 URL（dev/prod 的 URL 都分不出窗口）。
 *
 * 默认**不过闸**：只有生产组合根显式传 `senderPolicy` 才启用。理由是单测与
 * 纯函数级 fixture 里没有真实 sender，默认开闸会把「没登记窗口类别」误判成攻击。
 */
function makeSenderGate(options: IpcScopeOptions): ((channel: string, event: unknown) => void) | null {
  const policy = options.senderPolicy;
  if (!policy) return null;
  const classify = options.classify ?? windowKindOf;
  return (channel, event) => {
    const allowed = policy[channel];
    if (!allowed) return;
    const sender = (event as { sender?: { id?: number } } | null)?.sender;
    const id = sender?.id;
    const kind = typeof id === "number" ? classify(id) : "unknown";
    if (!allowed.includes(kind)) {
      throw new Error(`IPC sender denied: channel=${channel} kind=${kind}`);
    }
  };
}

export function createIpcScope(
  main: IpcScopeMainLike = ipcMain as IpcScopeMainLike,
  options: IpcScopeOptions = {},
): IpcScope {
  const registrations: TrackedRegistration[] = [];
  const handledChannels = new Set<string>();
  const gate = makeSenderGate(options);
  let disposed = false;

  function assertActive(): void {
    if (disposed) {
      throw new Error("IPC scope already disposed");
    }
  }

  return {
    handle(channel, listener) {
      assertActive();
      // 没配 policy ＝ 零包装：listener 原样转发（既有单测与 328 处调用点的形状都不变）。
      const gated: typeof listener = gate
        ? (event, ...args) => {
            gate(channel, event);
            return listener(event, ...args);
          }
        : listener;
      if (handledChannels.has(channel)) {
        throw new Error(`IPC channel already registered: ${channel}`);
      }
      handledChannels.add(channel);
      registrations.push({ kind: "handle", channel, listener: gated });
      main.handle(channel, gated);
    },

    removeHandler(channel) {
      assertActive();
      if (!handledChannels.delete(channel)) return;
      const index = registrations.findIndex(
        (registration) => registration.kind === "handle" && registration.channel === channel,
      );
      if (index >= 0) registrations.splice(index, 1);
      main.removeHandler(channel);
    },

    on(channel, listener) {
      assertActive();
      const gated: typeof listener = gate
        ? (event, ...args) => {
            gate(channel, event);
            listener(event, ...args);
          }
        : listener;
      registrations.push({ kind: "on", channel, listener: gated });
      main.on(channel, gated);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // 逆序移除：后注册的先注销，保持与注册路径一致的对称性。
      for (const registration of registrations.reverse()) {
        try {
          if (registration.kind === "handle") main.removeHandler(registration.channel);
          else main.removeListener(registration.channel, registration.listener);
        } catch (error) {
          console.error(`[IpcScope] dispose failed for ${registration.kind} ${registration.channel}:`, error);
        }
      }
      registrations.length = 0;
      handledChannels.clear();
    },
  };
}

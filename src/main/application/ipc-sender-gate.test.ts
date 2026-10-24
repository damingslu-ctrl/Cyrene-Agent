import { describe, expect, it, vi } from "vitest";
import { createIpcScope, type IpcScopeMainLike } from "./ipc-scope";
import { IPC } from "../../shared/ipc-channels";

function makeMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ons = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  const main: IpcScopeMainLike = {
    handle: (channel, listener) => { handlers.set(channel, listener); },
    on: (channel, listener) => { ons.set(channel, listener); },
    removeHandler: (channel) => { handlers.delete(channel); },
    removeListener: (channel, listener) => { void channel; void listener; },
  };
  return { main, handlers, ons };
}

describe("IPC 发送方闸门（R-D11）", () => {
  it("列出的通道只放行声明的类别：pet 通道被 chat 调时抛", () => {
    const { main, handlers } = makeMain();
    const scope = createIpcScope(main, {
      senderPolicy: { [IPC.VERGE_IS_QUIET]: ["pet"] },
      classify: (id) => (id === 7 ? "pet" : "chat"),
    });
    scope.handle(IPC.VERGE_IS_QUIET, () => "ok");
    const handler = handlers.get(IPC.VERGE_IS_QUIET)!;
    expect(handler({ sender: { id: 7 } })).toBe("ok");
    expect(() => handler({ sender: { id: 9 } })).toThrow(/IPC sender denied/);
  });

  it("on 注册的通道同样过闸", () => {
    const { main, ons } = makeMain();
    const scope = createIpcScope(main, {
      senderPolicy: { [IPC.VERGE_PET_RESIZE]: ["pet"] },
      classify: () => "chat",
    });
    const listener = vi.fn();
    scope.on(IPC.VERGE_PET_RESIZE, listener);
    const registered = ons.get(IPC.VERGE_PET_RESIZE)!;
    expect(() => registered({ sender: { id: 1 } })).toThrow(/denied/);
    expect(listener).not.toHaveBeenCalled();
  });

  it("表外通道零改动（328 处老调用点照旧）", () => {
    const { main, handlers } = makeMain();
    const scope = createIpcScope(main, { senderPolicy: {}, classify: () => "unknown" });
    scope.handle("some:legacy", () => "legacy-ok");
    expect(handlers.get("some:legacy")!({ sender: { id: 42 } })).toBe("legacy-ok");
  });

  it("无 sender 的事件按 unknown 判：pet 通道拒绝，表外通道放行", () => {
    const { main, handlers } = makeMain();
    const scope = createIpcScope(main, {
      senderPolicy: { [IPC.VERGE_IS_QUIET]: ["pet"] },
      classify: () => "unknown",
    });
    scope.handle(IPC.VERGE_IS_QUIET, () => 1);
    expect(() => handlers.get(IPC.VERGE_IS_QUIET)!({})).toThrow(/denied/);
  });
});

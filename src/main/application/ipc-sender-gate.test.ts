import { describe, expect, it, vi } from "vitest";
import { createIpcScope, type IpcScopeMainLike } from "./ipc-scope";
import { IPC } from "../../shared/ipc-channels";
import { IPC_SENDER_POLICY } from "./ipc-sender-policy";
import { __resetWindowKindsForTest, markWebContents, windowKindOf } from "./window-kind";

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

describe("窗口类别登记簿（R-D11 的真实接线）", () => {
  it("未登记 → unknown（闸门因此会拒），登记后 → 登记的类别，销毁后 → 回到 unknown", () => {
    __resetWindowKindsForTest();
    expect(windowKindOf(42)).toBe("unknown");
    markWebContents(42, "pet");
    expect(windowKindOf(42)).toBe("pet");
    // forget 的入参是「销毁前读到的 id」——create-pet-window 里 closed 回调就是这么用的
    markWebContents(43, "chat");
    expect(windowKindOf(43)).toBe("chat");
    __resetWindowKindsForTest();
    expect(windowKindOf(42)).toBe("unknown");
  });

  /**
   * 这条锁是 2026-10-24 那次事故的直接后代：`markWebContents` 写好了但**没有任何调用方**，
   * 于是宠物窗永远是 unknown，`VERGE_PROFILE_GET`（policy 只放行 pet）被闸门拒绝，
   * 渲染端 `.catch()` 咽掉异常，v1.5.0 的猫娘在所有装机上都看不见。
   * 判据不是「函数存在」，而是「宠物窗那条创建路径上真的调了它」——
   * 用源码扫描钉住（引入真实 Electron 才能动态验，代价不值）。
   */
  it("create-pet-window 的创建路径里必须登记 pet 类别（防再次只定义不接线）", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../startup/create-pet-window.ts", import.meta.url), "utf8");
    expect(src, "create-pet-window.ts 没调用 markWebContents").toMatch(/markWebContents\s*\(/);
    expect(src, "登记时必须标成 pet").toMatch(/markWebContents\([^)]*"pet"/);
    expect(src, "窗口销毁时要 forget，否则 id 复用会串类别").toMatch(/forgetWebContents\s*\(/);
  });

  it("policy 表里的每条 pet 通道都真的在渲染端有调用方（死行比没表更糟）", () => {
    // 只对 pet 侧做：chat 侧的调用方分布在多处，这条锁只负责「猫窗那半边」。
    // 名单来自渲染端实际 invoke 的通道，改任何一边都要同时改另一边的这份名单。
    const petChannels = Object.entries(IPC_SENDER_POLICY)
      .filter(([, kinds]) => kinds.includes("pet"))
      .map(([channel]) => channel)
      .sort();
    expect(petChannels).toEqual([
      IPC.VERGE_GET_PET_GEOMETRY, IPC.VERGE_IS_QUIET, IPC.VERGE_PET_POSITION_SETTLED,
      IPC.VERGE_PET_RESIZE, IPC.VERGE_PROFILE_GET, IPC.VERGE_TUCK_HINTED,
    ].sort());
  });
});

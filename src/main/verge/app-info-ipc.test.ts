import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { registerAppInfoIpc } from "./app-info-ipc";

function buildScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipc: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
}

describe("本机版本信息 IPC", () => {
  it("只登记 get-app-info 一条通道，且回执标成本机构建", () => {
    const scope = buildScope();
    const dispose = registerAppInfoIpc(scope.ipc as never, {
      getName: () => "Mochi",
      getVersion: () => "1.3.3",
      dataDirName: () => "Mochi",
    });
    expect([...scope.handlers.keys()]).toEqual([IPC.VERGE_GET_APP_INFO]);
    expect(scope.handlers.get(IPC.VERGE_GET_APP_INFO)!()).toEqual({
      name: "Mochi", nameZh: "麻糬", version: "1.3.3", buildChannel: "local", dataDirName: "Mochi",
    });
    dispose();
    expect(scope.handlers.size).toBe(0);
  });
});

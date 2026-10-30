/**
 * Wave 3 T10b 内核通道的薄层测试：假 IpcScope + 假 CoreAssembly。
 *
 * 这里最值钱的一条判据是**顺序**：`manager.start()` 会回一份「动作之前」的账（故意的，
 * 真实现也真会回中途态），处理器必须等它回来之后再取一次 `status()`。
 * 拿 await 的值回执，页面就会对着已经起来的内核画「已停止」——这类错在真机上
 * 只是「刷新一下才对上」，单测里不钉住就一路绿灯。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_CORE_STATUS,
  MAX_SELF_HEAL,
  type CoreSecretSource,
  type CoreStatus,
} from "../../shared/core-types";
import { IPC } from "../../shared/ipc-channels";
import { IPC_SENDER_POLICY } from "../application/ipc-sender-policy";
import type { IpcScope } from "../application/ipc-scope";
import type { CoreAssembly } from "./core-bootstrap";
import { registerCoreIpc } from "./core-ipc";

function makeScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const registered: string[] = [];
  const scope = {
    handlers,
    registered,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, listener);
      registered.push(channel);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

const RUNNING: Partial<CoreStatus> = {
  state: "running",
  mode: "installed",
  pid: 4321,
  ports: { mixed: 17890, controller: 17891 },
  controller: "http://127.0.0.1:17891",
  startedAt: 1_732_000_000_000,
};

interface AssemblyInput {
  /** 动作之前账上的态。 */
  before?: Partial<CoreStatus>;
  /** 动作之后账上应该变成什么——`manager` 那三个方法各自都会落到这一份。 */
  after?: Partial<CoreStatus>;
  startThrows?: string;
  stopThrows?: string;
  restartThrows?: string;
  secretSource?: CoreSecretSource;
}

function makeAssembly(input: AssemblyInput = {}) {
  let current: CoreStatus = { ...EMPTY_CORE_STATUS, ...input.before };
  /** 谁动了账、按什么顺序——判据全靠它，不靠调用次数猜顺序。 */
  const seq: string[] = [];
  const run = (name: string, throws?: string) => async (): Promise<CoreStatus> => {
    seq.push(name);
    if (throws) throw new Error(throws);
    // 回的是「动作之前」那一份：真实现里这就是 starting／stopped 之类的中途态。
    const stale = current;
    // 落账按 settle 的口径只覆盖给出的键：否则闸门刚归零的 healAttempts 会被
    // 这一份假账整个替换掉，测出来的就是假子而不是产品行为。
    current = { ...current, ...input.after };
    return stale;
  };
  const manager = {
    start: vi.fn(run("start", input.startThrows)),
    stop: vi.fn(run("stop", input.stopThrows)),
    restart: vi.fn(run("restart", input.restartThrows)),
    status: vi.fn(() => current),
    resetHealBudget: vi.fn(() => {
      seq.push("reset");
      current = { ...current, healAttempts: 0 };
    }),
  };
  const assembly = {
    manager,
    status: vi.fn(() => {
      seq.push("read");
      return current;
    }),
    controllerOverride: vi.fn(() => null),
    secretSource: vi.fn(() => input.secretSource ?? "mochi"),
    runtimeFile: vi.fn(() => null),
    logFile: vi.fn(() => String.raw`C:\Users\mochi\AppData\Roaming\Mochi\core.log`),
    coreDir: vi.fn(() => String.raw`C:\Users\mochi\AppData\Roaming\Mochi\core`),
  };
  return {
    assembly: assembly as unknown as CoreAssembly & typeof assembly,
    manager,
    seq,
    settle: (next: CoreStatus) => {
      current = next;
    },
  };
}

function setup(input: AssemblyInput = {}) {
  const scope = makeScope();
  const fake = makeAssembly(input);
  const dispose = registerCoreIpc(scope, fake.assembly);
  return { scope, dispose, ...fake };
}

describe("registerCoreIpc：注册与形状", () => {
  it("四条通道按序注册，STATUS 那一档只读账、一次进程动作都不发起", async () => {
    const { scope, manager, seq } = setup();
    expect(scope.registered).toEqual([
      IPC.VERGE_CORE_STATUS,
      IPC.VERGE_CORE_START,
      IPC.VERGE_CORE_STOP,
      IPC.VERGE_CORE_RESTART,
    ]);
    const read = scope.handlers.get(IPC.VERGE_CORE_STATUS)!;
    await read({});
    expect(seq).toEqual(["read"]);
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.stop).not.toHaveBeenCalled();
    expect(manager.restart).not.toHaveBeenCalled();
  });

  it("四条通道回同一份形状：status 与 secretSource 一起走，页面不必自己拼", async () => {
    const { scope } = setup({ before: RUNNING, secretSource: "verge" });
    const shape = {
      status: { ...EMPTY_CORE_STATUS, ...RUNNING },
      secretSource: "verge" as CoreSecretSource,
    };
    for (const channel of scope.registered) {
      const handler = scope.handlers.get(channel)!;
      expect(await handler({})).toEqual(shape);
    }
  });

  it("每次现取账：两次 STATUS 之间内核崩了，第二份回执得跟着改", async () => {
    const { scope, settle } = setup({ before: RUNNING });
    const read = scope.handlers.get(IPC.VERGE_CORE_STATUS)!;
    const first = (await read({})) as { status: CoreStatus };
    settle({ ...EMPTY_CORE_STATUS, mode: "installed", reason: "exited", detail: "exit=1" });
    const second = (await read({})) as { status: CoreStatus };
    expect(first.status.state).toBe("running");
    expect(second.status).toMatchObject({ state: "stopped", reason: "exited", detail: "exit=1" });
  });

  it("渲染端塞进来的参数一个都不往 manager 传", async () => {
    const { scope, manager } = setup();
    const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
    await start({}, { state: "running", exePath: "..\\..\\x.exe" }, "installed");
    expect(manager.start).toHaveBeenCalledWith();
  });
});

describe("registerCoreIpc：回执取的是动作之后那份账", () => {
  it.each([
    // start 前面那次 read 是预算闸门（见下一组），不是回执；stop/restart 不读闸门。
    ["start", IPC.VERGE_CORE_START, RUNNING, ["read", "start", "read"]],
    ["stop", IPC.VERGE_CORE_STOP, { state: "stopped" as const }, ["stop", "read"]],
    ["restart", IPC.VERGE_CORE_RESTART, RUNNING, ["restart", "read"]],
  ] as const)("%s 的尾序必须是动作→读账，回执不是 await 回来的那一份", async (name, channel, after, expected) => {
    const { scope, seq } = setup({ before: { state: "exited", reason: "not-ready" }, after });
    const handler = scope.handlers.get(channel)!;
    const view = (await handler({})) as { status: CoreStatus };
    expect(seq).toEqual(expected);
    // manager 回的是动作之前的 exited＋not-ready；这里读到的是动作之后的态，才证明是重新取的。
    expect(view.status.state).toBe(after.state);
  });

  it("内核没起来时如实回 exited＋原因，不演成 running", async () => {
    const { scope } = setup({
      before: { state: "blocked" },
      after: { state: "exited", mode: "installed", reason: "not-ready", detail: "控制器不应答" },
    });
    const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
    const view = (await start({})) as { status: CoreStatus };
    expect(view.status).toMatchObject({ state: "exited", reason: "not-ready", pid: null });
  });
});

describe("registerCoreIpc：手动「起」与自愈预算", () => {
  it("预算打满后手动点起＝新一轮意图，先归零再起，页面不再对着新内核报 3 次", async () => {
    const { scope, manager, seq } = setup({
      before: { state: "exited", mode: "installed", reason: "self-heal-exhausted", healAttempts: MAX_SELF_HEAL },
      after: RUNNING,
    });
    const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
    const view = (await start({})) as { status: CoreStatus };
    // 闸门读账排在归零之前、归零排在起之前：起完之后再读一次才是回执那份账。
    expect(seq).toEqual(["read", "reset", "start", "read"]);
    expect(manager.resetHealBudget).toHaveBeenCalledOnce();
    expect(view.status.healAttempts).toBe(0);
  });

  it("别的原因不动预算：只有 self-heal-exhausted 这一档才是「人工再试一次」", async () => {
    for (const reason of ["no-binary", "not-ready", "verge-running"] as const) {
      const { scope, manager, seq } = setup({ before: { state: "blocked", reason } });
      const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
      await start({});
      expect(manager.resetHealBudget).not.toHaveBeenCalled();
      expect(seq).toEqual(["read", "start", "read"]);
    }
  });

  it("起抛错时归零照旧发生，但不补回执：seq 停在动作上，没有读账", async () => {
    // 归零排在起之前——这一档不做「起成功才归零」，因为抛错那一次连账都没法更新，
    // 预算留在 0 还是 3 对下一次点击没有差别（手动点一次本就是一次新意图）。
    const { scope, manager, seq } = setup({
      before: { state: "exited", mode: "installed", reason: "self-heal-exhausted", healAttempts: MAX_SELF_HEAL },
      startThrows: "spawn EPERM",
    });
    const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
    await expect(start({})).rejects.toThrow(/EPERM/);
    expect(seq).toEqual(["read", "reset", "start"]);
    expect(manager.resetHealBudget).toHaveBeenCalledOnce();
    expect(manager.start).toHaveBeenCalledOnce();
  });
});

describe("registerCoreIpc：不吞异常", () => {
  it.each([
    ["start", IPC.VERGE_CORE_START, "startThrows", ["read", "start"]],
    ["stop", IPC.VERGE_CORE_STOP, "stopThrows", ["stop"]],
    ["restart", IPC.VERGE_CORE_RESTART, "restartThrows", ["restart"]],
  ] as const)("%s 抛了就让它出去，不折成一份 stopped 回执", async (name, channel, key, expected) => {
    const { scope, seq } = setup({ [key]: `EROFS: ${name}` } as AssemblyInput);
    const handler = scope.handlers.get(channel)!;
    await expect(handler({})).rejects.toThrow(new RegExp(`EROFS: ${name}`));
    // 抛错那次不许顺手读账：读了就会把「没做完」画成一份看起来完整的现状。
    expect(seq).toEqual(expected);
  });

  it("一次动作抛错之后，STATUS 照旧能读——通道没有被异常拆掉", async () => {
    const { scope } = setup({ startThrows: "EROFS: 只读盘" });
    const start = scope.handlers.get(IPC.VERGE_CORE_START)!;
    await expect(start({})).rejects.toThrow(/EROFS/);
    const read = scope.handlers.get(IPC.VERGE_CORE_STATUS)!;
    expect((await read({})) as unknown).toMatchObject({ secretSource: "mochi" });
  });
});

describe("registerCoreIpc：dispose", () => {
  it("摘的正是那四条，摘完 STATUS 也不再答话", () => {
    const { scope, dispose } = setup();
    dispose();
    for (const channel of [
      IPC.VERGE_CORE_STATUS,
      IPC.VERGE_CORE_START,
      IPC.VERGE_CORE_STOP,
      IPC.VERGE_CORE_RESTART,
    ]) {
      expect(scope.removeHandler).toHaveBeenCalledWith(channel);
    }
    expect(scope.removeHandler).toHaveBeenCalledTimes(4);
    expect(scope.handlers.size).toBe(0);
  });
});

/**
 * Wave 3 T10b 的端到端接线锁。
 *
 * 2026-10-24 那次的事故形状是「模块写好了、单测全绿、真机上是死的」，所以这里钉的不是
 * 「函数存在」，而是「那四条通道从装配层一路走到卡片的那只手」。用源码扫描而不是真起一个
 * Electron：动态验要真窗，而真窗那一条正压在「用户退出 Clash Verge」上，不能当日常门禁。
 * 代价是改任何一边都要同时改这里；收益是漏接一次立刻红。
 */
describe("内核宿主四条通道端到端接线（防只定义不接线）", () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
  const preload = read("../../preload/index.ts");
  const bridge = read("../../renderer/types/cyrene.d.ts");
  const mainApp = read("../application/default-dependencies.ts");
  const panel = read("../../renderer/react/features/network/NetworkPanel.tsx");
  const card = read("../../renderer/react/features/network/CoreSection.tsx");

  it("装配层既真的注册、也真的在退出时摘掉那四条", () => {
    expect(mainApp).toMatch(/registerCoreHostIpc\(ipc, services\.core\)/);
    expect(mainApp).toMatch(/id: "verge-core-ipc"[\s\S]{0,220}removeCoreHostIpc\(\)/);
  });

  it("preload 四条各自 invoke 对应常量，且一个参数都不递", () => {
    const pairs = [
      ["status", "STATUS"],
      ["start", "START"],
      ["stop", "STOP"],
      ["restart", "RESTART"],
    ] as const;
    for (const [method, channel] of pairs) {
      expect(preload, `preload.core.${method} 没接上 VERGE_CORE_${channel}`).toMatch(
        new RegExp(`${method}: \\(\\) => ipcRenderer\\.invoke\\(IPC\\.VERGE_CORE_${channel}\\)`),
      );
    }
    // 递一个参数就等于把「起哪颗内核、吃哪份配置」的决定权交回渲染端。
    expect(preload).not.toMatch(/invoke\(IPC\.VERGE_CORE_\w+,\s*\S/);
  });

  it("桥接类型收下四条，回的都是同一份 CoreView", () => {
    for (const method of ["status", "start", "stop", "restart"]) {
      expect(bridge, `cyrene.d.ts 的 core.${method} 变了形状`).toMatch(
        new RegExp(`${method}\\(\\):\\s*Promise<[^>]*CoreView>`),
      );
    }
  });

  it("设置页把桥递进卡片，卡片调用时不带参数", () => {
    expect(panel).toMatch(/window\.verge\?\.core/);
    expect(panel).toMatch(/<CoreSection api=\{coreApi\} \/>/);
    // 顺序也是契约：读内核控制面那两张，排在内核宿主之后。
    expect(panel.indexOf("<CoreSection")).toBeLessThan(panel.indexOf("<SettingsView"));
    expect(panel.indexOf("<SettingsView")).toBeLessThan(panel.indexOf("<VergeSettingsSection"));
    expect(card).toMatch(/await api\.status\(\)/);
    expect(card).toMatch(/await api\[action\]\(\)/);
  });

  it("四条都只归主窗：宠物窗拿到通道也没有替全机起内核的资格", () => {
    for (const channel of [
      IPC.VERGE_CORE_STATUS,
      IPC.VERGE_CORE_START,
      IPC.VERGE_CORE_STOP,
      IPC.VERGE_CORE_RESTART,
    ]) {
      expect(IPC_SENDER_POLICY[channel], channel).toEqual(["chat"]);
    }
  });
});

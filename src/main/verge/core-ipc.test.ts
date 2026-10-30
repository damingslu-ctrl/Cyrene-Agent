/**
 * Wave 3 T10b/T11 内核通道的薄层测试：假 IpcScope + 假 CoreAssembly。
 *
 * 这里最值钱的一条判据是**顺序**：`manager.start()` 会回一份「动作之前」的账（故意的，
 * 真实现也真会回中途态），处理器必须等它回来之后再取一次 `status()`。
 * 拿 await 的值回执，页面就会对着已经起来的内核画「已停止」——这类错在真机上
 * 只是「刷新一下才对上」，单测里不钉住就一路绿灯。
 *
 * T11 在这把尺上多加一条同形的判据：`updateCore()` 回的那一份也不算回执，
 * 回执还是动作之后那一次读账——而且那一次读账必须同时带上进程态与更新态，
 * 页面才不需要问两次再自己猜哪一次更新对应哪一次起停。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_CORE_STATUS,
  MAX_SELF_HEAL,
  type CoreSecretSource,
  type CoreStatus,
  type CoreUpdateState,
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

/** 假装配层里 `updateCore()` 落下的那一份账——测试里两处要比对的都指向它。 */
const UPDATE_SETTLED: CoreUpdateState = {
  outcome: "installed",
  tag: "v1.19.33",
  asset: "mihomo-windows-amd64-v1.19.33.zip",
  reason: null,
  detail: null,
  at: 1_732_000_050_000,
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
  /** 更新这一本账：null 表示这一班还没试过更新。 */
  update?: CoreUpdateState | null;
  updateThrows?: string;
}

function makeAssembly(input: AssemblyInput = {}) {
  let current: CoreStatus = { ...EMPTY_CORE_STATUS, ...input.before };
  let updateState: CoreUpdateState | null = input.update ?? null;
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
    updateCore: vi.fn(async (): Promise<CoreUpdateState> => {
      seq.push("update");
      if (input.updateThrows) throw new Error(input.updateThrows);
      // 与 manager 那三个同一个口径：动作返回的不是回执，回执在之后那次读账里。
      updateState = UPDATE_SETTLED;
      return UPDATE_SETTLED;
    }),
    updateState: vi.fn(() => updateState),
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

const CORE_CHANNELS = [
  IPC.VERGE_CORE_STATUS,
  IPC.VERGE_CORE_START,
  IPC.VERGE_CORE_STOP,
  IPC.VERGE_CORE_RESTART,
  IPC.VERGE_CORE_UPDATE,
] as const;

describe("registerCoreIpc：注册与形状", () => {
  it("五条通道按序注册，STATUS 那一档只读账、一次进程动作都不发起", async () => {
    const { scope, manager, seq } = setup();
    expect(scope.registered).toEqual([...CORE_CHANNELS]);
    const read = scope.handlers.get(IPC.VERGE_CORE_STATUS)!;
    await read({});
    expect(seq).toEqual(["read"]);
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.stop).not.toHaveBeenCalled();
    expect(manager.restart).not.toHaveBeenCalled();
  });

  it("五条通道回同一份形状：status、secretSource 与 update 一起走，页面不必自己拼", async () => {
    const { scope } = setup({ before: RUNNING, secretSource: "verge" });
    const base = {
      status: { ...EMPTY_CORE_STATUS, ...RUNNING },
      secretSource: "verge" as CoreSecretSource,
    };
    for (const channel of scope.registered) {
      const handler = scope.handlers.get(channel)!;
      const view = await handler({});
      // 形状一致才是「一把尺量五种动作」：缺一个键页面就得自己猜那次点击归哪本账。
      expect(Object.keys(view as object).sort(), channel).toEqual(["secretSource", "status", "update"]);
      // 只有「更新」那一条会落更新账；起停与读现状不许替更新编一份没发生过的记录。
      expect(view, channel).toEqual({
        ...base,
        update: channel === IPC.VERGE_CORE_UPDATE ? UPDATE_SETTLED : null,
      });
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

  /** 渲染端递进来的版本号／下载地址同样没有入口——不然更新通道就成了任意写文件的通道。 */
  it("更新通道也不收渲染端递进来的参数", async () => {
    const { scope, assembly } = setup();
    const update = scope.handlers.get(IPC.VERGE_CORE_UPDATE)!;
    await update({}, { tag: "v9.9.9", url: "http://例如.com/x.zip" });
    expect(assembly.updateCore).toHaveBeenCalledWith();
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

  /** 内核在跑时点更新：进程态与更新态都得在同一份回执里，页面才不用问两次再自己对齐。 */
  it("更新之后那份账同时带上新下的 update——两本账一次走清", async () => {
    const { scope, seq } = setup({ before: RUNNING });
    const handler = scope.handlers.get(IPC.VERGE_CORE_UPDATE)!;
    const view = (await handler({})) as { status: CoreStatus; update: CoreUpdateState };
    expect(seq).toEqual(["update", "read"]);
    expect(view.status.state).toBe("running");
    expect(view.update).toMatchObject({ outcome: "installed", tag: "v1.19.33" });
  });

  /** 换上文件不等于重起内核：这是设计里最容易被「顺手做点好事」破坏的一条。 */
  it("更新通道一次进程动作都不发起：不 stop、不 restart、也不 start", async () => {
    const { scope, manager } = setup({ before: RUNNING });
    const handler = scope.handlers.get(IPC.VERGE_CORE_UPDATE)!;
    await handler({});
    expect(manager.stop).not.toHaveBeenCalled();
    expect(manager.restart).not.toHaveBeenCalled();
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.resetHealBudget).not.toHaveBeenCalled();
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
    ["update", IPC.VERGE_CORE_UPDATE, "updateThrows", ["update"]],
  ] as const)("%s 抛了就让它出去，不折成一份看起来完整的回执", async (name, channel, key, expected) => {
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
  it("摘的正是那五条，摘完 STATUS 也不再答话", () => {
    const { scope, dispose } = setup();
    dispose();
    for (const channel of CORE_CHANNELS) {
      expect(scope.removeHandler).toHaveBeenCalledWith(channel);
    }
    expect(scope.removeHandler).toHaveBeenCalledTimes(CORE_CHANNELS.length);
    expect(scope.handlers.size).toBe(0);
  });
});

/**
 * Wave 3 T10b/T11 的端到端接线锁。
 *
 * 2026-10-24 那次的事故形状是「模块写好了、单测全绿、真机上是死的」，所以这里钉的不是
 * 「函数存在」，而是「那五条通道从装配层一路走到卡片的那只手」。用源码扫描而不是真起一个
 * Electron：动态验要真窗，而真窗那一条正压在「用户退出 Clash Verge」上，不能当日常门禁。
 * 代价是改任何一边都要同时改这里；收益是漏接一次立刻红。
 */
describe("内核宿主五条通道端到端接线（防只定义不接线）", () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
  const preload = read("../../preload/index.ts");
  const bridge = read("../../renderer/types/cyrene.d.ts");
  const mainApp = read("../application/default-dependencies.ts");
  const panel = read("../../renderer/react/features/network/NetworkPanel.tsx");
  const card = read("../../renderer/react/features/network/CoreSection.tsx");
  const bootstrap = read("./core-bootstrap.ts");

  it("装配层既真的注册、也真的在退出时摘掉那五条", () => {
    expect(mainApp).toMatch(/registerCoreHostIpc\(ipc, services\.core\)/);
    expect(mainApp).toMatch(/id: "verge-core-ipc"[\s\S]{0,220}removeCoreHostIpc\(\)/);
  });

  it("preload 五条各自 invoke 对应常量，且一个参数都不递", () => {
    const pairs = [
      ["status", "STATUS"],
      ["start", "START"],
      ["stop", "STOP"],
      ["restart", "RESTART"],
      ["update", "UPDATE"],
    ] as const;
    for (const [method, channel] of pairs) {
      expect(preload, `preload.core.${method} 没接上 VERGE_CORE_${channel}`).toMatch(
        new RegExp(`${method}: \\(\\) => ipcRenderer\\.invoke\\(IPC\\.VERGE_CORE_${channel}\\)`),
      );
    }
    // 递一个参数就等于把「起哪颗内核、吃哪份配置、装哪个版本」的决定权交回渲染端。
    expect(preload).not.toMatch(/invoke\(IPC\.VERGE_CORE_\w+,\s*\S/);
  });

  it("桥接类型收下五条，回的都是同一份 CoreView", () => {
    for (const method of ["status", "start", "stop", "restart", "update"]) {
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

  /**
   * 更新这一路最容易断的一环是装配层：`mihomo-update` 的单测全绿、`core-ipc` 的单测全绿，
   * 但 `core.updateCore()` 从来没被构造出来过一次——那条通道就会一直抛「handler not found」。
   */
  it("装配层真的把更新器接上，且换文件的闸门排在下载之前", () => {
    expect(bootstrap).toMatch(/createCoreUpdater\(\{/);
    expect(bootstrap).toMatch(/canSwap,\n\s*coreDir,/);
    expect(bootstrap).toMatch(/updateCore: \(\) => updater\.update\(\)/);
    expect(bootstrap).toMatch(/updateState: \(\) => updater\.state\(\)/);
    // 写路径只有一条：`<userData>/core`。Verge 安装目录那一路只能问「在不在」，
    // 把人家的目录交给更新器就等于拿一次「更新内核」去改 Clash Verge 自己的文件。
    expect(bootstrap).toMatch(/const coreDir = \(\) => coreDirOf\(options\.userData\)/);
    expect(bootstrap).toMatch(/installedCoreExists: \(\) => findInstalledExe\(\) !== null/);
  });

  it("五条都只归主窗：宠物窗拿到通道也没有替全机起内核或换内核文件的资格", () => {
    for (const channel of CORE_CHANNELS) {
      expect(IPC_SENDER_POLICY[channel], channel).toEqual(["chat"]);
    }
  });
});

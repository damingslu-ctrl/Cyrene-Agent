/**
 * Wave 4 T12d：客户端更新五条通道的薄层测试（假 IpcScope + 假状态机）。
 *
 * 这把尺上最值钱的两条判据都是「回执是从哪儿来的」：
 * - 动作 `await` 回来的那一份**不是**回执（真实现里那是 `phase` 还在走时的中途态），
 *   回执必须取动作之后那一次 `state()`；读错了的话，页面会对着刚落账的检查画一张昨天的卡。
 * - 开关那一条落盘失败时，内存里那一档**确实**已经改了：`saved.ok=false` 与
 *   `autoCheck=新值` 必须同时出现，只报其一都会让用户做错事（「以为存住了」或「以为没改」）。
 *
 * 端到端那一组用源码扫描而不是真起一个 Electron：真窗那一条正压在「用户退出 Clash Verge」上，
 * 不能当日常门禁；而 2026-10-24 那次的事故形状正是「模块写好了、单测全绿、真机上是死的」。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_CORE_STATUS, type CoreMode, type CoreState } from "../../shared/core-types";
import {
  type ClientCheckReceipt,
  type ClientDownloadReceipt,
  type ClientInstallReceipt,
  type ClientUpdateSave,
  type ClientUpdateState,
} from "../../shared/client-update-types";
import { IPC } from "../../shared/ipc-channels";
import { IPC_SENDER_POLICY } from "../application/ipc-sender-policy";
import type { IpcScope } from "../application/ipc-scope";
import type { ClientUpdateService } from "./update-service";
import { ownCoreIsLive } from "./update-bootstrap";
import { registerClientUpdateIpc } from "./update-ipc";

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

/** 账上「动作之前」那一份：状态机 resolve 回来的就是这种还没落账的东西。 */
const STALE_CHECK: ClientCheckReceipt = { outcome: "failed", at: 0, latestVersion: null, reason: "in-flight", detail: "中途态" };

/** 假状态机在动作之后落的那三本账——回执必须是这三份。 */
const FRESH_CHECK: ClientCheckReceipt = { outcome: "available", at: 10, latestVersion: "1.99.0", reason: null, detail: null };
const FRESH_DOWNLOAD: ClientDownloadReceipt = { outcome: "ready", at: 11, version: "1.99.0", fileName: "Mochi-Setup-1.99.0.exe", bytes: 290, reason: null, detail: null };
const FRESH_INSTALL: ClientInstallReceipt = { outcome: "launched", at: 12, version: "1.99.0", reason: null, detail: null };

const BASE_STATE: ClientUpdateState = {
  currentVersion: "1.16.0",
  autoCheck: true,
  phase: "idle",
  check: null,
  download: null,
  install: null,
};

interface ServiceInput {
  state?: Partial<ClientUpdateState>;
  checkThrows?: string;
  downloadThrows?: string;
  installThrows?: string;
  /** `setAutoCheck` 回的那一份落盘下场。 */
  save?: ClientUpdateSave;
  /** 开关没被调用时，这一档要回成原样的账。 */
  saveThrows?: string;
}

function makeService(input: ServiceInput = {}) {
  let current: ClientUpdateState = { ...BASE_STATE, ...input.state };
  /** 谁动了账、按什么顺序——判据全靠它，不靠调用次数猜顺序。 */
  const seq: string[] = [];
  const save = input.save ?? { ok: true, detail: null };
  const service = {
    state: vi.fn((): ClientUpdateState => {
      seq.push("read");
      return { ...current };
    }),
    check: vi.fn(async (): Promise<ClientCheckReceipt> => {
      seq.push("check");
      if (input.checkThrows) throw new Error(input.checkThrows);
      current = { ...current, phase: "idle", check: FRESH_CHECK };
      return STALE_CHECK;
    }),
    download: vi.fn(async (): Promise<ClientDownloadReceipt> => {
      seq.push("download");
      if (input.downloadThrows) throw new Error(input.downloadThrows);
      current = { ...current, phase: "idle", download: FRESH_DOWNLOAD };
      return { ...STALE_CHECK, outcome: "failed" } as unknown as ClientDownloadReceipt;
    }),
    install: vi.fn(async (): Promise<ClientInstallReceipt> => {
      seq.push("install");
      if (input.installThrows) throw new Error(input.installThrows);
      current = { ...current, phase: "idle", install: FRESH_INSTALL };
      return { ...STALE_CHECK, outcome: "failed" } as unknown as ClientInstallReceipt;
    }),
    setAutoCheck: vi.fn((on: boolean): ClientUpdateSave => {
      seq.push("autoCheck");
      if (input.saveThrows) throw new Error(input.saveThrows);
      current = { ...current, autoCheck: on };
      return save;
    }),
    start: vi.fn((): string[] => []),
    stop: vi.fn(),
  };
  return { service: service as unknown as ClientUpdateService & typeof service, seq };
}

function setup(input: ServiceInput = {}) {
  const scope = makeScope();
  const fake = makeService(input);
  const dispose = registerClientUpdateIpc(scope, fake.service);
  return { scope, dispose, ...fake };
}

const UPDATE_CHANNELS = [
  IPC.VERGE_CLIENT_UPDATE_STATE,
  IPC.VERGE_CLIENT_UPDATE_CHECK,
  IPC.VERGE_CLIENT_UPDATE_DOWNLOAD,
  IPC.VERGE_CLIENT_UPDATE_INSTALL,
  IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK,
] as const;

type View = ClientUpdateState & { saved: ClientUpdateSave | null };

/** 只有开关那一条收参数：其余四条按契约一个字都不递。 */
function invoke(scope: ReturnType<typeof makeScope>, channel: string, ...args: unknown[]): Promise<View> {
  const handler = scope.handlers.get(channel);
  if (!handler) throw new Error(`没有注册 ${channel}`);
  return Promise.resolve(handler({ sender: {} }, ...args)) as Promise<View>;
}

describe("registerClientUpdateIpc：注册与形状", () => {
  it("五条通道按序注册，STATE 那一档只读账、一次动作都不发起", async () => {
    const { scope, service, seq } = setup();
    expect(scope.registered).toEqual([...UPDATE_CHANNELS]);
    await invoke(scope, IPC.VERGE_CLIENT_UPDATE_STATE);
    expect(seq).toEqual(["read"]);
    expect(service.check).not.toHaveBeenCalled();
    expect(service.download).not.toHaveBeenCalled();
    expect(service.install).not.toHaveBeenCalled();
    expect(service.setAutoCheck).not.toHaveBeenCalled();
  });

  it("五条通道回同一份形状：三本账 + 当下这一段 + 落盘下场一起走", async () => {
    const { scope } = setup();
    const keys = ["autoCheck", "check", "currentVersion", "download", "install", "phase", "saved"];
    for (const channel of scope.registered) {
      // 开关那一条是唯一收参数的，递 `true` 才算走通了它；另外四条不递。
      const view = channel === IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK
        ? await invoke(scope, channel, true)
        : await invoke(scope, channel);
      expect(Object.keys(view).sort(), channel).toEqual(keys);
      // `saved` 只有开关那一条会填：另外四条既没写过盘，不许顺手造一份「存好了」。
      expect(view.saved, channel).toEqual(
        channel === IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK ? { ok: true, detail: null } : null,
      );
    }
  });

  /** 回执取的是动作之后那次读账，不是 `await` 回来的那一份中途态。 */
  it.each([
    [IPC.VERGE_CLIENT_UPDATE_CHECK, "check", FRESH_CHECK],
    [IPC.VERGE_CLIENT_UPDATE_DOWNLOAD, "download", FRESH_DOWNLOAD],
    [IPC.VERGE_CLIENT_UPDATE_INSTALL, "install", FRESH_INSTALL],
  ] as const)("%s 的尾序必须是动作→读账，回执不是 await 回来的那一份", async (channel, book, fresh) => {
    const { scope, seq } = setup();
    const view = await invoke(scope, channel);
    expect(seq).toEqual([book, "read"]);
    // 假状态机 resolve 回来的是 `phase` 还在走时的中途态；这里读到的是刚落账的那一份。
    expect(view[book]).toEqual(fresh);
    expect(view[book]).not.toEqual(STALE_CHECK);
  });

  it("三条动作都不收渲染端递进来的参数：下哪一版、从哪儿下只由 main 算", async () => {
    const { scope, service } = setup();
    for (const channel of [IPC.VERGE_CLIENT_UPDATE_CHECK, IPC.VERGE_CLIENT_UPDATE_DOWNLOAD, IPC.VERGE_CLIENT_UPDATE_INSTALL]) {
      await invoke(scope, channel, { version: "0.0.1", downloadUrl: "https://例如.com/x.exe" }, "1.99.0");
    }
    expect(service.check).toHaveBeenCalledWith();
    expect(service.download).toHaveBeenCalledWith();
    expect(service.install).toHaveBeenCalledWith();
  });

  it("每次现取账：两次 STATE 之间排程落了一次新账，第二份回执跟着改", async () => {
    const { scope, service } = setup();
    const first = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_STATE);
    // 排程那一条链在页面看不见的时候改的是内存里那本账（这里直接换掉假状态机的返回）。
    service.state.mockImplementationOnce(() => ({ ...BASE_STATE, check: FRESH_CHECK }));
    const second = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_STATE);
    expect(first.check).toBeNull();
    expect(second.check).toEqual(FRESH_CHECK);
  });
});

describe("registerClientUpdateIpc：自动检查那一颗", () => {
  it("只接受布尔：`\"false\"` 这种字符串一次调用都不发出去，账也不动", async () => {
    for (const on of ["false", 0, null, undefined, { on: false }, [], "true", 1]) {
      const { scope, service, seq } = setup();
      const view = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK, on);
      expect(service.setAutoCheck).not.toHaveBeenCalled();
      // 「什么都没改」的意思是不动那一颗：回读的账必须还是盘上那一份。
      expect(seq).toEqual(["read"]);
      expect(view.autoCheck).toBe(true);
      expect(view.saved?.ok).toBe(false);
      expect(view.saved?.detail).toMatch(/没改/);
    }
  });

  it("布尔那一次原样递给状态机，回执里的 autoCheck 是改过之后的", async () => {
    const { scope, service } = setup();
    const view = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK, false);
    expect(service.setAutoCheck).toHaveBeenCalledWith(false);
    expect(view.autoCheck).toBe(false);
    expect(view.saved).toEqual({ ok: true, detail: null });
  });

  /** 这一条是「内存改了、盘上没住」那一种帧：两个字段必须一起说，缺一句用户就会做错事。 */
  it("落盘没住时同时报出新开关与失败：不是「没改成」，也不是「存好了」", async () => {
    const { scope } = setup({ save: { ok: false, detail: "EPERM: 只读" } });
    const view = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK, false);
    expect(view.autoCheck).toBe(false);
    expect(view.saved).toEqual({ ok: false, detail: "EPERM: 只读" });
  });

  it("状态机自己抛了（userData 读不到）就让它出去，不折成一份看起来存好了的账", async () => {
    const { scope, seq } = setup({ saveThrows: "ENOENT: 目录没了" });
    await expect(invoke(scope, IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK, true)).rejects.toThrow(/ENOENT/);
    expect(seq).toEqual(["autoCheck"]);
  });
});

describe("registerClientUpdateIpc：不吞异常", () => {
  it.each([
    ["check", IPC.VERGE_CLIENT_UPDATE_CHECK],
    ["download", IPC.VERGE_CLIENT_UPDATE_DOWNLOAD],
    ["install", IPC.VERGE_CLIENT_UPDATE_INSTALL],
  ] as const)("%s 抛了就让它出去，而且不补读账", async (name, channel) => {
    const { scope, seq } = setup({ [`${name}Throws`]: `EROFS: ${name}` } as ServiceInput);
    await expect(invoke(scope, channel)).rejects.toThrow(new RegExp(`EROFS: ${name}`));
    // 抛错那次读了账就会把「没做完」画成一份完整的现状。
    expect(seq).toEqual([name]);
  });

  it("一次动作抛错之后，STATE 照旧能读——通道没有被异常拆掉", async () => {
    const { scope } = setup({ downloadThrows: "EROFS: 只读盘" });
    await expect(invoke(scope, IPC.VERGE_CLIENT_UPDATE_DOWNLOAD)).rejects.toThrow(/EROFS/);
    const view = await invoke(scope, IPC.VERGE_CLIENT_UPDATE_STATE);
    expect(view.currentVersion).toBe("1.16.0");
  });
});

describe("registerClientUpdateIpc：dispose", () => {
  it("摘的正是那五条，摘完 STATE 也不再答话", () => {
    const { scope, dispose } = setup();
    dispose();
    for (const channel of UPDATE_CHANNELS) {
      expect(scope.removeHandler).toHaveBeenCalledWith(channel);
    }
    expect(scope.removeHandler).toHaveBeenCalledTimes(UPDATE_CHANNELS.length);
    expect(scope.handlers.size).toBe(0);
  });
});

/**
 * 装配层那一条算式：拦安装的不是「内核卡片上有没有绿点」，是「我们 spawn 的那一颗还活着」。
 * 口径漂开的形状有两种，两种都是把人支到一件不需要他做的事上。
 */
describe("ownCoreIsLive：只有我们那颗活着才拦安装", () => {
  const live = (mode: CoreMode, state: CoreState): boolean =>
    ownCoreIsLive({ ...EMPTY_CORE_STATUS, mode, state });

  it("running／starting 拦，stopped／exited／blocked 不拦", () => {
    for (const state of ["running", "starting"] as const) expect(live("installed", state), state).toBe(true);
    for (const state of ["stopped", "exited", "blocked"] as const) expect(live("installed", state), state).toBe(false);
  });

  it("Verge 那颗（external）再跑也不拦：安装器动不到它", () => {
    expect(live("external", "running")).toBe(false);
    expect(live("external", "starting")).toBe(false);
  });

  it("bundled 与 installed 同口径：那是我们 spawn 出来的两颗", () => {
    expect(live("bundled", "running")).toBe(true);
    expect(live("bundled", "exited")).toBe(false);
  });

  it("还没认领过任何内核（mode null）不拦：这一班根本没起过东西", () => {
    expect(ownCoreIsLive({ ...EMPTY_CORE_STATUS, mode: null, state: "running" })).toBe(false);
  });
});

/**
 * Wave 4 T12d 的端到端接线锁（防只定义不接线）。
 *
 * 钉的不是「函数存在」，而是「那五条通道从装配层一路走到卡片的那只手」——T12a/b/c 三轮
 * 都记过同一条 ①：模块写完、单测全绿、`ipc-contract` 那道可达门根本看不见它们。
 */
describe("客户端更新五条通道端到端接线（防只定义不接线）", () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
  const preload = read("../../preload/index.ts");
  const bridge = read("../../renderer/types/cyrene.d.ts");
  const mainApp = read("../application/default-dependencies.ts");
  const bootstrap = read("./update-bootstrap.ts");
  const panel = read("../../renderer/react/features/network/NetworkPanel.tsx");
  const card = read("../../renderer/react/features/network/ClientUpdateSection.tsx");

  it("装配层真的把更新器接上：装配、排程、注册、退出时摘掉，四步一步不缺", () => {
    expect(mainApp).toMatch(/createClientUpdateAssembly\(\{/);
    // 排程与清扫都挂在 start() 上；忘了它，这条通道就只剩手动按钮，`.part` 也没人收。
    expect(mainApp).toMatch(/clientUpdate\.service\.start\(\)/);
    expect(mainApp).toMatch(/registerClientUpdateIpc\(ipc, clientUpdate\.service\)/);
    expect(mainApp).toMatch(/id: "verge-client-update-ipc"[\s\S]{0,220}removeClientUpdateIpc\(\)/);
    // 排程那一条链必须跟着撤：`stop()` 之后 `.finally` 里那颗 6 小时闹钟会在正在退出的进程里再响一次。
    expect(mainApp).toMatch(/id: "verge-client-update-host"[\s\S]{0,220}clientUpdate\.service\.stop\(\)/);
  });

  it("写面只有两处：updates/ 与那颗 settings.json", () => {
    expect(bootstrap).toMatch(/path\.join\(options\.userData, UPDATE_DIR_NAME\)/);
    expect(bootstrap).toMatch(/path\.join\(options\.userData, CLIENT_UPDATE_SETTINGS_FILE\)/);
    // 装配层不碰内核宿主的状态文件，也不碰 Verge 目录（spec D2）。
    expect(bootstrap).not.toMatch(/getConfigRoot|configRoot|verge\.yaml/);
  });

  it("拦安装问的是内存里那颗进程，口径与内核卡片一致", () => {
    expect(bootstrap).toMatch(/isOwnCoreMode\(status\.mode\) && \(status\.state === "running" \|\| status\.state === "starting"\)/);
    // 装配层递进来的必须是内核宿主内存里那一份账；在装配点手搓一个布尔（`coreIsRunning:`）
    // 等于把这条算式抄第二遍，抄错那次用户就永远「先停内核再升级」。
    expect(mainApp).toMatch(/coreStatus: \(\) => core\.status\(\)/);
    expect(mainApp).not.toMatch(/coreIsRunning:/);
  });

  it("退出走的是受控退出那一条，不是 process.exit", () => {
    expect(mainApp).toMatch(/quitApp: \(\) => app\.quit\(\)/);
    expect(mainApp).not.toMatch(/process\.exit\(\)/);
  });

  it("preload 五条各自 invoke 对应常量，四条动作一个参数都不递", () => {
    const pairs = [
      ["state", "STATE"],
      ["check", "CHECK"],
      ["download", "DOWNLOAD"],
      ["install", "INSTALL"],
    ] as const;
    for (const [method, channel] of pairs) {
      expect(preload, `preload.clientUpdate.${method} 没接上 VERGE_CLIENT_UPDATE_${channel}`).toMatch(
        new RegExp(`${method}: \\(\\) => ipcRenderer\\.invoke\\(IPC\\.VERGE_CLIENT_UPDATE_${channel}\\)`),
      );
    }
    expect(preload).toMatch(/setAutoCheck: \(on: boolean\) =>/);
    // 只有开关那一条允许带参数，且只有那一个布尔。
    expect(preload).not.toMatch(/invoke\(IPC\.VERGE_CLIENT_UPDATE_(?:STATE|CHECK|DOWNLOAD|INSTALL),\s*\S/);
  });

  it("桥接类型收下五条：四条回整份 ClientUpdateView，开关那条收一个布尔", () => {
    for (const method of ["state", "check", "download", "install"]) {
      expect(bridge, `cyrene.d.ts 的 clientUpdate.${method} 变了形状`).toMatch(
        new RegExp(`${method}\\(\\):\\s*Promise<[^>]*ClientUpdateView>`),
      );
    }
    expect(bridge).toMatch(/setAutoCheck\(on: boolean\):\s*Promise<[^>]*ClientUpdateView>/);
  });

  it("设置页把桥递进卡片，卡片调用时三条动作都不带参数", () => {
    expect(panel).toMatch(/window\.verge\?\.clientUpdate/);
    expect(panel).toMatch(/<ClientUpdateSection api=\{clientUpdateApi\} \/>/);
    // 顺序也是契约：更新卡片排在内核卡片之后（安装前要问的那道闸门是内核在不在跑）。
    expect(panel.indexOf("<ClientUpdateSection")).toBeGreaterThan(panel.indexOf("<CoreSection"));
    expect(card).toMatch(/await api\.state\(\)/);
    expect(card).toMatch(/await api\[action\]\(\)/);
    expect(card).toMatch(/api\.setAutoCheck\(/);
  });

  it("五条都只归主窗：宠物窗没有换掉这台机器上 App 的资格", () => {
    for (const channel of UPDATE_CHANNELS) {
      expect(IPC_SENDER_POLICY[channel], channel).toEqual(["chat"]);
    }
  });
});

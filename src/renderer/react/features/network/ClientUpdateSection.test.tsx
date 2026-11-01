// @vitest-environment jsdom

/**
 * 「客户端更新」这张卡的**两步确认**与**下载→安装那一拍**的渲染锁。
 *
 * 逼出这份文件的是真窗第一趟真下载（`scripts/verify/client-update-cdp.mjs` 的 `download` 档）：
 * main 那本账已经写着 `download.ready` + `phase:idle`，探针回头读 DOM 却没拿到一颗按得下去的
 * 「安装」键。那次只有一句「卡上没有可点的按钮」，分不清是页面还没收到回话、卡片被顶下台，
 * 还是确认窗那套派生没跟上——所以这里把三种形状各钉一条：
 * - 动作回话落地那一帧，三颗必须当场回到可按（探针因此改成轮询而不是读一眼）。
 * - 第一下「安装」当场就要把字换成「再按一次」：卡片上写着什么，用户就照着按什么，
 *   而这一颗按下去是「退出并被替换」，没有反悔通路。
 * - 过了确认窗，第二下只许重新武装，不许直接换掉这台机器。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientCheckReceipt,
  ClientDownloadReceipt,
  ClientInstallReceipt,
  ClientUpdateView,
} from "../../../../shared/client-update-types";
import zhCN from "../../i18n/zh-CN.json";
import { CLIENT_CONFIRM_WINDOW_MS, type ClientUpdateApi } from "./client-update-view";
import { ClientUpdateSection } from "./ClientUpdateSection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** 时钟钉住：确认窗、`距今`、5 秒那条回执寿命都按这把钟走，跑在哪一天都一样。 */
const AT = 1_732_000_000_000;
const CURRENT = "1.0.0";
const LATEST = "1.16.0";
/** 卡片每 10 秒静默重读一次；测试里推时间要跨过它，所以留个名字。 */
const POLL_MS = 10_000;

const RESOURCES: Record<string, Record<string, unknown>> = {
  "zh-CN": zhCN as unknown as Record<string, unknown>,
};

/** 文案一律从语言文件取，测试不重打一遍：改了措辞这条锁要跟着红，而不是跟着测试一起说谎。 */
function text(key: string): string {
  let node: unknown = RESOURCES["zh-CN"];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) throw new Error(`zh-CN.json 里没有 ${key}`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`zh-CN.json 里 ${key} 不是一句话`);
  return node;
}

function viewOf(over: Partial<ClientUpdateView> = {}): ClientUpdateView {
  return {
    currentVersion: CURRENT,
    autoCheck: true,
    phase: "idle",
    check: null,
    download: null,
    install: null,
    saved: null,
    ...over,
  };
}

const checked = (over: Partial<ClientCheckReceipt> = {}): ClientCheckReceipt => ({
  outcome: "available",
  at: AT,
  latestVersion: LATEST,
  reason: null,
  detail: null,
  ...over,
});

const ready = (over: Partial<ClientDownloadReceipt> = {}): ClientDownloadReceipt => ({
  outcome: "ready",
  at: AT,
  version: LATEST,
  fileName: `Mochi-Setup-${LATEST}.exe`,
  bytes: 303_971_021,
  reason: null,
  detail: null,
  ...over,
});

const REFUSED: ClientInstallReceipt = {
  outcome: "failed",
  at: AT,
  version: LATEST,
  reason: "stale-package",
  detail: `装前重算 b4ff1603c0a8… ≠ 下载时核过 cc63d3dfc65d…`,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function makeApi(over: Partial<ClientUpdateApi> = {}): ClientUpdateApi {
  const idle = viewOf({ check: checked() });
  return {
    state: vi.fn(async () => idle),
    check: vi.fn(async () => idle),
    download: vi.fn(async () => idle),
    install: vi.fn(async () => idle),
    setAutoCheck: vi.fn(async () => idle),
    ...over,
  } as unknown as ClientUpdateApi;
}

const roots: Root[] = [];

async function mount(api: ClientUpdateApi): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => { root.render(createElement(ClientUpdateSection, { api })); });
  await settle();
  return host;
}

/** 静默轮询与动作回话都是异步的：推时间/放行 promise 之后统一过一遍 act 才看得到重渲染。 */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    if (ms > 0) {
      await vi.advanceTimersByTimeAsync(ms);
    }
    // 回话到渲染落定之间隔着几个微任务（await → setState → 提交），只 flush 一格会读到旧帧。
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`button[name='client_update_${name}']`);
  if (!el) throw new Error(`卡上没有 client_update_${name} 那颗`);
  return el;
}

/** 按钮上的字要**整句**比：「安装」是「再按一次才安装」的子串，`toContain` 在这儿等于没量。 */
function label(host: HTMLElement, name: string): string {
  return (button(host, name).textContent ?? "").replace(/\s+/g, " ").trim();
}

async function click(host: HTMLElement, name: string): Promise<void> {
  await act(async () => { button(host, name).click(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => { for (const root of roots) root.unmount(); });
  roots.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("客户端更新卡片：下载回话那一拍", () => {
  it("动作在途时三颗一起灰着，回执不许拿上一趟的账冒充这一次", async () => {
    const gate = deferred<ClientUpdateView>();
    const api = makeApi({ download: vi.fn(() => gate.promise) as ClientUpdateApi["download"] });
    const host = await mount(api);

    await click(host, "download");

    for (const name of ["check", "download", "install"]) {
      expect(button(host, name).disabled, `${name} 在途时该灰着`).toBe(true);
    }
    expect(label(host, "download")).toBe(text("network.clientUpdate.working"));
    // 在途时**一句回执都不给**：那一本账还没落笔，这时候画出来的任何一句话都是从上一趟借的。
    expect(host.querySelector(".net-notice")).toBeNull();
  });

  it("main 落完账、回话抵达的那一帧，「安装」当场回到可按", async () => {
    const gate = deferred<ClientUpdateView>();
    const api = makeApi({ download: vi.fn(() => gate.promise) as ClientUpdateApi["download"] });
    const host = await mount(api);
    await click(host, "download");
    expect(button(host, "install").disabled).toBe(true);

    // 真窗里探针就是卡在这一拍之后：main 的 `state()` 已经答得出 ready+idle，
    // 而渲染端要等这次 invoke 的回话落地才把三颗放开——所以尺子读 DOM 必须轮询，不能读一眼。
    gate.resolve(viewOf({ check: checked(), download: ready() }));
    await settle();

    expect(button(host, "install").disabled).toBe(false);
    expect(label(host, "install")).toBe(text("network.clientUpdate.install.button"));
    expect(host.querySelector(".net-notice")?.textContent).toContain(text("network.clientUpdate.download.ready"));
    // 包那一行报的是可核对的东西：文件名 + 字节数，不是「一个包」。
    expect(host.textContent).toContain(`Mochi-Setup-${LATEST}.exe`);
  });
});

describe("客户端更新卡片：两步确认", () => {
  /**
   * 真用户是先读一眼卡、再抬手按：点击必然落在 mount 之后的某一毫秒。
   * 时钟不先走一格，mount 与点击就同在一毫秒，`now - armedAt === 0` 恰好把真窗里那个
   * 「武装中的字要等下一拍才换」的缺陷洗成绿的——这条锁量的是屏幕上那句话，不是算术边角。
   */
  const READ_DELAY_MS = 1_500;

  const armedHost = async () => {
    const api = makeApi({ state: vi.fn(async () => viewOf({ check: checked(), download: ready() })) as ClientUpdateApi["state"] });
    const host = await mount(api);
    await settle(READ_DELAY_MS);
    return { host, api };
  };

  it("第一下只武装：当场就说「再按一次」，一颗安装器都不许起来", async () => {
    const { host, api } = await armedHost();

    await click(host, "install");

    // 这一条是真窗那一趟教出来的：武装中的字如果只能等 10 秒那一拍才换，
    // 那么第一下之后到下一拍之间，键上写着「安装」而按下去真的会装——按钮名骗了一次点击。
    expect(label(host, "install")).toBe(text("network.clientUpdate.installConfirm"));
    expect(api.install).not.toHaveBeenCalled();
    expect(host.querySelector(".net-notice")?.textContent).toContain(text("network.clientUpdate.confirmHint"));
  });

  it("确认窗内的第二下才发出去，并把拒装那一行原样画出来", async () => {
    const refused = viewOf({
      check: checked(),
      download: ready(),
      install: { ...REFUSED, at: AT + CLIENT_CONFIRM_WINDOW_MS - 1_000 },
    });
    const api = makeApi({
      state: vi.fn(async () => viewOf({ check: checked(), download: ready() })) as ClientUpdateApi["state"],
      install: vi.fn(async () => refused),
    });
    const host = await mount(api);

    await click(host, "install");
    await settle(3_000);
    expect(label(host, "install")).toBe(text("network.clientUpdate.installConfirm"));
    await click(host, "install");

    expect(api.install).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".net-notice")?.textContent).toContain(text("network.clientUpdate.install.failed"));
    expect(host.querySelector(".net-notice")?.textContent).toContain(text("network.clientUpdate.reason.stale-package"));
    // 两枚 sha 都要在屏上：拒装这句话的价值是「哪两枚对不上」，只说「失败」等于没说。
    expect(host.textContent).toContain("b4ff1603c0a8…");
    expect(host.textContent).toContain("cc63d3dfc65d…");
  });

  it("过了那一窗，第二下只重新武装，不许直接换掉这台机器", async () => {
    const { host, api } = await armedHost();

    await click(host, "install");
    // 下一拍（10 秒轮询）把 `now` 推过确认窗，字自己退回原样——不留一颗待发的按钮。
    await settle(2 * POLL_MS);
    expect(label(host, "install")).toBe(text("network.clientUpdate.install.button"));

    await click(host, "install");

    expect(api.install).not.toHaveBeenCalled();
    expect(label(host, "install")).toBe(text("network.clientUpdate.installConfirm"));
  });
});

describe("客户端更新卡片：通道读不到", () => {
  it("state() 抛一次说「接口不可用」并灰掉动作，下一拍读回来就当场放开", async () => {
    let failing = true;
    const api = makeApi({
      state: vi.fn(async () => {
        if (failing) {
          failing = false;
          throw new Error("ipc down");
        }
        return viewOf({ check: checked(), download: ready() });
      }) as ClientUpdateApi["state"],
    });
    const host = await mount(api);

    expect(host.textContent).toContain(text("network.clientUpdate.ipcFailed"));
    for (const name of ["check", "download", "install"]) {
      expect(button(host, name).disabled, `${name} 在接口不可用该灰着`).toBe(true);
    }

    // 这一条是给尺子兜底的：`unreachable` 必须是**下一拍就能自己好**的状态，而不是粘住的。
    // 真窗要是读到满 30 秒灰，红的就是产品（这条恢复路没走通），不是探针等短了。
    await settle(POLL_MS);
    for (const name of ["check", "download", "install"]) {
      expect(button(host, name).disabled, `${name} 读回账后该放开`).toBe(false);
    }
    expect(host.textContent).not.toContain(text("network.clientUpdate.ipcFailed"));
  });
});

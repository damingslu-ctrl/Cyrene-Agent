/**
 * Wave 3 T9-d：设置面四条通道的判据。
 *
 * 这层唯一值得钉的智力活是「代理地址不经过页面」：渲染端只说开/关，
 * 地址与例外由 main 现读内核 → 退到 verge.yaml → 两头都没有就 no-port。
 * 下面每一条都在验这个归属，而不是验「函数调到了」。
 */
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { DEFAULT_SYSTEM_PROXY_BYPASS } from "../../shared/system-proxy-types";
import type { VergeSettingsView } from "../../shared/verge-settings-types";
import { EMPTY_VERGE_SETTINGS_VIEW } from "../../shared/verge-settings-types";
import type { IpcScope } from "../application/ipc-scope";
import { validateSettingsPatch, VergeSettingsError, type VergeSettingsResult, type VergeSettingsStore } from "./verge-settings";
import { registerVergeSettingsIpc } from "./verge-settings-ipc";

function makeScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const scope = {
    handlers,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, listener);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

function call<T>(scope: ReturnType<typeof makeScope>, channel: string, ...args: unknown[]): Promise<T> {
  const handler = scope.handlers.get(channel);
  if (!handler) throw new Error(`${channel} 没注册`);
  return Promise.resolve(handler({} as never, ...args) as T);
}

// —— 假注册表：只认 `-Name ProxyXxx` 这一种形状，读回来永远是盘上的当前值 ——

interface FakeRegistry {
  values: Record<string, string | number | null>;
  failWrite?: string;
  failRead?: boolean;
}

const ENV_FOR: Record<string, string> = {
  ProxyEnable: "MOCHI_PROXY_ENABLE",
  ProxyServer: "MOCHI_PROXY_SERVER",
  ProxyOverride: "MOCHI_PROXY_BYPASS",
};

function makeExec(registry: FakeRegistry) {
  const calls: { command: string; env: Record<string, string> }[] = [];
  const exec = (input: { file: string; args: string[]; env: Record<string, string>; timeoutMs: number }): string => {
    const command = input.args[3] ?? "";
    calls.push({ command, env: input.env });
    if (command.includes("ConvertTo-Json")) {
      if (registry.failRead) throw new Error("注册表读取失败");
      const out: Record<string, unknown> = {};
      for (const key of ["ProxyEnable", "ProxyServer", "ProxyOverride"]) {
        const value = registry.values[key];
        if (value !== undefined && value !== null) out[key] = value;
      }
      return JSON.stringify(out);
    }
    const name = /-Name (Proxy\w+)/.exec(command)?.[1] ?? "";
    if (registry.failWrite === name) throw new Error("拒绝访问");
    if (command.includes("Remove-ItemProperty")) {
      registry.values[name] = null;
      return "";
    }
    if (!name) return "";
    const raw = input.env[ENV_FOR[name]];
    registry.values[name] = name === "ProxyEnable" ? Number(raw ?? 0) : raw ?? "";
    return "";
  };
  return { calls, exec };
}

const OPEN = { enabled: true, server: "127.0.0.1:7896", bypass: "localhost" };

// —— 假 store：read 给注入的视图，write 走真的白名单校验器（这样「坏键」那条验的是委托，不是编出来的 reason）——

function makeStore(overrides: Partial<VergeSettingsView> = {}, readReason: "bad-yaml" | null = null) {
  const view: VergeSettingsView = { ...EMPTY_VERGE_SETTINGS_VIEW, ...overrides };
  const writes: unknown[] = [];
  let writeResult: VergeSettingsResult = { ok: true, view, changed: [] };
  const store: VergeSettingsStore = {
    filePath: () => "C:\\verge\\verge.yaml",
    read: () => ({ view, reason: readReason, filePath: "C:\\verge\\verge.yaml" }),
    write: (patch) => {
      writes.push(patch);
      try {
        validateSettingsPatch(patch);
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof VergeSettingsError ? error.reason : "bad-value",
          view,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      return writeResult;
    },
  };
  return {
    store,
    writes,
    setWriteResult(next: VergeSettingsResult) { writeResult = next; },
  };
}

function makeDeps(
  options: {
    view?: Partial<VergeSettingsView>;
    registry?: FakeRegistry;
    corePort?: number | null;
    noRoot?: boolean;
    writeResult?: VergeSettingsResult;
    readReason?: "bad-yaml" | null;
  } = {},
) {
  const registry: FakeRegistry = options.registry ?? { values: { ProxyEnable: 0 } };
  const { calls, exec } = makeExec(registry);
  const fake = makeStore(options.view ?? {}, options.readReason ?? null);
  if (options.writeResult) fake.setWriteResult(options.writeResult);
  const corePort = vi.fn(async () => options.corePort ?? null);
  const settings = vi.fn((): VergeSettingsStore | null => (options.noRoot ? null : fake.store));
  const scope = makeScope();
  const dispose = registerVergeSettingsIpc(scope, { settings, corePort, proxy: { exec, platform: "win32" } });
  return { scope, registry, calls, corePort, settings, fake, dispose };
}

describe("设置面四条通道", () => {
  it("四条都注册，且 dispose 把它们全部摘掉", () => {
    const { scope, dispose } = makeDeps();
    expect([...scope.handlers.keys()].sort()).toEqual([
      IPC.VERGE_SETTINGS_GET, IPC.VERGE_SETTINGS_SET,
      IPC.VERGE_SYS_PROXY_GET, IPC.VERGE_SYS_PROXY_SET,
    ].sort());
    dispose();
    expect(scope.removeHandler).toHaveBeenCalledTimes(4);
  });

  it("verge.yaml 读：拿到视图与路径", async () => {
    const { scope } = makeDeps({ view: { mixedPort: 7896, enableTunMode: false } });
    const read = await call(scope, IPC.VERGE_SETTINGS_GET);
    expect(read).toMatchObject({
      view: { mixedPort: 7896, enableTunMode: false },
      reason: null,
      filePath: "C:\\verge\\verge.yaml",
    });
  });

  it("没有 Verge 目录时读回空视图 + not-found，路径是 null 而不是编一个", async () => {
    const { scope } = makeDeps({ noRoot: true });
    expect(await call(scope, IPC.VERGE_SETTINGS_GET)).toEqual({
      view: EMPTY_VERGE_SETTINGS_VIEW, reason: "not-found", filePath: null,
    });
  });

  it("verge.yaml 写：坏键由 store 的白名单挡下，回执带得上当前视图", async () => {
    const { scope, fake } = makeDeps({ view: { mixedPort: 7890 } });
    const result = await call<{ ok: boolean; reason?: string; view: VergeSettingsView }>(
      scope, IPC.VERGE_SETTINGS_SET, { "enable_auto_launch": true },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-key");
    expect(result.view.mixedPort).toBe(7890);
    // 这层不自己判白名单：判据只有一份，在 store 里。这里只负责把原样递过去。
    expect(fake.writes).toEqual([{ enable_auto_launch: true }]);
  });

  it("verge.yaml 写：原样转给 store", async () => {
    const { scope, fake } = makeDeps();
    await call(scope, IPC.VERGE_SETTINGS_SET, { verge_mixed_port: 7897 });
    expect(fake.writes).toEqual([{ verge_mixed_port: 7897 }]);
  });
});

describe("系统代理开关：地址由 main 决定", () => {
  it("打开时写的是内核报出来的那个端口", async () => {
    const { scope, registry, calls } = makeDeps({ corePort: 7896 });
    const result = await call<{ ok: boolean; status: { enabled: boolean | null; server: string | null } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result.ok).toBe(true);
    expect(registry.values).toMatchObject({ ProxyEnable: 1, ProxyServer: "127.0.0.1:7896" });
    expect(calls.some((c) => c.env.MOCHI_PROXY_SERVER === "127.0.0.1:7896")).toBe(true);
    expect(result.status).toMatchObject({ enabled: true, server: "127.0.0.1:7896" });
  });

  it("内核没在跑时退到 verge.yaml 里那把混合端口", async () => {
    const { scope, registry } = makeDeps({ corePort: null, view: { mixedPort: 7890 } });
    const result = await call<{ ok: boolean }>(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(result.ok).toBe(true);
    expect(registry.values.ProxyServer).toBe("127.0.0.1:7890");
  });

  it("两头都说不出端口时是 no-port，一个键都不写", async () => {
    const { scope, registry, calls } = makeDeps({ corePort: null, view: {} });
    const result = await call<{ ok: boolean; reason?: string; align?: { state: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result).toMatchObject({ ok: false, reason: "no-port", align: { state: "skipped" } });
    expect(calls).toHaveLength(0);
    expect(registry.values).toEqual({ ProxyEnable: 0 });
  });

  it("页面递进来的 server 一律无视：写出去的仍是 main 算的那个", async () => {
    const { scope, registry, calls } = makeDeps({ corePort: 7896 });
    const result = await call<{ ok: boolean }>(scope, IPC.VERGE_SYS_PROXY_SET, {
      enabled: true, server: "evil.example.com:8080", bypass: "example.com",
    });
    expect(result.ok).toBe(true);
    expect(registry.values.ProxyServer).toBe("127.0.0.1:7896");
    expect(registry.values.ProxyOverride).toBe(DEFAULT_SYSTEM_PROXY_BYPASS);
    expect(calls.some((c) => JSON.stringify(c.env).includes("evil"))).toBe(false);
  });

  it("例外列表跟 verge.yaml 那两把键走：勾了默认用默认，取消勾且没填就删掉那一把键", async () => {
    const withCustom = makeDeps({
      corePort: 7896,
      view: { useDefaultBypass: false, systemProxyBypass: "internal.example" },
    });
    await call(withCustom.scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(withCustom.registry.values.ProxyOverride).toBe("internal.example");

    const cleared = makeDeps({ corePort: 7896, view: { useDefaultBypass: false, systemProxyBypass: null } });
    const result = await call<{ ok: boolean }>(cleared.scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(result.ok).toBe(true);
    expect(cleared.registry.values.ProxyOverride).toBeNull();
    expect(cleared.calls.some((c) => c.command.includes("Remove-ItemProperty"))).toBe(true);
  });

  it("没配过时跟随默认（null ≠ false）", async () => {
    const { scope, registry } = makeDeps({ corePort: 7896, view: {} });
    await call(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(registry.values.ProxyOverride).toBe(DEFAULT_SYSTEM_PROXY_BYPASS);
  });

  it("verge.yaml 把端口写成 0（Verge 的随机档）不算端口", async () => {
    const { scope, calls } = makeDeps({ corePort: null, view: { mixedPort: 0 } });
    const result = await call<{ reason?: string }>(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(result.reason).toBe("no-port");
    expect(calls).toHaveLength(0);
  });

  it("verge.yaml 读不出时不猜例外，也不假装对齐成功", async () => {
    const { scope, registry } = makeDeps({
      corePort: 7896,
      readReason: "bad-yaml",
      writeResult: {
        ok: false, reason: "bad-yaml", view: { ...EMPTY_VERGE_SETTINGS_VIEW }, detail: "第 3 行缩进不对",
      },
    });
    const result = await call<{ ok: boolean; align?: { state: string; detail?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result).toMatchObject({ ok: true, align: { state: "failed", detail: "第 3 行缩进不对" } });
    expect(registry.values.ProxyOverride).toBeUndefined();
  });

  it("关闭不要求端口，也不碰地址与例外那两把键", async () => {
    const { scope, registry, calls, corePort } = makeDeps({
      corePort: null,
      registry: { values: { ProxyEnable: 1, ProxyServer: "127.0.0.1:7890", ProxyOverride: "localhost" } },
    });
    const result = await call<{ ok: boolean }>(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: false });
    expect(result.ok).toBe(true);
    expect(registry.values).toMatchObject({ ProxyEnable: 0, ProxyServer: "127.0.0.1:7890", ProxyOverride: "localhost" });
    expect(corePort).not.toHaveBeenCalled();
    expect(calls.filter((c) => /-Name Proxy(Enable|Server|Override)/.test(c.command))).toHaveLength(1);
  });

  it("读通道把盘上的现状原样递回去", async () => {
    const { scope } = makeDeps({ registry: { values: { ProxyEnable: 1, ProxyServer: "127.0.0.1:7890", ProxyOverride: "localhost" } } });
    expect(await call(scope, IPC.VERGE_SYS_PROXY_GET)).toEqual({
      status: { enabled: true, server: "127.0.0.1:7890", bypass: "localhost" }, reason: null,
    });
  });

  it("读失败给 reason 与 detail，状态是 null 三件套而不是「关着」", async () => {
    const { scope } = makeDeps({ registry: { values: {}, failRead: true } });
    const read = await call<{ status: Record<string, unknown>; reason: string; detail?: string }>(
      scope, IPC.VERGE_SYS_PROXY_GET,
    );
    expect(read).toMatchObject({ reason: "read-failed", status: { enabled: null, server: null, bypass: null } });
    expect(read.detail).toContain("注册表读取失败");
  });

  it("非 Windows 平台一次进程都不起", async () => {
    const registry = { values: { ProxyEnable: 0 } };
    const { calls, exec } = makeExec(registry);
    const scope = makeScope();
    registerVergeSettingsIpc(scope, {
      settings: () => null,
      corePort: async () => 7896,
      proxy: { exec, platform: "darwin" },
    });
    const result = await call<{ ok: boolean; reason?: string }>(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(result).toMatchObject({ ok: false, reason: "unsupported" });
    expect(calls).toHaveLength(0);
  });

  it("写失败时不去同步 Verge 的开关", async () => {
    const { scope, fake } = makeDeps({ corePort: 7896, registry: { values: { ProxyEnable: 0 }, failWrite: "ProxyEnable" } });
    const result = await call<{ ok: boolean; reason?: string; align?: { state: string; reason?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result).toMatchObject({ ok: false, reason: "write-failed", align: { state: "skipped", reason: "not-applied" } });
    expect(fake.writes).toHaveLength(0);
  });

  it("形状不对的请求不碰系统，也不谎称读到了现状", async () => {
    const { scope, calls } = makeDeps();
    const result = await call<{ ok: boolean; reason?: string; status: Record<string, unknown> }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: "yes" },
    );
    expect(result).toMatchObject({
      ok: false, reason: "bad-value", status: { enabled: null, server: null, bypass: null },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("Verge 自己那把开关的对齐", () => {
  it("打开系统代理时同步写 enable_system_proxy，回执说 aligned", async () => {
    const { scope, fake } = makeDeps({ corePort: 7896 });
    const result = await call<{ align?: { state: string } }>(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true });
    expect(result.align).toEqual({ state: "aligned" });
    expect(fake.writes).toEqual([{ enable_system_proxy: true }]);
  });

  it("关闭时同样要把那把键写成 false", async () => {
    const { scope, fake } = makeDeps();
    await call(scope, IPC.VERGE_SYS_PROXY_SET, { enabled: false });
    expect(fake.writes).toEqual([{ enable_system_proxy: false }]);
  });

  it("Verge 正在运行：系统代理照样改，但那把键归它自己——报 skipped 而不是失败", async () => {
    const { scope, fake } = makeDeps({
      corePort: 7896,
      writeResult: {
        ok: false, reason: "verge-running", view: { ...EMPTY_VERGE_SETTINGS_VIEW },
      },
    });
    const result = await call<{ ok: boolean; align?: { state: string; reason?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result.ok).toBe(true);
    expect(result.align).toEqual({ state: "skipped", reason: "verge-running" });
    expect(fake.writes).toHaveLength(1);
  });

  it("盘上没有 verge.yaml：跳过对齐并说清原因", async () => {
    const { scope } = makeDeps({
      corePort: 7896,
      writeResult: { ok: false, reason: "not-found", view: { ...EMPTY_VERGE_SETTINGS_VIEW } },
    });
    const result = await call<{ align?: { state: string; reason?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result.align).toEqual({ state: "skipped", reason: "no-file" });
  });

  it("对齐写坏了要说 failed，并带上原话——不能因为系统代理成功了就当没事", async () => {
    const { scope } = makeDeps({
      corePort: 7896,
      writeResult: { ok: false, reason: "write-failed", view: { ...EMPTY_VERGE_SETTINGS_VIEW }, detail: "磁盘只读" },
    });
    const result = await call<{ ok: boolean; align?: { state: string; detail?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result.ok).toBe(true);
    expect(result.align).toMatchObject({ state: "failed", detail: "磁盘只读" });
  });

  it("没装 Verge 也要能开系统代理：端口来自内核，对齐报 no-file", async () => {
    const { scope, registry } = makeDeps({ corePort: 7896, noRoot: true });
    const result = await call<{ ok: boolean; align?: { state: string; reason?: string } }>(
      scope, IPC.VERGE_SYS_PROXY_SET, { enabled: true },
    );
    expect(result.ok).toBe(true);
    expect(registry.values.ProxyServer).toBe("127.0.0.1:7896");
    expect(result.align).toEqual({ state: "skipped", reason: "no-file" });
  });
});

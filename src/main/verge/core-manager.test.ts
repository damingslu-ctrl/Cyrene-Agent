/**
 * v1.26 内核宿主（Wave 3 T10）的判定测试：假 fs / 假 spawn / 假端口。
 *
 * 时钟与 sleep 都是注入的，所以「等控制器答话」「撑过 60s 补预算」这类判定
 * 在测试里是**推进假时钟**发生的，不吃真 wall clock，也不会因为 CI 慢就漂。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORE_REASONS,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MIXED_PORT,
  FALLBACK_PORT_START,
  MAX_SELF_HEAL,
  PORT_SCAN_LIMIT,
  type CorePortPair,
} from "../../shared/core-types";
import {
  CORE_HEAL_RESET_MS,
  CORE_READY_TIMEOUT_MS,
  createCoreManager,
  type CoreChild,
  type CoreManagerDeps,
} from "./core-manager";

const CORE_DIR = String.raw`C:\Users\mochi\AppData\Roaming\Mochi\core`;
/** 运行时配置里会有我们自己生成的 controller secret；这里用哨兵代表它，日志里出现即红。 */
const SECRET_SENTINEL = "zh-SECRET-sentinel-8f2c41";

interface HarnessInput {
  /** external 控制器地址；显式给 null 表示「压根没发现 Verge」。 */
  external?: string | null;
  externalReachable?: boolean;
  vergeRunning?: boolean;
  installedExe?: string | null;
  bundledExe?: string | null;
  usedPorts?: number[];
  /** 装配层声明的首选档；显式给 null 表示「那本账读不出来，没有首选」。 */
  preferred?: CorePortPair | null;
  /** 配置这一步抛错（没选订阅、正文坏了）：必须挡在 spawn 之前。 */
  configThrows?: string;
  /** 自有内核第几次探测才答话（1 = 第一下就答）。 */
  readyAfter?: number;
  neverReady?: boolean;
  spawnThrows?: string;
  platform?: NodeJS.Platform;
  readyTimeoutMs?: number;
  nowStart?: number;
}

function makeChild(pid: number) {
  let kills = 0;
  const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
  const out: Array<(chunk: unknown) => void> = [];
  const err: Array<(chunk: unknown) => void> = [];
  const child: CoreChild = {
    pid,
    stdout: { on: (_event, listener) => { out.push(listener); } },
    stderr: { on: (_event, listener) => { err.push(listener); } },
    on: (_event, listener) => { exitListeners.push(listener); },
    kill: () => { kills += 1; return true; },
  };
  return {
    child,
    killCount: () => kills,
    fireExit: (code: number | null = 1, signal: string | null = null) => {
      for (const listener of exitListeners) listener(code, signal);
    },
    emitStderr: (text: string) => { for (const listener of err) listener(text); },
  };
}

type FakeChild = ReturnType<typeof makeChild>;

function harness(input: HarnessInput = {}) {
  const clock = { now: input.nowStart ?? 1_732_000_000_000 };
  const spawned: FakeChild[] = [];
  const configs: Array<{ mixed: number; controller: number }> = [];
  const logs: string[] = [];
  const ownProbes: number[] = [];
  let externalProbes = 0;
  let nextPid = 4100;

  const external = input.external === undefined ? "http://127.0.0.1:9090" : input.external;
  let readyCount = 0;

  const deps: CoreManagerDeps = {
    platform: input.platform ?? "win32",
    readyTimeoutMs: input.readyTimeoutMs,
    isVergeRunning: () => input.vergeRunning ?? false,
    externalController: () => external,
    probeController: async (url) => {
      if (url === external) {
        externalProbes += 1;
        return input.externalReachable ?? false;
      }
      ownProbes.push(Number(url.split(":").pop()));
      if (input.neverReady) return false;
      readyCount += 1;
      return readyCount >= (input.readyAfter ?? 1);
    },
    findInstalledExe: () => (input.installedExe === undefined ? String.raw`C:\Program Files\Clash Verge\verge-mihomo.exe` : input.installedExe),
    findBundledExe: () => (input.bundledExe === null ? null : String.raw`${CORE_DIR}\mihomo.exe`),
    usedPorts: () => input.usedPorts ?? [],
    preferredPorts: () => (input.preferred === undefined ? null : input.preferred),
    coreDir: () => CORE_DIR,
    writeRuntimeConfig: (ports) => {
      if (input.configThrows) throw new Error(input.configThrows);
      configs.push(ports);
      return String.raw`${CORE_DIR}\runtime.yaml#${SECRET_SENTINEL}`;
    },
    spawn: (exePath, args) => {
      if (input.spawnThrows) throw new Error(input.spawnThrows);
      const fake = makeChild(nextPid++);
      spawned.push(fake);
      spawns.push({ exePath, args });
      return fake.child;
    },
    appendLog: (line) => { logs.push(line); },
    sleep: async (ms) => { clock.now += ms; },
    now: () => clock.now,
  };
  const spawns: Array<{ exePath: string; args: string[] }> = [];
  const manager = createCoreManager(deps);
  return {
    manager,
    clock,
    spawns,
    configs,
    logs,
    spawned,
    ownProbes,
    externalProbeCount: () => externalProbes,
    /** 所有 await 链都只走微任务（sleep 是假的），一个宏任务边界即可排空。 */
    flush: async () => { for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0)); },
  };
}

describe("core-manager：external 态不动手", () => {
  it("控制器可达就是 external：不 spawn、不写配置、不动端口", async () => {
    const h = harness({ externalReachable: true });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "running", mode: "external", pid: null, controller: "http://127.0.0.1:9090", reason: null });
    expect(status.ports).toBeNull();
    expect(h.spawns).toHaveLength(0);
    expect(h.configs).toHaveLength(0);
    // 两颗内核抢同一套端口才是真事故，所以这里连一次 spawn 都不许有。
    expect(h.logs.join("\n")).toContain("不启进程");
  });

  it("external 态的 stop 只清账，绝不 kill 别人那颗", async () => {
    const h = harness({ externalReachable: true });
    await h.manager.start();
    const status = await h.manager.stop();
    expect(status.state).toBe("stopped");
    expect(status.mode).toBeNull();
    expect(h.spawned).toHaveLength(0);
  });

  it("没发现 Verge 时不去探测空地址", async () => {
    const h = harness({ external: null });
    await h.manager.start();
    expect(h.externalProbeCount()).toBe(0);
  });
});

describe("core-manager：spawn 之前的闸门", () => {
  it("Verge 在跑＝blocked，连 runtime config 都不写", async () => {
    const h = harness({ vergeRunning: true });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "verge-running" });
    expect(h.spawns).toHaveLength(0);
    expect(h.configs).toHaveLength(0);
  });

  it("非 win32＝blocked，不去猜人家的进程表", async () => {
    const h = harness({ platform: "darwin" });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "unsupported-platform", detail: "darwin" });
    expect(h.spawns).toHaveLength(0);
  });

  it("本机没有内核＝blocked 等下载，绝不自己联网拉包", async () => {
    const h = harness({ installedExe: null, bundledExe: null });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "no-binary" });
    expect(status.detail).toContain("下载");
    expect(h.spawns).toHaveLength(0);
  });

  it("runtime 配置写不出来＝no-config，一颗都不 spawn", async () => {
    // 让内核去吃一份坏配置，它会自己退出；那串日志与真崩溃一模一样，
    // 于是「用户没选订阅」被演成「我们的内核会崩」。这一档必须拦在 spawn 之前。
    const h = harness({ configThrows: "no-profile：没有选中的订阅" });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "no-config", pid: null, ports: null });
    expect(status.detail).toContain("没有选中的订阅");
    expect(h.spawns).toHaveLength(0);
    // 抛在 push 之前：盘上一枚没人吃的孤儿配置都不该多出来。
    expect(h.configs).toHaveLength(0);
    expect(h.logs.join("\n")).toContain("runtime 配置写不出来，不起");
  });

  it("已经在跑的那颗不许被第二个 start 顶掉", async () => {
    const h = harness();
    await h.manager.start();
    await h.manager.start();
    await h.manager.start();
    expect(h.spawns).toHaveLength(1);
  });

  it("起还没走完时再点一次＝同一个在途请求，不多起一颗", async () => {
    // running 那道守卫挡不住 starting 那几秒：8s 窗口里的连点必须并成一次。
    const h = harness({ readyAfter: 4 });
    const [a, b] = await Promise.all([h.manager.start(), h.manager.start()]);
    expect(h.spawns).toHaveLength(1);
    expect(a.state).toBe("running");
    expect(b).toEqual(a);
  });

  it("起还没走完时点停止，等它回来再 kill，不许留一颗正在起的内核", async () => {
    const h = harness({ readyAfter: 4 });
    const started = h.manager.start();
    const stopped = h.manager.stop();
    const [a, b] = await Promise.all([started, stopped]);
    expect(a.state).toBe("running");
    expect(b.state).toBe("stopped");
    expect(h.spawns).toHaveLength(1);
    expect(h.spawned[0].killCount()).toBe(1);
  });
});

describe("core-manager：端口是一起挑的一对", () => {
  it("默认档被占时整对挪到 FALLBACK_PORT_START", async () => {
    const h = harness({ usedPorts: [DEFAULT_MIXED_PORT] });
    const status = await h.manager.start();
    expect(status.ports).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
    // 配置吃的必须是同一对，否则页面显示的端口就不是真在监听的那一个。
    expect(h.configs[0]).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
  });

  it("controller 单独被占也要挪对（只查 mixed 会起在半套端口上）", async () => {
    const h = harness({ usedPorts: [DEFAULT_CONTROLLER_PORT] });
    const status = await h.manager.start();
    expect(status.ports?.mixed).toBe(FALLBACK_PORT_START);
  });

  it("扫满都没空＝no-port，一颗都不起", async () => {
    const jammed = [DEFAULT_MIXED_PORT, DEFAULT_CONTROLLER_PORT];
    for (let offset = 0; offset < PORT_SCAN_LIMIT + 5; offset += 1) {
      jammed.push(FALLBACK_PORT_START + offset, FALLBACK_PORT_START + offset + 1);
    }
    const h = harness({ usedPorts: jammed });
    const status = await h.manager.start();
    expect(status).toMatchObject({ reason: "no-port" });
    expect(status.detail).toContain(String(FALLBACK_PORT_START));
    expect(h.spawns).toHaveLength(0);
  });

  it("装配声明的首选档（Verge 那本账上那一组）优先于硬默认", async () => {
    // 数据面按 9097/7896 找内核；我们若按 DEFAULT_* 起，页面就永远看不见这颗，且不报错。
    const h = harness({ preferred: { mixed: 7896, controller: 9097 } });
    const status = await h.manager.start();
    expect(status.ports).toEqual({ mixed: 7896, controller: 9097 });
    expect(h.configs[0]).toEqual({ mixed: 7896, controller: 9097 });
    expect(h.ownProbes[0]).toBe(9097);
  });

  it("首选档撞上也要整对退到扫描段，退完报的是真端口", async () => {
    const h = harness({ preferred: { mixed: 7896, controller: 9097 }, usedPorts: [9097] });
    const status = await h.manager.start();
    expect(status.ports).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
    expect(h.ownProbes[0]).toBe(FALLBACK_PORT_START + 1);
  });
});

describe("core-manager：就绪只认控制器答话", () => {
  it("第 3 次探测才答话也算起来了，startedAt 用注入时钟", async () => {
    const h = harness({ readyAfter: 3 });
    const status = await h.manager.start();
    expect(status.state).toBe("running");
    expect(status.pid).toBe(4100);
    expect(status.controller).toBe(`http://127.0.0.1:${status.ports?.controller}`);
    expect(status.startedAt).toBe(h.clock.now);
  });

  it("起了但不应答＝not-ready，并且把自己那颗 kill 掉", async () => {
    const h = harness({ neverReady: true });
    const before = h.clock.now;
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "exited", reason: "not-ready", pid: null });
    expect(h.spawned[0].killCount()).toBe(1);
    // 超时必须真的等过 readyTimeoutMs，不能被假 sleep 骗成一轮就退出。
    expect(h.clock.now - before).toBeGreaterThanOrEqual(CORE_READY_TIMEOUT_MS);
    expect(h.ownProbes.length).toBeGreaterThanOrEqual(2);
  });

  it("spawn 抛错＝spawn-failed，原因原文透出不吞", async () => {
    const h = harness({ spawnThrows: "spawn EACCES" });
    const status = await h.manager.start();
    expect(status).toMatchObject({ state: "exited", reason: "spawn-failed", detail: "spawn EACCES" });
  });

  it("命令行只有 -d/-f，且 -d 是 Mochi 自己的 core 目录", async () => {
    const h = harness();
    await h.manager.start();
    expect(h.spawns[0].args).toEqual(["-d", CORE_DIR, "-f", `${CORE_DIR}\\runtime.yaml#${SECRET_SENTINEL}`]);
  });

  it("core.log 里不许出现口令哨兵", async () => {
    const h = harness();
    await h.manager.start();
    h.spawned[0].emitStderr('time=... level=warning msg="listening 127.0.0.1:9097"\n');
    expect(h.logs.length).toBeGreaterThan(0);
    expect(h.logs.join("\n")).not.toContain(SECRET_SENTINEL);
    // 每一行都得带时间戳：装配层是纯 append，没时间戳的行事后没法对齐是哪一次启动。
    for (const line of h.logs) expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /);
  });

  it("内核的 stderr 要进日志，多行压平成一条", async () => {
    const h = harness();
    await h.manager.start();
    h.spawned[0].emitStderr("line one\nline two\n");
    expect(h.logs.join("\n")).toContain("err line one | line two");
  });
});

describe("core-manager：崩溃自愈有预算", () => {
  it("崩一次自动重起一次，并沿用原来那组端口", async () => {
    const h = harness();
    await h.manager.start();
    const ports = h.manager.status().ports;
    h.spawned[0].fireExit(1);
    await h.flush();
    expect(h.manager.status()).toMatchObject({ state: "running", healAttempts: 1 });
    expect(h.manager.status().ports).toEqual(ports);
    expect(h.spawns).toHaveLength(2);
  });

  it("连崩打满 MAX_SELF_HEAL 后不再重起，并把原因说清楚", async () => {
    const h = harness();
    await h.manager.start();
    for (let i = 0; i < MAX_SELF_HEAL + 2; i += 1) {
      const latest = h.spawned[h.spawned.length - 1];
      latest.fireExit(2);
      await h.flush();
    }
    expect(h.spawns).toHaveLength(MAX_SELF_HEAL + 1);
    expect(h.manager.status()).toMatchObject({ reason: "self-heal-exhausted", healAttempts: MAX_SELF_HEAL });
    expect(h.logs.join("\n")).toContain("不再重起");
  });

  it("我们自己按下的停止不计入自愈", async () => {
    const h = harness();
    await h.manager.start();
    await h.manager.stop();
    h.spawned[0].fireExit(null, "SIGTERM");
    await h.flush();
    expect(h.manager.status().healAttempts).toBe(0);
    expect(h.spawns).toHaveLength(1);
  });

  it("撑过 CORE_HEAL_RESET_MS 的那次崩溃要补满预算", async () => {
    const h = harness();
    await h.manager.start();
    // 先烧掉两次预算，再让内核活过重置窗口后崩一次。
    h.spawned[0].fireExit(1);
    await h.flush();
    h.spawned[1].fireExit(1);
    await h.flush();
    expect(h.manager.status().healAttempts).toBe(2);
    h.clock.now += CORE_HEAL_RESET_MS + 1_000;
    h.spawned[2].fireExit(1);
    await h.flush();
    expect(h.manager.status().healAttempts).toBe(1);
    expect(h.manager.status().state).toBe("running");
  });

  it("预算打满后人工 resetHealBudget + start 能再起", async () => {
    const h = harness();
    await h.manager.start();
    for (let i = 0; i < MAX_SELF_HEAL + 1; i += 1) {
      h.spawned[h.spawned.length - 1].fireExit(1);
      await h.flush();
    }
    expect(h.manager.status().reason).toBe("self-heal-exhausted");
    h.manager.resetHealBudget();
    const status = await h.manager.start();
    expect(status.state).toBe("running");
    expect(status.healAttempts).toBe(0);
  });

  it("已被换掉的那颗进程退出，不许动现在的账", async () => {
    const h = harness();
    await h.manager.start();
    const stale = h.spawned[0];
    stale.fireExit(1);
    await h.flush();
    // 现在活着的是第 2 颗；把第 1 颗再叫一次（真 spawn 不会，但守卫必须挡住）。
    stale.fireExit(1);
    await h.flush();
    expect(h.spawns).toHaveLength(2);
    expect(h.manager.status().healAttempts).toBe(1);
  });
});

describe("core-manager：restart 与状态读出", () => {
  it("restart 先 kill 自己那颗、再重新起一组，并把自愈计数归零", async () => {
    const h = harness();
    await h.manager.start();
    h.spawned[0].fireExit(1);
    await h.flush();
    expect(h.manager.status().healAttempts).toBe(1);
    const status = await h.manager.restart();
    // 被 kill 的必须是当下活着那颗（第 2 颗），第 1 颗是自己崩的、早就没了。
    expect(h.spawned[0].killCount()).toBe(0);
    expect(h.spawned[1].killCount()).toBe(1);
    expect(status.state).toBe("running");
    expect(status.healAttempts).toBe(0);
    expect(h.spawns).toHaveLength(3);
  });

  it("status() 回的是副本：外面改不动我们的账", async () => {
    const h = harness();
    await h.manager.start();
    const read = h.manager.status();
    read.state = "blocked";
    expect(h.manager.status().state).toBe("running");
  });
});

describe("core-manager：原因词表没有死词", () => {
  /**
   * i18n 那两把尺都只朝一个方向量（枚举里的每一档，三种语言都得有话），所以
   * 「枚举与语言里挂着一档本模块永远不会说出的原因」两头都不红——`CORE_REASONS` 里
   * 那四档下载/摘要/解压的词就是这么活到 T11 的：本模块从不下载，而 T11 给更新另起了
   * `CORE_UPDATE_REASONS`，那四档从此不会有生产者。这条反过来按源码扫：每一档都得在这儿
   * 以字面量出现过。留着死词不是无害——页面会替它编一句人话，读的人据此以为「内核会因为
   * 下载失败而停着」，而那件事在这台机器上永远不会发生。
   */
  it("CORE_REASONS 每一档都在本模块被产出过", () => {
    const src = readFileSync(resolve(__dirname, "core-manager.ts"), "utf8");
    const dead = CORE_REASONS.filter((reason) => !src.includes(`"${reason}"`));
    expect(dead, `这些原因没人生产：${dead.join(", ")}`).toEqual([]);
    // 正对照：锚点本身得有效——扫不到任何字面量＝尺子坏了，不是词表干净。
    expect(CORE_REASONS.filter((reason) => src.includes(`"${reason}"`)).length).toBe(CORE_REASONS.length);
  });
});

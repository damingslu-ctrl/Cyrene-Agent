/**
 * 内核宿主装配层的测试：真目录 + 真读账 + 假进程。
 *
 * 判据在 `core-manager` / `core-source` 那儿用假端口钉死了；这里只证接线，
 * 而接线上最贵的三件事恰好都在这一层：口令跟谁走、端口跟谁走、我们起的这颗
 * 内核页面看不看得见。三条都可能「接错了但全绿」，所以每条都得有字节级的证据。
 *
 * T11 把这层加了一件事，也照同一个口径证：**更新只换 `<userData>/core` 里那个文件**。
 * 是「换文件」还是「动进程」得能从字节与 spawn 计数上分开看出来，因为这两件事在真机上
 * 的后果完全不同——前者最多是下次起内核吃新版，后者是用户正在用的代理当场断。
 */
import { createHash } from "node:crypto";
import { createServer, type AddressInfo } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  CORE_MODES,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MIXED_PORT,
  FALLBACK_PORT_START,
  isOwnCoreMode,
} from "../../shared/core-types";
import {
  createCoreAssembly,
  createControllerProbe,
  installedCoreDirs,
  toCoreChild,
  type CoreAssembly,
} from "./core-bootstrap";
import type { CoreChild } from "./core-manager";
import { MIHOMO_RELEASE_API_URL, STAGING_DIR_NAME, sha256Hex, type UpdateNetwork } from "./mihomo-update";
import { PROFILES_DIR } from "./profile-store-port";
import { PROFILES_FILE } from "./profiles-store";
import { RUNTIME_DIR } from "./runtime-config";

const VERGE_PLACEHOLDER = "set-your-secret";
const OURS_HEX = "9f2c41a7be05d8136ce4a0f1d2b87e9c3a5f60718293a4b5c6d7e8f9012345ab";
const BODY = "proxies:\n  - name: hk-1\n    type: ss\n    server: 1.2.3.4\n";
const CLOCK = 1_732_000_000_000;

/** 假包与假内核正文：更新那几条判据比的都是字节，这里得给出真的字节。 */
const ZIP_BYTES = Buffer.from("fake-mihomo-zip-payload");
const NEW_EXE_BYTES = Buffer.from("new-mihomo-exe\0\0\0");
const OLD_EXE_BYTES = Buffer.from("old-mihomo-exe\0\0");

/** 一份「能装」的发布页：windows-amd64 的 plain 包排第一，摘要按 zip 现算。 */
function releaseJson(zip: Buffer, tag = "v1.19.33") {
  const name = `mihomo-windows-amd64-${tag}.zip`;
  return {
    tag_name: tag,
    prerelease: false,
    draft: false,
    assets: [
      {
        name: "mihomo-darwin-arm64.zip",
        digest: null,
        browser_download_url: "https://github.com/MetaCubeX/mihomo/releases/download/other",
      },
      {
        name,
        digest: `sha256:${sha256Hex(zip)}`,
        browser_download_url: `https://github.com/MetaCubeX/mihomo/releases/download/${tag}/${name}`,
      },
    ],
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface AssemblyInput {
  /** clash-verge.yaml 正文；显式 null ＝「那本账压根不在」。 */
  controllerYaml?: string | null;
  current?: string;
  usedPorts?: number[];
  externalReachable?: boolean;
  vergeRunning?: boolean;
  /** 安装目录里有没有那颗可借用内核（走注入的 readdir）。 */
  installed?: boolean;
  /** `<userData>/core/mihomo.exe` 在不在（走注入的 exists）。 */
  bundled?: boolean;
  /** 预置我们自己那枚存盘的口令。 */
  secretOnDisk?: string;
  /** 发布页正文；不传＝那份「能装」的假发布页。传 null 就让它回原样（判定自己走）。 */
  release?: unknown;
  /** 假包正文（摘要按它现算，所以换它就等于换指纹）。 */
  zip?: Buffer;
  /** 假解压吐出来的那颗 exe 正文。 */
  exe?: Buffer;
  releaseThrows?: string;
  downloadThrows?: string;
  extractThrows?: string;
  /** 预置 `<userData>/core/mihomo.exe` 的正文：给成 `exe` 同一个值就落进「已是最新」那一档。 */
  currentExe?: Buffer;
  /**
   * 就绪敲门挂在这条 promise 上：用来把内核钉在 `starting` 那一档不动，
   * 好让「正在起的那几秒里点更新」这条判据有一个确定的现场（不靠抢微任务时序）。
   */
  readyHold?: Promise<void>;
}

function fakeChild(pid: number) {
  const sink: Array<(chunk: unknown) => void> = [];
  const child: CoreChild = {
    pid,
    stdout: { on: (_event, listener) => { sink.push(listener); } },
    stderr: { on: (_event, listener) => { sink.push(listener); } },
    on: () => undefined,
    kill: () => true,
  };
  return { child, emitStderr: (text: string) => { for (const listener of sink) listener(text); } };
}

/**
 * 整棵目录树的字节指纹（相对名 + 内容一起进哈希）。
 *
 * 「 listings 没变」只证了文件名那一层：有人往 Verge 目录里改写一个已有文件，名字不变、
 * 内容变了，列表尺读不出来。spec D2 那条「Verge 的目录一个字节都不碰」要的是这种证据。
 */
function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, name.name);
      const relative = prefix ? `${prefix}/${name.name}` : name.name;
      if (name.isDirectory()) walk(file, relative);
      else hash.update(`${relative}\n${readFileSync(file).length}\n`).update(readFileSync(file));
    }
  };
  if (existsSync(root)) walk(root, "");
  return hash.digest("hex");
}

function assembly(input: AssemblyInput = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "core-boot-"));
  dirs.push(base);
  const configRoot = path.join(base, "verge");
  const userData = path.join(base, "mochi");
  mkdirSync(path.join(configRoot, PROFILES_DIR), { recursive: true });
  mkdirSync(userData, { recursive: true });
  if (input.controllerYaml !== null) {
    writeFileSync(
      path.join(configRoot, "clash-verge.yaml"),
      input.controllerYaml ?? `external-controller: 127.0.0.1:9097\nsecret: ${VERGE_PLACEHOLDER}\nmixed-port: 7896\n`,
      "utf8",
    );
  }
  writeFileSync(
    path.join(configRoot, PROFILES_FILE),
    stringifyYaml({
      current: input.current ?? "Sub00000001",
      items: [{ uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/a", name: "机场 A" }],
    }, { lineWidth: 0 }),
    "utf8",
  );
  writeFileSync(path.join(configRoot, PROFILES_DIR, "Sub00000001.yaml"), BODY, "utf8");

  const installedDir = String.raw`C:\Program Files\Clash Verge`;
  const bundledExe = path.join(userData, "core", "mihomo.exe");
  if (input.secretOnDisk !== undefined) {
    mkdirSync(path.join(userData, "core"), { recursive: true });
    writeFileSync(path.join(userData, "core", "secret"), `${input.secretOnDisk}\n`, "utf8");
  }
  if (input.currentExe !== undefined) {
    mkdirSync(path.join(userData, "core"), { recursive: true });
    writeFileSync(bundledExe, input.currentExe);
  }

  const spawns: Array<{ exePath: string; args: string[]; cwd: string }> = [];
  const kids: ReturnType<typeof fakeChild>[] = [];
  const declared = "http://127.0.0.1:9097";
  let pid = 5200;
  /**
   * 敲门计数兼假时钟的推进量。
   *
   * 「那本账声明的端口」正好就是我们选中的端口时，external 检查与就绪敲门问的是同一个地址，
   * 所以这里得按**有没有 spawn 过**来答，不能按 URL 答（按 URL 答会在起内核那次永远不应答）。
   * 时钟每敲一次走 2s：接错线时 `waitReady` 会在 8s 超时后报 `not-ready`，而不是把整个测试进程挂死。
   */
  let knocks = 0;
  const started = () => spawns.length > 0;

  /** 两条出口各记一笔：busy 那一条的判据就是「一次请求都没发出去」。 */
  const zip = input.zip ?? ZIP_BYTES;
  const updateCalls = { json: [] as string[], bytes: [] as string[] };
  const updateNetwork: UpdateNetwork = {
    async getJson(url) {
      updateCalls.json.push(url);
      if (input.releaseThrows) throw new Error(input.releaseThrows);
      return input.release === undefined ? releaseJson(zip) : input.release;
    },
    async downloadBytes(url) {
      updateCalls.bytes.push(url);
      if (input.downloadThrows) throw new Error(input.downloadThrows);
      return zip;
    },
  };
  /** 假的系统解压：把「包里的内容」直接落成一颗 exe，条目名与真包一致。 */
  const extract = async (_archive: string, destDir: string): Promise<string[]> => {
    if (input.extractThrows) throw new Error(input.extractThrows);
    writeFileSync(path.join(destDir, "mihomo-windows-amd64.exe"), input.exe ?? NEW_EXE_BYTES);
    return ["mihomo-windows-amd64.exe"];
  };

  const core: CoreAssembly = createCoreAssembly({
    getConfigRoot: () => configRoot,
    userData,
    env: { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "", LOCALAPPDATA: String.raw`C:\Users\m\AppData\Local` },
    isVergeRunning: () => input.vergeRunning ?? false,
    usedPorts: () => input.usedPorts ?? [],
    readdir: (dir) => (dir === installedDir && input.installed !== false ? ["resources", "verge-mihomo-alpha.exe", "verge-mihomo.exe"] : []),
    exists: (file) => (file === bundledExe ? input.bundled === true : existsSync(file)),
    now: () => CLOCK + knocks * 2_000,
    probeController: async (url) => {
      knocks += 1;
      if (!started()) return url === declared && input.externalReachable === true;
      if (input.readyHold) await input.readyHold;
      return true;
    },
    spawnCore: (exePath, args, cwd) => {
      spawns.push({ exePath, args, cwd });
      const kid = fakeChild(pid++);
      kids.push(kid);
      return kid.child;
    },
    updateNetwork,
    extract,
  });

  return {
    core,
    base,
    configRoot,
    userData,
    spawns,
    kids,
    updateCalls,
    bundledExe,
    zip,
    exeBytes: () => (existsSync(bundledExe) ? readFileSync(bundledExe) : null),
    logText: () => {
      const file = path.join(userData, "core.log");
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    },
    runtimeDoc: () => parseYaml(readFileSync(path.join(userData, RUNTIME_DIR, "core.yaml"), "utf8")) as Record<string, unknown>,
    listedIn: (dir: string) => readdirSync(dir).sort(),
  };
}

describe("installedCoreDirs：安装版把内核放哪儿", () => {
  it("三个位置按顺序去重，缺哪个环境变量就少哪个", () => {
    expect(installedCoreDirs({
      PROGRAMFILES: String.raw`C:\Program Files`,
      "PROGRAMFILES(X86)": String.raw`C:\Program Files (x86)`,
      LOCALAPPDATA: String.raw`C:\Users\m\AppData\Local`,
    })).toEqual([
      String.raw`C:\Program Files\Clash Verge`,
      String.raw`C:\Program Files (x86)\Clash Verge`,
      String.raw`C:\Users\m\AppData\Local\Programs\Clash Verge`,
    ]);
    expect(installedCoreDirs({ PROGRAMFILES: String.raw`D:\Programs` })).toEqual([String.raw`D:\Programs\Clash Verge`]);
    expect(installedCoreDirs({})).toEqual([]);
    // 同一处别找两遍：机器上没装 32 位版时这两个变量可能指向同一个目录。
    expect(installedCoreDirs({
      PROGRAMFILES: String.raw`C:\Program Files`,
      "PROGRAMFILES(X86)": String.raw`C:\Program Files`,
    })).toEqual([String.raw`C:\Program Files\Clash Verge`]);
  });
});

describe("createControllerProbe：只在听就算在", () => {
  async function withServer(handler: (req: unknown, res: import("node:http").ServerResponse) => void) {
    const server = createServer(handler as never);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      port,
      // fetch 的连接池会把 keep-alive  socket 留在池里；不先拆连接，close() 就永远等不到「所有连接结束」。
      close: async () => {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it("401 也算「有人在听」：口令不对不等于那儿没进程", async () => {
    // 判成「没人」我们会在同一台机器上再 spawn 第二颗去抢端口——external 态就永远立不起来。
    const srv = await withServer((_req, res) => { res.writeHead(401); res.end("Unauthorized"); });
    try {
      const probe = createControllerProbe({ timeoutMs: 2_000 });
      expect(await probe(`http://127.0.0.1:${srv.port}`)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it("200 应答＝true；没人听＝false", async () => {
    const srv = await withServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"version":"v1.18.10"}'); });
    try {
      const probe = createControllerProbe({ timeoutMs: 2_000 });
      expect(await probe(`http://127.0.0.1:${srv.port}`)).toBe(true);
    } finally {
      await srv.close();
    }
    const probe = createControllerProbe({ timeoutMs: 500 });
    // srv 已关：这个端口此刻没人听（端口号是刚释放的，重试一次就够）。
    expect(await probe(`http://127.0.0.1:${srv.port}`)).toBe(false);
  });

  it("答话慢到超过窗口也算不应答：门铃按太久不会有新答案", async () => {
    const srv = await withServer(() => { /* 永不回话 */ });
    try {
      const probe = createControllerProbe({ timeoutMs: 60 });
      expect(await probe(`http://127.0.0.1:${srv.port}`)).toBe(false);
    } finally {
      await srv.close();
    }
  });
});

describe("toCoreChild：pid 与异步 error", () => {
  it("spawn 没回 pid＝当场判失败，并且把这只 kill 掉", () => {
    let kills = 0;
    const halfDead = { pid: undefined, kill: () => { kills += 1; return true; }, on: () => undefined } as never;
    expect(() => toCoreChild(halfDead)).toThrow(/pid/);
    expect(kills).toBe(1);
  });

  it("ENOENT 是异步 'error' 事件：不接住它，日志里只剩「控制器不应答」这句废话", () => {
    const seen: string[] = [];
    const child = {
      pid: 4321,
      stdout: null,
      stderr: null,
      on: (event: string, listener: (arg: unknown) => void) => { if (event === "error") listener(new Error("spawnSync C:\\nope.exe ENOENT")); },
      kill: () => true,
    } as never;
    toCoreChild(child, (detail) => seen.push(detail));
    expect(seen).toEqual(["spawnSync C:\\nope.exe ENOENT"]);
  });

  it("管理器那张窄口给全：pid、两条流、exit、kill", () => {
    const child = {
      pid: 777,
      stdout: { on: () => undefined },
      stderr: { on: () => undefined },
      on: () => undefined,
      kill: () => true,
    };
    const view = toCoreChild(child as never);
    expect(view.pid).toBe(777);
    expect(typeof view.kill).toBe("function");
    expect(view.stdout).toEqual(child.stdout);
  });
});

describe("core-bootstrap：口令跟着数据面走", () => {
  it("账上那一枚原样用，哪怕它是 15 位的出厂占位值", async () => {
    const h = assembly({ installed: true });
    const status = await h.core.manager.start();
    expect(status.state).toBe("running");
    expect(h.core.secretSource()).toBe("verge");
    // 嫌它不成形状而自己生成一枚 → 起来的那颗把整条数据面挡在 401 外面，且没有任何报错。
    expect(h.runtimeDoc().secret).toBe(VERGE_PLACEHOLDER);
    expect(existsSync(path.join(h.userData, "core", "secret"))).toBe(false);
  });

  it("账上没写口令才轮到我们那一枚，并且落进 <userData>/core/secret", async () => {
    const h = assembly({ installed: true, controllerYaml: "external-controller: 127.0.0.1:9097\nmixed-port: 7896\n" });
    await h.core.manager.start();
    expect(h.core.secretSource()).toBe("mochi");
    const stored = readFileSync(path.join(h.userData, "core", "secret"), "utf8").trim();
    expect(stored).toHaveLength(64);
    expect(h.runtimeDoc().secret).toBe(stored);
  });

  it("盘上已经有我们那枚就接着用：客户端重开不许换口令", async () => {
    const h = assembly({ installed: true, controllerYaml: "external-controller: 127.0.0.1:9097\n", secretOnDisk: OURS_HEX });
    await h.core.manager.start();
    expect(h.core.secretSource()).toBe("mochi");
    expect(h.runtimeDoc().secret).toBe(OURS_HEX);
  });

  it("core.log 里没有口令，哪怕内核自己把它吐到 stderr", async () => {
    const h = assembly({ installed: true });
    await h.core.manager.start();
    h.kids[0].emitStderr(`listening on 127.0.0.1:9097 with secret ${VERGE_PLACEHOLDER}\n`);
    const log = h.logText();
    expect(log).toContain("«密钥»");
    expect(log).not.toContain(VERGE_PLACEHOLDER);
  });

  it("我们自己那枚同样不许进日志", async () => {
    const h = assembly({ installed: true, controllerYaml: "external-controller: 127.0.0.1:9097\n" });
    await h.core.manager.start();
    const secret = readFileSync(path.join(h.userData, "core", "secret"), "utf8").trim();
    h.kids[0].emitStderr(`Authorization: Bearer ${secret}`);
    expect(h.logText()).not.toContain(secret);
    expect(h.logText()).toContain("«密钥»");
  });
});

describe("core-bootstrap：端口跟着同一本账，覆写跟着当下那颗", () => {
  it("首选档就是账上声明的那一组（7896/9097）", async () => {
    const h = assembly({ installed: true });
    const status = await h.core.manager.start();
    expect(status.ports).toEqual({ mixed: 7896, controller: 9097 });
    expect(h.runtimeDoc()["external-controller"]).toBe("127.0.0.1:9097");
    expect(h.runtimeDoc()["mixed-port"]).toBe(7896);
  });

  it("声明的那组被占了：退到扫描段，并把真端口交给数据面", async () => {
    const h = assembly({ installed: true, usedPorts: [9097] });
    const status = await h.core.manager.start();
    expect(status.ports).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
    const override = h.core.controllerOverride();
    // 页面还按 9097 找就全瞎了——覆写报的必须是真在听的那一号。
    expect(override).toMatchObject({
      baseUrl: `http://127.0.0.1:${FALLBACK_PORT_START + 1}`,
      mixedPort: FALLBACK_PORT_START,
      secret: VERGE_PLACEHOLDER,
    });
  });

  it("账上只有 mixed-port、控制器地址没写端口：各归各的默认档", async () => {
    const h = assembly({ installed: true, controllerYaml: `external-controller: ":9097"\nsecret: ${VERGE_PLACEHOLDER}\nmixed-port: 7896\n` });
    const status = await h.core.manager.start();
    expect(status.ports).toEqual({ mixed: 7896, controller: 9097 });
  });

  it("没有那本账就用硬默认，并且覆写照样报得出地址", async () => {
    const h = assembly({ installed: true, controllerYaml: null });
    const status = await h.core.manager.start();
    expect(status.ports).toEqual({ mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT });
    const override = h.core.controllerOverride();
    expect(override?.baseUrl).toBe(`http://127.0.0.1:${DEFAULT_CONTROLLER_PORT}`);
    // 账不在＝借不到口令，只能用自己那枚；这一档必须让页面看得见来源。
    expect(h.core.secretSource()).toBe("mochi");
  });

  it("覆写只在我们自己那颗活着时生效：external 与没起都回 null", async () => {
    const external = assembly({ externalReachable: true });
    const status = await external.core.manager.start();
    expect(status.mode).toBe("external");
    // 那颗是 Verge 的：口令、地址都按盘上那本账走，我们不许插一句。
    expect(external.core.controllerOverride()).toBeNull();

    const fresh = assembly({ installed: true });
    expect(fresh.core.controllerOverride()).toBeNull();
    await fresh.core.manager.start();
    expect(fresh.core.controllerOverride()).not.toBeNull();
    await fresh.core.manager.stop();
    expect(fresh.core.controllerOverride()).toBeNull();
  });

  it("自托管那颗（下载来的 mihomo.exe）同样算我们自己的", async () => {
    const h = assembly({ installed: false, bundled: true });
    const status = await h.core.manager.start();
    expect(status.mode).toBe("bundled");
    expect(h.spawns[0].exePath).toBe(path.join(h.userData, "core", "mihomo.exe"));
    expect(h.core.controllerOverride()).not.toBeNull();
  });

  it("isOwnCoreMode 只认我们起的那两档：除 external 之外没有第三颗是别人的", () => {
    // 从 `CORE_MODES` 反着数：加一档 mode 却没回答「归谁」时，它会落进 nonOwn 这一堆，
    // 这条立刻红——装配层 `kill` 的就是这一档，页面三颗按钮的闸门量的也是同一把尺。
    const own = CORE_MODES.filter(isOwnCoreMode);
    expect(own).toEqual(["installed", "bundled"]);
    expect(CORE_MODES.filter((mode) => !isOwnCoreMode(mode))).toEqual(["external"]);
    expect(isOwnCoreMode(null)).toBe(false);
  });
});

describe("core-bootstrap：写只写自己那一侧", () => {
  it("内核吃的是 -d <userData>/core -f <userData>/runtime/core.yaml", async () => {
    const h = assembly({ installed: true });
    await h.core.manager.start();
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0].exePath).toBe(String.raw`C:\Program Files\Clash Verge\verge-mihomo.exe`);
    expect(h.spawns[0].args).toEqual([
      "-d", path.join(h.userData, "core"),
      "-f", path.join(h.userData, RUNTIME_DIR, "core.yaml"),
    ]);
    expect(h.spawns[0].cwd).toBe(path.join(h.userData, "core"));
    expect(h.core.runtimeFile()).toBe(path.join(h.userData, RUNTIME_DIR, "core.yaml"));
  });

  it("Verge 的目录一个字节都不许多：只读它的账", async () => {
    const h = assembly({ installed: true });
    const before = [h.listedIn(h.configRoot), h.listedIn(path.join(h.configRoot, PROFILES_DIR))];
    await h.core.manager.start();
    expect([h.listedIn(h.configRoot), h.listedIn(path.join(h.configRoot, PROFILES_DIR))]).toEqual(before);
    expect(h.listedIn(h.userData)).toEqual(["core", "core.log", RUNTIME_DIR]);
  });

  it("runtime 配置带的是我们的控制面 + 订阅正文，页面上给得出订阅名", async () => {
    const h = assembly({ installed: true });
    await h.core.manager.start();
    const doc = h.runtimeDoc();
    expect((doc.proxies as unknown[]).length).toBe(1);
    expect(doc["external-controller"]).toBe("127.0.0.1:9097");
    expect(h.logText()).toContain("机场 A");
    expect(h.logText()).toContain("口令来源=verge");
  });

  it("订阅没选＝no-config，一颗都不起、core 目录也不预先造出来", async () => {
    const h = assembly({ installed: true, current: "" });
    const status = await h.core.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "no-config" });
    expect(status.detail).toContain("没有选中的订阅");
    expect(h.spawns).toHaveLength(0);
    expect(existsSync(path.join(h.userData, "core"))).toBe(false);
  });

  it("找不到 Verge 数据目录时说的是目录，不是「没有订阅」", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "core-boot-orphan-"));
    dirs.push(base);
    const core = createCoreAssembly({
      getConfigRoot: () => null,
      userData: path.join(base, "mochi"),
      env: { PROGRAMFILES: "C:\\Program Files" },
      // 有内核可借：这样才会走到「读订阅账本」那一步，那句目录缺失才说得出嘴。
      readdir: () => ["verge-mihomo.exe"],
      isVergeRunning: () => false,
      usedPorts: () => [],
      probeController: async () => false,
      spawnCore: () => fakeChild(1).child,
    });
    const status = await core.manager.start();
    expect(status).toMatchObject({ state: "blocked", reason: "no-config" });
    expect(status.detail).toContain("数据目录");
    expect(core.controllerOverride()).toBeNull();
  });
});

describe("core-bootstrap：内核更新只换一个文件，不动进程", () => {
  /** 装成一次的全部证据：字节落了盘、临时层没留、Verge 那边一个字节没多。 */
  it("更新把新字节放进 <userData>/core/mihomo.exe，别的什么都不碰", async () => {
    // `installed: false` 是为了让这一条只证「换文件」这一件事：本机没有安装版时，
    // 回执不该带那句「还没生效」的阴影（它有自己那一条测试）。
    const h = assembly({ installed: false });
    // 一次都没试过：这一档必须是 null，页面那句「上次更新」没有权利画出来。
    expect(h.core.updateState()).toBeNull();
    const vergeFiles = [h.listedIn(h.configRoot), h.listedIn(path.join(h.configRoot, PROFILES_DIR))];
    const vergeBytes = fingerprint(h.configRoot);

    const state = await h.core.updateCore();
    expect(state).toEqual({
      outcome: "installed",
      tag: "v1.19.33",
      asset: "mihomo-windows-amd64-v1.19.33.zip",
      reason: null,
      detail: null,
      at: CLOCK,
    });
    expect(h.exeBytes()).toEqual(NEW_EXE_BYTES);
    expect(h.core.updateState()).toEqual(state);
    expect(path.dirname(h.bundledExe)).toBe(h.core.coreDir());
    // 换装全程住的那一层是过路的地方：败了要能重跑，成了不该留下痕迹。
    expect(existsSync(path.join(h.userData, "core", STAGING_DIR_NAME))).toBe(false);
    expect(h.listedIn(path.join(h.userData, "core"))).toEqual(["mihomo.exe"]);
    expect([h.listedIn(h.configRoot), h.listedIn(path.join(h.configRoot, PROFILES_DIR))]).toEqual(vergeFiles);
    // 名字没变不等于没被碰过：整棵 Verge 树的字节指纹必须一模一样（spec D2）。
    expect(fingerprint(h.configRoot)).toBe(vergeBytes);
    // 这把尺自己得有用：往 Verge 目录里改写一个已有文件，指纹必须变——不然上面那条是恒真。
    writeFileSync(path.join(h.configRoot, PROFILES_FILE), `${BODY}tampered\n`, "utf8");
    expect(fingerprint(h.configRoot)).not.toBe(vergeBytes);
    // 一颗进程都没动：更新那趟连 spawn 都不该有。
    expect(h.spawns).toHaveLength(0);
  });

  /** 出口只有 spec D3 那本发布页；下载地址由发布页说了算，装配层不改写也不放宽。 */
  it("发出去的地址就是 GitHub 发布页，资产地址取自发布页给的那一条", async () => {
    const h = assembly();
    await h.core.updateCore();
    expect(h.updateCalls.json).toEqual([MIHOMO_RELEASE_API_URL]);
    expect(h.updateCalls.bytes[0] ?? "").toMatch(/^https:\/\/github\.com\/MetaCubeX\/mihomo\/releases\/download\//);
  });

  it("发布页给的下载地址不在白名单域名上：一个字节都不下", async () => {
    const h = assembly({
      release: {
        tag_name: "v1.19.33",
        assets: [{
          name: "mihomo-windows-amd64-v1.19.33.zip",
          digest: `sha256:${sha256Hex(ZIP_BYTES)}`,
          browser_download_url: "https://api.github.com.evil.tld/x.zip",
        }],
      },
    });
    expect(await h.core.updateCore()).toMatchObject({ outcome: "failed", reason: "download-failed" });
    expect(h.updateCalls.bytes).toEqual([]);
    expect(h.exeBytes()).toBeNull();
  });

  /**
   * 「已是最新」不看版本号记账，看字节。
   * 这一条在装配层也要证一次：装配层要是把 `releaseUrl`／`bundledExe` 接错，
   * 更新器比的就是别的文件，那句「已经是最新」会一直真——而内核从来没换过。
   */
  it("core 里那颗与包里的逐字节相同时报 latest，且确实没有再写第二次", async () => {
    const h = assembly({ currentExe: NEW_EXE_BYTES });
    const state = await h.core.updateCore();
    expect(state.outcome).toBe("latest");
    expect(state.detail).toContain("逐字节相同");
    expect(h.exeBytes()).toEqual(NEW_EXE_BYTES);
  });

  it("解压败了：旧那颗一个字节都不动，临时层也扫干净", async () => {
    const h = assembly({ currentExe: OLD_EXE_BYTES, extractThrows: "Expand-Archive：退出码 1" });
    const state = await h.core.updateCore();
    expect(state).toMatchObject({ outcome: "failed", reason: "extract-failed", tag: "v1.19.33" });
    expect(state.detail).toContain("退出码 1");
    expect(h.exeBytes()).toEqual(OLD_EXE_BYTES);
    expect(existsSync(path.join(h.userData, "core", STAGING_DIR_NAME))).toBe(false);
  });

  /** 我们那颗还在跑（或正在起）就换不动文件；闸门必须排在下载之前，不然这一次点击先烧 22 MB。 */
  it("自己起的内核在跑时点更新：不发请求、不写文件，只说 busy", async () => {
    const h = assembly({ installed: true });
    await h.core.manager.start();
    expect(h.core.status().state).toBe("running");
    h.updateCalls.json.length = 0;
    h.updateCalls.bytes.length = 0;

    const state = await h.core.updateCore();
    expect(state.outcome).toBe("busy");
    expect(h.updateCalls).toEqual({ json: [], bytes: [] });
    expect(h.exeBytes()).toBeNull();
    expect(h.spawns).toHaveLength(1); // 只有刚才那次起，更新这趟一颗都没动
  });

  /**
   * 「正在起」也算挡着：那一颗进程已经存在、吃的是我们刚写下去的那份 runtime 配置，
   * 这时候换文件等于换掉正在被拉起的那一颗的映像——败得毫无道理且看不出原因。
   */
  it("内核还在 starting 时点更新：一样 busy，一样不发请求", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const h = assembly({ installed: true, readyHold: hold });
    const inflight = h.core.manager.start();
    // 就绪敲门被 readyHold 挂住，所以这一档停在 starting；不必抢时序，让出微任务即可。
    for (let i = 0; i < 200 && h.core.status().state !== "starting"; i += 1) await Promise.resolve();
    expect(h.core.status().state).toBe("starting");
    expect(h.spawns).toHaveLength(1);
    h.updateCalls.json.length = 0;
    h.updateCalls.bytes.length = 0;

    expect(await h.core.updateCore()).toMatchObject({ outcome: "busy" });
    expect(h.updateCalls).toEqual({ json: [], bytes: [] });
    expect(h.exeBytes()).toBeNull();

    release();
    expect((await inflight).state).toBe("running");
  });

  /**
   * 这条最容易接反：external 态那颗进程是 Verge 的，占的是安装目录里的文件，
   * 我们的 `core/mihomo.exe` 从来不在它手上。跟着 busy 挡住，装了 Verge 且退不掉的人
   * 就永远更新不了自托管内核——而那本来跟「谁在跑」不是同一件事。
   */
  it("吃 Verge 控制器时照样换得动：挡的是我们自己的进程，不是别人那颗", async () => {
    const h = assembly({ externalReachable: true, installed: true });
    const status = await h.core.manager.start();
    expect(status.mode).toBe("external");
    expect(status.state).toBe("running");

    expect(await h.core.updateCore()).toMatchObject({ outcome: "installed" });
    expect(h.exeBytes()).toEqual(NEW_EXE_BYTES);
    expect(h.spawns).toHaveLength(0);
    expect(h.kids).toHaveLength(0);
    // 更新写的是我们那一侧的账：日志里那句读回来的口令仍旧不许落盘。
    expect(h.logText()).not.toContain(VERGE_PLACEHOLDER);
  });

  /** 装了 Verge 时按三态发现会优先借安装版：换上不等于生效，这句只能在这里说出口。 */
  it("本机还有安装版时，回执写着「还没生效」那句；没有安装版就不编这句", async () => {
    const withVerge = assembly({ installed: true });
    expect((await withVerge.core.updateCore()).detail).toContain("优先借");

    const alone = assembly({ installed: false });
    expect((await alone.core.updateCore()).detail).toBeNull();
  });

  /** 在途去重也是接线的一部分：装配层每班只造一个更新器，两次点击等同一趟结果。 */
  it("连点两次更新只跑一趟，第二次拿的是同一份下场", async () => {
    const h = assembly();
    const [first, second] = await Promise.all([h.core.updateCore(), h.core.updateCore()]);
    expect(second).toEqual(first);
    expect(h.updateCalls.json).toHaveLength(1);
    expect(h.updateCalls.bytes).toHaveLength(1);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_INSTALLER_ARGS,
  CLIENT_LAUNCH_SETTLE_MS,
  createInstallerLauncher,
  type LaunchHandle,
  type SpawnInstaller,
} from "./installer-launch";

const DIR = path.join("U:", "userData", "updates");
const FINAL = path.join(DIR, "Mochi-Setup-1.16.0.exe");

/* ------------------------------------------------------------------ 假进程 */

interface FakeChild {
  handle: LaunchHandle;
  /** 真 child_process 就是靠这两个事件说话的：测试自己决定什么时候开口。 */
  fire(kind: "spawn" | "error", arg?: unknown): void;
  unrefs(): number;
  listened(kind: "spawn" | "error"): number;
}

/** 没有默认值：`fakeChild(undefined)` 要的就是「拿不到 pid」那一档，不能被默认参数吃掉。 */
function fakeChild(pid?: number): FakeChild {
  const listeners = { spawn: [] as ((arg?: unknown) => void)[], error: [] as ((arg?: unknown) => void)[] };
  let unrefCalls = 0;
  const handle = {
    pid,
    once(event: "spawn" | "error", cb: (arg?: unknown) => void) {
      listeners[event].push(cb);
      return handle;
    },
    unref() {
      unrefCalls += 1;
    },
  } as unknown as LaunchHandle;
  return {
    handle,
    fire(kind, arg) {
      for (const cb of listeners[kind]) cb(arg);
    },
    unrefs: () => unrefCalls,
    listened: (kind) => listeners[kind].length,
  };
}

interface LaunchScript {
  /** 每次都造一颗新的假孩子：多次 launch 不许共用同一颗事件表。 */
  makeChild?(): FakeChild;
  /** 让 spawn() 同步抛（路径非法那一种）。 */
  throwOnSpawn?: Error;
  /** 记录 spawn 的入参。 */
  onSpawn?(file: string, args: readonly string[], init: Record<string, unknown>): void;
}

function launcher(script: LaunchScript = {}, options: Parameters<typeof createInstallerLauncher>[0] = {}) {
  const spawned: { file: string; args: readonly string[]; init: Record<string, unknown> }[] = [];
  const child = script.makeChild?.() ?? fakeChild(4242);
  const spawnImpl: SpawnInstaller = (file, args, init) => {
    spawned.push({ file, args, init });
    script.onSpawn?.(file, args, init);
    if (script.throwOnSpawn) throw script.throwOnSpawn;
    return child.handle;
  };
  const logs: string[] = [];
  const launcher$ = createInstallerLauncher({ spawnImpl, log: (line) => logs.push(line), settleMs: 30, ...options });
  return { launcher: launcher$, spawned, logs, child: () => child };
}

/* -------------------------------------------------------------------- 尺 */

describe("installer-launch：spawn 返回不等于安装器起来了", () => {
  it("等 spawn 事件落下来才算成功，并当场 unref（安装器要在我们退出之后还活着）", async () => {
    const h = launcher();
    const pending = h.launcher.launch(FINAL);
    // 事件还没来：这一档必须仍然是「没结论」——立刻 resolve 的形状是退了而安装器根本没跑。
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    h.child().fire("spawn");
    expect(await pending).toEqual({ ok: true, pid: 4242 });
    expect(h.child().unrefs()).toBe(1);
  });

  it("ENOENT 是以异步 error 报的：那一档不许被读成起来了，也不许 unref", async () => {
    const h = launcher();
    const pending = h.launcher.launch(FINAL);
    h.child().fire("error", new Error("spawn ENOENT"));
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("spawn ENOENT");
    expect(h.child().unrefs()).toBe(0);
  });

  it("两个事件一个都不来也要收口：到点报失败，不许把调用方挂死", async () => {
    const h = launcher({}, { settleMs: 15 });
    const started = Date.now();
    const result = await h.launcher.launch(FINAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("没报 spawn 也没报 error");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(CLIENT_LAUNCH_SETTLE_MS).toBeGreaterThan(0);
  });

  it("spawn 同步抛（路径根本不能要）也算没起来", async () => {
    const h = launcher({ throwOnSpawn: new Error("EINVAL") });
    const result = await h.launcher.launch(FINAL);
    expect(result).toEqual({ ok: false, detail: "安装器没起来：EINVAL" });
  });
});

describe("installer-launch：参数与句柄的形状", () => {
  it("三颗参数一个都不能少，顺序也不许漂", async () => {
    const h = launcher();
    const pending = h.launcher.launch(FINAL);
    h.child().fire("spawn");
    await pending;
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0].args).toEqual(["/S", "--updated", "--force-run"]);
    expect([...CLIENT_INSTALLER_ARGS]).toEqual(["/S", "--updated", "--force-run"]);
  });

  it("detached + stdio ignore + windowsHide：退出后安装器要活着，且不拖句柄、不闪控制台", async () => {
    const h = launcher();
    const pending = h.launcher.launch(FINAL);
    h.child().fire("spawn");
    await pending;
    expect(h.spawned[0].init).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
    expect(h.spawned[0].file).toBe(FINAL);
    if (!h.logs.length) throw new Error("起来了却不说是哪一颗、什么参数：这一格事后无法核对");
    expect(h.logs[0]).toContain("pid 4242");
  });

  it("pid 拿不到也不当失败（spawn 事件本身就是凭据）", async () => {
    const h = launcher({ makeChild: () => fakeChild(undefined) });
    const pending = h.launcher.launch(FINAL);
    h.child().fire("spawn");
    expect(await pending).toEqual({ ok: true, pid: null });
  });
});

describe("installer-launch：只起安装包形状的那一颗", () => {
  it("basename 不像安装包的，一个都不 spawn", async () => {
    const h = launcher();
    for (const file of [
      path.join(DIR, "notes.txt"),
      path.join(DIR, "Mochi-Setup-1.16.0.exe.part"),
      path.join(DIR, "mihomo.exe"),
      path.join(DIR, ""),
      "C:\\Windows\\System32\\cmd.exe",
    ]) {
      const result = await h.launcher.launch(file);
      expect(result.ok, file).toBe(false);
      if (!result.ok) expect(result.detail, file).toContain("不是安装包的样子");
    }
    expect(h.spawned).toEqual([]);
  });

  it("正对照：预发布号与带空格的路径都照样起（拒的不是形状之外的东西）", async () => {
    const h = launcher();
    for (const file of [
      path.join(DIR, "Mochi-Setup-1.16.0-beta.2.exe"),
      path.join("C:\\Users\\some name\\AppData\\Local\\updates", "Mochi-Setup-1.16.0.exe"),
    ]) {
      const pending = h.launcher.launch(file);
      h.child().fire("spawn");
      expect((await pending).ok, file).toBe(true);
    }
    expect(h.spawned).toHaveLength(2);
  });
});

describe("installer-launch：与安装器脚本之间的跨文件契约", () => {
  // 这三条锁读的是 `build/installer/installer.nsh`：本层的参数不是自选风格，
  // 是那份脚本里的分支——脚本改了分支条件，参数就得跟着重估，否则「静默」两字会换人。
  const installer = readFileSync(path.join(process.cwd(), "build", "installer", "installer.nsh"), "utf8");

  /** 取 `!macro <name>` 到下一个 `!macroend` 之间的那一段；宏不在了直接抛（比读成空串诚实）。 */
  function macroOf(name: string): string {
    const start = installer.indexOf(`!macro ${name}`);
    if (start < 0) throw new Error(`installer.nsh 里没有 !macro ${name}——本锁的前提变了，去那里改判据`);
    const end = installer.indexOf("!macroend", start);
    return installer.slice(start, end < 0 ? undefined : end);
  }

  /** 注释行（`;` 起头）剥掉：解释「为什么不写」的那一句写在闸门之外，不算它写了。 */
  function codeOnly(block: string): string {
    return block
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith(";"))
      .join("\n");
  }

  it("升级保护仍然只活在静默分支里（/S 才是被保护的那一路）", () => {
    const block = macroOf("customInit");
    const guard = block.indexOf("${Silent}");
    expect(guard, "customInit 里没有静默判据了：/S 不再触发升级保护").toBeGreaterThan(-1);
    expect(block.indexOf(".Cyrene.content-preserve"), block).toBeGreaterThan(guard);
    expect(block).toContain(".Cyrene.models-preserve");
  });

  it("静默那一路不写 installer-options.json：没有选择就没有凭据", () => {
    const block = codeOnly(macroOf("customInstall"));
    const guard = /\$\{IfNot\} \$\{Silent\}/.exec(block);
    if (!guard) throw new Error("customInstall 里那道静默闸门没了——静默升级会把用户的「开机自启」显式判成关");
    const end = block.indexOf("${EndIf}", guard.index);
    const outside = block.slice(0, guard.index) + block.slice(end);
    expect(outside.includes("installer-options.json")).toBe(false);
    expect(block.slice(guard.index, end)).toContain("installer-options.json");
  });

  it("参数与那份脚本的说法仍然对得上（三颗都写进了注释的出处）", () => {
    const text = readFileSync(path.join(process.cwd(), "src", "main", "update", "installer-launch.ts"), "utf8");
    for (const arg of CLIENT_INSTALLER_ARGS) {
      expect(text.includes(`\`${arg}\``), `少了 ${arg} 这一条的出处说明`).toBe(true);
    }
  });
});

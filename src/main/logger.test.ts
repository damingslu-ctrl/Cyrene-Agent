import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * logger.ts 的模块顶层只剩级别解析；文件落盘接收器必须由组合根在身份配置之后
 * 显式安装（installMainLogSink）。这里锁死两件事：
 *   1. 仅 import 不得读取并绑定 userData —— 入口的 import 图早于 configureIdentity，
 *      那一刻 getPath("userData") 还是 package.json productName 决定的上游目录；
 *   2. 安装发生在身份改动之后，sink 绑到的是改动之后的目录。
 */
const electronState = vi.hoisted(() => ({
  userDataDir: "",
  /** 置为 true 时 getPath 抛错，模拟 userData 不可用的极端环境 */
  unavailable: false,
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key !== "userData") throw new Error(`logger 只应读取 userData，却读到 ${key}`);
      if (electronState.unavailable) throw new Error("userData unavailable");
      return electronState.userDataDir;
    }),
  },
}));

let tmpDirs: string[] = [];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tmpDirs = [];
  electronState.userDataDir = "";
  electronState.unavailable = false;
  // 每个用例一份全新的 logger（模块级的「只装一次」守卫与 shared/logger 的 sink 集合都归零）
  vi.resetModules();
  // 真实 logger 会写 stdout/stderr，测试里拦掉避免脏行泄漏
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("installMainLogSink", () => {
  it("import 期不绑定 userData，安装期才绑到身份配置之后的目录", async () => {
    // 身份配置前的目录（真实场景 = 上游 %APPDATA%\Cyrene）
    const upstreamDir = makeTmpDir("cyrene-log-upstream-");
    // configureVergeIdentity 之后的目录（真实场景 = %APPDATA%\cyrene-verge）
    const forkDir = makeTmpDir("cyrene-log-fork-");
    const upstreamLogs = path.join(upstreamDir, "logs");
    const forkLog = path.join(forkDir, "logs", "cyrene.log");

    electronState.userDataDir = upstreamDir;
    const loggerModule = await import("./logger");

    // 旧实现在模块顶层就 installFileLogSink(getPath("userData"))：
    // 到这里 upstreamDir/logs 已被 mkdir，且 sink 永久绑死在上游目录。
    expect(fs.existsSync(upstreamLogs)).toBe(false);

    // 身份改完了，才允许装接收器
    electronState.userDataDir = forkDir;
    const uninstall = loggerModule.installMainLogSink();
    try {
      loggerModule.logger.error("Cyrene", "bound-after-identity");
      expect(fs.existsSync(forkLog)).toBe(true);
      expect(fs.readFileSync(forkLog, "utf8")).toContain("bound-after-identity");
      // 上游账本一个字节都不许多
      expect(fs.existsSync(upstreamLogs)).toBe(false);

      // 幂等：重复安装不得让同一行写两份
      loggerModule.installMainLogSink();
      loggerModule.logger.error("Cyrene", "idempotent-line");
      expect(fs.readFileSync(forkLog, "utf8").match(/idempotent-line/g)).toHaveLength(1);
    } finally {
      uninstall();
    }
  });

  it("卸载后不再写盘，且 userData 不可用时静默降级不抛", async () => {
    const forkDir = makeTmpDir("cyrene-log-fork-");
    electronState.userDataDir = forkDir;
    const loggerModule = await import("./logger");
    const uninstall = loggerModule.installMainLogSink();
    const forkLog = path.join(forkDir, "logs", "cyrene.log");

    loggerModule.logger.error("Cyrene", "before-uninstall");
    uninstall();
    loggerModule.logger.error("Cyrene", "after-uninstall");
    const content = fs.readFileSync(forkLog, "utf8");
    expect(content).toContain("before-uninstall");
    expect(content).not.toContain("after-uninstall");

    // userData 读取失败（真实 Electron 在极端环境下会抛）时静默跳过，日志落盘只是增强项
    electronState.unavailable = true;
    vi.resetModules();
    const fresh = await import("./logger");
    expect(() => fresh.installMainLogSink()).not.toThrow();
    expect(fresh.installMainLogSink()).toBeTypeOf("function");
  });
});

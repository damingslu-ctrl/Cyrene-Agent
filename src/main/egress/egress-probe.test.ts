/**
 * `--egress-probe` 的落盘与退出码单测（Task 31 验收跑出来的洞，回填 Task 6）。
 *
 * 探针档唯一的契约是「退出码即判据」：E2 读 exit code，验收读 JSON。
 * 之前这一层只测了分类器，没测落盘，于是 `mkdir` 失败会升级成主进程未捕获异常 →
 * Windows 弹一个模态 Error 框 → 验收进程既不退出也不落盘，只能靠人上去杀。
 * app 与 fs 全部换成假的：这里不启 Electron，只锁「产物落在哪 + 失败给什么退出码」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exit: vi.fn(),
  entries: vi.fn((): unknown[] => []),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getVersion: () => "0.0.0-test", exit: h.exit } }));
// node:fs 只换掉这两把写盘的手，readFileSync 保持真实（第四把锁要读组合根源码）。
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  mkdirSync: h.mkdirSync,
  writeFileSync: h.writeFileSync,
}));
vi.mock("./egress-watchdog", () => ({
  installEgressWatchdog: () => ({ entries: h.entries, dispose: vi.fn() }),
}));

import { armEgressProbe } from "./egress-probe";

let lines: string[] = [];
let disposeProbe: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
    return true;
  });
  h.exit.mockReset();
  h.entries.mockReset().mockImplementation(() => []);
  h.mkdirSync.mockReset();
  h.writeFileSync.mockReset();
});

afterEach(() => {
  disposeProbe?.();
  disposeProbe = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function arm(idleMs = 20_000, outDir = "D:/cyrene-p0-probe") {
  disposeProbe = armEgressProbe(idleMs, outDir);
  return disposeProbe;
}

describe("探针档落盘", () => {
  it("空闲到点后把表写进给定目录，无外部请求即退出码 0", () => {
    arm();
    vi.advanceTimersByTime(20_000);
    expect(h.mkdirSync).toHaveBeenCalledWith("D:/cyrene-p0-probe", { recursive: true });
    const [file, body] = h.writeFileSync.mock.calls[0] as [string, string];
    expect(file.replace(/\\/g, "/")).toBe("D:/cyrene-p0-probe/egress-probe.json");
    expect(JSON.parse(body)).toMatchObject({ external: [], version: "0.0.0-test" });
    expect(lines.join("\n")).toContain("[egress-probe] external=0");
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("记到外部请求就退出码 1，并把逐条留痕写进 JSON（正对照：空表不是唯一分支）", () => {
    h.entries.mockImplementation(() => [
      { url: "https://example.com/x", method: "GET", resourceType: "image", atMs: 1200 },
    ]);
    arm();
    vi.advanceTimersByTime(20_000);
    const [, body] = h.writeFileSync.mock.calls[0] as [string, string];
    expect(JSON.parse(body).external).toHaveLength(1);
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("落盘失败不许逃逸成主进程未捕获异常：记下原因并以退出码 1 收场", () => {
    h.mkdirSync.mockImplementation(() => {
      const error = new Error("EPERM: operation not permitted, mkdir 'D:\\'") as Error & { code: string };
      error.code = "EPERM";
      throw error;
    });
    arm();
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
    expect(lines.join("\n")).toMatch(/egress-probe.*write failed.*EPERM/);
    expect(h.writeFileSync).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("组合根传的是 userData 本身，不许再取它的父目录（卷根 mkdir 必 EPERM）", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8");
    expect(source).toMatch(/armEgressProbe\(\s*egressProbeMs,\s*app\.getPath\("userData"\)\s*\)/);
    expect(source).not.toMatch(/armEgressProbe\([^)]*dirname/);
  });

  /**
   * Task 31 第一层跑出来的假绿：探针档 `arm` 完就 `return`，应用根本没启动——
   * 一个不建窗、不加载渲染进程的进程当然 0 条外部请求。尺子必须量真东西。
   */
  it("探针档也要照常启动应用，否则 external=0 量的是空转进程", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8");
    const start = source.indexOf("readEgressProbeArg()");
    const end = source.indexOf("egressWatchdog = installEgressWatchdog()");
    expect(start, "组合根里找不到探针分支").toBeGreaterThan(-1);
    expect(end, "组合根里找不到常规装尺那行").toBeGreaterThan(start);
    const probeBranch = source.slice(start, end);
    expect(probeBranch, "探针分支排完尺就 return，应用没启动 → 表永远是空的").toMatch(/application\.start\(\)/);
  });
});

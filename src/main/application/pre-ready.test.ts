import { describe, expect, it, vi } from "vitest";
import { prepareBeforeReady, type PreReadyDependencies } from "./pre-ready";

function makePreReadyDeps(calls: string[], overrides: Partial<PreReadyDependencies> = {}): PreReadyDependencies {
  return {
    // 默认按「命令行没给 --user-data-dir」：正常启动才搬运，现有顺序断言不受影响
    usesExplicitUserDataDir: false,
    configureIdentity: vi.fn(() => { calls.push("configure-identity"); }),
    installSingleInstance: vi.fn(() => { calls.push("single-instance-lock"); return true; }),
    migrateLegacyUserData: vi.fn(() => { calls.push("migrate-user-data"); return { status: "none" }; }),
    migrateVergeUserData: vi.fn(() => { calls.push("migrate-verge-user-data"); return { status: "none" }; }),
    registerPrivilegedSchemes: vi.fn(() => { calls.push("register-schemes"); }),
    configureGpuSwitches: vi.fn(() => { calls.push("gpu-switches"); }),
    ensureGpuSandboxAcl: vi.fn(() => { calls.push("gpu-acl"); }),
    activation: { request: vi.fn() },
    ...overrides,
  };
}

describe("prepareBeforeReady", () => {
  it.each(["failed", "partial"] as const)("stops before reading settings when migration is %s", (status) => {
    const deps = makePreReadyDeps([], { migrateLegacyUserData: () => ({ status }) });
    expect(() => prepareBeforeReady(deps)).toThrow("用户数据迁移未完成");
    expect(deps.registerPrivilegedSchemes).not.toHaveBeenCalled();
    expect(deps.configureGpuSwitches).not.toHaveBeenCalled();
    expect(deps.ensureGpuSandboxAcl).not.toHaveBeenCalled();
  });

  // Task 9：身份迁移（cyrene-verge → Mochi）没搬完同样不许继续启动，
  // 报错要指名 Mochi 并留住旧目录（旧目录里是用户全部账本，删了就回不来了）。
  it.each(["failed", "partial"] as const)("stops before reading settings when the identity migration is %s", (status) => {
    const deps = makePreReadyDeps([], { migrateVergeUserData: () => ({ status }) });
    expect(() => prepareBeforeReady(deps)).toThrow("Mochi 数据目录迁移未完成");
    expect(() => prepareBeforeReady(deps)).toThrow("请勿删除");
    expect(deps.registerPrivilegedSchemes).not.toHaveBeenCalled();
    expect(deps.configureGpuSwitches).not.toHaveBeenCalled();
    expect(deps.ensureGpuSandboxAcl).not.toHaveBeenCalled();
  });

  it("performs every Electron pre-ready operation synchronously in order", () => {
    const calls: string[] = [];
    const result = prepareBeforeReady(makePreReadyDeps(calls));
    expect(calls).toEqual([
      "configure-identity",
      "single-instance-lock",
      "migrate-user-data",
      "migrate-verge-user-data",
      "register-schemes",
      "gpu-switches",
      "gpu-acl",
    ]);
    expect(result.isPrimaryProcess).toBe(true);
  });

  // 顺序裁决（plan Step 4 那段注释写反了）：历史 live2d 迁移先跑，身份迁移后跑。
  // 反了会让 cyrene-verge 里被搬进 Mochi 的历史标记把 live2d 迁移判成 already_migrated，
  // 真实未并的数据静默留在旧目录；也让陈旧文件反过来覆盖较新的现状。
  it("历史 live2d 迁移严格早于身份迁移，两者都早于特权协议注册", () => {
    const calls: string[] = [];
    prepareBeforeReady(makePreReadyDeps(calls));
    expect(calls.indexOf("migrate-user-data")).toBeLessThan(calls.indexOf("migrate-verge-user-data"));
    expect(calls.indexOf("migrate-verge-user-data")).toBeLessThan(calls.indexOf("register-schemes"));
  });

  it("配置实例身份严格早于单实例锁与任何 userData 读取", () => {
    const calls: string[] = [];
    prepareBeforeReady(makePreReadyDeps(calls));
    const identityIndex = calls.indexOf("configure-identity");
    expect(identityIndex).toBe(0);
    for (const later of [
      "single-instance-lock",
      "migrate-user-data",
      "migrate-verge-user-data",
      "gpu-switches",
      "gpu-acl",
    ]) {
      expect(identityIndex).toBeLessThan(calls.indexOf(later));
    }
  });

  it("does not continue primary startup for a duplicate process", () => {
    const deps = makePreReadyDeps([], { installSingleInstance: () => false });
    expect(prepareBeforeReady(deps).isPrimaryProcess).toBe(false);
    // 身份仍需先配好：非主进程同样按 fork 的名字去争锁，才会拿不到锁
    expect(deps.configureIdentity).toHaveBeenCalled();
    expect(deps.registerPrivilegedSchemes).not.toHaveBeenCalled();
    expect(deps.ensureGpuSandboxAcl).not.toHaveBeenCalled();
  });

  it("does not migrate user data for a duplicate process", () => {
    const deps = makePreReadyDeps([], { installSingleInstance: () => false });
    prepareBeforeReady(deps);
    expect(deps.migrateLegacyUserData).not.toHaveBeenCalled();
    // 身份迁移同样只在抢到锁之后跑：两个进程并发改名会把账本搬成两半
    expect(deps.migrateVergeUserData).not.toHaveBeenCalled();
  });

  // 显式 --user-data-dir 的意思是「在这次指定的 profile 上跑」，不是「把我的真数据搬到这里」。
  // 搬运的 renamed 会把源目录整个改名搬走再移除，而且是**成功状态**（下游拦不住），
  // 一次探针启动就能把用户真实的 %APPDATA%\cyrene-verge 搬空。所以两步搬运都得跳过。
  it("显式 --user-data-dir 时两步 userData 搬运都不跑，其余预配置照常", () => {
    const calls: string[] = [];
    const deps = makePreReadyDeps(calls, { usesExplicitUserDataDir: true });
    const result = prepareBeforeReady(deps);
    expect(calls).not.toContain("migrate-user-data");
    expect(calls).not.toContain("migrate-verge-user-data");
    expect(deps.migrateLegacyUserData).not.toHaveBeenCalled();
    expect(deps.migrateVergeUserData).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "configure-identity",
      "single-instance-lock",
      "register-schemes",
      "gpu-switches",
      "gpu-acl",
    ]);
    expect(result.isPrimaryProcess).toBe(true);
  });

  // 搬运被跳过后，连「搬不完就拒启动」的抛出也不再发生：探针 profile 不该被真实数据的
  // 占用问题卡住启动（partial/failed 都来自源目录里的真实文件）。
  it("显式 --user-data-dir 时即便迁移返回 partial 也不抛，探针 profile 照常启动", () => {
    const deps = makePreReadyDeps([], {
      usesExplicitUserDataDir: true,
      migrateLegacyUserData: () => ({ status: "partial" }),
      migrateVergeUserData: () => ({ status: "partial" }),
    });
    expect(() => prepareBeforeReady(deps)).not.toThrow();
    expect(deps.registerPrivilegedSchemes).toHaveBeenCalled();
  });

  it("routes second-instance activation through the chat request", () => {
    const request = vi.fn();
    const deps = makePreReadyDeps([], {
      activation: { request },
      installSingleInstance: (onSecondInstance) => {
        onSecondInstance();
        return true;
      },
    });
    prepareBeforeReady(deps);
    expect(request).toHaveBeenCalledWith({ kind: "chat" });
  });
});

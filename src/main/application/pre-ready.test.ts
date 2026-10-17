import { describe, expect, it, vi } from "vitest";
import { prepareBeforeReady, type PreReadyDependencies } from "./pre-ready";

function makePreReadyDeps(calls: string[], overrides: Partial<PreReadyDependencies> = {}): PreReadyDependencies {
  return {
    configureIdentity: vi.fn(() => { calls.push("configure-identity"); }),
    installSingleInstance: vi.fn(() => { calls.push("single-instance-lock"); return true; }),
    migrateLegacyUserData: vi.fn(() => { calls.push("migrate-user-data"); return { status: "none" }; }),
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
  it("performs every Electron pre-ready operation synchronously in order", () => {
    const calls: string[] = [];
    const result = prepareBeforeReady(makePreReadyDeps(calls));
    expect(calls).toEqual([
      "configure-identity",
      "single-instance-lock",
      "migrate-user-data",
      "register-schemes",
      "gpu-switches",
      "gpu-acl",
    ]);
    expect(result.isPrimaryProcess).toBe(true);
  });

  it("配置实例身份严格早于单实例锁与任何 userData 读取", () => {
    const calls: string[] = [];
    prepareBeforeReady(makePreReadyDeps(calls));
    const identityIndex = calls.indexOf("configure-identity");
    expect(identityIndex).toBe(0);
    for (const later of [
      "single-instance-lock",
      "migrate-user-data",
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

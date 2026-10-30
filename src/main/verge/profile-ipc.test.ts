/**
 * profile-ipc 单测：只验「闸门外的一层」——入参校验、广播、dispose。
 *
 * 写面本身的判据（Verge 在跑零写入、切换顺序、失败带旧列表）在 profile-service.test.ts，
 * 这里刻意用假服务：通道层不该重新证明业务规则，只该证明**坏参数进不到业务规则里**。
 */
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import type { ProfileResult, ProfileRow } from "../../shared/subscription-types";
import type { IpcScope } from "../application/ipc-scope";
import { ProfilesStoreError } from "./profiles-store";
import { registerProfileIpc, type ProfileIpcDeps } from "./profile-ipc";
import type { ProfileService } from "./profile-service";

const ROWS: ProfileRow[] = [
  { uid: "Merge", type: "merge", label: "Merge", url: null, desc: null, updatedAt: null, current: false, builtin: true, selectable: false },
  { uid: "Sub00000001", type: "remote", label: "defond", url: "https://a.test/sub", desc: null, updatedAt: 1, current: true, builtin: false, selectable: true },
];

const OK: ProfileResult = { ok: true, rows: ROWS, warnings: [] };
const BAD: ProfileResult = { ok: false, reason: "verge-running", rows: ROWS };

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
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

function makeService() {
  const service = {
    list: vi.fn((): ProfileRow[] => ROWS),
    importUrl: vi.fn(async (): Promise<ProfileResult> => OK),
    importFile: vi.fn(async (): Promise<ProfileResult> => OK),
    update: vi.fn(async (): Promise<ProfileResult> => OK),
    select: vi.fn(async (): Promise<ProfileResult> => OK),
    remove: vi.fn(async (): Promise<ProfileResult> => OK),
    setOption: vi.fn(async (): Promise<ProfileResult> => OK),
  };
  return service as unknown as ProfileService & typeof service;
}

function setup(deps: Partial<Pick<ProfileIpcDeps, "pickFile">> = {}) {
  const scope = makeScope();
  const service = makeService();
  const broadcast = vi.fn();
  const pickFile = deps.pickFile ?? vi.fn(async () => "D:/x/sub.yaml");
  const dispose = registerProfileIpc(scope, { service, broadcast, pickFile });
  return { scope, service, broadcast, pickFile, dispose };
}

describe("registerProfileIpc 通道表", () => {
  it("八条入站按序注册，外加一条出站广播通道（表里没有无人调用的死行）", () => {
    const { scope } = setup();
    expect(scope.registered).toEqual([
      IPC.VERGE_SUB_LIST,
      IPC.VERGE_SUB_IMPORT_URL,
      IPC.VERGE_SUB_PICK_FILE,
      IPC.VERGE_SUB_IMPORT_FILE,
      IPC.VERGE_SUB_UPDATE,
      IPC.VERGE_SUB_SELECT,
      IPC.VERGE_SUB_REMOVE,
      IPC.VERGE_SUB_SET_OPTION,
    ]);
    expect(IPC.VERGE_SUB_CHANGED).toBe("verge:sub:changed");
    expect(scope.handlers.has(IPC.VERGE_SUB_CHANGED)).toBe(false);
  });

  it("dispose 把八条 handler 全摘，之后再点同一个通道不再有人接", () => {
    const { scope, dispose } = setup();
    dispose();
    for (const channel of scope.registered) expect(scope.handlers.has(channel)).toBe(false);
    expect(scope.removeHandler).toHaveBeenCalledTimes(scope.registered.length);
  });
});

describe("registerProfileIpc 入参校验", () => {
  it("LIST 走统一回执形状（页面只有一条解包路径），且不触发任何写", async () => {
    const { scope, service } = setup();
    expect(await scope.handlers.get(IPC.VERGE_SUB_LIST)!({})).toEqual({ ok: true, rows: ROWS, warnings: [] });
    expect(service.importUrl).not.toHaveBeenCalled();
  });

  it("LIST 读不出账本：说清原因并回空列表，不炸主进程", async () => {
    const { scope, service } = setup();
    service.list.mockImplementationOnce(() => { throw new ProfilesStoreError("bad-yaml", "profiles.yaml 读不出"); });
    expect(await scope.handlers.get(IPC.VERGE_SUB_LIST)!({})).toMatchObject({
      ok: false, reason: "bad-yaml", rows: [],
    });
  });

  it("uid 必须是账本放得下的形状：空、超长、带路径分隔符一律拒且不碰服务", async () => {
    const { scope, service } = setup();
    const update = scope.handlers.get(IPC.VERGE_SUB_UPDATE)!;
    const select = scope.handlers.get(IPC.VERGE_SUB_SELECT)!;
    const remove = scope.handlers.get(IPC.VERGE_SUB_REMOVE)!;
    for (const bad of ["", "   ", "x".repeat(65), "Sub/01", "..\\Sub", "中文uid1"]) {
      expect(await update({}, bad)).toMatchObject({ ok: false, reason: "invalid" });
      expect(await select({}, bad)).toMatchObject({ ok: false, reason: "invalid" });
      expect(await remove({}, bad)).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(service.update).not.toHaveBeenCalled();
    expect(service.select).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("IMPORT_URL：非字符串/空串拒；带备注一起透传", async () => {
    const { scope, service } = setup();
    const importUrl = scope.handlers.get(IPC.VERGE_SUB_IMPORT_URL)!;
    expect(await importUrl({}, 42)).toMatchObject({ ok: false, reason: "bad-url" });
    expect(await importUrl({}, "  ")).toMatchObject({ ok: false, reason: "bad-url" });
    expect(await importUrl({}, "https://a.test/sub", "  备用  ")).toMatchObject({ ok: true });
    expect(service.importUrl).toHaveBeenCalledWith({ url: "https://a.test/sub", desc: "备用" });
  });

  it("IMPORT_FILE：主进程给的路径才信；渲染端塞进来的非法长度拒", async () => {
    const { scope, service } = setup();
    const importFile = scope.handlers.get(IPC.VERGE_SUB_IMPORT_FILE)!;
    expect(await importFile({}, null)).toMatchObject({ ok: false, reason: "read-failed" });
    expect(await importFile({}, "x".repeat(4096))).toMatchObject({ ok: false, reason: "read-failed" });
    expect(service.importFile).not.toHaveBeenCalled();
    expect(await importFile({}, "D:/x/sub.yaml")).toMatchObject({ ok: true });
    expect(service.importFile).toHaveBeenCalledWith({ path: "D:/x/sub.yaml" });
  });

  it("SET_OPTION：不是纯对象、键不在白名单、uid 坏 → 不碰服务", async () => {
    const { scope, service } = setup();
    const setOption = scope.handlers.get(IPC.VERGE_SUB_SET_OPTION)!;
    expect(await setOption({}, "Sub00000001", null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setOption({}, "Sub00000001", ["with_proxy"])).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setOption({}, "Sub00000001", { merge: "AttachMerge" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await setOption({}, "Sub00000001", {})).toMatchObject({ ok: false, reason: "invalid" });
    expect(service.setOption).not.toHaveBeenCalled();
    expect(await setOption({}, "Sub00000001", { with_proxy: true })).toMatchObject({ ok: true });
    expect(service.setOption).toHaveBeenCalledWith("Sub00000001", { with_proxy: true });
  });

  it("PICK_FILE 回主进程选中的路径；用户取消与对话框不可用都回 null，不是错误", async () => {
    const picked = setup({ pickFile: vi.fn(async () => "D:/x/sub.yaml") });
    expect(await picked.scope.handlers.get(IPC.VERGE_SUB_PICK_FILE)!({})).toEqual({ path: "D:/x/sub.yaml" });
    const cancelled = setup({ pickFile: vi.fn(async () => null) });
    expect(await cancelled.scope.handlers.get(IPC.VERGE_SUB_PICK_FILE)!({})).toEqual({ path: null });
    expect(cancelled.pickFile).toHaveBeenCalledOnce();
  });
});

describe("registerProfileIpc 广播", () => {
  it("写成功才广播新列表；写失败一条都不发（否则页面会被假成功带走）", async () => {
    const { scope, service, broadcast } = setup();
    await scope.handlers.get(IPC.VERGE_SUB_SELECT)!({}, "Sub00000001");
    expect(broadcast).toHaveBeenCalledWith(IPC.VERGE_SUB_CHANGED, OK.rows);
    service.select.mockResolvedValueOnce(BAD);
    broadcast.mockClear();
    expect(await scope.handlers.get(IPC.VERGE_SUB_SELECT)!({}, "Sub00000001")).toMatchObject({ ok: false });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("LIST 是读，不广播", async () => {
    const { scope, broadcast } = setup();
    await scope.handlers.get(IPC.VERGE_SUB_LIST)!({});
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("服务抛账本错误 → 翻译原 reason 并带回空列表；未知异常说 write-failed", async () => {
    const { scope, service, broadcast } = setup();
    service.update.mockRejectedValueOnce(new ProfilesStoreError("bad-yaml", "profiles.yaml 读不出"));
    const res = await scope.handlers.get(IPC.VERGE_SUB_UPDATE)!({}, "Sub00000001");
    expect(res).toMatchObject({ ok: false, reason: "bad-yaml" });
    expect(broadcast).not.toHaveBeenCalled();
    service.remove.mockRejectedValueOnce(new Error("EBUSY"));
    expect(await scope.handlers.get(IPC.VERGE_SUB_REMOVE)!({}, "Sub00000001")).toMatchObject({
      ok: false, reason: "write-failed", detail: "EBUSY",
    });
  });

  it("PICK_FILE 抛了不炸主进程：回 null 让页面自己决定说什么", async () => {
    const { scope } = setup({ pickFile: vi.fn(async () => { throw new Error("dialog unavailable"); }) });
    expect(await scope.handlers.get(IPC.VERGE_SUB_PICK_FILE)!({})).toEqual({ path: null });
  });
});

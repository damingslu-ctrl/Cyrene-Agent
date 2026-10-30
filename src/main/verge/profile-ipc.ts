/**
 * 订阅页的 IPC 层：八条入站通道 + 一条出站广播。
 *
 * 这层只做三件事，而且只做这三件——
 * 1) **入参校验**：坏参数在这里就挡下，绝不进服务（服务那侧的判据是「零写入」，
 *    靠这里兜住形状才证得清）；
 * 2) **异常翻译**：`ProfilesStoreError` 的 reason 原样递出去，未知异常说 `write-failed`——
 *    渲染端拿到的一定是 `{ ok, reason, rows }`，不会是一个炸掉的 invoke；
 * 3) **成功才广播**：写失败时一条都不发。页面被一次失败的写带走新列表，
 *    比页面卡住更难查——它会让用户以为切成功了。
 *
 * 白名单（option 键）在这里过一遍、服务里再过一遍不是重复：这层管「别把坏键送到服务」，
 * 服务那层管「就算有人绕过 IPC 直接调服务，坏键也进不了盘」。后者才是判据。
 */
import { IPC } from "../../shared/ipc-channels";
import {
  PROFILE_OPTION_KEYS,
  type ProfileFailReason,
  type ProfileResult,
} from "../../shared/subscription-types";
import type { IpcScope } from "../application/ipc-scope";
import { ProfilesStoreError } from "./profiles-store";
import type { ProfileService } from "./profile-service";

export interface ProfileIpcDeps {
  service: ProfileService;
  broadcast: (channel: string, payload: unknown) => void;
  /** 原生「打开文件」对话框：取消回 null。渲染端没有文件系统权限，这一步只能在 main。 */
  pickFile(): Promise<string | null>;
}

/**
 * uid 的边界检查。
 *
 * 真正的防越权在下面两道：`profile-store-port.ts` 的正文文件名白名单、
 * `runtime-config.ts` 的 `runtimeConfigPath`。这里再挡一次是因为分隔符一旦进到日志、
 * 错误文案或将来某个拼路径的新调用点，就不是一处漏了。
 * 收得比 `runtimeConfigPath` 松（允许 `.`/`_`/`-`）：账本里的 uid 是外部文件写的，
 * 删除与改选项这两条路不碰 runtime，把它们的字符集钉死反而删不掉手抄过的条目。
 */
const UID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_URL_LENGTH = 4096;
const MAX_PATH_LENGTH = 1024;
const MAX_DESC_LENGTH = 200;

const OPTION_KEY_SET: ReadonlySet<string> = new Set(PROFILE_OPTION_KEYS);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(reason: ProfileFailReason, extra: { detail?: string } = {}): ProfileResult {
  return { ok: false, reason, rows: [], ...extra };
}

/** 账本读不出时失败也要带得上当前列表——这里只能回空，但至少不炸。 */
function translate(error: unknown): ProfileResult {
  if (error instanceof ProfilesStoreError) return failure(error.reason, { detail: error.message });
  return failure("write-failed", { detail: messageOf(error) });
}

function isUid(value: unknown): value is string {
  return typeof value === "string" && UID_PATTERN.test(value);
}

function trimmedBounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return null;
  // 换行/制表符能伪造出「看起来是一行」的日志与提示文案，一并排除。
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function descOf(value: unknown): string | undefined {
  const text = trimmedBounded(value, MAX_DESC_LENGTH);
  return text === null ? undefined : text;
}

/** 只有纯对象、且每个键都在白名单里才放行；值为 `null` 留给服务判断。 */
function isWhitelistedPatch(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key]) => OPTION_KEY_SET.has(key));
}

export function registerProfileIpc(ipc: IpcScope, deps: ProfileIpcDeps): () => void {
  const { service, broadcast, pickFile } = deps;

  /** 一次写的全部后续：只有成功才广播新列表。 */
  const run = async (work: () => Promise<ProfileResult>): Promise<ProfileResult> => {
    let result: ProfileResult;
    try {
      result = await work();
    } catch (error) {
      return translate(error);
    }
    if (result.ok) broadcast(IPC.VERGE_SUB_CHANGED, result.rows);
    return result;
  };

  ipc.handle(IPC.VERGE_SUB_LIST, async (): Promise<ProfileResult> => {
    try {
      return { ok: true, rows: service.list(), warnings: [] };
    } catch (error) {
      return translate(error);
    }
  });

  ipc.handle(IPC.VERGE_SUB_IMPORT_URL, (_event, url: unknown, desc: unknown) => {
    const target = trimmedBounded(url, MAX_URL_LENGTH);
    if (target === null) return failure("bad-url", { detail: "订阅地址得是一条 http(s) 链接" });
    return run(() => service.importUrl({ url: target, desc: descOf(desc) }));
  });

  ipc.handle(IPC.VERGE_SUB_PICK_FILE, async (): Promise<{ path: string | null }> => {
    try {
      const picked = await pickFile();
      return { path: typeof picked === "string" && picked.length > 0 ? picked : null };
    } catch {
      // 对话框起不来（无头/远程会话）与用户取消对页面是同一件事：没有选中文件。
      return { path: null };
    }
  });

  ipc.handle(IPC.VERGE_SUB_IMPORT_FILE, (_event, file: unknown, desc: unknown) => {
    const path = trimmedBounded(file, MAX_PATH_LENGTH);
    // 长度越界/非字符串只可能是拼出来的假路径；真路径由上一条通道给。
    if (path === null) return failure("read-failed", { detail: "路径得由主进程的对话框给出" });
    return run(() => service.importFile({ path, desc: descOf(desc) }));
  });

  ipc.handle(IPC.VERGE_SUB_UPDATE, (_event, uid: unknown) => {
    if (!isUid(uid)) return failure("invalid", { detail: "订阅 uid 不合法" });
    return run(() => service.update(uid));
  });

  ipc.handle(IPC.VERGE_SUB_SELECT, (_event, uid: unknown) => {
    if (!isUid(uid)) return failure("invalid", { detail: "订阅 uid 不合法" });
    return run(() => service.select(uid));
  });

  ipc.handle(IPC.VERGE_SUB_REMOVE, (_event, uid: unknown) => {
    if (!isUid(uid)) return failure("invalid", { detail: "订阅 uid 不合法" });
    return run(() => service.remove(uid));
  });

  ipc.handle(IPC.VERGE_SUB_SET_OPTION, (_event, uid: unknown, patch: unknown) => {
    if (!isUid(uid)) return failure("invalid", { detail: "订阅 uid 不合法" });
    if (!isWhitelistedPatch(patch)) {
      return failure("invalid", { detail: `只接受 ${PROFILE_OPTION_KEYS.join(" / ")}` });
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (Object.keys(clean).length === 0) return failure("invalid", { detail: "没有要改的项" });
    return run(() => service.setOption(uid, clean));
  });

  return () => {
    ipc.removeHandler(IPC.VERGE_SUB_LIST);
    ipc.removeHandler(IPC.VERGE_SUB_IMPORT_URL);
    ipc.removeHandler(IPC.VERGE_SUB_PICK_FILE);
    ipc.removeHandler(IPC.VERGE_SUB_IMPORT_FILE);
    ipc.removeHandler(IPC.VERGE_SUB_UPDATE);
    ipc.removeHandler(IPC.VERGE_SUB_SELECT);
    ipc.removeHandler(IPC.VERGE_SUB_REMOVE);
    ipc.removeHandler(IPC.VERGE_SUB_SET_OPTION);
  };
}

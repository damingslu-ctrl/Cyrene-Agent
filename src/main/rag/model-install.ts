// 本机检索模型的在应用内下载器。
//
// 为什么要有它：模型文件历史上只能靠人手拷进 models/，而装机用户既没有管理员
// 权限也不一定知道 HF 怎么下——「装了却没生效」大半是这个环节断的。这里把
// 下载目标固定在 <userData>/models（唯一保证可写的位置），逐文件校验字节数，
// 失败只留 .part 残片、绝不冒充已安装。
//
// 传输走 Electron `net.fetch`（Chromium 栈，跟随系统代理），不是 undici 的全局
// fetch——后者在本机直连 huggingface.co 是打不通的。代价是 Chromium 会自己跟
// 重定向，所以这里强制 `redirect: "manual"` 逐跳过上游黑名单：HF 的 resolve/main
// 会 302 去 cdn-lfs，正常放行；但镜像站一旦被改成指向 GitHub，请求不能真的发出去。
import { net } from "electron";
import * as fs from "fs";
import * as path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { isUpstreamUrl } from "../../shared/upstream-hosts";
import {
  LOCAL_EMBEDDING_MODELS,
  isLocalEmbeddingModelKey,
  type LocalEmbeddingModelKey,
  type LocalModelFileSpec,
} from "../../shared/local-models";
import { getInstallableModelsDir, getProjectModelSubPath, getModelInstallStatusDetail } from "./model-status";

/** HF 镜像兜底顺序：国内先走镜像，再回原站。 */
export const MODEL_MIRRORS = ["https://hf-mirror.com", "https://huggingface.co"] as const;

/** 磁盘余量安全垫：清单之外再多留 256 MB，防止下到一半把系统盘挤爆。 */
const DISK_HEADROOM_BYTES = 256 * 1024 * 1024;

/** 单个文件内部的进度回报粒度。 */
const PROGRESS_STEP_BYTES = 2 * 1024 * 1024;

export type ModelInstallPhase = "downloading" | "progress" | "done" | "cancelled" | "error";

export interface ModelInstallProgress {
  modelKey: string;
  phase: ModelInstallPhase;
  /** 当前文件相对路径；phase 为 done/cancelled/error 时为 null。 */
  file: string | null;
  /** 1-based。 */
  fileIndex: number;
  fileCount: number;
  bytesTotal: number;
  /** 已落盘字节（含跳过复用的已完成文件）。 */
  bytesDone: number;
}

export interface ModelInstallResponse {
  ok: boolean;
  status: number;
  body: NodeJS.ReadableStream | null;
}

export type ModelInstallFetch = (url: string, init: { signal: AbortSignal }) => Promise<ModelInstallResponse>;

export type ModelInstallResult =
  | { ok: true; modelKey: LocalEmbeddingModelKey; modelDir: string; skippedBytes: number; alreadyInstalled: boolean }
  | { ok: false; modelKey: string; error: string };

let activeInstall: AbortController | null = null;

/** 取消进行中的下载。返回是否真的有任务被取消。 */
export function cancelLocalModelInstall(): boolean {
  if (!activeInstall) return false;
  activeInstall.abort();
  return true;
}

export function isModelInstallRunning(): boolean {
  return activeInstall !== null;
}

/** 下载落位目录：<userData>/models/Xenova/<dirName>。注册表外的 key 返回 null。 */
export function getModelInstallTargetDir(modelKey: string): string | null {
  if (!isLocalEmbeddingModelKey(modelKey)) return null;
  const baseDir = getInstallableModelsDir();
  const subPath = getProjectModelSubPath("embedding", modelKey);
  if (!baseDir || !subPath) return null;
  return path.join(baseDir, subPath);
}

export interface ModelInstallDescriptor {
  modelKey: LocalEmbeddingModelKey;
  label: string;
  dims: number;
  /** 项目侧相对目录，例如 `Xenova/bge-base-zh-v1.5`。 */
  dirName: string;
  bytesTotal: number;
  files: number;
  installed: boolean;
  targetDir: string | null;
}

/** 设置页展示用：这个档多大、几个文件、装没装、要装到哪。 */
export function describeModelInstall(modelKey: string): ModelInstallDescriptor | null {
  if (!isLocalEmbeddingModelKey(modelKey)) return null;
  const spec = LOCAL_EMBEDDING_MODELS[modelKey];
  return {
    modelKey,
    label: spec.label,
    dims: spec.dims,
    dirName: getProjectModelSubPath("embedding", modelKey) ?? `Xenova/${spec.dirName}`,
    bytesTotal: spec.totalBytes,
    files: spec.files.length,
    installed: getModelInstallStatusDetail("embedding", modelKey).installed,
    targetDir: getModelInstallTargetDir(modelKey),
  };
}

async function electronFetch(url: string, init: { signal: AbortSignal }): Promise<ModelInstallResponse> {
  const res = await fetchRedirectGated(netFetchRaw, url, init.signal);
  const body = res.body ? Readable.fromWeb(res.body as never) : null;
  return { ok: res.ok, status: res.status, body };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/** `net.fetch` 的最小形状（测试可注入假响应）。 */
export interface RawModelFetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: { cancel?: () => Promise<void> | void } | null;
}

export type RawModelFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: "manual" },
) => Promise<RawModelFetchResponse>;

const netFetchRaw: RawModelFetch = (url, init) => net.fetch(url, init) as unknown as Promise<RawModelFetchResponse>;

/** 重定向不读正文；不取消的话连接会一直被攥着。 */
async function cancelBody(res: RawModelFetchResponse): Promise<void> {
  try {
    await res.body?.cancel?.();
  } catch {
    // 取消失败不影响判定。
  }
}

/**
 * 逐跳跟随重定向，每一跳（含入口）都过上游黑名单。
 * 命中上游立即抛错，且**不会**对上游地址发起请求。
 */
export async function fetchRedirectGated(
  raw: RawModelFetch,
  url: string,
  signal: AbortSignal,
  maxRedirects = MAX_REDIRECTS,
): Promise<ModelInstallResponse> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (isUpstreamUrl(current)) {
      throw new Error(`E_MODEL_INSTALL_UPSTREAM 下载链指向已切断的上游站点：${current}`);
    }
    const res = await raw(current, { signal, redirect: "manual" });
    if (!REDIRECT_STATUS.has(res.status)) {
      return { ok: res.ok, status: res.status, body: res.body as unknown as NodeJS.ReadableStream | null };
    }
    const location = res.headers.get("location");
    if (!location) {
      await cancelBody(res);
      return { ok: res.ok, status: res.status, body: res.body as unknown as NodeJS.ReadableStream | null };
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      await cancelBody(res);
      throw new Error(`E_MODEL_INSTALL_BAD_REDIRECT 无效的重定向地址：${location}`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      await cancelBody(res);
      throw new Error(`E_MODEL_INSTALL_BAD_REDIRECT 不支持的重定向协议：${next.protocol}`);
    }
    await cancelBody(res);
    current = next.href;
  }
  throw new Error(`E_MODEL_INSTALL_TOO_MANY_REDIRECTS 重定向超过 ${maxRedirects} 次`);
}

class CancelledError extends Error {
  constructor() {
    super("E_MODEL_INSTALL_CANCELLED");
    this.name = "CancelledError";
  }
}

/** 路径必须落在模型目录内（清单来自 shared，但装机人能手改，这里再挡一次）。 */
function safeJoin(root: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.includes("\\") || /^[a-zA-Z]:/.test(rel)) return null;
  const joined = path.join(root, rel);
  const normalizedRoot = path.normalize(root) + path.sep;
  const normalizedJoined = path.normalize(joined);
  return normalizedJoined.startsWith(normalizedRoot) ? normalizedJoined : null;
}

function fileMatchesSpec(filePath: string, spec: LocalModelFileSpec): boolean {
  try {
    return fs.statSync(filePath).size === spec.bytes;
  } catch {
    return false;
  }
}

/** 把响应体写进 .part 并返回字节数；任何失败都清掉残片。 */
async function writePart(
  body: NodeJS.ReadableStream,
  partPath: string,
  expectedBytes: number,
  signal: AbortSignal,
  onBytes: (written: number) => void,
): Promise<number> {
  let written = 0;
  let lastEmit = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, data?: Buffer) => void) {
      if (signal.aborted) {
        cb(new CancelledError());
        return;
      }
      written += chunk.length;
      if (written - lastEmit >= PROGRESS_STEP_BYTES) {
        lastEmit = written;
        onBytes(written);
      }
      cb(null, chunk);
    },
  });
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  try {
    await pipeline(body as any, counter, fs.createWriteStream(partPath));
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }
  if (written !== expectedBytes) {
    fs.rmSync(partPath, { force: true });
    throw new Error(`E_MODEL_INSTALL_SIZE ${partPath}: expected ${expectedBytes}, got ${written}`);
  }
  return written;
}

function freeBytesFor(targetDir: string): number | null {
  let probe = targetDir;
  // 目标目录可能还不存在：向上找到第一个存在的盘符节点再问容量。
  while (probe && !fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const stats = fs.statfsSync(probe);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

export interface ModelInstallDeps {
  fetchImpl?: ModelInstallFetch;
  onProgress?: (progress: ModelInstallProgress) => void;
}

export async function installLocalEmbeddingModel(
  modelKey: string,
  deps: ModelInstallDeps = {},
): Promise<ModelInstallResult> {
  if (!isLocalEmbeddingModelKey(modelKey)) {
    return { ok: false, modelKey: String(modelKey), error: "E_MODEL_INSTALL_UNKNOWN_KEY" };
  }
  if (activeInstall) {
    return { ok: false, modelKey, error: "E_MODEL_INSTALL_BUSY 已有模型正在下载，请等它结束或先取消" };
  }

  const spec = LOCAL_EMBEDDING_MODELS[modelKey];
  const targetDir = getModelInstallTargetDir(modelKey);
  if (!targetDir) {
    return { ok: false, modelKey, error: "E_MODEL_INSTALL_NO_TARGET 无法确定模型目录（应用尚未就绪）" };
  }

  const fetchImpl = deps.fetchImpl ?? electronFetch;
  const emit = deps.onProgress;
  const signal = new AbortController();
  activeInstall = signal;

  const pending: Array<{ spec: LocalModelFileSpec; finalPath: string | null }> = [];
  for (const file of spec.files) {
    const finalPath = safeJoin(targetDir, file.path);
    if (!finalPath) {
      activeInstall = null;
      emit?.({ modelKey, phase: "error", file: file.path, fileIndex: 0, fileCount: spec.files.length, bytesTotal: spec.totalBytes, bytesDone: 0 });
      return { ok: false, modelKey, error: `E_MODEL_INSTALL_BAD_PATH 清单路径越出模型目录：${file.path}` };
    }
    pending.push({ spec: file, finalPath });
  }

  let bytesDone = 0;
  let skippedBytes = 0;
  for (const item of pending) {
    if (fileMatchesSpec(item.finalPath!, item.spec)) {
      skippedBytes += item.spec.bytes;
      bytesDone += item.spec.bytes;
    }
  }

  // 全部命中清单：已经是安装完成态，直接回执（UI 靠它把按钮从「安装」翻成「已安装」）。
  if (skippedBytes === spec.totalBytes) {
    activeInstall = null;
    emit?.({ modelKey, phase: "done", file: null, fileIndex: spec.files.length, fileCount: spec.files.length, bytesTotal: spec.totalBytes, bytesDone });
    return { ok: true, modelKey, modelDir: targetDir, skippedBytes, alreadyInstalled: true };
  }

  const needed = spec.totalBytes - skippedBytes;
  const free = freeBytesFor(targetDir);
  if (free !== null && free < needed + DISK_HEADROOM_BYTES) {
    activeInstall = null;
    return {
      ok: false,
      modelKey,
      error: `E_MODEL_INSTALL_NO_SPACE 磁盘余量不足：需 ${(needed / 1048576).toFixed(0)} MB（另留 256 MB 安全垫），实际只剩 ${(free / 1048576).toFixed(0)} MB`,
    };
  }

  const mirrorUrls = (file: LocalModelFileSpec): string[] =>
    MODEL_MIRRORS.map((host) => `${host}/${spec.hfName}/resolve/main/${file.path}`);

  try {
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const finalPath = item.finalPath!;
      if (fileMatchesSpec(finalPath, item.spec)) continue;

      emit?.({
        modelKey, phase: "downloading", file: item.spec.path,
        fileIndex: i + 1, fileCount: pending.length, bytesTotal: spec.totalBytes, bytesDone,
      });

      let lastStatus = 0;
      let downloaded: number | null = null;
      for (const url of mirrorUrls(item.spec)) {
        if (signal.signal.aborted) throw new CancelledError();
        const res = await fetchImpl(url, { signal: signal.signal });
        if (!res.ok || !res.body) {
          lastStatus = res.status;
          continue;
        }
        downloaded = await writePart(res.body, `${finalPath}.part`, item.spec.bytes, signal.signal, (written) => {
          emit?.({
            modelKey, phase: "progress", file: item.spec.path,
            fileIndex: i + 1, fileCount: pending.length, bytesTotal: spec.totalBytes,
            bytesDone: bytesDone + written,
          });
        });
        break;
      }
      if (downloaded === null) {
        throw new Error(
          `E_MODEL_INSTALL_NO_SOURCE ${item.spec.path} 在 ${MODEL_MIRRORS.join(" / ")} 上都没拿到（最后一次 HTTP ${lastStatus}）`,
        );
      }

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      // 覆盖式改名：同名旧文件若是坏档（size 不符才会走到这里），直接换掉。
      fs.renameSync(`${finalPath}.part`, finalPath);
      bytesDone += downloaded;
    }

    activeInstall = null;
    emit?.({
      modelKey, phase: "done", file: null,
      fileIndex: pending.length, fileCount: pending.length, bytesTotal: spec.totalBytes, bytesDone,
    });
    return { ok: true, modelKey, modelDir: targetDir, skippedBytes, alreadyInstalled: false };
  } catch (err) {
    activeInstall = null;
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = err instanceof CancelledError || signal.signal.aborted;
    emit?.({
      modelKey, phase: cancelled ? "cancelled" : "error", file: null,
      fileIndex: 0, fileCount: pending.length, bytesTotal: spec.totalBytes, bytesDone,
    });
    return { ok: false, modelKey, error: cancelled ? "E_MODEL_INSTALL_CANCELLED 下载已取消" : message };
  }
}

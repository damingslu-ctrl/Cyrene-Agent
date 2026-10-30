/**
 * 安装包的落盘（Wave 4 T12b）：流式写、边下边算摘要、败了不留半包。
 *
 * 为什么不复用内核通道那份 `downloadBytes`（`verge/mihomo-update.ts`）：它把整包读进
 * 一个 Buffer。内核包 22 MB 可以，安装包实测 289,746,294 字节——把 276 MiB 塞进主进程堆里
 * 换一句「下好了」，代价是下载期间主进程随时可能被 V8 拖去 GC 停顿，而这段时间界面还在跑。
 * 所以这一份改成**边读边写盘 + 增量 sha256**，内存里一次只留一块。
 *
 * 五条只有这一层会判错的线：
 *
 * 1) **摘要在 rename 之前算完**。落盘先写 `<name>.part`，全部字节读尽、哈希与发布页给的
 *    那枚对上了，才 rename 成正名。对不上或任何一步败了，`.part` 当场删——盘上出现一个
 *    「看着像安装包、其实少了一截」的文件比下不到更坏：下一次启动清理不到它，
 *    而用户会拿它去装。
 * 2) **等待用的是「静默超时」，不是总时长**。276 MiB 在慢网上本来就要走几分钟，
 *    总时长一刀切会把正常下载判成失败；只有「连续 N 秒一个字节都没来」才是真的断了。
 *    超预算的连接先 `cancel()` 再收手：继续挂着就是接着吃用户的下行带宽。
 * 3) **跳转出白名单是 wrong-source，不是 network-failed**。这一档的话是「这趟走出了
 *    我们钉住的那几台主机」，跟「网不通」是两件要用户做不同事的事——把它并进网络失败，
 *    用户会去查路由器。
 * 4) **写不进去是 write-failed，同样不是 network-failed**。目录只读、盘满、`.part`
 *    被杀毒软件按住——这些跟下行没关系，把它们报成断网会让人重装一遍客户端再去查路由器。
 * 5) **文件名是从我们自己的版本号推出来的，不是从 JSON 里抄的**。`assets[].name` 是别人写的，
 *    直接拼进路径就是目录穿越。这里要求它必须等于 `Mochi-Setup-<version>.exe` 且不含路径分隔，
 *    而 `<version>` 是 tag 里过了 semver 的那一串（`github-release.ts` 已经核过一遍，
 *    这一层再按 basename 死判一次——边界上该重复的检查不叫冗余）。
 *
 * 出口闸门仍然只有一把：每一跳都重新过 `isAllowedUpdateUrl(url, "asset")`。
 */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ClientUpdateReason } from "../../shared/client-update-types";
import { isAllowedUpdateUrl } from "../verge/core-source";
import { type FetchLike, type ReaderLike, type ResponseLike } from "../verge/subscription-fetch";

/** 真安装包 289,746,294 字节（v1.3.5 实测）。给到 512 MiB：换成 zip 分发也不至于把更新判死。 */
export const CLIENT_INSTALLER_MAX_BYTES = 512 * 1024 * 1024;
/** 连续 90 秒收不到一个字节才算断——慢网上 276 MiB 要走很久，这一段宁宽不窄。 */
export const CLIENT_DOWNLOAD_IDLE_MS = 90_000;
export const CLIENT_DOWNLOAD_MAX_REDIRECTS = 5;
export const CLIENT_USER_AGENT = "mochi-client-updater/v1";
/** 下好了才改名；盘上只要出现这个后缀就是「这一趟没走完」。 */
export const PART_SUFFIX = ".part";

/** 与 `github-release.ts` 的资产名同一把形状尺；这里带锚点重列一次是有意的（见文件头第 4 条）。 */
const INSTALLER_NAME = /^Mochi-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.exe$/;

export interface WriteSink {
  write(chunk: Buffer): Promise<void>;
  close(): Promise<void>;
}

export interface DownloadFs {
  mkdir(dir: string): void;
  /** 真实现走 FileHandle（线程池），不在主进程上同步一块一块写。 */
  openWrite(file: string): Promise<WriteSink>;
  remove(file: string): void;
  rename(from: string, to: string): void;
  entries(dir: string): string[];
  size(file: string): number | null;
  /** 分块读全盘算摘要：装之前那一道要用，一次只进一块。 */
  sha256(file: string): Promise<string | null>;
}

export interface DownloadTarget {
  fileName: string;
  downloadUrl: string;
  /** 发布页给的那枚 sha256（小写十六进制，已脱掉 `sha256:` 前缀）。 */
  digest: string;
  version: string;
}

export type InstallerDownloadResult =
  | { ok: true; fileName: string; bytes: number; hops: number }
  | { ok: false; reason: ClientUpdateReason; detail: string; fileName: string };

export interface InstallerDownloader {
  download(target: DownloadTarget): Promise<InstallerDownloadResult>;
  /** 重新按字节算一遍（装之前那一道）；文件不在回 null。 */
  digestOf(fileName: string): Promise<string | null>;
  sizeOf(fileName: string): number | null;
  filePathOf(fileName: string): string;
  dir(): string;
  /** 只留 `keep` 那一份安装包，其余的删掉并回删了哪些（spec D3「保留最近 1 份」）。 */
  pruneInstalled(keep: string | null): string[];
  /** 上一次被硬杀掉的 `.part` 永远等不到收尾：启动时清一遍。 */
  sweepParts(): string[];
}

/** 静默到点：与「网络报错」分开记，回执里说的是「多少秒没收到字节」。 */
class IdleTimeout extends Error {}

/** 出口闸门拒的跳转：单独一档，别混进「网络不通」。 */
class EgressRefused extends Error {}

/**
 * 盘上败的那一档：建目录、开文件、写块、关句柄、换正名。
 *
 * 单列一类是因为「网不通」和「写不进去」让用户做的事完全相反——前者查代理和下行，
 * 后者查磁盘和占用（`.part` 被杀毒软件按住、`updates` 目录只读、盘满）。
 * 全塞进 network-failed，用户会把一个只读目录的问题当成断网重装一遍客户端。
 * 摘要已经对上之后 rename 才败的，归这一档而不归 digest-*：字节没错，错的是换名。
 */
class DiskWrite extends Error {}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

/** 把一次盘上操作裹成 DiskWrite：只改「归类」，不改「败没败」。 */
async function disk<T>(what: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new DiskWrite(`${what}失败：${messageOf(error)}`);
  }
}

export const nodeDownloadFs: DownloadFs = {
  mkdir: (dir) => {
    fs.mkdirSync(dir, { recursive: true });
  },
  async openWrite(file: string): Promise<WriteSink> {
    const handle = await fsp.open(file, "w");
    return {
      write: async (chunk) => {
        await handle.write(chunk);
      },
      close: async () => {
        await handle.close();
      },
    };
  },
  remove: (file) => {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 删不掉也不能拦住主判据：调用方要么覆盖它，要么在回执里把路径说出来 */
    }
  },
  rename: (from, to) => fs.renameSync(from, to),
  entries: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  size: (file) => {
    try {
      const st = fs.statSync(file);
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  },
  async sha256(file: string): Promise<string | null> {
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(file)) {
        hash.update(chunk as Buffer);
      }
      return hash.digest("hex");
    } catch {
      return null;
    }
  },
};

export interface InstallerDownloaderOptions {
  updatesDir(): string;
  fetchImpl?: FetchLike;
  fs?: DownloadFs;
  maxBytes?: number;
  idleMs?: number;
  maxRedirects?: number;
  log?(line: string): void;
}

export function createInstallerDownloader(options: InstallerDownloaderOptions): InstallerDownloader {
  const doFetch = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const f = options.fs ?? nodeDownloadFs;
  const maxBytes = options.maxBytes ?? CLIENT_INSTALLER_MAX_BYTES;
  const idleMs = options.idleMs ?? CLIENT_DOWNLOAD_IDLE_MS;
  const maxRedirects = options.maxRedirects ?? CLIENT_DOWNLOAD_MAX_REDIRECTS;
  const log = options.log ?? (() => {});

  const filePathOf = (fileName: string): string => path.join(options.updatesDir(), fileName);

  /** 一跳一跳走到落地响应：每一跳都重新过一次出口闸门（第一跳干净不等于跟完跳转还干净）。 */
  async function resolveAsset(startUrl: string, signal: AbortSignal): Promise<{ res: ResponseLike; hops: number }> {
    let current = startUrl;
    let hops = 0;
    for (;;) {
      if (!isAllowedUpdateUrl(current, "asset")) {
        throw new EgressRefused(`资产这一趟跳转出了白名单：${hostOf(current)}`);
      }
      let res: ResponseLike;
      try {
        res = await doFetch(current, {
          redirect: "manual",
          signal,
          headers: { "user-agent": CLIENT_USER_AGENT, accept: "application/octet-stream" },
        });
      } catch (error) {
        if (signal.aborted) throw new IdleTimeout(`${idleMs} 秒没收到字节`);
        throw new Error(`请求没回来：${messageOf(error)}`);
      }
      if (res.status >= 300 && res.status < 400) {
        if (hops >= maxRedirects) throw new Error(`跳转超过 ${maxRedirects} 跳：${hostOf(current)}`);
        const location = res.headers.get("location");
        if (!location) throw new Error(`${res.status} 说要跳转但没给地址`);
        try {
          current = new URL(location, current).toString();
        } catch {
          throw new Error(`${res.status} 给的跳转地址读不出：${location}`);
        }
        hops += 1;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}（${hostOf(current)}）`);
      return { res, hops };
    }
  }

  /** 只留一份安装包；`download` 成功路径与外层都要用，所以不能挂在返回对象的 `this` 上。 */
  function pruneInstalled(keep: string | null): string[] {
    const dir = options.updatesDir();
    const removed: string[] = [];
    for (const entry of f.entries(dir)) {
      if (!INSTALLER_NAME.test(entry)) continue;
      if (entry === keep) continue;
      f.remove(path.join(dir, entry));
      removed.push(entry);
    }
    return removed;
  }

  function sweepParts(): string[] {
    const dir = options.updatesDir();
    const removed: string[] = [];
    for (const entry of f.entries(dir)) {
      if (!entry.endsWith(PART_SUFFIX)) continue;
      if (!INSTALLER_NAME.test(entry.slice(0, -PART_SUFFIX.length))) continue;
      f.remove(path.join(dir, entry));
      removed.push(entry);
    }
    return removed;
  }

  async function download(target: DownloadTarget): Promise<InstallerDownloadResult> {
    // 边界上再死判一次文件名：正名是从我们的版本号推出来的，不是从 JSON 抄的。
    if (target.fileName !== path.basename(target.fileName) || !INSTALLER_NAME.test(target.fileName)) {
      return { ok: false, reason: "no-asset", detail: `安装包文件名认不出：${target.fileName}`, fileName: target.fileName };
    }
    const dir = options.updatesDir();
    try {
      f.mkdir(dir);
    } catch (error) {
      return { ok: false, reason: "write-failed", detail: `建不出来 ${dir}：${messageOf(error)}`, fileName: target.fileName };
    }
    const partPath = path.join(dir, `${target.fileName}${PART_SUFFIX}`);
    const finalPath = path.join(dir, target.fileName);

    const controller = new AbortController();
    let sink: WriteSink | null = null;
    let reader: ReaderLike | null = null;
    /** 「`.part` 此刻还在盘上」。只有 rename 成功才允许把它划掉。 */
    let partOnDisk = false;
    let bytes = 0;
    /** 文件头第 1 条的唯一执行处：两个失败分支各写一遍删盘，总有一天只有一遍。 */
    const discardPart = (): void => {
      if (!partOnDisk) return;
      partOnDisk = false;
      f.remove(partPath);
    };
    try {
      const { res, hops } = await resolveAsset(target.downloadUrl, controller.signal);
      const declared = Number(res.headers.get("content-length"));
      // content-length 只是提前一步止损；撒谎的服务器交给下面边读边算那把尺。
      if (Number.isFinite(declared) && declared > maxBytes) {
        return {
          ok: false,
          reason: "too-large",
          detail: `包比上限大：声明 ${declared} > ${maxBytes} 字节`,
          fileName: target.fileName,
        };
      }
      reader = res.body?.getReader?.() ?? null;
      if (!reader) {
        return {
          ok: false,
          reason: "network-failed",
          detail: "回来的响应没有可读的字节流，这么大一个包不靠 text() 兜",
          fileName: target.fileName,
        };
      }
      sink = await disk("打开临时文件", () => f.openWrite(partPath));
      const handle = sink;
      partOnDisk = true;
      const hash = createHash("sha256");
      for (;;) {
        const pending = reader.read();
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        // 静默超时：每读到位一次就重新上弦。总时长不设限——276 MiB 在慢网上就是要走几分钟。
        const idle = new Promise<never>((_, reject) => {
          idleTimer = setTimeout(() => reject(new IdleTimeout(`${Math.round(idleMs / 1000)} 秒没收到字节`)), idleMs);
        });
        let outcome: { done?: boolean; value?: unknown };
        try {
          outcome = await Promise.race([pending, idle]);
          if (outcome.done === true) break;
        } finally {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
        }
        const chunk = outcome.value;
        if (!chunk) continue;
        const buf = typeof chunk === "string" ? Buffer.from(chunk, "binary") : Buffer.from(chunk as Uint8Array);
        bytes += buf.length;
        if (bytes > maxBytes) {
          // 先取消再收手：超预算的连接继续挂着就是接着吃下行带宽。
          await cancelReader(reader);
          discardPart();
          return {
            ok: false,
            reason: "too-large",
            detail: `包比上限大：读到 ${bytes} > ${maxBytes} 字节`,
            fileName: target.fileName,
          };
        }
        hash.update(buf);
        await disk("写临时文件", () => handle.write(buf));
      }
      reader.releaseLock?.();
      await disk("关临时文件", () => handle.close());
      sink = null;

      const got = hash.digest("hex");
      if (got !== target.digest) {
        discardPart();
        return {
          ok: false,
          reason: "digest-mismatch",
          detail: `期望 sha256 ${target.digest.slice(0, 12)}…，实际 ${got.slice(0, 12)}…（${bytes} 字节）`,
          fileName: target.fileName,
        };
      }
      await disk("换成正名", () => f.rename(partPath, finalPath));
      // 到这一步 `.part` 已经不在了（它换成了正名）：后面 pruneInstalled 再败也不许回头删它。
      partOnDisk = false;
      const removed = pruneInstalled(target.fileName);
      log(`安装包就位：${target.fileName}（${bytes} 字节，sha256 对得上${removed.length ? `，清掉旧包 ${removed.join(", ")}` : ""}）`);
      return { ok: true, fileName: target.fileName, bytes, hops };
    } catch (error) {
      // 败了也要把那条连接松开：读者留在原地 = 276 MiB 的下行还在往一个没人看的缓冲里灌。
      if (reader) await cancelReader(reader);
      if (sink) {
        // 先关句柄再删文件：Windows 上不关就删不掉，于是「不留半包」这句话在自家盘上失效。
        try {
          await sink.close();
        } catch {
          /* 已经要报失败了，关不上也要往下走 */
        }
      }
      discardPart();
      let reason: ClientUpdateReason = "network-failed";
      if (error instanceof EgressRefused) reason = "wrong-source";
      else if (error instanceof DiskWrite) reason = "write-failed";
      const detail = error instanceof IdleTimeout
        ? `${messageOf(error)}，这一趟停了（盘上没留半包）`
        : messageOf(error);
      log(`下载败：${detail}`);
      return { ok: false, reason, detail, fileName: target.fileName };
    }
  }

  return {
    download,
    digestOf: (fileName) => f.sha256(filePathOf(fileName)),
    sizeOf: (fileName) => f.size(filePathOf(fileName)),
    filePathOf,
    dir: () => options.updatesDir(),
    pruneInstalled,
    sweepParts,
  };
}

async function cancelReader(reader: ReaderLike): Promise<void> {
  try {
    await reader.cancel?.();
  } catch {
    /* 取消失败也要走：这一份正文已经不可能被安全用上 */
  }
}

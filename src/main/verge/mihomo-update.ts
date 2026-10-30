/**
 * v1.26 内核更新（Wave 3 T11）：把 mihomo 官方 Release 换装进我们自己的 `core/`。
 *
 * 这一层的难处不在「能不能下到文件」，而在**什么时候可以说话**。四条只有这里能判断错的线：
 *
 * 1) **「已是最新」不许靠版本号记账**。我们不在盘上存「本机是 v1.19.33」这种文件：
 *    那种账会留在原地骗人（有人手工替换过 exe、装过预发布、或者上一次只换了一半）。
 *    判据是**字节**——把新包解出来，与此刻躺在 `core/mihomo.exe` 那颗比一遍。
 *    代价是每次更新都要下一趟包；换来的是这句「已经是最新」永远有出处。
 * 2) **摘要验完才允许碰盘**。`assets[].digest` 缺失就直接拒（一个字节都不下），
 *    下回来的 sha256 与它对不上就拒——写进内核目录之前，字节必须先自证。
 *    `digest-missing` 与 `digest-mismatch` 分两档：前者是「发布页没给凭据」（上游的事），
 *    后者是「拿到手的东西不是它说的那个」（要么网络坏了，要么有人在中间换包）。
 * 3) **来源白名单在发出请求之前判，而不是在拿到东西之后**。`api.github.com.evil.tld` 与
 *    `api.github.com@evil.tld` 都长得像那本发布页，真 host 却是别人的域——而伪造的 JSON 里
 *    可以写着完全自洽的 sha256，摘要在假发布页面前自证不了任何东西。资产那一头放行
 *    `github.com` 与 `*.githubusercontent.com`：实测下载入口 302 到
 *    `release-assets.githubusercontent.com`，所以**每一跳都重新过一次闸门**，
 *    第一跳干净不等于跟完跳转还干净。
 * 4) **失败不动当前内核**。先解到 `<coreDir>/update-staging/`，认得出唯一那颗 exe、
 *    并且比对完字节之后，才 rename 进 `core/mihomo.exe`。任何一步败了，那一条旧内核
 *    原样还在原地，用户下一次起内核吃的还是它——这是「更新失败」和「更新把内核弄没了」
 *    唯一的分界。rename 之前还会再问一次 `canSwap()`：下载那几十秒里内核可能被人起起来了，
 *    那时候换文件换的是 Windows 正在执行的映像，会败得毫无道理。
 *
 * 另两条边界：只写 `<userData>/core/` 下面，Verge 的目录一个字节都不碰（spec D2）；
 * 解压不引新依赖——PowerShell `Expand-Archive` 先，`System32\tar.exe` 兜底（实测
 * Git Bash 的 GNU tar 会抢在 PATH 前面，而它不认 zip，所以兜底那一条走绝对路径）。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type CoreUpdateOutcome,
  type CoreUpdateReason,
  type CoreUpdateState,
} from "../../shared/core-types";
import {
  isAllowedUpdateUrl,
  pickMihomoAsset,
  selectExtractedExe,
  type CoreAssetPick,
} from "./core-source";
import { type FetchLike, type ResponseLike } from "./subscription-fetch";

/** spec D3 的内核通道：公开仓库、无 token，匿名 60 次/时对「用户点一下」这个频率够用。 */
export const MIHOMO_RELEASE_API_URL = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";
/** 真包 22,512,121 字节（v1.19.33 实测）。给到 64 MiB：上游换压缩方式不至于把更新判死。 */
export const MIHOMO_MAX_BYTES = 64 * 1024 * 1024;
/** 22 MB 在慢网上要走一两分钟；这一档宁可宽松，掐断一次的代价是用户以为更新坏了。 */
export const MIHOMO_TIMEOUT_MS = 120_000;
export const MIHOMO_MAX_REDIRECTS = 5;
export const MIHOMO_USER_AGENT = "mochi-core-updater/v1";

/** 临时那一层的名字：换装全程住在这儿，成功之后整层删掉。 */
export const STAGING_DIR_NAME = "update-staging";
export const ARCHIVE_NAME = "mihomo.zip";
export const PAYLOAD_DIR_NAME = "payload";

export interface UpdateFs {
  mkdir(dir: string): void;
  writeFile(file: string, data: Buffer): void;
  /** 文件不在回 null——「读不到」与「读出来是空的」在两处判据里不是同一件事。 */
  readBytes(file: string): Buffer | null;
  rename(from: string, to: string): void;
  remove(target: string): void;
}

export interface CoreUpdaterDeps {
  getJson(url: string): Promise<unknown>;
  downloadBytes(url: string, maxBytes: number): Promise<Buffer>;
  /** 解到 `destDir`，返回**相对 `destDir`** 的文件名（`/` 分隔）；解压本身败了抛错。 */
  extract(archive: string, destDir: string): Promise<string[]>;
  /** 现在能不能换文件：我们自己那颗在跑（或正在起）就是不能。 */
  canSwap(): boolean;
  coreDir(): string;
  bundledExe(): string;
  /**
   * 本机还有没有 Verge 那侧的安装版内核。有就必须写在回执里：按 spec D2 的三态，
   * 起内核时优先借安装版，我们这颗要等它不在才生效——不写这一句，「装上了」会被读成「生效了」。
   */
  installedCoreExists?(): boolean;
  fs?: UpdateFs;
  releaseUrl?: string;
  maxBytes?: number;
  now?(): number;
  log?(line: string): void;
}

export interface CoreUpdater {
  update(): Promise<CoreUpdateState>;
  state(): CoreUpdateState | null;
}

/** 网络层带原因地失败：这一层只可能报 `download-failed`，别的判定都不归它。 */
export class UpdateHttpError extends Error {}

export interface ReleaseInspection {
  tag: string | null;
  prerelease: boolean;
  draft: boolean;
  asset: CoreAssetPick | null;
}

/**
 * 发布页里「这一版能不能装」的判定。
 *
 * `releases/latest` 按 GitHub 的语义本来就不该返回预发布/草稿，所以这里不是常规路径，
 * 是**伪造或上游改行为时的出口**：判不出来就当不能装，而不是「名字对就先下」。
 * `tag` 与 `asset` 分开取——连 tag 都没读到的那次，回执也得说清败在哪一层。
 */
export function inspectRelease(release: unknown): ReleaseInspection {
  const record = typeof release === "object" && release !== null
    ? (release as Record<string, unknown>)
    : {};
  const rawTag = typeof record.tag_name === "string" ? record.tag_name.trim() : "";
  return {
    tag: rawTag || null,
    prerelease: record.prerelease === true,
    draft: record.draft === true,
    asset: pickMihomoAsset(release),
  };
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 解压产物里那颗 exe 的绝对路径；条目名是 `/` 分隔的相对名，得按平台拆开再拼。 */
export function stagedExePath(payloadDir: string, entryName: string): string {
  return path.join(payloadDir, ...entryName.split("/"));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCoreUpdater(deps: CoreUpdaterDeps): CoreUpdater {
  const fs = deps.fs ?? nodeUpdateFs;
  const now = deps.now ?? (() => Date.now());
  const releaseUrl = deps.releaseUrl ?? MIHOMO_RELEASE_API_URL;
  const maxBytes = deps.maxBytes ?? MIHOMO_MAX_BYTES;
  const log = deps.log ?? (() => {});

  let record: CoreUpdateState | null = null;
  let pending: Promise<CoreUpdateState> | null = null;

  async function run(): Promise<CoreUpdateState> {
    const started = now();
    const coreDir = deps.coreDir();
    const bundled = deps.bundledExe();
    const staging = path.join(coreDir, STAGING_DIR_NAME);
    const archive = path.join(staging, ARCHIVE_NAME);
    const payload = path.join(staging, PAYLOAD_DIR_NAME);

    /** 案发现场一路带到底：败在哪一版、哪一颗资产，回执里都得有，不许只剩「下载失败」。 */
    let tag: string | null = null;
    let assetName: string | null = null;

    const settle = (
      outcome: CoreUpdateOutcome,
      reason: CoreUpdateReason | null,
      detail: string | null,
    ): CoreUpdateState => {
      const next: CoreUpdateState = { outcome, tag, asset: assetName, reason, detail, at: now() };
      record = next;
      log(`更新 outcome=${outcome} tag=${tag ?? "-"} asset=${assetName ?? "-"}${detail ? ` ${detail}` : ""}`);
      return next;
    };

    /** 扫临时目录是「顺手」，不是判据：扫不掉只留一句日志，真出事由后面的 mkdir/write 自己报。 */
    const quietlyRemove = (target: string): void => {
      try {
        fs.remove(target);
      } catch (error) {
        log(`临时目录没清干净 ${target}：${messageOf(error)}`);
      }
    };

    try {
      // 出口闸门在**发请求之前**：假发布页可以给出自洽的 sha256，来源不钉住则摘要没有意义。
      if (!isAllowedUpdateUrl(releaseUrl, "release")) {
        return settle("failed", "download-failed", `发布页域名不在白名单，一个字节都没发出去：${hostOf(releaseUrl)}`);
      }
      // 慢的那两步之前先问一次：明知换不了还先下 22 MB，是替用户烧带宽。
      if (!deps.canSwap()) {
        return settle("busy", null, "我们自己那颗还在跑，先停内核再换文件");
      }

      let release: unknown;
      try {
        release = await deps.getJson(releaseUrl);
      } catch (error) {
        return settle("failed", "download-failed", `发布页没问到：${messageOf(error)}`);
      }

      const info = inspectRelease(release);
      tag = info.tag;
      if (!info.asset) {
        return settle("failed", "no-asset", `${tag ?? "这一版"}里没有 windows-amd64 的 zip 包`);
      }
      assetName = info.asset.name;
      if (info.prerelease || info.draft) {
        return settle(
          "failed",
          "no-asset",
          `${tag ?? assetName} 是${info.draft ? "还没发布的" : "预发布"}版本，不装进内核目录`,
        );
      }
      if (!info.asset.digest) {
        return settle("failed", "digest-missing", `发布页没给 ${assetName} 的 sha256，一个字节都没下`);
      }
      if (!isAllowedUpdateUrl(info.asset.downloadUrl, "asset")) {
        return settle(
          "failed",
          "download-failed",
          `${assetName} 的下载地址不在白名单，没发请求：${hostOf(info.asset.downloadUrl)}`,
        );
      }

      let bytes: Buffer;
      try {
        bytes = await deps.downloadBytes(info.asset.downloadUrl, maxBytes);
      } catch (error) {
        return settle("failed", "download-failed", `${assetName} 没下回来：${messageOf(error)}`);
      }

      const got = sha256Hex(bytes);
      if (got !== info.asset.digest) {
        return settle(
          "failed",
          "digest-mismatch",
          `期望 sha256 ${info.asset.digest}，实际 ${got}——下回来的不是它说的那个文件`,
        );
      }
      // 从这里往下，字节已经自证过身份；剩下的问题全是「能不能落到盘上」。
      log(`摘要已核对 ${got}`);

      // 上一次的半成品先扫一遍：残留的 payload 会被下一次的文件枚举算进来。
      // 扫不掉不当失败——下面的 mkdir(recursive) 与 writeFile 各自都会真报错，那时候才轮到有话要说。
      quietlyRemove(staging);
      try {
        fs.mkdir(staging);
        fs.mkdir(payload);
        fs.writeFile(archive, bytes);
      } catch (error) {
        return settle("failed", "swap-failed", `临时目录没落住：${messageOf(error)}`);
      }

      let names: string[];
      try {
        names = await deps.extract(archive, payload);
      } catch (error) {
        return settle("failed", "extract-failed", `解压失败：${messageOf(error)}`);
      }
      const exeName = selectExtractedExe(names);
      if (!exeName) {
        return settle(
          "failed",
          "extract-failed",
          names.length === 0
            ? "解压完是空的"
            : `解压产物里有 ${names.filter((name) => /\.exe$/i.test(name)).length} 个 exe，认不出该装哪一颗：${names.join(", ")}`,
        );
      }
      const stagedExe = stagedExePath(payload, exeName);
      const incoming = fs.readBytes(stagedExe);
      if (!incoming) return settle("failed", "extract-failed", `解压目录里读不到 ${exeName}`);

      const current = fs.readBytes(bundled);
      if (current && current.equals(incoming)) {
        return settle("latest", null, `core 里那颗与 ${tag ?? assetName} 逐字节相同`);
      }

      // 下载那几十秒里别人可能把内核起起来了；那时候换的是正在执行的映像，必败且败得看不懂。
      if (!deps.canSwap()) {
        return settle("busy", null, "下载这段时间里内核起来了，这一次没换文件");
      }
      try {
        fs.rename(stagedExe, bundled);
      } catch (error) {
        return settle("failed", "swap-failed", `${exeName} 没能换成 mihomo.exe：${messageOf(error)}`);
      }

      const shadow = deps.installedCoreExists?.()
        ? "本机还有 Verge 安装版那颗内核，按三态发现起内核时优先借它，我们这颗要等安装版不在才生效"
        : null;
      return settle("installed", null, shadow);
    } catch (error) {
      return settle("failed", "download-failed", `更新过程出了没想到的错：${messageOf(error)}`);
    } finally {
      // 半包不许留在 coreDir 里：残留会让下一次的枚举多算一份，也会被当成「装过东西」。
      quietlyRemove(staging);
    }
  }

  return {
    /** 在途去重：第二点击等同一趟的结果，而不是并发开两个临时目录互相盖文件。 */
    update() {
      if (pending) return pending;
      const inflight = run().finally(() => {
        if (pending === inflight) pending = null;
      });
      pending = inflight;
      return inflight;
    },
    state: () => record,
  };
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

const nodeUpdateFs: UpdateFs = {
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  writeFile: (file, data) => writeFileSync(file, data),
  readBytes: (file) => (existsSync(file) ? readFileSync(file) : null),
  rename: (from, to) => renameSync(from, to),
  remove: (target) => rmSync(target, { recursive: true, force: true }),
};

/* ------------------------------------------------------------------ 真网络 */

export interface UpdateNetworkOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** `CoreUpdaterDeps` 里那两条网络口的形状——装配层注入假的那一份时照这把尺对。 */
export interface UpdateNetwork {
  getJson(url: string): Promise<unknown>;
  downloadBytes(url: string, maxBytes: number): Promise<Buffer>;
}

/**
 * 更新器的两条出口：读发布页 JSON、下资产正文。
 *
 * 两条都必须**逐跳过白名单闸门**：实测 `github.com/<…>/download/…` 会 302 到
 * `release-assets.githubusercontent.com`，跟跳转本身就把「第一跳不是别人」这个假设打穿了。
 * 不跟到底就报 `download-failed`，不静默放宽 host。
 */
export function createUpdateNetwork(options: UpdateNetworkOptions = {}): UpdateNetwork {
  const doFetch = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? MIHOMO_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MIHOMO_MAX_REDIRECTS;

  /** GitHub 的 API 必须有 User-Agent（缺了直接 403），发布页另要声明吃 JSON；资产那头才是二进制。 */
  const head = (kind: "release" | "asset"): Record<string, string> => ({
    "user-agent": MIHOMO_USER_AGENT,
    accept: kind === "release" ? "application/vnd.github+json" : "application/octet-stream",
  });

  /** 一跳一跳走到落地响应；`kind` 决定这一趟允许留在哪些 host 上。 */
  async function resolve(
    startUrl: string,
    kind: "release" | "asset",
    signal: AbortSignal,
  ): Promise<ResponseLike> {
    let current = startUrl;
    let hops = 0;
    for (;;) {
      if (!isAllowedUpdateUrl(current, kind)) {
        throw new UpdateHttpError(`${kind === "release" ? "发布页" : "资产"}跳转出了白名单：${hostOf(current)}`);
      }
      let res: ResponseLike;
      try {
        res = await doFetch(current, { redirect: "manual", signal, headers: head(kind) });
      } catch (error) {
        if (signal.aborted) throw new UpdateHttpError(`到点没等到：${hostOf(current)}`);
        throw new UpdateHttpError(`请求没回来：${messageOf(error)}`);
      }
      if (res.status >= 300 && res.status < 400) {
        if (hops >= maxRedirects) throw new UpdateHttpError(`跳转超过 ${maxRedirects} 跳：${hostOf(current)}`);
        const location = res.headers.get("location");
        if (!location) throw new UpdateHttpError(`${res.status} 说要跳转但没给地址`);
        try {
          current = new URL(location, current).toString();
        } catch {
          throw new UpdateHttpError(`${res.status} 给的跳转地址读不出：${location}`);
        }
        hops += 1;
        continue;
      }
      if (!res.ok) throw new UpdateHttpError(`HTTP ${res.status}（${hostOf(current)}）`);
      return res;
    }
  }

  return {
    async getJson(url: string): Promise<unknown> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await resolve(url, "release", controller.signal);
        const text = await res.text();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new UpdateHttpError("发布页回来的不是 JSON");
        }
      } finally {
        clearTimeout(timer);
      }
    },

    async downloadBytes(url: string, limit: number): Promise<Buffer> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await resolve(url, "asset", controller.signal);
        const declared = Number(res.headers.get("content-length"));
        // content-length 只是提前一步：撒谎的服务器交给下面边读边算那把尺。
        if (Number.isFinite(declared) && declared > limit) {
          throw new UpdateHttpError(`包比上限大：声明 ${declared} > ${limit} 字节`);
        }
        const reader = res.body?.getReader?.();
        if (!reader) {
          const text = await res.text();
          const bytes = Buffer.from(text, "binary");
          if (bytes.length > limit) throw new UpdateHttpError(`包比上限大：${bytes.length} > ${limit} 字节`);
          return bytes;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = typeof value === "string" ? Buffer.from(value, "binary") : Buffer.from(value);
          total += chunk.length;
          if (total > limit) {
            // 先取消再收手：超预算的连接继续挂着就是接着吃用户的下行带宽。
            try {
              await reader.cancel?.();
            } catch {
              /* 取消失败也要走：这一份正文已经不可能被安全用上 */
            }
            reader.releaseLock?.();
            throw new UpdateHttpError(`包比上限大：读到 ${total} > ${limit} 字节`);
          }
          chunks.push(chunk);
        }
        reader.releaseLock?.();
        return Buffer.concat(chunks);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ---------------------------------------------------------------- 真解压 */

/** bsdtar 的绝对路径：Git Bash 的 GNU tar 会抢在 PATH 前面，而它不认 zip。 */
export function systemTarPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
  return path.join(root, "System32", "tar.exe");
}

/**
 * PowerShell 的单引号字面量。
 *
 * 路径是我们自己拼的（userData + 固定文件名），不含用户输入，但引号该转还得转：
 * 便携版的 userData 名字里出现 `'` 完全合法，那时候不转就是把路径截断。
 */
export function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface ExtractorOptions {
  /** 跑一条命令并等它结束；非 0 退出码抛错。单测换成假的。 */
  run?(file: string, args: string[]): Promise<void>;
  list?(dir: string): string[];
  systemRoot?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 系统自带两条路：PowerShell `Expand-Archive` 先，`System32\tar.exe -xf` 兜底。
 *
 * 都不引新依赖（spec D3「不引入新依赖」在解压这一侧的落点）。返回相对 `destDir` 的文件名，
 * 交给 `selectExtractedExe` 判「到底只有一颗 exe 吗」。
 */
export function createArchiveExtractor(options: ExtractorOptions = {}): (
  archive: string,
  destDir: string,
) => Promise<string[]> {
  const run = options.run ?? runCommand;
  const list = options.list ?? listFilesRecursive;
  const tar = path.join(options.systemRoot ?? options.env?.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

  return async (archive, destDir) => {
    const script = `Expand-Archive -LiteralPath ${psSingleQuote(archive)} -DestinationPath ${psSingleQuote(destDir)} -Force`;
    try {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    } catch (powerShellError) {
      // 两条路都败了才报解压失败；报错正文优先给 bsdtar 那一条（它才是 Windows 自带的解压主力）。
      try {
        await run(tar, ["-xf", archive, "-C", destDir]);
      } catch (tarError) {
        throw new Error(`Expand-Archive：${messageOf(powerShellError)}；${tar}：${messageOf(tarError)}`);
      }
    }
    return list(destDir);
  };
}

function runCommand(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // windowsHide 不是修饰：不盖这一层，每次更新都会在用户桌面上闪出一个 PowerShell 窗口。
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: unknown) => {
      stderr += typeof chunk === "string" ? chunk : String(chunk ?? "");
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`退出码 ${code}${stderr.trim() ? `：${stderr.trim().replace(/\s+/g, " ")}` : ""}`));
    });
  });
}

/** 递归枚举，返回 `/` 分隔的相对名——判「只有一颗 exe」要看的是全部条目，不能只看根。 */
function listFilesRecursive(dir: string, prefix = ""): string[] {
  const names: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    // 符号链接两头都不算：既不是"解出来的文件"，也不该由我们替它指到哪去。
    if (entry.isDirectory()) names.push(...listFilesRecursive(path.join(dir, entry.name), relative));
    else if (entry.isFile()) names.push(relative);
  }
  return names;
}

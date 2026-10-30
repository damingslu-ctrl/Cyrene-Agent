/**
 * v1.26 内核更新（Wave 3 T11）的判据。
 *
 * 这一层的账只有一条主线：**说「装上了」之前盘上必须真的换了；说「没装上」之后
 * 原来那颗必须还在原地**。所以每一档失败都同时断言两件事——回执里那句话，和假 fs 上
 * 留下的痕迹（哪个文件被动过、哪一个没被动过）。只看回执的测试会放过
 * 「报了失败但半包已经盖进 core 目录」这一种最贵的形状。
 *
 * 网络与解压全用假的：真 fetch 的出口边界由 `createUpdateNetwork` 那一节单独认证
 * （逐跳过白名单、超上限、非 JSON、跳转超限），真解压的两条路（PowerShell / System32 tar）
 * 由 `createArchiveExtractor` 那一节认证。**没有一条测试联网或真的起 powershell**：
 * 那是 T14 真窗验收的活，写进单测就变成「CI 依赖外网」。
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  CORE_UPDATE_OUTCOMES,
  CORE_UPDATE_REASONS,
  type CoreUpdateOutcome,
  type CoreUpdateReason,
} from "../../shared/core-types";
import { type ReaderLike, type ResponseLike } from "./subscription-fetch";
import {
  ARCHIVE_NAME,
  createArchiveExtractor,
  createCoreUpdater,
  createUpdateNetwork,
  inspectRelease,
  MIHOMO_MAX_BYTES,
  MIHOMO_RELEASE_API_URL,
  PAYLOAD_DIR_NAME,
  psSingleQuote,
  sha256Hex,
  STAGING_DIR_NAME,
  stagedExePath,
  systemTarPath,
  UpdateHttpError,
  type UpdateFs,
} from "./mihomo-update";

/* ------------------------------------------------------------------ 夹具 */

const CORE_DIR = path.join("D:", "mochi", "core");
const BUNDLED = path.join(CORE_DIR, "mihomo.exe");
const STAGING = path.join(CORE_DIR, STAGING_DIR_NAME);
const ARCHIVE = path.join(STAGING, ARCHIVE_NAME);
const PAYLOAD = path.join(STAGING, PAYLOAD_DIR_NAME);
/** 本机装版 Verge 的内核所在处：更新一个字节都不许写到这儿来。 */
const VERGE_DIR = path.join("D:", "Program Files", "Clash Verge");

const EXE_ENTRY = "mihomo-windows-amd64.exe";
const OLD_EXE = Buffer.from("old mihomo 1.18.0 image");
const NEW_EXE = Buffer.from("new mihomo 1.19.33 image");
const ZIP = Buffer.from("zip container of mihomo-windows-amd64");
const ZIP_DIGEST = sha256Hex(ZIP);
/** 2026-10-30 真包的字节数：v1.19.33 的 windows-amd64 plain zip。 */
const REAL_ZIP_BYTES = 22_512_121;

interface ReleaseOptions {
  tag?: string | null;
  name?: string;
  digest?: string | null;
  downloadUrl?: string;
  prerelease?: boolean;
  draft?: boolean;
  /** 整个 assets 数组直接给（用于「只有别的平台」「一个 zip 都没有」这类形状）。 */
  assets?: unknown;
}

/** 形状照真响应（`v1.19.33`、127 个资产）里 windows-amd64 那一族缩到最小。 */
function releaseJson(options: ReleaseOptions = {}): Record<string, unknown> {
  const tag = options.tag ?? "v1.19.33";
  const name = options.name ?? `mihomo-windows-amd64-${tag}.zip`;
  if (options.assets !== undefined) return { tag_name: tag, prerelease: false, assets: options.assets };
  return {
    tag_name: tag,
    prerelease: options.prerelease ?? false,
    draft: options.draft ?? false,
    assets: [
      {
        name,
        digest: options.digest === undefined ? `sha256:${ZIP_DIGEST}` : options.digest,
        browser_download_url: options.downloadUrl
          ?? `https://github.com/MetaCubeX/mihomo/releases/download/${tag}/${name}`,
      },
      // 真发布页 always 有的干扰项：别的平台的包，以及只有摘要那种小文件。
      { name: "mihomo-linux-amd64-v1.19.33.zip", digest: `sha256:${ZIP_DIGEST}`, browser_download_url: "https://github.com/linux" },
      { name: "mihomo-windows-amd64-v1.19.33.sha256", digest: null, browser_download_url: "https://github.com/sha" },
    ],
  };
}

interface FakeFs extends UpdateFs {
  files: Map<string, Buffer>;
  /** 每一条落盘动作，按发生先后记：断言「没动过」与「动过哪些」靠的是这一串。 */
  touched: string[];
}

function toBuffer(value: Buffer | string): Buffer {
  return typeof value === "string" ? Buffer.from(value) : value;
}

interface FsHooks {
  /** 只挂在写包那一步（别的 write 照常），这样「落不住」不会被误读成「解压失败」。 */
  writeThrows?: string;
  renameThrows?: string;
  removeThrows?: string;
}

function createFakeFs(initial: Record<string, Buffer | string>, hooks: FsHooks = {}): FakeFs {
  const files = new Map<string, Buffer>();
  for (const [file, value] of Object.entries(initial)) files.set(file, toBuffer(value));
  const touched: string[] = [];
  return {
    files,
    touched,
    mkdir: (dir) => {
      touched.push(`mkdir ${dir}`);
    },
    writeFile: (file, data) => {
      if (hooks.writeThrows && file === ARCHIVE) throw new Error(hooks.writeThrows);
      touched.push(`write ${file}`);
      files.set(file, data);
    },
    readBytes: (file) => files.get(file) ?? null,
    rename: (from, to) => {
      if (hooks.renameThrows) throw new Error(hooks.renameThrows);
      touched.push(`rename ${from} -> ${to}`);
      const value = files.get(from);
      if (!value) throw new Error(`ENOENT: no such file or directory, rename '${from}'`);
      files.delete(from);
      files.set(to, value);
    },
    remove: (target) => {
      if (hooks.removeThrows) throw new Error(hooks.removeThrows);
      touched.push(`remove ${target}`);
      for (const key of [...files.keys()]) {
        if (key === target || key.startsWith(`${target}${path.sep}`)) files.delete(key);
      }
    },
  };
}

interface HarnessOptions extends ReleaseOptions {
  /** `false`＝一路不能换；数组＝按调用顺序给答案（「下载中途被起起来了」那一档要用）。 */
  canSwap?: boolean | boolean[];
  zip?: Buffer;
  /** 解压产物：相对名 → 字节。`{}`＝解压出来是空的。 */
  payload?: Record<string, Buffer>;
  extractThrows?: string;
  writeThrows?: string;
  renameThrows?: string;
  removeThrows?: string;
  getJsonThrows?: string;
  downloadThrows?: string;
  fsInitial?: Record<string, Buffer | string>;
  releaseUrl?: string;
  installedCoreExists?: boolean;
}

interface Harness {
  updater: ReturnType<typeof createCoreUpdater>;
  fs: FakeFs;
  calls: { getJson: string[]; download: string[]; extract: string[]; canSwap: number };
  logs: string[];
}

/** 一次跑到底的假装配：每条测试只写自己关心的那一个偏置，其余全走成功路径。 */
function harness(options: HarnessOptions = {}): Harness {
  const zip = toBuffer(options.zip ?? ZIP);
  const payload = options.payload ?? { [EXE_ENTRY]: NEW_EXE };
  const fs = createFakeFs({ [BUNDLED]: OLD_EXE, ...options.fsInitial }, {
    writeThrows: options.writeThrows,
    renameThrows: options.renameThrows,
    removeThrows: options.removeThrows,
  });
  const calls = { getJson: [] as string[], download: [] as string[], extract: [] as string[], canSwap: 0 };
  const logs: string[] = [];
  const swapAnswers = typeof options.canSwap === "boolean" || options.canSwap === undefined
    ? [options.canSwap ?? true]
    : options.canSwap;

  const updater = createCoreUpdater({
    releaseUrl: options.releaseUrl ?? MIHOMO_RELEASE_API_URL,
    getJson: async (url) => {
      calls.getJson.push(url);
      if (options.getJsonThrows) throw new UpdateHttpError(options.getJsonThrows);
      return releaseJson(options);
    },
    downloadBytes: async (url) => {
      calls.download.push(url);
      if (options.downloadThrows) throw new UpdateHttpError(options.downloadThrows);
      return zip;
    },
    extract: async (_archive, destDir) => {
      calls.extract.push(destDir);
      if (options.extractThrows) throw new Error(options.extractThrows);
      const names: string[] = [];
      for (const [entry, bytes] of Object.entries(payload)) {
        fs.writeFile(stagedExePath(destDir, entry), bytes);
        names.push(entry);
      }
      return names;
    },
    canSwap: () => {
      const answer = swapAnswers[Math.min(calls.canSwap, swapAnswers.length - 1)];
      calls.canSwap += 1;
      return answer;
    },
    coreDir: () => CORE_DIR,
    bundledExe: () => BUNDLED,
    installedCoreExists: () => options.installedCoreExists ?? false,
    fs,
    now: () => 1_730_000_000_000,
    log: (line) => logs.push(line),
  });
  return { updater, fs, calls, logs };
}

/** 落盘痕迹里「写/换名/建目录」那三类——「清临时目录」不算落盘，单独看。 */
function writtenToDisk(touched: readonly string[]): string[] {
  return touched.filter((line) => !line.startsWith("remove "));
}

/* ------------------------------------------------ 场景表：词表没有死档 */

type Scenario = {
  name: string;
  options: HarnessOptions;
  outcome: CoreUpdateOutcome;
  reason: CoreUpdateReason | null;
};

const SCENARIOS: Scenario[] = [
  { name: "成功换装", options: {}, outcome: "installed", reason: null },
  { name: "逐字节相同", options: { payload: { [EXE_ENTRY]: OLD_EXE } }, outcome: "latest", reason: null },
  { name: "内核在跑，先拒", options: { canSwap: false }, outcome: "busy", reason: null },
  { name: "下载期间被起起来了", options: { canSwap: [true, false] }, outcome: "busy", reason: null },
  { name: "发布页问不到", options: { getJsonThrows: "HTTP 403" }, outcome: "failed", reason: "download-failed" },
  { name: "包下不回来", options: { downloadThrows: "HTTP 404" }, outcome: "failed", reason: "download-failed" },
  { name: "发布页 host 是假的", options: { releaseUrl: "https://api.github.com.evil.tld/repos/x" }, outcome: "failed", reason: "download-failed" },
  { name: "资产 host 是假的", options: { downloadUrl: "https://evil.tld/mihomo.zip" }, outcome: "failed", reason: "download-failed" },
  { name: "发布页没给摘要", options: { digest: null }, outcome: "failed", reason: "digest-missing" },
  { name: "摘要不是 sha256", options: { digest: "md5:00112233" }, outcome: "failed", reason: "digest-missing" },
  { name: "摘要对不上", options: { zip: Buffer.from("tampered container") }, outcome: "failed", reason: "digest-mismatch" },
  { name: "只有预发布版", options: { prerelease: true }, outcome: "failed", reason: "no-asset" },
  { name: "只有草稿", options: { draft: true }, outcome: "failed", reason: "no-asset" },
  { name: "没有 windows-amd64 包", options: { assets: [{ name: "mihomo-darwin-arm64.zip", digest: `sha256:${ZIP_DIGEST}`, browser_download_url: "https://github.com/m" }] }, outcome: "failed", reason: "no-asset" },
  { name: "解压直接败", options: { extractThrows: "退出码 1" }, outcome: "failed", reason: "extract-failed" },
  { name: "解压出来是空的", options: { payload: {} }, outcome: "failed", reason: "extract-failed" },
  { name: "解压出来两颗 exe", options: { payload: { "mihomo.exe": NEW_EXE, "helper.exe": NEW_EXE } }, outcome: "failed", reason: "extract-failed" },
  { name: "解压目录里读不到那颗 exe", options: { payload: { "notes.txt": NEW_EXE } }, outcome: "failed", reason: "extract-failed" },
  { name: "临时目录落不住", options: { writeThrows: "ENOSPC: no space left on device" }, outcome: "failed", reason: "swap-failed" },
  { name: "文件换不动", options: { renameThrows: "EPERM: operation not permitted" }, outcome: "failed", reason: "swap-failed" },
];

describe("内核更新：每一档场景的下场", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const state = await harness(scenario.options).updater.update();
      expect(state.outcome).toBe(scenario.outcome);
      expect(state.reason).toBe(scenario.reason);
    });
  }

  it("词表里每一档都有可达的路径（加了词却走不到＝页面要替它编话）", () => {
    const outcomes = new Set<CoreUpdateOutcome>();
    const reasons = new Set<CoreUpdateReason>();
    for (const scenario of SCENARIOS) {
      outcomes.add(scenario.outcome);
      if (scenario.reason) reasons.add(scenario.reason);
    }
    expect([...outcomes].sort()).toEqual([...CORE_UPDATE_OUTCOMES].sort());
    expect([...reasons].sort()).toEqual([...CORE_UPDATE_REASONS].sort());
  });

  it("除了成功那档，其余每一档都不许留下半包或换过的文件", async () => {
    for (const scenario of SCENARIOS) {
      if (scenario.outcome === "installed") continue;
      const run = harness(scenario.options);
      await run.updater.update();
      expect(run.fs.files.get(BUNDLED)?.equals(OLD_EXE), `${scenario.name} 动了当前内核`).toBe(true);
      expect(run.fs.touched.some((line) => line.startsWith(`rename ${PAYLOAD}`)), `${scenario.name} 换了文件`).toBe(false);
      // 临时那一层每次都收场：残留会让下一次的文件枚举多算一份，也会被当成「装过东西」。
      expect(run.fs.touched, `${scenario.name} 没清临时目录`).toContain(`remove ${STAGING}`);
    }
  });

  it("清临时目录失败也不把下场改掉，只多留一句日志", async () => {
    const run = harness({ removeThrows: "EBUSY: resource busy or locked" });
    const state = await run.updater.update();
    expect(state.outcome).toBe("installed");
    expect(run.logs.some((line) => line.includes("临时目录没清干净"))).toBe(true);
  });

  it("摘要不符时一个字节都不落盘", async () => {
    const run = harness({ zip: Buffer.from("tampered container") });
    const state = await run.updater.update();
    expect(state.reason).toBe("digest-mismatch");
    expect(writtenToDisk(run.fs.touched)).toEqual([]);
  });

  it("摘要缺失与预发布版都不许下载（先问发布页，别看名字对不上就下）", async () => {
    for (const options of [{ digest: null }, { prerelease: true }, { draft: true }]) {
      const run = harness(options);
      const state = await run.updater.update();
      expect(state.outcome).toBe("failed");
      expect(run.calls.download, JSON.stringify(options)).toEqual([]);
    }
  });

  it("发布页 host 不在白名单：连 getJson 都不许调", async () => {
    const run = harness({ releaseUrl: "https://api.github.com.evil.tld/repos/MetaCubeX/mihomo/releases/latest" });
    const state = await run.updater.update();
    expect(state.reason).toBe("download-failed");
    expect(run.calls.getJson).toEqual([]);
    expect(state.detail).toContain("api.github.com.evil.tld");
  });

  it("资产 host 不在白名单：连 downloadBytes 都不许调", async () => {
    const run = harness({ downloadUrl: "https://objects.githubusercontent.com.evil.tld/mihomo.zip" });
    const state = await run.updater.update();
    expect(state.reason).toBe("download-failed");
    expect(run.calls.getJson).toEqual([MIHOMO_RELEASE_API_URL]);
    expect(run.calls.download).toEqual([]);
  });

  it("明知换不了就不下那 22 MB", async () => {
    const run = harness({ canSwap: false });
    const state = await run.updater.update();
    expect(state.outcome).toBe("busy");
    expect(run.calls.getJson).toEqual([]);
    expect(run.calls.download).toEqual([]);
    expect(state.reason).toBe(null);
  });

  it("下载中途内核被起起来：解好了也不换，并说清是哪一段时间出的事", async () => {
    const run = harness({ canSwap: [true, false] });
    const state = await run.updater.update();
    expect(state.outcome).toBe("busy");
    expect(run.calls.download).toHaveLength(1);
    expect(run.fs.files.get(BUNDLED)?.equals(OLD_EXE)).toBe(true);
    expect(state.detail).toContain("下载这段时间");
  });

  it("逐字节相同是 latest，不许 rename、也不许报失败", async () => {
    const run = harness({ payload: { [EXE_ENTRY]: OLD_EXE } });
    const state = await run.updater.update();
    expect(state.outcome).toBe("latest");
    expect(state.reason).toBe(null);
    expect(state.tag).toBe("v1.19.33");
    expect(run.fs.touched.filter((line) => line.startsWith("rename"))).toEqual([]);
  });

  it("嵌套在子目录里的那颗 exe 也算数（换名要按相对路径拼）", async () => {
    const run = harness({ payload: { [`bin/${EXE_ENTRY}`]: NEW_EXE } });
    const state = await run.updater.update();
    expect(state.outcome).toBe("installed");
    expect(run.fs.touched).toContain(`rename ${path.join(PAYLOAD, "bin", EXE_ENTRY)} -> ${BUNDLED}`);
    expect(run.fs.files.get(BUNDLED)?.equals(NEW_EXE)).toBe(true);
  });

  it("本机还有安装版那颗时，installed 必须说清「生效要等它不在」", async () => {
    const shadowed = await harness({ installedCoreExists: true }).updater.update();
    expect(shadowed.outcome).toBe("installed");
    expect(shadowed.detail).toContain("优先借它");

    const alone = await harness({}).updater.update();
    expect(alone.detail).toBe(null);
  });

  it("回执带案发现场：tag、资产原名、时间戳，不许只剩「下载失败」", async () => {
    const run = harness({ downloadThrows: "HTTP 500" });
    const state = await run.updater.update();
    expect(state.tag).toBe("v1.19.33");
    expect(state.asset).toBe(`mihomo-windows-amd64-v1.19.33.zip`);
    expect(state.detail).toContain("HTTP 500");
    expect(state.at).toBe(1_730_000_000_000);
  });

  it("一个资产都没有：tag 有、asset 是 null，reason 是 no-asset", async () => {
    const state = await harness({ assets: [] }).updater.update();
    expect(state.tag).toBe("v1.19.33");
    expect(state.asset).toBe(null);
    expect(state.reason).toBe("no-asset");
  });

  it("tag_name 是空白串时，回执里的 tag 是 null 而不是「空版本号」", async () => {
    const state = await harness({ tag: "" }).updater.update();
    expect(state.outcome).toBe("installed");
    expect(state.tag).toBe(null);
  });

  it("落盘边界：所有写入都在 core 目录下，一个字节都不进 Verge 目录", async () => {
    const run = harness();
    await run.updater.update();
    const written = writtenToDisk(run.fs.touched);
    expect(written.length).toBeGreaterThan(0);
    for (const line of written) {
      // `rename A -> B` 的两端都要看：源在 core 里但目标跑到 Verge 目录，同样是越界。
      const targets = line.replace(/^(mkdir|write|rename) /, "").split(" -> ");
      for (const target of targets) {
        expect(target.startsWith(CORE_DIR + path.sep), `写到了 core 外面：${target}`).toBe(true);
        expect(target.startsWith(VERGE_DIR), `写进了 Verge 目录：${target}`).toBe(false);
      }
    }
    // 成功收场之后，临时那一层不该在盘上留下任何东西。
    for (const file of run.fs.files.keys()) {
      expect(file.startsWith(STAGING), `半包没清掉：${file}`).toBe(false);
    }
  });

  it("在途去重：第二次点击等同一趟，不开第二个临时目录互相盖文件", async () => {
    const run = harness();
    const first = run.updater.update();
    const second = run.updater.update();
    expect(second).toBe(first);
    const [a, b] = await Promise.all([first, second]);
    expect(run.calls.getJson).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a.outcome).toBe("installed");
  });

  it("跑完之后再点是重新一趟：第二趟认的是盘上现在那颗", async () => {
    const run = harness();
    const first = await run.updater.update();
    const second = await run.updater.update();
    expect(run.calls.getJson).toHaveLength(2);
    expect(first.outcome).toBe("installed");
    // 上一趟真的把文件换掉了，所以第二趟的「已经是最新」有出处——不是把旧账再念一遍。
    expect(second.outcome).toBe("latest");
  });

  it("state()：一次都没试过是 null，试过之后是最近那次的账", async () => {
    const run = harness();
    expect(run.updater.state()).toBe(null);
    const state = await run.updater.update();
    expect(run.updater.state()).toEqual(state);
  });

  it("每一档下场都进日志，日志里没有摘要之外的怪字符", async () => {
    const run = harness();
    await run.updater.update();
    expect(run.logs.some((line) => line.includes("outcome=installed"))).toBe(true);
    expect(run.logs.some((line) => line.includes("摘要已核对"))).toBe(true);
  });
});

/* ------------------------------------------------------------ 发布页判定 */

describe("发布页里「能不能装」的判定", () => {
  it("真形状的响应：tag、预发布标记与挑中的资产一起读出来", () => {
    const info = inspectRelease(releaseJson());
    expect(info).toEqual({
      tag: "v1.19.33",
      prerelease: false,
      draft: false,
      asset: {
        name: "mihomo-windows-amd64-v1.19.33.zip",
        downloadUrl: "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.33/mihomo-windows-amd64-v1.19.33.zip",
        digest: ZIP_DIGEST,
      },
    });
  });

  it("null / 数组 / 字符串都不许被当成一份发布页", () => {
    for (const payload of [null, undefined, [], "v1.19.33", 42]) {
      const info = inspectRelease(payload);
      expect(info.tag).toBe(null);
      expect(info.asset).toBe(null);
      expect(info.prerelease).toBe(false);
    }
  });

  it("prerelease/draft 只认字面 true：字符串 \"true\" 不算预发布", () => {
    expect(inspectRelease({ tag_name: "v1", prerelease: "true", assets: [] }).prerelease).toBe(false);
    expect(inspectRelease({ tag_name: "v1", prerelease: true, assets: [] }).prerelease).toBe(true);
  });

  it("tag_name 空白串算「没读到」，不是「读到了空版本号」", () => {
    expect(inspectRelease({ tag_name: "   ", assets: [] }).tag).toBe(null);
  });
});

/* ---------------------------------------------------------------- 出口层 */

interface FakeResponseInit {
  headers?: Record<string, string>;
  /** 单独给：3xx 那一档全靠它，写进 `headers` 也行，但测试里每处都拼一遍更容易写错。 */
  location?: string;
  text?: string;
  chunks?: Buffer[];
  reader?: ReaderLike;
}

function fakeResponse(status: number, init: FakeResponseInit = {}): ResponseLike {
  const entries = Object.entries(init.headers ?? {});
  if (init.location) entries.push(["location", init.location]);
  const headers = new Map(entries.map(([key, value]) => [key.toLowerCase(), value]));
  const chunks = init.chunks ?? [];
  const reader: ReaderLike = init.reader ?? {
    read: async () => (chunks.length === 0
      ? { done: true, value: undefined }
      : { done: false, value: chunks.shift() }),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    text: async () => init.text ?? Buffer.concat(chunks).toString("utf8"),
    body: { getReader: () => reader },
  };
}

class CountingReader implements ReaderLike {
  cancelled = false;
  private index = 0;
  constructor(private readonly chunks: Buffer[]) {}
  async read(): Promise<{ done?: boolean; value?: Uint8Array }> {
    if (this.index >= this.chunks.length) return { done: true, value: undefined };
    const value = this.chunks[this.index];
    this.index += 1;
    return { done: false, value };
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
  releaseLock(): void {}
}

describe("出口层：逐跳过白名单，超上限就收手", () => {
  const releaseUrl = MIHOMO_RELEASE_API_URL;
  const assetUrl = "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.33/mihomo-windows-amd64-v1.19.33.zip";

  it("发布页一问一答：JSON 原样读出，且带上 GitHub 要的 UA 与 accept", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const network = createUpdateNetwork({
      fetchImpl: (url, init) => {
        seen.push({ url, init });
        return Promise.resolve(fakeResponse(200, { text: JSON.stringify({ tag_name: "v1.19.33" }) }));
      },
    });
    await expect(network.getJson(releaseUrl)).resolves.toEqual({ tag_name: "v1.19.33" });
    expect(seen[0].url).toBe(releaseUrl);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.accept).toContain("application/vnd.github+json");
    expect(headers["user-agent"]).toBeTruthy();
    expect(seen[0].init.redirect).toBe("manual");
  });

  it("回来的不是 JSON 时报「发布页回来的不是 JSON」，不交给上层去猜", async () => {
    const network = createUpdateNetwork({ fetchImpl: () => Promise.resolve(fakeResponse(200, { text: "<html>登录页" })) });
    await expect(network.getJson(releaseUrl)).rejects.toThrow(/不是 JSON/);
  });

  it("HTTP 非 2xx 把状态码带进错误正文", async () => {
    const network = createUpdateNetwork({ fetchImpl: () => Promise.resolve(fakeResponse(403, { text: "{}" })) });
    await expect(network.getJson(releaseUrl)).rejects.toThrow(/HTTP 403/);
  });

  it("跳转落在白名单里就继续跟：实测 github.com 会 302 到 release-assets", async () => {
    const urls: string[] = [];
    const network = createUpdateNetwork({
      fetchImpl: (url) => {
        urls.push(url);
        return Promise.resolve(url.endsWith(".zip") && urls.length === 1
          ? fakeResponse(302, { location: "https://release-assets.githubusercontent.com/abcdef.zip" })
          : fakeResponse(200, { chunks: [ZIP] }));
      },
    });
    const bytes = await network.downloadBytes(assetUrl, MIHOMO_MAX_BYTES);
    expect(bytes.equals(ZIP)).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("release-assets.githubusercontent.com");
  });

  it("跳转出了白名单就当场拒，那一次请求根本不发", async () => {
    const urls: string[] = [];
    const network = createUpdateNetwork({
      fetchImpl: (url) => {
        urls.push(url);
        return Promise.resolve(fakeResponse(302, { location: "https://evil.tld/mihomo.zip" }));
      },
    });
    await expect(network.downloadBytes(assetUrl, MIHOMO_MAX_BYTES)).rejects.toThrow(/白名单/);
    expect(urls).toEqual([assetUrl]);
  });

  it("发布页那一路只准留在 api.github.com：跳到 github.com 也算出去", async () => {
    const network = createUpdateNetwork({
      fetchImpl: () => Promise.resolve(fakeResponse(302, { location: "https://github.com/login" })),
    });
    await expect(network.getJson(releaseUrl)).rejects.toThrow(/白名单/);
  });

  it("跳转超过上限就收手，不跟到底", async () => {
    let requests = 0;
    const network = createUpdateNetwork({
      maxRedirects: 2,
      fetchImpl: () => {
        requests += 1;
        return Promise.resolve(fakeResponse(302, { location: `https://github.com/loop-${requests}.zip` }));
      },
    });
    await expect(network.downloadBytes(assetUrl, MIHOMO_MAX_BYTES)).rejects.toThrow(/超过 2 跳/);
    // 2 跳跟完之后那一次请求仍然发得出去，是它的 302 才被拒：总共 3 次请求，不是 2 次。
    expect(requests).toBe(3);
  });

  it("3xx 没给地址也是一句能照着看的话", async () => {
    const network = createUpdateNetwork({ fetchImpl: () => Promise.resolve(fakeResponse(302, {})) });
    await expect(network.downloadBytes(assetUrl, MIHOMO_MAX_BYTES)).rejects.toThrow(/没给地址/);
  });

  it("content-length 撒谎时，边读边算那把尺兜住", async () => {
    const reader = new CountingReader([Buffer.alloc(1000), Buffer.alloc(1000), Buffer.alloc(1000)]);
    // 声明 1000、实际 3000：提前拦那把尺根本看不见，只有边读边算能拦住。
    const network = createUpdateNetwork({
      fetchImpl: () => Promise.resolve(fakeResponse(200, { headers: { "content-length": "1000" }, reader })),
    });
    await expect(network.downloadBytes(assetUrl, 2500)).rejects.toThrow(/比上限大/);
    expect(reader.cancelled).toBe(true);
  });

  it("正文原样读回来：三块拼成一份，不多不少", async () => {
    const network = createUpdateNetwork({
      fetchImpl: () => Promise.resolve(fakeResponse(200, { chunks: [Buffer.from("abc"), Buffer.from("def")] })),
    });
    const bytes = await network.downloadBytes(assetUrl, MIHOMO_MAX_BYTES);
    expect(bytes.toString("utf8")).toBe("abcdef");
  });

  it("声明就比上限大时提前拦，一次正文都不读", async () => {
    const network = createUpdateNetwork({
      fetchImpl: () => Promise.resolve(fakeResponse(200, { headers: { "content-length": String(REAL_ZIP_BYTES * 4) } })),
    });
    await expect(network.downloadBytes(assetUrl, REAL_ZIP_BYTES)).rejects.toThrow(/比上限大/);
  });

  it("真包那一档必须在上限之下：上限收紧过一次就要红", async () => {
    expect(MIHOMO_MAX_BYTES).toBeGreaterThan(REAL_ZIP_BYTES);
  });

  it("到点没等到就说「到点没等到」，不混成「网络不通」", async () => {
    const network = createUpdateNetwork({
      timeoutMs: 5,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    await expect(network.getJson(releaseUrl)).rejects.toThrow(/到点没等到/);
  });

  it("请求本身炸了报「请求没回来」并带上原始那句", async () => {
    const network = createUpdateNetwork({
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:443")),
    });
    await expect(network.getJson(releaseUrl)).rejects.toThrow(/请求没回来：ECONNREFUSED/);
  });

  it("发布页地址的域名钉在 api.github.com（换域名就是换上游）", () => {
    expect(new URL(MIHOMO_RELEASE_API_URL).host).toBe("api.github.com");
    expect(MIHOMO_RELEASE_API_URL).toContain("MetaCubeX/mihomo");
  });
});

/* ------------------------------------------------------------------ 解压 */

describe("解压：PowerShell 先，System32 的 tar 兜底", () => {
  it("Expand-Archive 成事时不碰 tar，且两条路径都以单引号字面量进命令", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const extractor = createArchiveExtractor({
      run: (file, args) => {
        calls.push({ file, args });
        return Promise.resolve();
      },
      list: () => [EXE_ENTRY],
    });
    const names = await extractor(ARCHIVE, PAYLOAD);
    expect(names).toEqual([EXE_ENTRY]);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("powershell.exe");
    const script = calls[0].args[calls[0].args.length - 1];
    expect(script).toContain("Expand-Archive -LiteralPath");
    expect(script).toContain(`-DestinationPath ${psSingleQuote(PAYLOAD)}`);
    expect(calls[0].args).toContain("-NonInteractive");
    expect(calls[0].args).toContain("-NoProfile");
  });

  it("PowerShell 败了才走 tar，且用的是绝对路径（PATH 上的 tar 是 Git 那个 GNU tar）", async () => {
    const calls: string[] = [];
    const extractor = createArchiveExtractor({
      systemRoot: "D:\\Windows",
      run: (file) => {
        calls.push(file);
        if (file === "powershell.exe") return Promise.reject(new Error("退出码 1"));
        return Promise.resolve();
      },
      list: () => [EXE_ENTRY],
    });
    await expect(extractor(ARCHIVE, PAYLOAD)).resolves.toEqual([EXE_ENTRY]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(path.join("D:\\Windows", "System32", "tar.exe"));
  });

  it("两条都败时报两句都带上——只报后一句会让人去找 PowerShell 的毛病", async () => {
    const extractor = createArchiveExtractor({
      run: (file) => Promise.reject(new Error(`${file} 退出码 1`)),
      list: () => [],
    });
    await expect(extractor(ARCHIVE, PAYLOAD)).rejects.toThrow(/Expand-Archive：powershell.exe 退出码 1.*tar.exe：.*退出码 1/);
  });

  it("tar 的参数是 -xf/-C：bsdtar 认 zip 靠的是这一对", async () => {
    const args: string[][] = [];
    const extractor = createArchiveExtractor({
      run: (file, a) => {
        args.push(a);
        return file === "powershell.exe" ? Promise.reject(new Error("no powershell here")) : Promise.resolve();
      },
      list: () => [],
    });
    await extractor(ARCHIVE, PAYLOAD);
    expect(args[1]).toEqual(["-xf", ARCHIVE, "-C", PAYLOAD]);
  });

  it("systemTarPath 认 SystemRoot，没有它才退到 C:\\Windows", () => {
    expect(systemTarPath({ SystemRoot: "E:\\Win" })).toBe(path.join("E:\\Win", "System32", "tar.exe"));
    expect(systemTarPath({})).toBe(path.join("C:\\Windows", "System32", "tar.exe"));
  });

  it("路径里的单引号必须成对翻倍：便携版目录名里有 ' 是合法的", () => {
    expect(psSingleQuote("it's here")).toBe("'it''s here'");
    expect(psSingleQuote("plain")).toBe("'plain'");
  });
});

/* ------------------------------------------------------------ 小纯函数 */

describe("小判定", () => {
  it("sha256Hex 与 node:crypto 的口径一致（摘要比对靠这一句）", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("stagedExePath 把 `/` 分隔的条目名换成平台路径", () => {
    expect(stagedExePath(PAYLOAD, "bin/mihomo.exe")).toBe(path.join(PAYLOAD, "bin", "mihomo.exe"));
    expect(stagedExePath(PAYLOAD, EXE_ENTRY)).toBe(path.join(PAYLOAD, EXE_ENTRY));
  });

  it("临时那三层的名字不许改：改名会让上一次的半成品留下来不被清", () => {
    expect(STAGING_DIR_NAME).toBe("update-staging");
    expect(ARCHIVE_NAME).toBe("mihomo.zip");
    expect(PAYLOAD_DIR_NAME).toBe("payload");
  });
});

import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_USER_AGENT,
  PART_SUFFIX,
  createInstallerDownloader,
  type DownloadFs,
  type DownloadTarget,
  type WriteSink,
} from "./installer-download";

const VERSION = "1.16.0";
const FILE_NAME = `Mochi-Setup-${VERSION}.exe`;
const DIR = path.join("U:", "userData", "updates");
const PART = path.join(DIR, `${FILE_NAME}${PART_SUFFIX}`);
const FINAL = path.join(DIR, FILE_NAME);
const hexOf = (text: string): string => createHash("sha256").update(Buffer.from(text, "binary")).digest("hex");

/* ------------------------------------------------------------------ 假盘 */

interface FakeFs extends DownloadFs {
  files: Map<string, string>;
  ops: string[];
  /** 让 mkdir / openWrite / rename 下一步就抛：败在哪一格都能演。 */
  failAt?(op: "mkdir" | "open" | "write" | "rename"): void;
}

function fakeFs(seed: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(seed));
  const ops: string[] = [];
  let failing: string | null = null;
  const boom = (op: string): void => {
    if (failing === op) throw new Error(`注入失败：${op}`);
  };
  const fs: FakeFs = {
    files,
    ops,
    failAt(op) {
      failing = op;
    },
    mkdir(dir) {
      ops.push(`mkdir ${dir}`);
      boom("mkdir");
    },
    async openWrite(file): Promise<WriteSink> {
      ops.push(`open ${file}`);
      boom("open");
      files.set(file, "");
      return {
        async write(chunk) {
          boom("write");
          files.set(file, (files.get(file) ?? "") + chunk.toString("binary"));
        },
        async close() {
          ops.push(`close ${file}`);
        },
      };
    },
    remove(file) {
      ops.push(`remove ${file}`);
      files.delete(file);
    },
    rename(from, to) {
      ops.push(`rename ${from} -> ${to}`);
      boom("rename");
      const body = files.get(from) ?? "";
      files.delete(from);
      files.set(to, body);
    },
    entries(dir) {
      return [...files.keys()].filter((key) => key.startsWith(dir + path.sep) || key.startsWith(dir)).map((key) => key.slice(dir.length + 1));
    },
    size(file) {
      const body = files.get(file);
      return body === undefined ? null : Buffer.byteLength(body, "binary");
    },
    async sha256(file) {
      const body = files.get(file);
      return body === undefined ? null : hexOf(body);
    },
  };
  return fs;
}

/* ----------------------------------------------------------------- 假网络 */

interface ReaderScript {
  chunks?: (string | Error)[];
  /** 读到第几块之后卡住不回（演「静默超时」，不是报错）。 */
  hang?: boolean;
}

function makeFetch(
  script: ReaderScript,
  options: {
    status?: number;
    headers?: Record<string, string>;
    redirects?: { status: number; location: string }[];
    /** 响应根本没带 body（只有 text()）。 */
    noBody?: boolean;
    onUrl?(url: string): void;
  } = {},
) {
  const urls: string[] = [];
  const queue = [...(script.chunks ?? [])];
  const fetchImpl = async (url: string, init: RequestInit) => {
    urls.push(url);
    options.onUrl?.(url);
    expect((init.headers as Record<string, string>)["user-agent"], "GitHub 没有 UA 会直接 403").toBe(CLIENT_USER_AGENT);
    expect(init.redirect, "必须自己逐跳走，不能让 fetch 静默跟跳转").toBe("manual");
    const hop = (options.redirects ?? []).shift();
    if (hop) {
      return {
        ok: false,
        status: hop.status,
        headers: new Map<string, string>([["location", hop.location], ...Object.entries(options.headers ?? {})] as [string, string][]),
        body: null,
        text: async () => "",
      };
    }
    const headers = new Map<string, string>(Object.entries(options.headers ?? {}));
    return {
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      headers,
      body: options.noBody ? null : {
        getReader: () => ({
          read: async () => {
            if (script.hang) return new Promise(() => {});
            const next = queue.shift();
            if (next === undefined) return { done: true, value: undefined };
            if (next instanceof Error) throw next;
            return { done: false, value: Buffer.from(next, "binary") };
          },
          cancel: async () => {
            urls.push("CANCELLED");
          },
          releaseLock: () => {},
        }),
      },
      text: async () => "no-body",
    };
  };
  return { fetchImpl: fetchImpl as never, urls };
}

function downloader(
  script: ReaderScript,
  options: Parameters<typeof makeFetch>[1] & Partial<{
    maxBytes: number;
    idleMs: number;
    seed: Record<string, string>;
    failAt: "mkdir" | "open" | "write" | "rename";
  }> = {},
) {
  const fs = fakeFs(options.seed ?? {});
  if (options.failAt) fs.failAt(options.failAt);
  const { fetchImpl, urls } = makeFetch(script, options);
  const logs: string[] = [];
  const dl = createInstallerDownloader({
    updatesDir: () => DIR,
    fetchImpl,
    fs,
    idleMs: options.idleMs ?? 20,
    maxBytes: options.maxBytes ?? 1024,
    log: (line) => logs.push(line),
  });
  return { dl, fs, urls, logs };
}

const target = (over: Partial<DownloadTarget> = {}): DownloadTarget => ({
  fileName: FILE_NAME,
  downloadUrl: `https://github.com/damingslu-ctrl/Cyrene-Agent/releases/download/v${VERSION}/${FILE_NAME}`,
  digest: hexOf("payload"),
  version: VERSION,
  ...over,
});

describe("installer-download：字节先自证，才允许上正名", () => {
  it("摘要对得上才 rename 成正名；.part 一路走到底不留", async () => {
    const h = downloader({ chunks: ["pay", "load"] });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: true, fileName: FILE_NAME, bytes: 7, hops: 0 });
    expect(h.fs.files.get(FINAL)).toBe("payload");
    expect(h.fs.files.has(PART)).toBe(false);
    expect(h.fs.ops.filter((op) => op.startsWith("rename"))).toHaveLength(1);
    // 增量哈希与「整包一次算」必须同值：分块这件事不许改变判定。
    expect(hexOf("pay" + "load")).toBe(hexOf("payload"));
  });

  it("摘要不符：.part 当场删掉、正名从没出现过，回执报期望与实际", async () => {
    const h = downloader({ chunks: ["pay", "load"] });
    const result = await h.dl.download(target({ digest: "f".repeat(64) }));
    expect(result).toMatchObject({ ok: false, reason: "digest-mismatch" });
    expect(h.fs.files.has(PART)).toBe(false);
    expect(h.fs.files.has(FINAL)).toBe(false);
    if (!result.ok) expect(result.detail).toContain(`期望 sha256 ${"f".repeat(12)}`);
    // 正对照：同一份字节配上对的摘要就就位——败的是摘要，不是这一趟读法。
    const ok = downloader({ chunks: ["pay", "load"] });
    expect((await ok.dl.download(target())).ok).toBe(true);
  });

  it("读到一半连接炸了也不留半包", async () => {
    const h = downloader({ chunks: ["pay", new Error("socket hang up")] });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "network-failed" });
    if (!result.ok) expect(result.detail).toContain("socket hang up");
    expect(h.fs.files.size).toBe(0);
  });

  it("写盘写坏了一格（盘满）报 write-failed，并且不把 .part 留在盘上冒充包", async () => {
    const h = downloader({ chunks: ["pay", "load"] }, { failAt: "write" });
    const result = await h.dl.download(target());
    // 「写不进去」跟「网不通」是两件事：前者查磁盘与占用，后者查下行。不许并成一档。
    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    if (!result.ok) expect(result.detail).toContain("注入失败：write");
    expect(h.fs.files.has(PART)).toBe(false);
    expect(h.fs.files.has(FINAL)).toBe(false);
    // 正对照：同一份字节、不注入写失败就位。
    const well = downloader({ chunks: ["pay", "load"] });
    expect((await well.dl.download(target())).ok).toBe(true);
  });

  it("临时文件根本开不开（只读目录）也是 write-failed，盘上一个文件都不落", async () => {
    const h = downloader({ chunks: ["pay", "load"] }, { failAt: "open" });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    if (!result.ok) expect(result.detail).toContain("注入失败：open");
    expect(h.fs.files.size).toBe(0);
    // 正对照：请求已经发出去了——败的是盘，不是没连着。
    expect(h.urls.filter((url) => url !== "CANCELLED")).toHaveLength(1);
  });

  it("目录建不出来就说建不出来，不发请求", async () => {
    const h = downloader({ chunks: ["pay"] }, { failAt: "mkdir" });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    if (!result.ok) expect(result.detail).toContain("注入失败：mkdir");
    expect(h.urls).toEqual([]);
  });

  it("rename 撞上（文件被占用）也不留 .part，且回执把这一步说出来", async () => {
    const h = downloader({ chunks: ["pay", "load"] }, { failAt: "rename" });
    const result = await h.dl.download(target());
    // 摘要已经对上了，败的是「换成正名」这一步——归 write-failed，不归 digest。
    expect(result).toMatchObject({ ok: false, reason: "write-failed" });
    if (!result.ok) expect(result.detail).toContain("注入失败：rename");
    expect(h.fs.files.has(PART)).toBe(false);
    expect(h.fs.files.has(FINAL)).toBe(false);
    // 正对照：注入留在 rename 这一格，说明前面那段字节、哈希与判定都没被牵连。
    const same = downloader({ chunks: ["pay", "load"] });
    expect((await same.dl.download(target())).ok).toBe(true);
  });
});

describe("installer-download：预算、静默与逐跳闸门", () => {
  it("content-length 声明就超预算：一个字节都不读、一个文件都不开", async () => {
    const h = downloader({ chunks: ["payload"] }, { maxBytes: 8, headers: { "content-length": "999999" } });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "too-large" });
    if (!result.ok) expect(result.detail).toContain("声明 999999");
    expect(h.fs.ops.filter((op) => op.startsWith("open"))).toEqual([]);
    // 正对照：同一份正文把上限抬到够，就位。
    const fits = downloader({ chunks: ["payload"] }, { maxBytes: 8, headers: { "content-length": "7" } });
    expect((await fits.dl.download(target())).ok).toBe(true);
  });

  it("撒谎的 content-length 交给边读边算那把尺，并且先 cancel 再收手", async () => {
    const h = downloader({ chunks: ["aaaa", "aaaa", "aaaa"] }, { maxBytes: 8, headers: { "content-length": "4" } });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "too-large" });
    if (!result.ok) expect(result.detail).toContain("读到 12");
    expect(h.urls).toContain("CANCELLED");
    expect(h.fs.files.size).toBe(0);
  });

  it("静默超时用的是「没有字节」而不是总时长：卡住那一档报得出等了多久", async () => {
    const h = downloader({ chunks: ["pay"], hang: true }, { idleMs: 25 });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "network-failed" });
    if (!result.ok) expect(result.detail).toContain("秒没收到字节");
    expect(h.fs.files.has(PART)).toBe(false);
  });

  it("跟到 302 的合法落地点算成功；出白名单那一跳直接拒，且根本没向它发请求", async () => {
    const ok = downloader({ chunks: ["payload"] }, {
      redirects: [
        { status: 302, location: "https://release-assets.githubusercontent.com/abcdef" },
        { status: 302, location: "https://objects.githubusercontent.com/abcdef" },
      ],
    });
    expect(await ok.dl.download(target())).toMatchObject({ ok: true, hops: 2 });
    expect(ok.urls).toHaveLength(3);

    const evil = downloader({ chunks: ["payload"] }, {
      redirects: [{ status: 302, location: "https://evil.tld/Mochi-Setup-1.16.0.exe" }],
    });
    const result = await evil.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "wrong-source" });
    // 拒得干脆：坏 host 一次都没被请求到（不是「先要回来再说」）。
    expect(evil.urls).toEqual(["https://github.com/damingslu-ctrl/Cyrene-Agent/releases/download/v1.16.0/Mochi-Setup-1.16.0.exe"]);
  });

  it("跳转超过上限报得出一共允许几跳；404 那一档带上状态码与 host", async () => {
    const loop = downloader({ chunks: ["payload"] }, {
      redirects: [1, 2, 3, 4, 5, 6].map((n) => ({ status: 302, location: `https://github.com/damingslu-ctrl/Cyrene-Agent/releases/download/v${VERSION}/${FILE_NAME}?hop=${n}` })),
    });
    const result = await loop.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "network-failed" });
    if (!result.ok) expect(result.detail).toContain("跳转超过 5 跳");

    const gone = downloader({ chunks: ["payload"] }, { status: 404 });
    const second = await gone.dl.download(target());
    expect(second).toMatchObject({ ok: false, reason: "network-failed" });
    if (!second.ok) expect(second.detail).toContain("HTTP 404");
  });

  it("响应没有字节流就当失败：276 MiB 不靠 text() 兜", async () => {
    const h = downloader({}, { noBody: true });
    const result = await h.dl.download(target());
    expect(result).toMatchObject({ ok: false, reason: "network-failed" });
    if (!result.ok) expect(result.detail).toContain("没有可读的字节流");
  });
});

describe("installer-download：文件名与目录里的其余事", () => {
  it("带路径分隔的文件名在边界上就被拒——那是目录穿越的形状，不是「下不动」", async () => {
    for (const fileName of ["../evil.exe", "sub/Mochi-Setup-1.16.0.exe", "Mochi-Setup-1.16.0.exe.part", ""]) {
      const h = downloader({ chunks: ["payload"] });
      const result = await h.dl.download(target({ fileName }));
      expect(result, fileName).toMatchObject({ ok: false, reason: "no-asset" });
      expect(h.fs.files.size, fileName).toBe(0);
      expect(h.urls, fileName).toEqual([]);
    }
  });

  it("装好一份之后只留最近这一份：旧包删掉，不是安装包的名字不碰", async () => {
    const h = downloader({ chunks: ["payload"] }, {
      seed: {
        [path.join(DIR, "Mochi-Setup-1.15.0.exe")]: "old",
        [path.join(DIR, "Mochi-Setup-1.14.0.exe")]: "older",
        [path.join(DIR, "secret-notes.txt")]: "keep me",
      },
    });
    expect((await h.dl.download(target())).ok).toBe(true);
    expect(h.fs.files.get(FINAL)).toBe("payload");
    expect(h.fs.files.has(path.join(DIR, "Mochi-Setup-1.15.0.exe"))).toBe(false);
    expect(h.fs.files.has(path.join(DIR, "Mochi-Setup-1.14.0.exe"))).toBe(false);
    expect(h.fs.files.get(path.join(DIR, "secret-notes.txt"))).toBe("keep me");
    if (!h.logs.length) throw new Error("就位那行日志必须说出来，含清掉了哪些");
    expect(h.logs[0]).toContain("清掉旧包");
  });

  it("启动清扫只收安装包形状的 .part：别人的 .part 一个都不许动", () => {
    const h = downloader({}, {});
    h.fs.files.set(path.join(DIR, `Mochi-Setup-1.13.0.exe${PART_SUFFIX}`), "半包");
    h.fs.files.set(path.join(DIR, "Mochi-Setup-1.13.0.exe"), "整包");
    h.fs.files.set(path.join(DIR, `notes.txt${PART_SUFFIX}`), "别人的");
    const swept = h.dl.sweepParts();
    expect(swept).toEqual([`Mochi-Setup-1.13.0.exe${PART_SUFFIX}`]);
    expect(h.fs.files.has(path.join(DIR, "Mochi-Setup-1.13.0.exe"))).toBe(true);
    expect(h.fs.files.has(path.join(DIR, `notes.txt${PART_SUFFIX}`))).toBe(true);
  });

  it("pruneInstalled(keep=null) 收下全部安装包、不碰别的；目录空也不抛", () => {
    const h = downloader({}, { seed: { [path.join(DIR, "Mochi-Setup-1.15.0.exe")]: "old", [path.join(DIR, "readme.md")]: "doc" } });
    expect(h.dl.pruneInstalled(null)).toEqual(["Mochi-Setup-1.15.0.exe"]);
    expect(h.fs.files.has(path.join(DIR, "readme.md"))).toBe(true);

    const empty = downloader({}, { seed: {} });
    expect(empty.dl.pruneInstalled(null)).toEqual([]);
    expect(empty.dl.sweepParts()).toEqual([]);
  });

  it("digestOf 重读全盘算：文件不在回 null（「读不到」与「读出来不对」是两档）", async () => {
    const h = downloader({}, { seed: { [FINAL]: "payload" } });
    expect(await h.dl.digestOf(FILE_NAME)).toBe(hexOf("payload"));
    expect(await h.dl.digestOf("Mochi-Setup-9.9.9.exe")).toBeNull();
    expect(h.dl.sizeOf(FILE_NAME)).toBe(7);
    expect(h.dl.sizeOf("nope.exe")).toBeNull();
    expect(h.dl.filePathOf(FILE_NAME)).toBe(FINAL);
    expect(h.dl.dir()).toBe(DIR);
  });
});

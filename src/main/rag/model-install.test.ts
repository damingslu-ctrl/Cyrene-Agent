// 本机模型下载器的锁：清单校验、镜像兜底、逐文件原子落盘、断点跳过、取消。
// 全部走假 fetch + 真临时目录，不联网；注册表清单被就地缩小到 18 字节以免真下载。
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";

const { TMP } = vi.hoisted(() => {
  const pathMod = require("path") as typeof import("path");
  return {
    TMP: pathMod.join(
      process.env.TEMP || process.env.TMP || "/tmp",
      `cyrene-model-install-test-${process.pid}`,
    ),
  };
});

const installRoot = path.join(TMP, "userdata");

vi.mock("electron", () => ({
  app: {
    getAppPath: () => TMP,
    getPath: (name: string) => {
      if (name === "userData") return installRoot;
      throw new Error(`unexpected app.getPath(${name})`);
    },
  },
  net: {
    fetch: () => {
      throw new Error("net.fetch must be injected in tests");
    },
  },
}));

import {
  installLocalEmbeddingModel,
  cancelLocalModelInstall,
  describeModelInstall,
  getModelInstallTargetDir,
  fetchRedirectGated,
} from "./model-install";
import { LOCAL_EMBEDDING_MODELS } from "../../shared/local-models";

const KEY = "bgeBaseZh" as const;

// 恰好等于探测用的三件套 required files，字节数缩到个位数。
const FAKE_FILES = [
  { path: "config.json", bytes: 4 },
  { path: "tokenizer.json", bytes: 6 },
  { path: "onnx/model_quantized.onnx", bytes: 8 },
];
const FAKE_TOTAL = 18;

function bodyFor(bytes: number): NodeJS.ReadableStream {
  return Readable.from([Buffer.alloc(bytes, 0x41)]);
}

/** 一切请求都成功的 fetch；顺带记录访问过的 URL。 */
function okFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const file = FAKE_FILES.find((f) => url.endsWith(`/${f.path}`));
    if (!file) return { ok: false, status: 404, body: null };
    return { ok: true, status: 200, body: bodyFor(file.bytes) };
  });
}

function urlsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(entry.name);
    out.push(...(entry.isDirectory() ? listFiles(path.join(dir, entry.name)).map((f) => path.join(rel, f)) : [rel]));
  }
  return out;
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(installRoot, { recursive: true });
  // 就地替换清单：下载器只认注册表，测试必须让它认这份缩略清单。
  const spec = LOCAL_EMBEDDING_MODELS[KEY];
  spec.files = FAKE_FILES.map((f) => ({ ...f }));
  spec.totalBytes = FAKE_TOTAL;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("getModelInstallTargetDir / describeModelInstall", () => {
  it("安装目标是 <userData>/models 下的 Xenova 规范布局", () => {
    expect(getModelInstallTargetDir(KEY)).toBe(
      path.join(installRoot, "models", "Xenova", "bge-base-zh-v1.5"),
    );
  });

  it("注册表外的 key 给 null（不许拼出任意路径）", () => {
    expect(getModelInstallTargetDir("../escape")).toBeNull();
  });

  it("describe 报出字节、文件数与当前是否已装", () => {
    const info = describeModelInstall(KEY);
    expect(info.files).toBe(FAKE_FILES.length);
    expect(info.bytesTotal).toBe(FAKE_TOTAL);
    expect(info.installed).toBe(false);
    expect(info.dirName).toBe("Xenova/bge-base-zh-v1.5");
  });
});

describe("installLocalEmbeddingModel", () => {
  it("逐文件落盘并按清单校验字节数，不留 .part 残片", async () => {
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: okFetch() as any });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modelDir).toBe(getModelInstallTargetDir(KEY));
    for (const file of FAKE_FILES) {
      expect(fs.statSync(path.join(result.modelDir, file.path)).size).toBe(file.bytes);
    }
    expect(listFiles(result.modelDir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("onProgress 每个文件一条 downloading，收尾一条 done，字节数累计到整档", async () => {
    const seen: string[] = [];
    let lastBytesDone = 0;
    const result = await installLocalEmbeddingModel(KEY, {
      fetchImpl: okFetch() as any,
      onProgress: (p) => {
        seen.push(`${p.phase}:${p.file ?? "-"}`);
        lastBytesDone = p.bytesDone;
      },
    });
    expect(result.ok).toBe(true);
    expect(seen.filter((s) => s.startsWith("downloading:")).length).toBe(FAKE_FILES.length);
    expect(seen[seen.length - 1]).toBe("done:-");
    expect(lastBytesDone).toBe(FAKE_TOTAL);
  });

  it("首镜失败自动换镜像，仍然成功", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("https://hf-mirror.com")) return { ok: false, status: 503, body: null };
      const file = FAKE_FILES.find((f) => url.endsWith(`/${f.path}`));
      return { ok: true, status: 200, body: file ? bodyFor(file.bytes) : null };
    });
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(true);
    const urls = urlsOf(fetchImpl);
    expect(urls.some((u) => u.startsWith("https://hf-mirror.com"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://huggingface.co"))).toBe(true);
  });

  it("两个镜像都失败时报 E_MODEL_INSTALL_NO_SOURCE，且不留下半个模型", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, body: null }));
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("E_MODEL_INSTALL_NO_SOURCE");
    expect(listFiles(getModelInstallTargetDir(KEY)!)).toEqual([]);
  });

  it("字节数与清单不符 → 判坏档并拒绝落位", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const file = FAKE_FILES.find((f) => url.endsWith(`/${f.path}`));
      return { ok: true, status: 200, body: file ? bodyFor(file.bytes + 1) : null };
    });
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("E_MODEL_INSTALL_SIZE");
    expect(listFiles(getModelInstallTargetDir(KEY)!)).toEqual([]);
  });

  it("已下好的文件跳过不重下，只补缺失的", async () => {
    const target = getModelInstallTargetDir(KEY)!;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "config.json"), Buffer.alloc(4));

    const fetchImpl = okFetch();
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(true);
    const urls = urlsOf(fetchImpl);
    expect(urls.some((u) => u.endsWith("/config.json"))).toBe(false);
    expect(urls.filter((u) => u.endsWith("/tokenizer.json"))).toHaveLength(1);
    if (result.ok) {
      expect(result.skippedBytes).toBe(4);
      expect(result.alreadyInstalled).toBe(false);
    }
  });

  it("完整安装重复点击直接返回 alreadyInstalled，不碰网络", async () => {
    await installLocalEmbeddingModel(KEY, { fetchImpl: okFetch() as any });
    const againFetch = okFetch();
    const again = await installLocalEmbeddingModel(KEY, { fetchImpl: againFetch as any });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.alreadyInstalled).toBe(true);
    expect(urlsOf(againFetch)).toEqual([]);
  });

  it("取消后不再写盘，报 cancelled", async () => {
    let started = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const file = FAKE_FILES.find((f) => url.endsWith(`/${f.path}`))!;
      started += 1;
      if (started === 2) cancelLocalModelInstall();
      return { ok: true, status: 200, body: bodyFor(file.bytes) };
    });
    const target = getModelInstallTargetDir(KEY)!;
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: fetchImpl as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("E_MODEL_INSTALL_CANCELLED");
    // 第 1 个文件（config.json）在取消前已落位；第 2 个起一个都不许写
    expect(fs.existsSync(path.join(target, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "tokenizer.json"))).toBe(false);
    expect(fs.existsSync(path.join(target, "onnx"))).toBe(false);
  });

  it("注册表外的 key 直接拒绝", async () => {
    const result = await installLocalEmbeddingModel("not-a-model", { fetchImpl: okFetch() as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("E_MODEL_INSTALL_UNKNOWN_KEY");
  });

  it("清单里不许有能越出模型目录的路径", async () => {
    const spec = LOCAL_EMBEDDING_MODELS[KEY];
    spec.files = [{ path: "../evil.json", bytes: 1 }];
    spec.totalBytes = 1;
    const result = await installLocalEmbeddingModel(KEY, { fetchImpl: okFetch() as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("E_MODEL_INSTALL_BAD_PATH");
  });

  it("并发第二次安装被拒（同一份模型不许两个下载器抢）", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slowFetch = vi.fn(async (url: string) => {
      const file = FAKE_FILES.find((f) => url.endsWith(`/${f.path}`))!;
      if (file.path === "config.json") await gate;
      return { ok: true, status: 200, body: bodyFor(file.bytes) };
    });
    const first = installLocalEmbeddingModel(KEY, { fetchImpl: slowFetch as any });
    const second = await installLocalEmbeddingModel(KEY, { fetchImpl: okFetch() as any });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("E_MODEL_INSTALL_BUSY");
    release();
    expect((await first).ok).toBe(true);
  });
});

// 下载链的出口闸门：net.fetch 会自己跟重定向，这里必须逐跳拦上游。
describe("fetchRedirectGated", () => {
  function rawResponse(status: number, location: string | null, body = null) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
      body,
    };
  }

  it("逐跳跟到 CDN，返回最后一跳的正文", async () => {
    const seen: string[] = [];
    const raw = vi.fn(async (url: string) => {
      seen.push(url);
      if (seen.length === 1) return rawResponse(302, "https://cdn-lfs.huggingface.co/entry/Xenova/bge-m3/config.json");
      return rawResponse(200, null, { cancel: async () => {} });
    });
    const res = await fetchRedirectGated(
      raw as any,
      "https://hf-mirror.com/Xenova/bge-m3/resolve/main/config.json",
      new AbortController().signal,
    );
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("cdn-lfs.huggingface.co");
  });

  it("相对 Location 按当前 URL 解析后再校验", async () => {
    const seen: string[] = [];
    const raw = vi.fn(async (url: string) => {
      seen.push(url);
      if (seen.length === 1) return rawResponse(301, "/mirror/config.json");
      return rawResponse(200, null);
    });
    await fetchRedirectGated(raw as any, "https://hf-mirror.com/Xenova/bge-m3/resolve/main/config.json", new AbortController().signal);
    expect(seen[1]).toBe("https://hf-mirror.com/mirror/config.json");
  });

  it("镜像 302 到 GitHub 时一枪不发，直接断", async () => {
    const seen: string[] = [];
    const raw = vi.fn(async (url: string) => {
      seen.push(url);
      return rawResponse(302, "https://raw.githubusercontent.com/some/model/main/config.json");
    });
    await expect(
      fetchRedirectGated(raw as any, "https://hf-mirror.com/Xenova/bge-m3/resolve/main/config.json", new AbortController().signal),
    ).rejects.toThrow(/E_MODEL_INSTALL_UPSTREAM/);
    expect(seen).toHaveLength(1);
  });

  it("入口本身就是上游时一个字节都不发", async () => {
    const raw = vi.fn(async () => rawResponse(200, null));
    await expect(
      fetchRedirectGated(raw as any, "https://github.com/o/r/releases/a.bin", new AbortController().signal),
    ).rejects.toThrow(/E_MODEL_INSTALL_UPSTREAM/);
    expect(raw).not.toHaveBeenCalled();
  });

  it("子域别名（www.github.com.）也拦得住", async () => {
    const seen: string[] = [];
    const raw = vi.fn(async (url: string) => {
      seen.push(url);
      return rawResponse(302, "https://www.github.com./x");
    });
    await expect(
      fetchRedirectGated(raw as any, "https://hf-mirror.com/a.json", new AbortController().signal),
    ).rejects.toThrow(/E_MODEL_INSTALL_UPSTREAM/);
    expect(seen).toHaveLength(1);
  });

  it("非 http(s) 协议的重定向拒绝跟随", async () => {
    const raw = vi.fn(async () => rawResponse(302, "file:///C:/windows/win.ini"));
    await expect(
      fetchRedirectGated(raw as any, "https://hf-mirror.com/a.json", new AbortController().signal),
    ).rejects.toThrow(/E_MODEL_INSTALL_BAD_REDIRECT/);
  });

  it("重定向环超过上限报错，不许无限跟", async () => {
    let hop = 0;
    const raw = vi.fn(async () => {
      hop += 1;
      return rawResponse(302, `https://hf-mirror.com/hop${hop}`);
    });
    await expect(
      fetchRedirectGated(raw as any, "https://hf-mirror.com/a.json", new AbortController().signal, 3),
    ).rejects.toThrow(/E_MODEL_INSTALL_TOO_MANY_REDIRECTS/);
    expect(raw).toHaveBeenCalledTimes(4);
  });

  it("302 但没有 Location 时按原样返回（不当作重定向死循环）", async () => {
    const raw = vi.fn(async () => rawResponse(302, null));
    const res = await fetchRedirectGated(raw as any, "https://hf-mirror.com/a.json", new AbortController().signal);
    expect(res.status).toBe(302);
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

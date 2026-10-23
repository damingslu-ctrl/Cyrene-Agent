import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../plugins/types";

// 本地枚举只依赖 loader 的磁盘校验回执；mock 掉它就完全不碰真实 userData。
vi.mock("../plugins/loader", () => ({ inspectPluginDir: vi.fn() }));

import { inspectPluginDir } from "../plugins/loader";
import { listLocalMarketPlugins } from "./plugin-marketplace";

const inspectMock = vi.mocked(inspectPluginDir);
let tmp = "";

function makeRoot(entries: string[]): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), "cyrene-market-local-"));
  for (const entry of entries) mkdirSync(path.join(tmp, entry), { recursive: true });
  return tmp;
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    apiVersion: 1,
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    description: "演示插件",
    author: "Mochi",
    entry: "index.cjs",
    defaultEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  inspectMock.mockReset();
});

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  }
});

describe("listLocalMarketPlugins", () => {
  it("目录不存在时返回空清单而不是错误", async () => {
    const missing = path.join(os.tmpdir(), `cyrene-market-missing-${Date.now()}`, "plugins");
    const result = await listLocalMarketPlugins(missing);
    expect(result).toEqual({ ok: true, plugins: [], directory: missing });
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it("非插件目录与普通文件被跳过", async () => {
    const root = makeRoot(["not-a-plugin", "empty-dir"]);
    writeFileSync(path.join(root, "loose.txt"), "not a plugin");
    inspectMock.mockReturnValue({ manifest: null, error: "缺少 manifest.json" });

    const result = await listLocalMarketPlugins(root);

    expect(result.ok).toBe(true);
    expect(result.plugins).toEqual([]);
    expect(result.directory).toBe(root);
    // 只对一级子目录做检查，普通文件不进入 inspectPluginDir
    expect(inspectMock).toHaveBeenCalledTimes(2);
  });

  it("manifest 缺字段（校验失败）的目录被跳过", async () => {
    const root = makeRoot(["broken", "good"]);
    inspectMock.mockImplementation((dir) => {
      if (path.basename(dir) === "broken") {
        return { manifest: null, error: "version 必须是合法 SemVer" };
      }
      return { manifest: manifest({ id: "good", name: "Good", version: "2.0.0" }), fingerprint: "f".repeat(64) };
    });

    const result = await listLocalMarketPlugins(root);

    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["good"]);
  });

  it("合法插件目录被列出，字段全部来自磁盘 manifest", async () => {
    const root = makeRoot(["alpha", "beta"]);
    inspectMock.mockImplementation((dir) => {
      const id = path.basename(dir);
      return {
        manifest: manifest({
          id,
          name: id === "alpha" ? "Alpha" : "Beta",
          version: id === "alpha" ? "1.0.0" : "2.1.0",
          description: `${id} 的说明`,
          author: "Mochi",
        }),
        fingerprint: "f".repeat(64),
      };
    });

    const result = await listLocalMarketPlugins(root);

    expect(result).toEqual({
      ok: true,
      directory: root,
      plugins: [
        {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          description: "alpha 的说明",
          author: "Mochi",
          path: path.join(root, "alpha"),
        },
        {
          id: "beta",
          name: "Beta",
          version: "2.1.0",
          description: "beta 的说明",
          author: "Mochi",
          path: path.join(root, "beta"),
        },
      ],
    });
  });
});

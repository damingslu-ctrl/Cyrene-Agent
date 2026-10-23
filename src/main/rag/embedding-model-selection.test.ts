// 本机 embedding 模型「选哪个真的能用」的锁。
// 背景：设置里钉死 bgem3 的历史包袱让「装好了却不生效」；这里的自适应回落
// 与严格切换是同一个问题的两面，必须分别锁住。
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const installed = new Set<string>();

vi.mock("./model-status", async () => {
  const actual = await vi.importActual<typeof import("./model-status")>("./model-status");
  return {
    ...actual,
    checkEmbeddingModelInstalled: (key: string) => installed.has(key),
    listInstalledEmbeddingModels: () =>
      (["bgeBaseZh", "bgem3"] as const).filter((k) => installed.has(k)),
    getProjectModelBaseDir: (kind: string, key: string) =>
      installed.has(key) ? `D:/fake/models/${key}` : null,
  };
});

import {
  createLocalEmbeddingProvider,
  resolveLocalModelKey,
  switchEmbeddingModel,
  resetEmbeddingProvider,
  getEmbeddingDiagnostics,
  getCurrentModelDims,
  getCurrentModelKey,
} from "./embedding";

beforeEach(() => {
  installed.clear();
  resetEmbeddingProvider();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEmbeddingProvider();
});

describe("resolveLocalModelKey — 自适应回落", () => {
  it("请求的模型已装时原样返回", () => {
    installed.add("bgem3");
    expect(resolveLocalModelKey("bgem3")).toBe("bgem3");
  });

  it("请求的模型没装、但默认档装了 → 回落到默认档并说清楚", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installed.add("bgeBaseZh");
    expect(resolveLocalModelKey("bgem3")).toBe("bgeBaseZh");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bgem3"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("768"));
  });

  it("只有非默认档装着时用它（不能让 RAG 因为缺默认档而整体失效）", () => {
    installed.add("bgem3");
    expect(resolveLocalModelKey("bgeBaseZh")).toBe("bgem3");
    expect(resolveLocalModelKey(undefined)).toBe("bgem3");
  });

  it("一个都没装 → null", () => {
    expect(resolveLocalModelKey("bgem3")).toBeNull();
    expect(resolveLocalModelKey()).toBeNull();
  });

  it("脏 key（旧版本写死的值）静默当没指定处理", () => {
    installed.add("bgeBaseZh");
    expect(resolveLocalModelKey("bge-small-zh")).toBe("bgeBaseZh");
  });
});

describe("createLocalEmbeddingProvider", () => {
  it("按解析出的模型给出维度与缓存身份", () => {
    installed.add("bgeBaseZh");
    const provider = createLocalEmbeddingProvider("bgem3");
    expect(provider).not.toBeNull();
    expect(provider!.dims).toBe(768);
    expect(provider!.cacheIdentity).toEqual({
      provider: "local",
      model: "Xenova/bge-base-zh-v1.5",
      dimensions: 768,
    });
    expect(provider!.workerConfig).toEqual({ provider: "local", modelKey: "bgeBaseZh" });
  });

  it("解析结果会写回 currentModelKey，诊断口径不撒谎", () => {
    installed.add("bgem3");
    createLocalEmbeddingProvider("bgeBaseZh");
    expect(getCurrentModelKey()).toBe("bgem3");
    expect(getCurrentModelDims()).toBe(1024);
    expect(getEmbeddingDiagnostics().currentModelKey).toBe("bgem3");
  });

  it("没装任何模型时返回 null（调用方决定降级）", () => {
    expect(createLocalEmbeddingProvider()).toBeNull();
  });
});

describe("switchEmbeddingModel — 切换是用户显式动作，不许悄悄换档", () => {
  it("目标模型已安装才切，维度跟着换成新档", () => {
    installed.add("bgeBaseZh");
    installed.add("bgem3");
    createLocalEmbeddingProvider("bgem3");
    expect(getCurrentModelDims()).toBe(1024);
    expect(switchEmbeddingModel("bgeBaseZh")).toBe(true);
    expect(getCurrentModelKey()).toBe("bgeBaseZh");
    expect(getCurrentModelDims()).toBe(768);
  });

  it("未安装的模型直接 false，且不改动当前模型", () => {
    installed.add("bgeBaseZh");
    createLocalEmbeddingProvider("bgeBaseZh");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(switchEmbeddingModel("bgem3")).toBe(false);
    expect(getCurrentModelKey()).toBe("bgeBaseZh");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bgem3"));
  });

  it("注册表外的 key 直接 false", () => {
    installed.add("bgeBaseZh");
    expect(switchEmbeddingModel("nope")).toBe(false);
    expect(getCurrentModelKey()).toBe("bgeBaseZh");
  });
});

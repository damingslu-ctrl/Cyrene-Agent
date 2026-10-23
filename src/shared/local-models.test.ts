import { describe, it, expect } from "vitest";
import {
  LOCAL_EMBEDDING_MODELS,
  LOCAL_EMBEDDING_MODEL_KEYS,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  isLocalEmbeddingModelKey,
  resolveLocalEmbeddingModelKey,
  getLocalEmbeddingModel,
} from "./local-models";

describe("LOCAL_EMBEDDING_MODELS — 注册表自洽", () => {
  it("每个模型都有 hfName/dirName/dims/files，且 hfName = Xenova/dirName", () => {
    for (const key of LOCAL_EMBEDDING_MODEL_KEYS) {
      const spec = LOCAL_EMBEDDING_MODELS[key];
      expect(spec.key).toBe(key);
      expect(spec.dirName.length).toBeGreaterThan(0);
      expect(spec.hfName).toBe(`Xenova/${spec.dirName}`);
      expect(Number.isInteger(spec.dims)).toBe(true);
      expect(spec.dims).toBeGreaterThan(0);
      expect(spec.files.length).toBeGreaterThan(0);
    }
  });

  it("量化 ONNX 是自带权重（无 _external_data），且清单必含推理三件套", () => {
    for (const key of LOCAL_EMBEDDING_MODEL_KEYS) {
      const paths = LOCAL_EMBEDDING_MODELS[key].files.map((f) => f.path);
      expect(paths).toContain("tokenizer.json");
      expect(paths).toContain("config.json");
      expect(paths).toContain("onnx/model_quantized.onnx");
      // 清单不许出现 _external_data 附属文件：只有 fp32 model.onnx 才需要
      expect(paths.some((p) => p.endsWith("_external_data"))).toBe(false);
      // 路径不许越出模型目录（下载器要 join，必须挡 ..）
      expect(paths.every((p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\"))).toBe(true);
    }
  });

  it("文件大小全部为正整数，totalBytes 等于清单求和", () => {
    for (const key of LOCAL_EMBEDDING_MODEL_KEYS) {
      const spec = LOCAL_EMBEDDING_MODELS[key];
      for (const file of spec.files) {
        expect(Number.isInteger(file.bytes)).toBe(true);
        expect(file.bytes).toBeGreaterThan(0);
      }
      expect(spec.totalBytes).toBe(spec.files.reduce((sum, f) => sum + f.bytes, 0));
    }
  });

  it("维度互不重复（同一索引里混维度必炸）", () => {
    const dims = LOCAL_EMBEDDING_MODEL_KEYS.map((k) => LOCAL_EMBEDDING_MODELS[k].dims);
    expect(new Set(dims).size).toBe(dims.length);
  });
});

describe("isLocalEmbeddingModelKey / resolveLocalEmbeddingModelKey", () => {
  it("只认注册过的 key", () => {
    expect(isLocalEmbeddingModelKey(DEFAULT_LOCAL_EMBEDDING_MODEL)).toBe(true);
    expect(isLocalEmbeddingModelKey("bge-small-zh")).toBe(false);
    expect(isLocalEmbeddingModelKey(undefined)).toBe(false);
    expect(isLocalEmbeddingModelKey(42)).toBe(false);
  });

  it("默认模型一定是注册表成员", () => {
    expect(LOCAL_EMBEDDING_MODEL_KEYS).toContain(DEFAULT_LOCAL_EMBEDDING_MODEL);
  });

  it("脏值一律回落到默认 key", () => {
    expect(resolveLocalEmbeddingModelKey("bogus")).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
    expect(resolveLocalEmbeddingModelKey(undefined)).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
    expect(resolveLocalEmbeddingModelKey(null)).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
  });

  it("合法值原样返回", () => {
    for (const key of LOCAL_EMBEDDING_MODEL_KEYS) {
      expect(resolveLocalEmbeddingModelKey(key)).toBe(key);
    }
  });
});

describe("getLocalEmbeddingModel", () => {
  it("返回对应 spec，未知 key 返回 undefined 而不是抛", () => {
    expect(getLocalEmbeddingModel(DEFAULT_LOCAL_EMBEDDING_MODEL)).toBe(
      LOCAL_EMBEDDING_MODELS[DEFAULT_LOCAL_EMBEDDING_MODEL],
    );
    expect(getLocalEmbeddingModel("nope")).toBeUndefined();
  });
});

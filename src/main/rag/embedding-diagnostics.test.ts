import { describe, expect, it, vi } from "vitest";
import { getEmbeddingDiagnostics, resetEmbeddingProvider } from "./embedding";

vi.mock("./model-status", () => ({
  checkEmbeddingModelInstalled: () => false,
  listInstalledEmbeddingModels: () => [],
  getProjectModelBaseDir: () => null,
}));

describe("embedding diagnostics", () => {
  it("reports model and pipeline init counters without loading a model", () => {
    resetEmbeddingProvider();

    expect(getEmbeddingDiagnostics()).toMatchObject({
      // 默认档 = 随包预置的 bge-base-zh-v1.5；翻转这个字面量必须让此测试变红。
      currentModelKey: "bgeBaseZh",
      cachedPipelineKeys: [],
      loadingPipelineKeys: [],
      localPipelineInitCount: 0,
    });
  });
});

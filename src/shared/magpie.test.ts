import { describe, expect, it } from "vitest";
import {
  MAGPIE_DEFAULT_GATEWAY_URL,
  MAGPIE_LOCAL_API_KEY,
  MAGPIE_PROVIDER,
  magpieModelsUrl,
  manualReasoningForMagpie,
  normalizeMagpieBaseUrl,
  normalizeMagpieGatewayUrl,
  parseMagpieModels,
} from "./magpie";

const LIVE_PAYLOAD = {
  object: "list",
  data: [
    {
      id: "group/never-stuck",
      owned_by: "opencode-zen",
      display_name: "永不卡住",
      magpie_label: "永不卡住 · routing group",
      context_window: 1048576,
      max_input_tokens: 1048576,
      max_output_tokens: 262144,
      modalities: { input: ["text", "image"] },
      reasoning: true,
      reasoning_levels: ["low", "high"],
    },
    {
      id: "opencode-zen/mimo-v2.6-flash-free",
      owned_by: "opencode-zen",
      display_name: "MiMo-V2.6-Flash Free",
      context_window: 200000,
      max_output_tokens: 32000,
      modalities: { input: ["text", "image", "audio", "video"], output: ["text"] },
      reasoning: true,
      reasoning_levels: [],
    },
    {
      id: "opencode-zen/nemotron-3.5-super-vl-free",
      owned_by: "opencode-zen",
      display_name: "Nemotron 3.5 Super VL Free",
      context_window: 1048576,
      max_output_tokens: 131072,
      modalities: { input: ["text", "image"], output: ["text"] },
      reasoning: true,
      reasoning_levels: ["none", "minimal", "low", "medium", "high", "xhigh"],
    },
    {
      id: "opencode-zen/text-only",
      owned_by: "opencode-zen",
      display_name: "Text Only",
      context_window: 200000,
      max_output_tokens: 32000,
      modalities: { input: ["text"], output: ["text"] },
      reasoning: false,
      reasoning_levels: [],
    },
  ],
};

describe("Magpie 模型目录解析", () => {
  it("把 OpenAI 列表与 Magpie 扩展字段映射成导入模型", () => {
    const models = parseMagpieModels(LIVE_PAYLOAD);

    expect(models).toHaveLength(4);
    expect(models[0]).toMatchObject({
      id: "group/never-stuck",
      displayName: "永不卡住",
      contextWindowTokens: 1048576,
      maxOutputTokens: 262144,
      multimodal: true,
      reasoningLevels: ["low", "high"],
      reasoningDisable: false,
    });
    expect(models[1]).toMatchObject({
      id: "opencode-zen/mimo-v2.6-flash-free",
      contextWindowTokens: 200000,
      multimodal: true,
    });
    expect(models[2]).toMatchObject({
      reasoningLevels: ["minimal", "low", "medium", "high", "xhigh"],
      reasoningDisable: true,
    });
    expect(models[3]).toMatchObject({
      multimodal: false,
      reasoningLevels: [],
      reasoningDisable: false,
    });
  });

  it("模型 ID 原样保存，不补 magpie/ 前缀", () => {
    const models = parseMagpieModels(LIVE_PAYLOAD);
    expect(models.map((model) => model.id)).toEqual([
      "group/never-stuck",
      "opencode-zen/mimo-v2.6-flash-free",
      "opencode-zen/nemotron-3.5-super-vl-free",
      "opencode-zen/text-only",
    ]);
    expect(models.some((model) => model.id.startsWith("magpie/"))).toBe(false);
  });

  it("跳过畸形条目并按 id 稳定去重", () => {
    const models = parseMagpieModels({
      data: [
        null,
        {},
        { id: 42 },
        { id: "  a  ", context_window: 999 },
        { id: "a", display_name: "duplicate" },
        { id: "b", context_window: 4096, modalities: { input: ["image"] } },
      ],
    });
    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(models[0].contextWindowTokens).toBeUndefined();
    expect(models[1].contextWindowTokens).toBe(4096);
    expect(models[1].multimodal).toBe(true);
  });

  it("非列表响应返回空数组", () => {
    expect(parseMagpieModels(null)).toEqual([]);
    expect(parseMagpieModels({ data: {} })).toEqual([]);
    expect(parseMagpieModels({ data: "oops" })).toEqual([]);
  });
});

describe("Magpie 网关地址", () => {
  it("只接受本机回环地址", () => {
    expect(normalizeMagpieGatewayUrl("http://127.0.0.1:3425")).toBe("http://127.0.0.1:3425");
    expect(normalizeMagpieGatewayUrl("http://127.0.0.1:3425/")).toBe("http://127.0.0.1:3425");
    expect(normalizeMagpieGatewayUrl("http://127.0.0.1:3425/v1/")).toBe("http://127.0.0.1:3425");
    expect(normalizeMagpieGatewayUrl("http://localhost:3425")).toBe("http://localhost:3425");
    expect(normalizeMagpieGatewayUrl("http://[::1]:3425")).toBe("http://[::1]:3425");
    expect(normalizeMagpieGatewayUrl("http://127.0.0.2:8080")).toBe("http://127.0.0.2:8080");
  });

  it("拒绝外网、0.0.0.0、凭据、查询串与非根路径", () => {
    expect(normalizeMagpieGatewayUrl("http://192.168.1.5:3425")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("http://10.0.0.2:3425")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("http://0.0.0.0:3425")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("https://example.com/v1")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("http://user:pass@127.0.0.1:3425")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("http://127.0.0.1:3425/?x=1")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("http://127.0.0.1:3425/api")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl("ws://127.0.0.1:3425")).toBeUndefined();
    expect(normalizeMagpieGatewayUrl(undefined)).toBeUndefined();
  });

  it("统一补出 /v1 与 /v1/models", () => {
    expect(MAGPIE_DEFAULT_GATEWAY_URL).toBe("http://127.0.0.1:3425");
    expect(normalizeMagpieBaseUrl("http://127.0.0.1:3425")).toBe("http://127.0.0.1:3425/v1");
    expect(normalizeMagpieBaseUrl("http://127.0.0.1:3425/v1")).toBe("http://127.0.0.1:3425/v1");
    expect(magpieModelsUrl("http://127.0.0.1:3425")).toBe("http://127.0.0.1:3425/v1/models");
    expect(magpieModelsUrl("http://127.0.0.1:3425/v1/")).toBe("http://127.0.0.1:3425/v1/models");
  });

  it("导出稳定的厂商与本地占位 key", () => {
    expect(MAGPIE_PROVIDER).toBe("Magpie");
    expect(MAGPIE_LOCAL_API_KEY).toBe("__CYRENE_LOCAL_NO_AUTH__");
  });
});

describe("Magpie 推理档位映射", () => {
  it("把 reasoning_levels 映射成 openai-effort 手动档", () => {
    const config = manualReasoningForMagpie({
      reasoningLevels: ["minimal", "low", "medium", "high", "xhigh"],
      reasoningDisable: true,
    });
    expect(config).toEqual({
      style: "openai-effort",
      supportedEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
      supportsDisable: true,
    });
  });

  it("没有 medium 时优先 high，再退 low", () => {
    expect(manualReasoningForMagpie({ reasoningLevels: ["low", "high"], reasoningDisable: false })?.defaultEffort).toBe("high");
    expect(manualReasoningForMagpie({ reasoningLevels: ["low", "max"], reasoningDisable: false })?.defaultEffort).toBe("low");
  });

  it("没有可调档位时不生成手动配置", () => {
    expect(manualReasoningForMagpie({ reasoningLevels: [], reasoningDisable: false })).toBeUndefined();
    expect(manualReasoningForMagpie({ reasoningLevels: [], reasoningDisable: true })).toBeUndefined();
  });
});

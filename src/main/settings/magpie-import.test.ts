import { describe, expect, it } from "vitest";
import { MAGPIE_LOCAL_API_KEY, MAGPIE_PROVIDER, type MagpieModel } from "../../shared/magpie";
import type { SavedModelProfile } from "./model-catalog";
import { buildMagpieProfile, mergeMagpieProfiles } from "./magpie-import";

const GATEWAY = "http://127.0.0.1:3425";

const MODELS: MagpieModel[] = [
  {
    id: "group/never-stuck",
    displayName: "永不卡住",
    contextWindowTokens: 1048576,
    maxOutputTokens: 262144,
    multimodal: true,
    reasoningLevels: ["low", "high"],
    reasoningDisable: false,
  },
  {
    id: "opencode-zen/text-only",
    contextWindowTokens: 200000,
    maxOutputTokens: 32000,
    multimodal: false,
    reasoningLevels: [],
    reasoningDisable: false,
  },
];

function previousProfile(overrides: Partial<SavedModelProfile> = {}): SavedModelProfile {
  return {
    id: "magpie-gateway",
    provider: MAGPIE_PROVIDER,
    displayName: "我的 Magpie",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "group/never-stuck",
    models: ["group/never-stuck", "opencode-zen/text-only"],
    apiKey: MAGPIE_LOCAL_API_KEY,
    explicitTransport: "openai",
    ...overrides,
  };
}

describe("Magpie 档案构建", () => {
  it("新建档案：OpenAI 协议、本机占位 key、全量模型与能力", () => {
    const profile = buildMagpieProfile(undefined, MODELS, GATEWAY);

    expect(profile).toMatchObject({
      id: "magpie-gateway",
      provider: MAGPIE_PROVIDER,
      displayName: "Magpie",
      baseUrl: "http://127.0.0.1:3425/v1",
      model: "group/never-stuck",
      models: ["group/never-stuck", "opencode-zen/text-only"],
      apiKey: MAGPIE_LOCAL_API_KEY,
      explicitTransport: "openai",
      contextWindowTokens: 1048576,
      multimodal: true,
    });
    expect(profile.modelOptions).toEqual({
      "group/never-stuck": {
        contextWindowTokens: 1048576,
        multimodal: true,
        manualReasoning: {
          style: "openai-effort",
          supportedEfforts: ["low", "high"],
          defaultEffort: "high",
          supportsDisable: false,
        },
      },
      "opencode-zen/text-only": {
        contextWindowTokens: 200000,
        multimodal: false,
      },
    });
    expect(profile.models?.some((model) => model.startsWith("magpie/"))).toBe(false);
  });

  it("单模型目录不落 models 清单（与 normalize 契约一致）", () => {
    const profile = buildMagpieProfile(undefined, [MODELS[1]], GATEWAY);
    expect(profile.model).toBe("opencode-zen/text-only");
    expect(profile.models).toBeUndefined();
  });

  it("重新同步保留用户选择的模型、档案名与自定义 key", () => {
    const previous = previousProfile({
      model: "opencode-zen/text-only",
      apiKey: "sk-user",
    });
    const profile = buildMagpieProfile(previous, MODELS, GATEWAY);

    expect(profile.id).toBe("magpie-gateway");
    expect(profile.displayName).toBe("我的 Magpie");
    expect(profile.model).toBe("opencode-zen/text-only");
    expect(profile.apiKey).toBe("sk-user");
    expect(profile.baseUrl).toBe("http://127.0.0.1:3425/v1");
  });

  it("旧模型已从目录消失时顺位到第一个模型", () => {
    const previous = previousProfile({ model: "opencode-zen/removed" });
    const profile = buildMagpieProfile(previous, MODELS, GATEWAY);
    expect(profile.model).toBe("group/never-stuck");
    expect(profile.modelOptions?.["opencode-zen/removed"]).toBeUndefined();
  });

  it("Magpie 未提供推理档位时保留用户手动配置", () => {
    const manualReasoning = {
      style: "openai-effort" as const,
      supportedEfforts: ["medium" as const],
      defaultEffort: "medium" as const,
      supportsDisable: false,
    };
    const previous = previousProfile({
      modelOptions: {
        "opencode-zen/text-only": { multimodal: true, contextWindowTokens: 123456, manualReasoning },
      },
    });
    const profile = buildMagpieProfile(previous, MODELS, GATEWAY);
    expect(profile.modelOptions?.["opencode-zen/text-only"]?.manualReasoning).toEqual(manualReasoning);
    expect(profile.modelOptions?.["opencode-zen/text-only"]?.multimodal).toBe(false);
    expect(profile.modelOptions?.["opencode-zen/text-only"]?.contextWindowTokens).toBe(200000);
  });
});

describe("Magpie 档案合并", () => {
  it("首次导入追加一个 Magpie 档案，不动其他档案", () => {
    const other: SavedModelProfile = {
      id: "other",
      provider: "MiniMax（稀宇科技）",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
      apiKey: "sk-other",
      explicitTransport: "anthropic",
    };
    const merged = mergeMagpieProfiles([other], MODELS, GATEWAY);

    expect(merged.changed).toBe(true);
    expect(merged.profiles).toHaveLength(2);
    expect(merged.profiles[0]).toBe(other);
    expect(merged.profile.provider).toBe(MAGPIE_PROVIDER);
  });

  it("已有 Magpie 档案时原位更新，不追加第二份", () => {
    const previous = previousProfile();
    const merged = mergeMagpieProfiles([previous], MODELS, GATEWAY);
    expect(merged.changed).toBe(true);
    expect(merged.profiles).toHaveLength(1);
    expect(merged.profile.id).toBe(previous.id);
    expect(merged.profile.baseUrl).toBe("http://127.0.0.1:3425/v1");
  });

  it("目录未变化时不产生写盘变更", () => {
    const first = mergeMagpieProfiles([], MODELS, GATEWAY);
    const second = mergeMagpieProfiles(first.profiles, MODELS, GATEWAY);
    expect(second.changed).toBe(false);
    expect(second.profile).toEqual(first.profile);
  });

  it("固定 id 被其他档案占用时改用可用 id", () => {
    const squatter: SavedModelProfile = {
      id: "magpie-gateway",
      provider: "Other",
      baseUrl: "https://example.test/v1",
      model: "x",
      apiKey: "k",
    };
    const merged = mergeMagpieProfiles([squatter], MODELS, GATEWAY);
    expect(merged.profile.id).toBe("magpie-gateway-2");
    expect(merged.profiles.map((profile) => profile.id)).toEqual(["magpie-gateway", "magpie-gateway-2"]);
  });
});

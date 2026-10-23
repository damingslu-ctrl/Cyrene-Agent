import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAGPIE_LOCAL_API_KEY, MAGPIE_PROVIDER } from "../../shared/magpie";

const state = vi.hoisted(() => ({
  profiles: [] as Array<Record<string, unknown>>,
  saves: 0,
}));

vi.mock("./model-settings", () => ({
  loadModelSettings: () => ({ modelProfiles: state.profiles }),
  listSavedModelProfiles: () => state.profiles,
  saveModelProfile: (profile: Record<string, unknown>) => {
    state.saves += 1;
    const id = profile.id as string;
    const index = state.profiles.findIndex((item) => item.id === id);
    state.profiles = index >= 0
      ? state.profiles.map((item, itemIndex) => (itemIndex === index ? profile : item))
      : [...state.profiles, profile];
    return { added: true, settings: { modelProfiles: state.profiles } };
  },
}));

import { syncMagpieModels } from "./magpie-sync";

const PAYLOAD = {
  object: "list",
  data: [
    {
      id: "group/never-stuck",
      display_name: "永不卡住",
      context_window: 1048576,
      modalities: { input: ["text", "image"] },
      reasoning_levels: ["low", "high"],
    },
    {
      id: "opencode-zen/text-only",
      context_window: 200000,
      modalities: { input: ["text"] },
      reasoning_levels: [],
    },
  ],
};

function okFetch(payload: unknown = PAYLOAD) {
  return vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  state.profiles = [];
  state.saves = 0;
});

describe("Magpie 同步编排", () => {
  it("发现模型后写入一个 Magpie 档案", async () => {
    const fetchImpl = okFetch();
    const result = await syncMagpieModels({ gatewayUrl: "http://127.0.0.1:3425", fetchImpl });

    expect(result).toMatchObject({
      available: true,
      changed: true,
      gatewayUrl: "http://127.0.0.1:3425",
      importedModels: 2,
      profileId: "magpie-gateway",
    });
    expect(state.saves).toBe(1);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      provider: MAGPIE_PROVIDER,
      baseUrl: "http://127.0.0.1:3425/v1",
      apiKey: MAGPIE_LOCAL_API_KEY,
      model: "group/never-stuck",
      models: ["group/never-stuck", "opencode-zen/text-only"],
    });
  });

  it("目录未变化时第二次同步不写盘", async () => {
    const fetchImpl = okFetch();
    await syncMagpieModels({ gatewayUrl: "http://127.0.0.1:3425", fetchImpl });
    const second = await syncMagpieModels({ gatewayUrl: "http://127.0.0.1:3425", fetchImpl });

    expect(second).toMatchObject({ available: true, changed: false, importedModels: 2, profileId: "magpie-gateway" });
    expect(state.saves).toBe(1);
  });

  it("网关不可达时报告不可用且不改档案", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3425");
    }) as unknown as typeof fetch;
    const result = await syncMagpieModels({ gatewayUrl: "http://127.0.0.1:3425", fetchImpl });

    expect(result.available).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.importedModels).toBe(0);
    expect(result.error).toContain("ECONNREFUSED");
    expect(state.saves).toBe(0);
  });

  it("网关在线但没有模型时不写空档案", async () => {
    const result = await syncMagpieModels({ gatewayUrl: "http://127.0.0.1:3425", fetchImpl: okFetch({ data: [] }) });

    expect(result).toMatchObject({ available: true, changed: false, importedModels: 0 });
    expect(result.error).toBeTruthy();
    expect(state.saves).toBe(0);
  });

  it("拒绝非回环网关，不发请求", async () => {
    const fetchImpl = vi.fn();
    const result = await syncMagpieModels({
      gatewayUrl: "http://198.51.100.4:3425",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.changed).toBe(false);
    expect(state.saves).toBe(0);
  });
});

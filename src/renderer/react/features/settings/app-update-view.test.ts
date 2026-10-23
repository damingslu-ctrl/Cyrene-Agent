import { describe, expect, it } from "vitest";
import type { AppInfo } from "../../../../shared/app-info";
import { resolveAppInfoView, resolveVersionTitleKey } from "./app-update-view";

function info(overrides: Partial<AppInfo> = {}): AppInfo {
  return {
    name: "Mochi",
    nameZh: "麻糬",
    version: "1.3.3",
    buildChannel: "local",
    dataDirName: "Mochi",
    ...overrides,
  };
}

describe("resolveAppInfoView", () => {
  it("只产出「版本号 + 构建方式」两项，不带任何可点的东西", () => {
    expect(resolveAppInfoView(info())).toEqual({
      versionLabel: "v1.3.3",
      titleKey: "ui.version.firstStable",
      noteKey: "appUpdate.localBuild",
    });
  });

  it("版本称号只给 key，不把译文拼进字符串", () => {
    const view = resolveAppInfoView(info({ version: "1.2.9" }));
    expect(view.titleKey).toBeNull();
    expect(view.versionLabel).toBe("v1.2.9");
    // 视图里不许出现译文字面（原来 resolveAppUpdateView 只产出 key 的规矩）
    expect(JSON.stringify(view)).not.toContain("正式版");
  });
});

describe("resolveVersionTitleKey", () => {
  it("正式版起点及更新版本带称号，预发布号不带", () => {
    expect(resolveVersionTitleKey("1.3.0")).toBe("ui.version.firstStable");
    expect(resolveVersionTitleKey("1.3.3")).toBe("ui.version.firstStable");
    expect(resolveVersionTitleKey("1.2.9")).toBeNull();
    expect(resolveVersionTitleKey("1.3.0-beta.1")).toBeNull();
  });
});

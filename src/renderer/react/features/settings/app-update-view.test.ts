import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
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
      noteKey: "appUpdate.updateCard",
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

const RESOURCES: Record<string, Record<string, unknown>> = {
  "zh-CN": zhCN as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
  "ja-JP": jaJP as unknown as Record<string, unknown>,
};

function leaf(locale: string, key: string): unknown {
  let node: unknown = RESOURCES[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * 「构建方式」那一行的句子是最容易留在旧现实里的一句：这一页不画按钮是真的，但
 * 「不联网检查更新」在 Wave 4 T12 之后就是假的了——产品每 6 小时问一次发布页，
 * 界面却当着用户说它不会。界面上写出来的状态词就是承诺，所以这里两头都量：
 * 旧话不许回来，而且必须指着真的存在的那张卡（否则这句话把用户领到空气跟前）。
 */
describe("「构建方式」那句话的措辞锁", () => {
  const noteKey = resolveAppInfoView(info()).noteKey;

  const forbidden: Record<string, RegExp> = {
    "zh-CN": /不联网检查|不检查更新|不会联网|没有升级来源/,
    en: /no online update|doesn'?t check|does not check|never checks/i,
    "ja-JP": /オンラインでのアップデート確認は行いません|更新を確認しません/,
  };
  const pointer: Record<string, RegExp> = {
    "zh-CN": /网络[\s\S]*更新/,
    en: /Network[\s\S]*updates/i,
    "ja-JP": /ネットワーク[\s\S]*更新/,
  };

  for (const locale of Object.keys(RESOURCES)) {
    it(`${locale}：既不说「不检查更新」，也指得到那张卡`, () => {
      const text = leaf(locale, noteKey);
      expect(typeof text, `${locale} · ${noteKey}`).toBe("string");
      expect((text as string).trim()).not.toBe("");
      expect(text).not.toMatch(forbidden[locale]);
      expect(text).toMatch(pointer[locale]);
    });
  }
});

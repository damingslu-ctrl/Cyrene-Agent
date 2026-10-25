import { describe, expect, it } from "vitest";
import { shouldSkipStartupSplash } from "./splash-policy";
import { CURRENT_DISCLAIMER_VERSION } from "../../shared/disclaimer";

describe("shouldSkipStartupSplash", () => {
  it("桌宠可见且已接受声明 → 跳过 Loading（登场动画独占启动期）", () => {
    expect(shouldSkipStartupSplash({ petVisible: true, disclaimerAcceptedVersion: CURRENT_DISCLAIMER_VERSION })).toBe(true);
  });

  it("旧版本的 undefined 也按已接受算（与 hasCurrentDisclaimerConsent 同口径）", () => {
    expect(shouldSkipStartupSplash({ petVisible: true, disclaimerAcceptedVersion: undefined })).toBe(true);
  });

  it("用户把桌宠藏起来 → 保留 Loading（没有动画可看，不能留白）", () => {
    expect(shouldSkipStartupSplash({ petVisible: false, disclaimerAcceptedVersion: CURRENT_DISCLAIMER_VERSION })).toBe(false);
  });

  it("未接受免责声明 → 保留 Loading（首启欢迎窗流程）", () => {
    expect(shouldSkipStartupSplash({ petVisible: true, disclaimerAcceptedVersion: "" })).toBe(false);
    expect(shouldSkipStartupSplash({ petVisible: true, disclaimerAcceptedVersion: "2020-01-01" })).toBe(false);
  });
});

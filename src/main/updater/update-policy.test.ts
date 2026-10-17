// src/main/updater/update-policy.test.ts
import { describe, expect, it } from "vitest";
import { FORK_AUTO_UPDATE_DISABLED, shouldScheduleStartupUpdateCheck } from "./update-policy";

describe("shouldScheduleStartupUpdateCheck", () => {
  it("fork 关掉了自动更新时，打包版也不排期启动检查", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: true, forkAutoUpdateDisabled: true }),
    ).toBe(false);
  });

  it("正对照：闸门打开且已打包时才排期（防止把判据写反）", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: true, forkAutoUpdateDisabled: false }),
    ).toBe(true);
  });

  it("未打包永远不排期（沿用上游 isPackaged 短路）", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: false, forkAutoUpdateDisabled: false }),
    ).toBe(false);
  });

  it("fork 的默认值必须是关掉", () => {
    expect(FORK_AUTO_UPDATE_DISABLED).toBe(true);
  });
});

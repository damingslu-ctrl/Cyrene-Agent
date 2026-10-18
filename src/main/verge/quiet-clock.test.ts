import { describe, expect, it } from "vitest";
import { QUIET_DURATION_MS, isQuietNow, quietRemainingMinutes, armQuiet } from "./quiet-clock";

const now = 1_700_000_000_000;

describe("quiet-clock", () => {
  it("半小时档时长照抄 native", () => {
    expect(QUIET_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("到点即失效，且不许差 1ms 还在响", () => {
    expect(isQuietNow(now + 1000, now)).toBe(true);
    expect(isQuietNow(now, now)).toBe(false);
  });

  it("正对照：null（不在安静期）判为 false", () => {
    expect(isQuietNow(null, now)).toBe(false);
  });

  it("剩余分钟向上取整且至少 1（剩 10 秒也得说「剩 1 分」）", () => {
    expect(quietRemainingMinutes(now + 10_000, now)).toBe(1);
    expect(quietRemainingMinutes(now + 91_000, now)).toBe(2);
  });

  it("再点一次是取消，不是续期（native 的反向路径回执）", () => {
    expect(armQuiet({ current: now + 60_000, now })).toBeNull();
    expect(armQuiet({ current: null, now })).toBe(now + QUIET_DURATION_MS);
  });
});

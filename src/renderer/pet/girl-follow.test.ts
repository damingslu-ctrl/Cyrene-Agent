import { describe, expect, it } from "vitest";
import {
  FOLLOW_ARRIVE_PX, FOLLOW_RANGE_PX, FOLLOW_STEP_PX, followArrived, followNeedsStep, followTargetX,
} from "./girl-follow";

const BOUNDS = { minX: 0, maxX: 1_200 };
const WIDTH = 82;

describe("跟我来（纯几何）", () => {
  it("光标在正中就留在原地；往右往左各追一段", () => {
    const start = 600;
    expect(followTargetX(start, WIDTH / 2, WIDTH, BOUNDS)).toBe(start);
    expect(followTargetX(start, WIDTH, WIDTH, BOUNDS)).toBe(start + WIDTH / 2);
    expect(followTargetX(start, 0, WIDTH, BOUNDS)).toBe(start - WIDTH / 2);
  });

  it("最多跟出发点相距 160px，且从不越过 workArea", () => {
    const start = 600;
    expect(followTargetX(start, 10_000, WIDTH, BOUNDS)).toBe(start + FOLLOW_RANGE_PX);
    expect(followTargetX(start, -10_000, WIDTH, BOUNDS)).toBe(start - FOLLOW_RANGE_PX);

    expect(followTargetX(30, -10_000, WIDTH, BOUNDS)).toBe(BOUNDS.minX);
    expect(followTargetX(1_170, 10_000, WIDTH, BOUNDS)).toBe(BOUNDS.maxX);
    // 窗口贴边时，范围再宽也不许出界。
    expect(followTargetX(1, -10_000, WIDTH, BOUNDS)).toBe(BOUNDS.minX);
  });

  it("到达与重发各有滞后：贴脸不走，小挪不重发", () => {
    expect(followArrived(100, 100 + FOLLOW_ARRIVE_PX)).toBe(true);
    expect(followArrived(100, 100 + FOLLOW_ARRIVE_PX + 1)).toBe(false);
    expect(followNeedsStep(100, 100 + FOLLOW_STEP_PX - 1)).toBe(false);
    expect(followNeedsStep(100, 100 - FOLLOW_STEP_PX)).toBe(true);
  });
});

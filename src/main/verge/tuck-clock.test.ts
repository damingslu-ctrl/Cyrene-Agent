import { describe, expect, it } from "vitest";
import {
  EDGE_NEAR_PX, TUCK_HINT, TUCK_IDLE_SECS, TUCK_PEEK_PX,
  shouldTuck, tuckHintShout, tuckStep, unTuckForDrag,
} from "./tuck-clock";

describe("tuck 常量", () => {
  it("照抄 native：藏一半约当猫体 74 宽的 54%，近边阈值 60，闲置 6 秒", () => {
    expect({ TUCK_PEEK_PX, EDGE_NEAR_PX, TUCK_IDLE_SECS }).toEqual({ TUCK_PEEK_PX: 40, EDGE_NEAR_PX: 60, TUCK_IDLE_SECS: 6 });
    // native main.rs:1943 的「≈54% 窗宽」分母是**猫体包围盒 2u=74**（e=0 时 u=37，:4130-4132），
    // 不是窗口 PET_W=82（40/82=0.488，计划手算值把它按 82 写会永远红——同勘误 1 的手算值作废口径）。
    expect(TUCK_PEEK_PX / 74).toBeGreaterThan(0.5);
  });
});

describe("shouldTuck 五道闸门", () => {
  const open = { tuckEnabled: true, userActive: false, idleSecs: 7, limit: TUCK_IDLE_SECS, e: 0, be: 0, bubbleOpen: false };
  it("全开才藏", () => { expect(shouldTuck(open)).toBe(true); });
  it("开关关了不藏（用户关得掉）", () => { expect(shouldTuck({ ...open, tuckEnabled: false })).toBe(false); });
  it("刚拖过不藏", () => { expect(shouldTuck({ ...open, userActive: true })).toBe(false); });
  it("不够久不藏", () => { expect(shouldTuck({ ...open, idleSecs: 5.9 })).toBe(false); });
  it("正对照：面板或气泡在开着时不藏（藏身会把气泡 anchor 顶出屏）", () => {
    // 判据分界取 native :4929-4930 的字面阈值 `e < 0.05` / `be < 0.05`：
    // 0.02 在 native 语义里就是「还没展开」，照样能藏——计划的 0.02→false 与 native 冲突，
    // 按「只搬不改」改钉 0.05 两侧（brief 测试代码的这组手算值同勘误 1 口径作废）。
    expect(shouldTuck({ ...open, e: 0.05 })).toBe(false);
    expect(shouldTuck({ ...open, be: 0.05 })).toBe(false);
    expect(shouldTuck({ ...open, bubbleOpen: true })).toBe(false);
    // 0.02 的正对照：闸门语义必须真是 native 的 <0.05，不是「非零就关」。
    expect(shouldTuck({ ...open, e: 0.02 })).toBe(true);
    expect(shouldTuck({ ...open, be: 0.02 })).toBe(true);
  });
});

describe("tuckHintShout", () => {
  it("第一次真藏之前先解释，且只说一次", () => {
    expect(tuckHintShout({ tuckOn: true, hinted: false, engaging: true })).toBe(TUCK_HINT);
    expect(tuckHintShout({ tuckOn: true, hinted: true, engaging: true })).toBeNull();
    expect(tuckHintShout({ tuckOn: true, hinted: false, engaging: false })).toBeNull();
  });
});

describe("tuckStep 缓动", () => {
  it("按 k = min(dt,0.05)*3.5 逼近，残余不足 0.5 吸附到位", () => {
    expect(tuckStep(0, 40, 0.016, 0)).toBeCloseTo(40 * 0.056, 6);
    expect(tuckStep(39.8, 40, 0.016, 0)).toBe(40);
  });
  it("目标 0 时往回收", () => {
    expect(tuckStep(40, 0, 0.016, 0)).toBeLessThan(40);
  });
});

describe("unTuckForDrag", () => {
  it("拖走时把窗口按 peek 补回原位再清偏移（否则猫会反向补偿、被窗裁掉）", () => {
    expect(unTuckForDrag({ x: 1836 }, 40)).toEqual({ x: 1876 });
  });
});

import { describe, expect, it } from "vitest";
import {
  BUBBLE_COUNT, BUBBLE_POP_MS, BUBBLES_MS, bubbleAt, bubblePos, bubblesAlive, buildBubbleOps,
  createBubbles, liveBubbleCount, popBubble, poppedBubbleCount,
} from "./girl-bubbles";

const FACE = { cx: 41, w: 46, h: 34 };
const FLOOR = 96;
const fixed = () => 0.5;

describe("泡泡", () => {
  it("一次固定吹 6 颗，出生即算活；5.6 秒后整串散掉", () => {
    const state = createBubbles(0, FACE, fixed);
    expect(state.bubbles).toHaveLength(BUBBLE_COUNT);
    expect(bubblesAlive(state, 0)).toBe(true);
    expect(bubblesAlive(state, BUBBLES_MS - 1)).toBe(true);
    expect(bubblesAlive(state, BUBBLES_MS)).toBe(false);
    expect(liveBubbleCount(state, BUBBLES_MS)).toBe(0);
  });

  it("泡泡边升边变大，横向只轻轻摆，不会离开脸宽太多", () => {
    const state = createBubbles(0, FACE, fixed);
    const bubble = state.bubbles[0];
    const early = bubblePos(state, bubble, 0, FLOOR);
    const late = bubblePos(state, bubble, BUBBLES_MS * 0.8, FLOOR);
    expect(late.y).toBeLessThan(early.y);
    expect(late.r).toBeGreaterThan(early.r);
    expect(Math.abs(late.x - early.x)).toBeLessThanOrEqual(3.3);
    expect(late.y).toBeGreaterThan(FLOOR - bubble.rise - 4);
  });

  it("点得中当前落点；一颗只破一次，其余同伴继续飞", () => {
    const state = createBubbles(1_000, FACE, fixed);
    const now = 2_000;
    const pos = bubblePos(state, state.bubbles[2], now, FLOOR);
    expect(bubbleAt(state, now, FLOOR, pos.x, pos.y)).toBe(2);
    // 离得远就不算点中。
    expect(bubbleAt(state, now, FLOOR, pos.x + pos.r + 8, pos.y)).not.toBe(2);

    expect(popBubble(state, 2, now)).toBe(true);
    expect(popBubble(state, 2, now + 10)).toBe(false);
    expect(poppedBubbleCount(state)).toBe(1);
    expect(liveBubbleCount(state, now)).toBe(BUBBLE_COUNT - 1);
    // 破掉的那颗不再参与命中判定。
    expect(bubbleAt(state, now, FLOOR, pos.x, pos.y)).not.toBe(2);
  });

  it("全部戳破后到破碎动画结束就整串结束（不必等满 5.6 秒）", () => {
    const state = createBubbles(0, FACE, fixed);
    for (const bubble of state.bubbles) popBubble(state, bubble.id, 1_000);
    expect(bubblesAlive(state, 1_000 + BUBBLE_POP_MS)).toBe(true);
    expect(bubblesAlive(state, 1_000 + BUBBLE_POP_MS + 1)).toBe(false);
  });

  it("画法：活泡泡是奶油+玫瑰双色圈；破掉的三道短线只留 320ms", () => {
    const state = createBubbles(0, FACE, fixed);
    const idle = buildBubbleOps(state, 100, FLOOR);
    expect(idle.length).toBeGreaterThanOrEqual(BUBBLE_COUNT * 5);
    expect(idle.some((op) => op.kind === "strokeEllipse")).toBe(true);

    popBubble(state, 0, 1_000);
    const popping = buildBubbleOps(state, 1_050, FLOOR);
    const poppingStrokes = popping.filter((op) => op.kind === "strokePath").length;
    expect(poppingStrokes).toBeGreaterThanOrEqual(3);
    expect(buildBubbleOps(state, 1_000 + BUBBLE_POP_MS + 1, FLOOR).length).toBeLessThan(popping.length);
  });
});

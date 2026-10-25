/**
 * 一串泡泡：从脚边升起 6 颗，边升边轻轻横摆，5.6 秒内自己散掉。
 * 点破一颗只记 poppedAt，其余同伴继续飞——泡泡是「可以戳的静物」，不是一段动画。
 */
import { ACCENT, PAPER, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BUBBLES_MS = 5_600;
export const BUBBLE_COUNT = 6;
export const BUBBLE_POP_MS = 320;

export interface BubbleFace {
  cx: number;
  w: number;
  h: number;
}

interface Bubble {
  id: number;
  x0: number;
  rise: number;
  r: number;
  phase: number;
  poppedAt: number;
}

export interface BubbleState {
  bornAt: number;
  bubbles: Bubble[];
}

export function createBubbles(now: number, face: BubbleFace, rand = Math.random): BubbleState {
  const bubbles: Bubble[] = [];
  for (let i = 0; i < BUBBLE_COUNT; i += 1) {
    const t = i / (BUBBLE_COUNT - 1);
    bubbles.push({
      id: i,
      x0: face.cx + (t - 0.5) * face.w * 1.05 + (rand() - 0.5) * face.w * 0.18,
      rise: face.h * (0.55 + rand() * 0.42),
      r: Math.max(2.4, face.w * (0.075 + rand() * 0.035)),
      phase: rand() * Math.PI * 2,
      poppedAt: -1,
    });
  }
  return { bornAt: now, bubbles };
}

export function bubblesAlive(state: BubbleState, now: number): boolean {
  if (now - state.bornAt >= BUBBLES_MS) return false;
  return state.bubbles.some((b) => b.poppedAt < 0 || now - b.poppedAt <= BUBBLE_POP_MS);
}

export function bubblePos(state: BubbleState, bubble: Bubble, now: number, floorY: number): { x: number; y: number; r: number } {
  const p = Math.max(0, Math.min(1, (now - state.bornAt) / BUBBLES_MS));
  const sway = Math.sin(bubble.phase + p * 5.2) * 3.2;
  return {
    x: bubble.x0 + sway,
    y: floorY - p * bubble.rise - 3,
    r: bubble.r * (0.85 + p * 0.25),
  };
}

/** 点中哪颗泡泡（同帧重叠时取离手指最近的一颗）。 */
export function bubbleAt(
  state: BubbleState,
  now: number,
  floorY: number,
  x: number,
  y: number,
): number | null {
  let best: { id: number; d: number } | null = null;
  for (const bubble of state.bubbles) {
    if (bubble.poppedAt >= 0) continue;
    const pos = bubblePos(state, bubble, now, floorY);
    const d = Math.hypot(x - pos.x, y - pos.y);
    if (d <= pos.r + 3 && (!best || d < best.d)) best = { id: bubble.id, d };
  }
  return best ? best.id : null;
}

export function popBubble(state: BubbleState, id: number, now: number): boolean {
  const bubble = state.bubbles.find((b) => b.id === id);
  if (!bubble || bubble.poppedAt >= 0) return false;
  bubble.poppedAt = now;
  return true;
}

export function liveBubbleCount(state: BubbleState, now: number): number {
  if (now - state.bornAt >= BUBBLES_MS) return 0;
  return state.bubbles.filter((b) => b.poppedAt < 0).length;
}

export function poppedBubbleCount(state: BubbleState): number {
  return state.bubbles.filter((b) => b.poppedAt >= 0).length;
}

export function buildBubbleOps(state: BubbleState, now: number, floorY: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const bubble of state.bubbles) {
    if (bubble.poppedAt >= 0) {
      const age = now - bubble.poppedAt;
      if (age > BUBBLE_POP_MS) continue;
      const pos = bubblePos(state, bubble, now, floorY);
      const p = age / BUBBLE_POP_MS;
      for (let i = 0; i < 3; i += 1) {
        const a = bubble.phase + (i * Math.PI * 2) / 3;
        const rr = pos.r * (1 + p * 1.8);
        ops.push({
          kind: "strokePath",
          stroke: withAlpha(PAPER, 0.85 * (1 - p)),
          width: 1.1,
          points: [
            [pos.x + Math.cos(a) * rr * 0.55, pos.y + Math.sin(a) * rr * 0.55],
            [pos.x + Math.cos(a) * rr, pos.y + Math.sin(a) * rr],
          ],
        });
      }
      continue;
    }
    const pos = bubblePos(state, bubble, now, floorY);
    // 双色泡泡：奶油圈打底（深桌布上看得见），玫瑰细圈压上去（浅桌布上有颜色）。
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.16), cx: pos.x, cy: pos.y, rx: pos.r, ry: pos.r });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.92), width: 1.7, cx: pos.x, cy: pos.y, rx: pos.r, ry: pos.r });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE, 0.8), width: 0.7, cx: pos.x, cy: pos.y, rx: pos.r, ry: pos.r });
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(PAPER, 0.9),
      cx: pos.x - pos.r * 0.32,
      cy: pos.y - pos.r * 0.34,
      rx: Math.max(0.6, pos.r * 0.2),
      ry: Math.max(0.6, pos.r * 0.15),
    });
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(ACCENT, 0.55),
      cx: pos.x + pos.r * 0.3,
      cy: pos.y + pos.r * 0.28,
      rx: Math.max(0.5, pos.r * 0.12),
      ry: Math.max(0.5, pos.r * 0.12),
    });
  }
  return ops;
}

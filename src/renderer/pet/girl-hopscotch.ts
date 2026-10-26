/**
 * 跳格子：她脚边用粉笔划出三格，得按 1→2→3 的顺序踩过去。
 * 踩错就从第一格重来，踩满三格才算跳完一轮；同一拍连点被冷却吞掉，
 * 免得一次双击把整局「跳」完（那样用户根本没看见她在跳）。
 *
 * 格位是解析量：位置全部由 face/floorY 推出来，帧率与点击顺序都不改布局。
 */
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const HOP_MS = 8_000;
export const HOP_COOLDOWN_MS = 220;
export const HOP_SQUARES = 3;
const SQUARE_W = 16;
const SQUARE_H = 10;
const SQUARE_GAP = 4;

export interface HopFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface HopState {
  bornAt: number;
  seed: number;
  /** 下一脚该踩第几格；等于 HOP_SQUARES 表示这一轮已经跳完。 */
  next: number;
  lastStepAt: number;
}

export interface HopSquare {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
}

export type HopStep = "miss" | "wrong" | "next" | "done";

export function createHopscotch(now: number, seed = Math.random()): HopState {
  return { bornAt: now, seed, next: 0, lastStepAt: -1 };
}

export function hopAlive(state: HopState, now: number): boolean {
  const age = now - state.bornAt;
  return age >= 0 && age < HOP_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function hopSquareAt(state: HopState, now: number, face: HopFace, floorY: number, index: 0 | 1 | 2): HopSquare {
  const total = HOP_SQUARES * SQUARE_W + (HOP_SQUARES - 1) * SQUARE_GAP;
  const x0 = clamp(face.cx - total / 2, 2, Math.max(2, 82 - total - 2));
  // 收走前 600ms 往下淡出，像被风擦掉。
  const fade = clamp((HOP_MS - (now - state.bornAt)) / 600, 0, 1);
  return {
    x: x0 + index * (SQUARE_W + SQUARE_GAP),
    y: floorY - 11 + (1 - fade) * 4,
    w: SQUARE_W,
    h: SQUARE_H,
    index,
  };
}

export function stepHop(state: HopState, now: number, index: number): HopStep {
  if (!hopAlive(state, now)) return "miss";
  if (state.lastStepAt >= 0 && now - state.lastStepAt < HOP_COOLDOWN_MS) return "miss";
  if (state.next >= HOP_SQUARES) return "miss";
  if (!Number.isInteger(index) || index < 0 || index >= HOP_SQUARES) return "miss";
  state.lastStepAt = now;
  if (index !== state.next) {
    // 踩错不是「没反应」：进度归零，得从第一格重新起跳。
    state.next = 0;
    return "wrong";
  }
  state.next += 1;
  return state.next >= HOP_SQUARES ? "done" : "next";
}

export function hopAtPoint(
  state: HopState,
  now: number,
  face: HopFace,
  floorY: number,
  x: number,
  y: number,
): number {
  if (!hopAlive(state, now)) return -1;
  for (let i = 0; i < HOP_SQUARES; i += 1) {
    const sq = hopSquareAt(state, now, face, floorY, i as 0 | 1 | 2);
    if (x >= sq.x && x <= sq.x + sq.w && y >= sq.y && y <= sq.y + sq.h) return i;
  }
  return -1;
}

function starPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.36;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return points;
}

export function buildHopOps(state: HopState, now: number, face: HopFace, floorY: number): DrawOp[] {
  if (!hopAlive(state, now)) return [];
  const age = now - state.bornAt;
  const alpha = clamp(age / 320, 0, 1) * clamp((HOP_MS - age) / 600, 0, 1);
  if (alpha <= 0.01) return [];
  const ops: DrawOp[] = [];
  const hopX = face.cx + Math.sin(age / 420) * 1.5;
  // 她跳起来的离地量：跳完一轮后落回地面。
  const lift = state.next > 0 && state.next < HOP_SQUARES ? Math.abs(Math.sin(age / 260)) * 2.4 : 0;
  ops.push({
    kind: "fillEllipse",
    fill: withAlpha(ROSE_DEEP, 0.16 * alpha),
    cx: hopX,
    cy: floorY + 1.2,
    rx: face.w * 0.42,
    ry: 2,
  });
  for (let i = 0; i < HOP_SQUARES; i += 1) {
    const sq = hopSquareAt(state, now, face, floorY, i as 0 | 1 | 2);
    const done = i < state.next;
    const next = i === state.next && state.next < HOP_SQUARES;
    const tone = done ? ROSE : next ? ACCENT : PAPER;
    ops.push({
      kind: "strokeRoundRect",
      stroke: withAlpha(tone, (done ? 0.92 : next ? 0.8 : 0.52) * alpha),
      width: next ? 1.2 : 0.9,
      x: sq.x,
      y: sq.y - lift,
      w: sq.w,
      h: sq.h,
      r: 2.4,
    });
    // 每格里的粉笔点＝序号（1/2/3 点），完成格填实，未完成格留空心。
    for (let p = 0; p < i + 1; p += 1) {
      const px = sq.x + sq.w / 2 + (p - i / 2) * 3;
      ops.push({
        kind: "fillEllipse",
        fill: withAlpha(tone, (done ? 0.9 : next ? 0.62 : 0.4) * alpha),
        cx: px,
        cy: sq.y + sq.h / 2 - lift,
        rx: 1.05,
        ry: 1.05,
      });
    }
    // 落点尘：踩过的格子边上留一点粉笔灰。
    if (done) {
      for (let d = 0; d < 2; d += 1) {
        const dx = sq.x + 3 + d * (sq.w - 6) + Math.sin(state.seed * 9 + i * 3 + d) * 1.2;
        ops.push({
          kind: "fillEllipse",
          fill: withAlpha(PAPER, 0.5 * alpha),
          cx: dx,
          cy: sq.y + sq.h + 0.8 + d * 0.8,
          rx: 1.1,
          ry: 0.6,
        });
      }
    }
  }
  // 下一格的落点星：告诉手指该点哪里。
  if (state.next < HOP_SQUARES) {
    const target = hopSquareAt(state, now, face, floorY, state.next as 0 | 1 | 2);
    const bob = Math.sin(now / 180) * 1.2;
    const cx = target.x + target.w / 2;
    const cy = target.y - 4 - lift + bob;
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.95 * alpha), points: starPoints(cx, cy, 3.4) });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.9 * alpha), points: starPoints(cx, cy, 2) });
  }
  // 跳完那一下：三颗星一起炸开（不占格位，纯反馈）。
  if (state.next >= HOP_SQUARES) {
    const since = now - state.lastStepAt;
    if (since >= 0 && since < 800) {
      const p = since / 800;
      for (let i = 0; i < 3; i += 1) {
        const cx = face.cx - 10 + i * 10;
        const cy = floorY - 18 - p * 10 - i * 2;
        ops.push({
          kind: "fillPath",
          fill: withAlpha(i === 1 ? ACCENT : ROSE, (1 - p) * alpha),
          points: starPoints(cx, cy, 2.6 - p * 0.8),
        });
      }
    }
  }
  return ops;
}

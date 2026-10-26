/**
 * 翻跟头：她蹲一下再横着滚过去，脚边扬起一圈尘土；最高点再点她一下＝多翻一个。
 * 跟头数由点击补，滚到哪儿由时刻解析——掉帧也不会把弧线画断。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const ROLL_MS = 3_400;
export const ROLL_CROUCH_MS = 420;
export const ROLL_SPIN_END_MS = 2_600;
export const ROLL_FLIP_COOLDOWN_MS = 300;
export const ROLL_MAX_FLIPS = 3;

export interface RollFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface RollState {
  bornAt: number;
  seed: number;
  flips: number;
  lastFlipAt: number;
}

export type RollPhase = "crouch" | "spin" | "land" | "gone";
export type RollFlip = "miss" | "flip" | "capped";

export function createRoll(now: number, seed = Math.random()): RollState {
  return { bornAt: now, seed, flips: 0, lastFlipAt: -1 };
}

export function rollPhase(state: RollState, now: number): RollPhase {
  const age = now - state.bornAt;
  if (age < 0 || age < ROLL_CROUCH_MS) return "crouch";
  if (age < ROLL_SPIN_END_MS) return "spin";
  return age < ROLL_MS ? "land" : "gone";
}

export function rollAlive(state: RollState, now: number): boolean {
  return rollPhase(state, now) !== "gone";
}

export function rollSpin(state: RollState, now: number): number {
  const age = now - state.bornAt - ROLL_CROUCH_MS;
  return Math.max(0, Math.min(1, age / (ROLL_SPIN_END_MS - ROLL_CROUCH_MS)));
}

export function rollAtPoint(state: RollState, now: number, face: RollFace, floorY: number, x: number, y: number): boolean {
  const phase = rollPhase(state, now);
  if (phase === "crouch" || phase === "gone") return false;
  const dx = (x - face.cx) / Math.max(20, face.w * 0.8);
  const dy = (y - (face.bottom + face.h * 0.3)) / Math.max(12, face.h * 0.9);
  return dx * dx + dy * dy <= 1;
}

export function flipRoll(state: RollState, now: number): RollFlip {
  if (rollPhase(state, now) !== "spin") return "miss";
  if (state.lastFlipAt >= 0 && now - state.lastFlipAt < ROLL_FLIP_COOLDOWN_MS) return "miss";
  if (state.flips >= ROLL_MAX_FLIPS) return "capped";
  state.lastFlipAt = now;
  state.flips += 1;
  return "flip";
}

function star(cx: number, cy: number, r: number, fill: string): DrawOp {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.34;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return { kind: "fillPath", fill, points };
}

export function buildRollOps(state: RollState, now: number, face: RollFace, floorY: number): DrawOp[] {
  const phase = rollPhase(state, now);
  if (phase === "gone") return [];
  const age = Math.max(0, now - state.bornAt);
  const alpha = Math.min(1, age / 240) * Math.min(1, (ROLL_MS - age) / 340);
  const p = rollSpin(state, now);
  const ops: DrawOp[] = [];
  // 尘土：左右各三团，从脚边往后滚。
  for (let i = 0; i < 6; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const out = (k + p * 1.4) * 3.2;
    const x = face.cx + side * (face.w * 0.5 + out);
    const y = floorY - 1.6 - (0.4 + k * 0.8) * Math.min(1, p * 2);
    ops.push({ kind: "fillEllipse", fill: withAlpha(i % 3 === 0 ? PAPER : PAPER_SHADE, (0.62 - k * 0.1) * alpha), cx: x, cy: y, rx: 2.4 + k * 0.5, ry: 1.3 + k * 0.25 });
  }
  // 旋转弧：两圈跟着进度转，读得出「她在滚」。
  for (let ring = 0; ring < 2; ring += 1) {
    const arc: Array<[number, number]> = [];
    const base = p * Math.PI * 2.6 + ring * Math.PI;
    for (let k = 0; k <= 8; k += 1) {
      const ang = base + (k / 8) * 1.9;
      const rx = face.w * (0.55 + ring * 0.12);
      const ry = face.h * (0.62 + ring * 0.1);
      arc.push([face.cx + Math.cos(ang) * rx, face.bottom + face.h * 0.2 + Math.sin(ang) * ry]);
    }
    ops.push({ kind: "strokePath", stroke: withAlpha(ring === 0 ? ROSE : PAPER, (0.5 - ring * 0.14) * alpha), width: 0.9, points: arc });
  }
  // 点击补出来的跟头：头顶一颗颗小星，最多三颗。
  for (let i = 0; i < state.flips; i += 1) {
    const x = face.cx + Math.sin(i * 2.1 + state.seed * 6.28) * face.w * 0.42;
    const y = face.top - 2 - i * 3.2;
    ops.push(star(x, y, 2.4, withAlpha(PAPER, 0.9 * alpha)));
    ops.push(star(x, y, 1.35, withAlpha(i % 2 === 0 ? ROSE : ROSE_DEEP, 0.95 * alpha)));
  }
  // 刚补的那一下：星环炸开。
  if (state.lastFlipAt >= 0 && now - state.lastFlipAt < 380) {
    const q = (now - state.lastFlipAt) / 380;
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE_DEEP, 0.7 * (1 - q) * alpha), width: 0.9, cx: face.cx, cy: face.top - 2, rx: 4 + q * 8, ry: 2 + q * 4 });
  }
  return ops;
}

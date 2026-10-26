/**
 * 踩奶：她在软垫上交替落爪，一下一下把垫子踩出小坑；点她胸口＝跟着踩一拍。
 * 整轮走完才记一次，顺手把呼噜续上（呼噜计时在引擎里）。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const KNEAD_MS = 4_600;
export const KNEAD_SETTLE_MS = 450;
export const KNEAD_BEAT_COOLDOWN_MS = 260;
export const KNEAD_MAX_BEATS = 6;

export interface KneadFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface KneadState {
  bornAt: number;
  seed: number;
  beats: number;
  lastBeatAt: number;
}

export type KneadPhase = "settle" | "knead" | "gone";

export function createKnead(now: number, seed = Math.random()): KneadState {
  return { bornAt: now, seed, beats: 0, lastBeatAt: -1 };
}

export function kneadPhase(state: KneadState, now: number): KneadPhase {
  const age = now - state.bornAt;
  if (age < 0 || age < KNEAD_SETTLE_MS) return "settle";
  return age < KNEAD_MS ? "knead" : "gone";
}

export function kneadAlive(state: KneadState, now: number): boolean {
  return kneadPhase(state, now) !== "gone";
}

export interface KneadPad {
  x: number;
  y: number;
  r: number;
  /** 0..1：落爪深度。 */
  down: number;
}

export function kneadPads(state: KneadState, now: number, face: KneadFace, floorY: number): KneadPad[] {
  const age = Math.max(0, now - state.bornAt) - KNEAD_SETTLE_MS;
  const step = Math.max(1, KNEAD_BEAT_COOLDOWN_MS);
  const r = Math.max(3.4, Math.min(5.2, face.w * 0.1));
  return [-1, 1].map((side, i) => ({
    x: face.cx + side * face.w * 0.2,
    y: floorY - 4,
    r,
    down: 0.5 + 0.5 * Math.sin((age / step) * Math.PI + i * Math.PI),
  }));
}

export function pressKnead(state: KneadState, now: number): boolean {
  if (kneadPhase(state, now) !== "knead") return false;
  if (state.beats >= KNEAD_MAX_BEATS) return false;
  if (state.lastBeatAt >= 0 && now - state.lastBeatAt < KNEAD_BEAT_COOLDOWN_MS) return false;
  state.lastBeatAt = now;
  state.beats += 1;
  return true;
}

export function kneadAtPoint(
  state: KneadState,
  now: number,
  face: KneadFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (kneadPhase(state, now) !== "knead") return false;
  const dx = (x - face.cx) / Math.max(18, face.w * 0.75);
  const dy = (y - (floorY - 3)) / 8;
  return dx * dx + dy * dy <= 1;
}

function heart(cx: number, cy: number, r: number, fill: string): DrawOp {
  return {
    kind: "fillPath",
    fill,
    points: [
      [cx, cy + r * 0.9],
      [cx - r, cy],
      [cx - r * 0.55, cy - r * 0.6],
      [cx, cy - r * 0.15],
      [cx + r * 0.55, cy - r * 0.6],
      [cx + r, cy],
    ],
  };
}

export function buildKneadOps(state: KneadState, now: number, face: KneadFace, floorY: number): DrawOp[] {
  const phase = kneadPhase(state, now);
  if (phase === "gone") return [];
  const age = Math.max(0, now - state.bornAt);
  const alpha = Math.min(1, age / 320) * Math.min(1, (KNEAD_MS - age) / 420);
  const settle = phase === "settle" ? age / KNEAD_SETTLE_MS : 1;
  const ops: DrawOp[] = [];
  // 软垫：奶油底 + 玫瑰沿，先落在桌布上。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.65 * alpha * settle), cx: face.cx, cy: floorY - 1, rx: face.w * 0.82 * settle, ry: 4.4 * settle });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE, 0.45 * alpha), width: 0.8, cx: face.cx, cy: floorY - 1, rx: face.w * 0.82, ry: 4.4 });
  // 两只前爪：奶油肉垫 + 三颗玫瑰豆，按拍子起落。
  for (const pad of kneadPads(state, now, face, floorY)) {
    const lift = pad.down * 2.2;
    const cy = pad.y - 1.6 + lift;
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.96 * alpha), cx: pad.x, cy, rx: pad.r, ry: pad.r * 0.72 });
    for (const [dx, dy] of [[-0.42, -0.1], [0, -0.32], [0.42, -0.1]] as const) {
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.9 * alpha), cx: pad.x + dx * pad.r, cy: cy + dy * pad.r, rx: pad.r * 0.2, ry: pad.r * 0.2 });
    }
    // 落爪的小尘点。
    if (pad.down > 0.72) {
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.55 * alpha), cx: pad.x - pad.r - 2, cy: pad.y + 0.4, rx: 1.1, ry: 0.6 });
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.45 * alpha), cx: pad.x + pad.r + 2, cy: pad.y + 0.4, rx: 1.1, ry: 0.6 });
    }
  }
  // 跟着点出来的心：踩得越快，飘得越高。
  const hearts = Math.min(4, state.beats);
  for (let i = 0; i < hearts; i += 1) {
    const p = ((age / 900 + i * 0.28) % 1);
    const x = face.cx + Math.sin(i * 2.2 + state.seed * 6.28) * face.w * 0.4;
    const y = floorY - 12 - p * face.h * 0.85;
    ops.push(heart(x, y, Math.max(1.8, face.w * 0.045) * (1 - p * 0.3), withAlpha(i % 2 === 0 ? ROSE : ROSE_DEEP, 0.85 * (1 - p) * alpha)));
  }
  // 呼噜的声纹垫在最上面一层，浅浅两道。
  for (let i = 0; i < 2; i += 1) {
    ops.push({
      kind: "strokeEllipse",
      stroke: withAlpha(PAPER, (0.28 - i * 0.08) * alpha),
      width: 0.7,
      cx: face.cx,
      cy: face.bottom + 2 + i * 2.4,
      rx: face.w * (0.42 + i * 0.1),
      ry: 3 + i * 1.2,
    });
  }
  return ops;
}

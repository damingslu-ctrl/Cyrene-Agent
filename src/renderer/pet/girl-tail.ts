/**
 * 追尾巴：她绕着自己转圈追尾巴，尾巴尖按固定轨道甩动——点中尾巴尖算抓一下。
 * 抓满三下再伸手会被自己晃晕；整轮走完才记一次「追尾巴」。
 *
 * 尾巴尖的位置由时刻解析（不存轨迹）：探针、命中、绘制读的是同一拍坐标。
 */
import { PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const TAIL_MS = 5_200;
export const TAIL_WARMUP_MS = 500;
export const TAIL_HIT_COOLDOWN_MS = 320;
export const TAIL_MAX_HITS = 3;
const TAIL_SPIN_MS = 620;

export interface TailFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface TailState {
  bornAt: number;
  seed: number;
  hits: number;
  lastHitAt: number;
}

export type TailPhase = "warmup" | "chase" | "gone";
export type TailChase = "miss" | "hit" | "dizzy";

export function createTail(now: number, seed = Math.random()): TailState {
  return { bornAt: now, seed, hits: 0, lastHitAt: -1 };
}

export function tailPhase(state: TailState, now: number): TailPhase {
  const age = now - state.bornAt;
  if (age < 0 || age < TAIL_WARMUP_MS) return "warmup";
  return age < TAIL_MS ? "chase" : "gone";
}

export function tailAlive(state: TailState, now: number): boolean {
  return tailPhase(state, now) !== "gone";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface TailTip {
  x: number;
  y: number;
  r: number;
  angle: number;
}

export function tailTipAt(state: TailState, now: number, face: TailFace, floorY: number): TailTip {
  const age = Math.max(0, now - state.bornAt);
  const angle = ((age - TAIL_WARMUP_MS) / TAIL_SPIN_MS) * Math.PI * 2 + state.seed * Math.PI * 2;
  const rx = Math.max(14, face.w * 0.6);
  const ry = 7;
  const cx = face.cx + 1;
  const cy = floorY - 8;
  return {
    x: clamp(cx + Math.cos(angle) * rx, 4, 78),
    y: cy + Math.sin(angle) * ry,
    r: Math.max(3, Math.min(5, face.w * 0.075)),
    angle,
  };
}

/** 点中尾巴尖：冷却外计数；已抓满三下再伸手＝把自己晃晕。 */
export function chaseTail(
  state: TailState,
  now: number,
  face: TailFace,
  floorY: number,
  x: number,
  y: number,
): TailChase {
  if (tailPhase(state, now) !== "chase") return "miss";
  const tip = tailTipAt(state, now, face, floorY);
  if (Math.hypot(x - tip.x, y - tip.y) > tip.r + 4) return "miss";
  if (state.lastHitAt >= 0 && now - state.lastHitAt < TAIL_HIT_COOLDOWN_MS) return "miss";
  if (state.hits >= TAIL_MAX_HITS) return "dizzy";
  state.lastHitAt = now;
  state.hits += 1;
  return "hit";
}

function tailPoints(state: TailState, tip: TailTip, face: TailFace, floorY: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const rx = Math.max(14, face.w * 0.6);
  const cx = face.cx + 1;
  for (let i = 0; i <= 5; i += 1) {
    const t = i / 5;
    const a = tip.angle - (1 - t) * 1.9;
    const rr = 3 + (rx - 3) * t;
    const x = cx + Math.cos(a) * rr;
    const y = (floorY - 17) * (1 - t) + (floorY - 8 + Math.sin(a) * 7) * t;
    points.push([x, y]);
  }
  return points;
}

export function buildTailOps(state: TailState, now: number, face: TailFace, floorY: number): DrawOp[] {
  if (tailPhase(state, now) === "gone") return [];
  const tip = tailTipAt(state, now, face, floorY);
  const points = tailPoints(state, tip, face, floorY);
  const age = now - state.bornAt;
  const alpha = Math.min(1, Math.max(0, age / 280)) * Math.min(1, Math.max(0, (TAIL_MS - age) / 380));
  const ops: DrawOp[] = [];
  // 甩尾的风：两道短弧跟着尾巴尖跑。
  for (let i = 0; i < 2; i += 1) {
    const a = tip.angle - 0.5 - i * 0.42;
    const rx = Math.max(12, face.w * 0.45) + i * 4;
    const arc: Array<[number, number]> = [];
    for (let k = 0; k <= 5; k += 1) {
      const ang = a + (k / 5) * 0.55;
      arc.push([face.cx + 1 + Math.cos(ang) * rx, floorY - 12 + Math.sin(ang) * 8]);
    }
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.34 * alpha), width: 0.8, points: arc });
  }
  // 尾巴本体：奶油粗底 + 玫瑰主线（画在桌布上也读得出）。
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 3.6, points });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE, 0.95 * alpha), width: 1.9, points });
  // 尾巴尖：奶油外圈 + 玫瑰内芯 + 一根小丝带。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx: tip.x, cy: tip.y, rx: tip.r * 1.45, ry: tip.r * 1.45 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.98 * alpha), cx: tip.x, cy: tip.y, rx: tip.r, ry: tip.r });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: tip.x - tip.r * 0.3, cy: tip.y - tip.r * 0.3, rx: tip.r * 0.3, ry: tip.r * 0.3 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.9 * alpha), cx: tip.x + tip.r * 1.3, cy: tip.y - tip.r * 0.6, rx: 1.1, ry: 0.9 });
  // 抓住的那一下：尾巴尖弹一颗星。
  if (state.lastHitAt >= 0 && now - state.lastHitAt < 420) {
    const p = (now - state.lastHitAt) / 420;
    const r = 3 + p * 3.4;
    const star: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : r * 0.34;
      star.push([tip.x + Math.cos(ang) * rad, tip.y - 4 + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * (1 - p)), points: star });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * (1 - p)), points: star.map(([x, y]) => [tip.x + (x - tip.x) * 0.6, tip.y - 4 + (y - (tip.y - 4)) * 0.6]) });
  }
  return ops;
}

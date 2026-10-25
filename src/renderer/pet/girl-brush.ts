/**
 * 梳毛：一把小梳子沿着发顶到后背来回刷 6 秒，共四趟；点梳子能加一下「顺毛」，
 * 每一下都冒星与心。点位只由脸框、朝向与趟内相位推，点中判定与画面同一把尺。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";
import { heartWithHalo, sparkleOps } from "./girl-prop-art";

export const BRUSH_MS = 6_000;
export const BRUSH_STROKE_MS = 1_250;
export const BRUSH_MAX_STROKES = 4;
export const BRUSH_BOOST_MS = 700;
export const BRUSH_BOOST_MAX = 3;

export interface BrushFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface BrushState {
  bornAt: number;
  seed: number;
  boosts: number;
  boostAt: number;
  boostX: number;
  boostY: number;
}

export interface BrushSweep {
  x: number;
  y: number;
  /** -1..1，0 = 在发顶，1 = 刷到后背。 */
  s: number;
  stroke: number;
}

export function createBrush(now: number, seed = Math.random()): BrushState {
  return { bornAt: now, seed, boosts: 0, boostAt: -1, boostX: 0, boostY: 0 };
}

export function brushAlive(state: BrushState, now: number): boolean {
  return now - state.bornAt < BRUSH_MS;
}

/** 已经刷完几趟（0..4）；六秒里正好四趟。 */
export function brushStrokes(state: BrushState, now: number): number {
  const age = Math.max(0, Math.min(BRUSH_MS - 1, now - state.bornAt));
  return Math.min(BRUSH_MAX_STROKES, Math.floor(age / BRUSH_STROKE_MS));
}

export function brushSweep(
  state: BrushState,
  now: number,
  face: BrushFace,
  facing: 1 | -1,
  floorY: number,
): BrushSweep {
  const age = Math.max(0, now - state.bornAt);
  const stroke = Math.min(BRUSH_MAX_STROKES - 1, Math.floor(age / BRUSH_STROKE_MS));
  const p = (age % BRUSH_STROKE_MS) / BRUSH_STROKE_MS;
  const s = 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  const headX = face.cx - facing * face.w * 0.12;
  const headY = face.top + face.h * 0.18;
  const backX = face.cx - facing * face.w * 0.3;
  const backY = face.bottom + Math.max(6, (floorY - face.bottom) * 0.45);
  const wobble = Math.sin(age / 95 + state.seed * 6) * 0.7;
  return {
    x: headX + (backX - headX) * s + wobble,
    y: headY + (backY - headY) * s,
    s,
    stroke,
  };
}

export function brushHitRadius(face: BrushFace): number {
  return Math.max(7, face.w * 0.26);
}

export function brushAt(
  state: BrushState,
  now: number,
  face: BrushFace,
  facing: 1 | -1,
  floorY: number,
  x: number,
  y: number,
): boolean {
  const sweep = brushSweep(state, now, face, facing, floorY);
  return Math.hypot(x - sweep.x, y - sweep.y) <= brushHitRadius(face);
}

/** 点中梳子：记一次顺毛（每局最多三下），返回是否真的记上了。 */
export function boostBrush(state: BrushState, now: number, x: number, y: number): boolean {
  if (!brushAlive(state, now) || state.boosts >= BRUSH_BOOST_MAX) return false;
  state.boosts += 1;
  state.boostAt = now;
  state.boostX = x;
  state.boostY = y;
  return true;
}

function rotate(points: Array<[number, number]>, cx: number, cy: number, ang: number): Array<[number, number]> {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return points.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export function buildBrushOps(
  state: BrushState,
  now: number,
  face: BrushFace,
  facing: 1 | -1,
  floorY: number,
): DrawOp[] {
  if (!brushAlive(state, now)) return [];
  const sweep = brushSweep(state, now, face, facing, floorY);
  const fadeIn = Math.min(1, (now - state.bornAt) / 260);
  const fadeOut = Math.min(1, (BRUSH_MS - (now - state.bornAt)) / 320);
  const alpha = fadeIn * fadeOut;
  const r = Math.max(3.6, face.w * 0.13);
  const ang = facing * (0.55 - sweep.s * 0.35);
  const ops: DrawOp[] = [];
  // 梳柄：奶油垫底 + 玫瑰细线，从右上角伸进来。
  const handle: Array<[number, number]> = [
    [sweep.x + facing * 1.5, sweep.y - 2.5],
    [sweep.x + facing * 13, sweep.y - 15],
  ];
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.92 * alpha), width: 2.8, points: handle });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.9 * alpha), width: 1.1, points: handle });
  // 梳头：一块奶油小板，绒毛在下面
  const head: Array<[number, number]> = rotate([
    [-r, -r * 0.55], [r, -r * 0.55], [r, r * 0.45], [-r, r * 0.45],
  ], sweep.x, sweep.y, ang);
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.98 * alpha), points: head });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.75 * alpha), width: 0.7, points: head, close: true });
  for (let i = -2; i <= 2; i += 1) {
    const bx = sweep.x + i * r * 0.36;
    const by = sweep.y + r * 0.45;
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(ROSE_DEEP, 0.85 * alpha),
      width: 0.7,
      points: rotate([[bx, by], [bx + facing * 0.6, by + 2.2]], sweep.x, sweep.y, ang),
    });
  }
  // 星星跟手走：三颗不同相位，像梳下来的光。
  for (let i = 0; i < 3; i += 1) {
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(now / 170 + i * 2.1 + state.seed));
    const sx = sweep.x + (i - 1) * r * 1.5 + Math.sin(now / 210 + i) * 1.6;
    const sy = sweep.y - 2 - i * 1.8 + Math.cos(now / 190 + i * 1.3) * 1.2;
    ops.push(...sparkleOps(sx, sy, Math.max(1.1, r * 0.3), withAlpha(PAPER, 0.9 * alpha * tw), withAlpha(ROSE, 0.95 * alpha * tw)));
  }
  // 顺毛一下：点击处冒三颗心 + 一圈星，700ms 消失。
  if (state.boostAt >= 0 && now - state.boostAt <= BRUSH_BOOST_MS) {
    const p = (now - state.boostAt) / BRUSH_BOOST_MS;
    for (let i = 0; i < 3; i += 1) {
      const hx = state.boostX + (i - 1) * 4 + Math.sin(i * 2.3) * 1.5;
      const hy = state.boostY - 3 - p * (9 + i * 3);
      ops.push(...heartWithHalo(hx, hy, Math.max(1.6, r * 0.36) * (1 - p * 0.35), withAlpha(ROSE, 0.95 * (1 - p)), withAlpha(PAPER, 0.9 * (1 - p))));
    }
    for (let i = 0; i < 4; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      const rr = r * (1 + p * 2.4);
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(PAPER, 0.85 * (1 - p)),
        width: 1,
        points: [
          [state.boostX + Math.cos(a) * rr * 0.6, state.boostY + Math.sin(a) * rr * 0.6],
          [state.boostX + Math.cos(a) * rr, state.boostY + Math.sin(a) * rr],
        ],
      });
    }
  }
  return ops;
}

/**
 * 纸飞机：一架奶油纸飞机从窗的一侧滑到另一侧（5.6s），点中就算接住——
 * 它会打着旋落到她脚边。轨迹、朝向与落点都由出生时刻解析，点中只记一拍。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";
import { heartWithHalo, sparkleOps } from "./girl-prop-art";

export const PLANE_MS = 7_000;
export const PLANE_CATCH_MS = 900;
export const PLANE_FLIGHT_MS = 5_600;

export interface PlaneFace {
  cx: number;
  top: number;
  w: number;
}

export interface PlaneState {
  bornAt: number;
  seed: number;
  dir: 1 | -1;
  caughtAt: number;
  catchX: number;
  catchY: number;
}

export interface PlanePos {
  x: number;
  y: number;
  rot: number;
  /** 飞行进度 0..1（扑中后冻结在扑中那一拍）。 */
  p: number;
}

export function createPlane(now: number, facing: 1 | -1 = 1, seed = Math.random()): PlaneState {
  return { bornAt: now, seed, dir: facing, caughtAt: -1, catchX: 0, catchY: 0 };
}

function easeIn(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return p * p;
}

export function planeAt(state: PlaneState, now: number, face: PlaneFace, floorY: number): PlanePos {
  const clampNow = state.caughtAt >= 0 ? state.caughtAt : now;
  const age = Math.max(0, clampNow - state.bornAt);
  const p = Math.max(0, Math.min(1, age / PLANE_FLIGHT_MS));
  const phase = state.seed * Math.PI * 2;
  const x = state.dir > 0 ? -10 + p * 102 : 92 - p * 102;
  const baseY = Math.max(14, face.top - 10);
  const y = Math.max(6, baseY + Math.sin(p * Math.PI * 2 + phase) * 5);
  const rot = state.dir * 0.26 + Math.cos(p * Math.PI * 2 + phase) * 0.16;
  if (state.caughtAt < 0) return { x, y, rot, p };
  const t = easeIn((now - state.caughtAt) / PLANE_CATCH_MS);
  return {
    x: state.catchX + (face.cx - state.dir * 4 - state.catchX) * t,
    y: state.catchY + (floorY - 8 - state.catchY) * t - Math.sin(t * Math.PI) * 6,
    rot: rot + t * Math.PI * 2.6,
    p,
  };
}

export function planeAlive(state: PlaneState, now: number): boolean {
  if (state.caughtAt >= 0) return now - state.caughtAt <= PLANE_CATCH_MS;
  return now - state.bornAt < PLANE_MS;
}

export function planeHitRadius(face: PlaneFace): number {
  return Math.max(7, face.w * 0.24);
}

export function planeAtPoint(
  state: PlaneState,
  now: number,
  face: PlaneFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (state.caughtAt >= 0) return false;
  const pos = planeAt(state, now, face, floorY);
  if (pos.p > 0.985) return false;
  return Math.hypot(x - pos.x, y - pos.y) <= planeHitRadius(face);
}

export function catchPlane(state: PlaneState, now: number, face: PlaneFace, floorY: number): boolean {
  if (state.caughtAt >= 0) return false;
  const pos = planeAt(state, now, face, floorY);
  state.caughtAt = now;
  state.catchX = pos.x;
  state.catchY = pos.y;
  return true;
}

function rotate(points: Array<[number, number]>, cx: number, cy: number, ang: number): Array<[number, number]> {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return points.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export function buildPlaneOps(state: PlaneState, now: number, face: PlaneFace, floorY: number): DrawOp[] {
  if (!planeAlive(state, now)) return [];
  const pos = planeAt(state, now, face, floorY);
  const fadeIn = Math.min(1, (now - state.bornAt) / 240);
  const fade = state.caughtAt >= 0 ? 1 - Math.max(0, now - state.caughtAt) / PLANE_CATCH_MS : fadeIn;
  const alpha = Math.max(0, fade);
  const k = Math.max(0.8, face.w * 0.045);
  const ops: DrawOp[] = [];
  // 航迹：三截越来越淡的短线
  if (state.caughtAt < 0) {
    for (let i = 3; i >= 1; i -= 1) {
      const t = planeAt(state, now - i * 55, face, floorY);
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(PAPER, 0.4 - i * 0.09),
        width: 1,
        points: [
          [t.x + state.dir * (i * 2.2), t.y + Math.sin(i) * 1.1],
          [t.x + state.dir * (i * 2.2 + 2.4), t.y + Math.sin(i + 0.4) * 1.1],
        ],
      });
    }
  }
  // 机身：两片纸翼，奶油打底、玫瑰描折线
  const nose: Array<[number, number]> = [[state.dir * 7 * k, 0], [-state.dir * 4.6 * k, -3.6 * k], [-state.dir * 1.6 * k, 0], [-state.dir * 4.6 * k, 3.4 * k]];
  const wing: Array<[number, number]> = [[state.dir * 7 * k, 0], [-state.dir * 1.6 * k, 0], [-state.dir * 4.2 * k, -5.4 * k]];
  const noseR = rotate(nose, pos.x, pos.y, pos.rot);
  const wingR = rotate(wing, pos.x, pos.y, pos.rot);
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.98 * alpha), points: noseR });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER_SHADE, 0.95 * alpha), points: wingR });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.8 * alpha), width: 0.7, points: noseR, close: true });
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(ROSE_DEEP, 0.7 * alpha),
    width: 0.6,
    points: rotate([[state.dir * 7 * k, 0], [-state.dir * 4.4 * k, 0]], pos.x, pos.y, pos.rot),
  });
  // 机头一点玫瑰，和逗猫棒的羽毛同一个色点
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.9 * alpha), cx: pos.x + Math.cos(pos.rot) * state.dir * 6.6 * k, cy: pos.y + Math.sin(pos.rot) * state.dir * 6.6 * k, rx: 0.9 * k, ry: 0.9 * k });
  if (state.caughtAt >= 0) {
    const t = Math.max(0, Math.min(1, (now - state.caughtAt) / PLANE_CATCH_MS));
    for (let i = 0; i < 5; i += 1) {
      const a = (i * Math.PI * 2) / 5 + pos.rot;
      const rr = 5 + t * 12;
      ops.push(...sparkleOps(pos.x + Math.cos(a) * rr, pos.y + Math.sin(a) * rr, 1.6 * (1 - t * 0.6), withAlpha(PAPER, 0.9 * (1 - t)), withAlpha(ROSE, 0.95 * (1 - t))));
    }
    ops.push(...heartWithHalo(face.cx, floorY - 18 - t * 8, 2.4, withAlpha(ROSE, 0.95 * (1 - t)), withAlpha(PAPER, 0.9 * (1 - t))));
  }
  return ops;
}

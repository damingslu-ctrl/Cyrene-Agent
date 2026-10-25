/**
 * 激光笔：墙上一颗红点按李萨如曲线在脸周围游走 8 秒。
 * 点中红点＝扑到，红点冻在原地炸一圈；轨迹与落点全部由出生时刻解析，帧率不影响走位。
 */
import { PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const LASER_MS = 8_000;
export const LASER_CATCH_MS = 700;

export interface LaserFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
}

export interface LaserBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LaserState {
  bornAt: number;
  seed: number;
  /** 扑中的时刻；-1 = 还在跑。 */
  caughtAt: number;
}

export function createLaser(now: number, seed = Math.random()): LaserState {
  return { bornAt: now, seed, caughtAt: -1 };
}

/** 红点活动的矩形：横向不出脸两侧太多，纵向从发顶到脚边上方。 */
export function laserBoundsFor(face: LaserFace, floorY: number): LaserBounds {
  const halfX = Math.max(16, Math.min(30, face.w * 0.95));
  return {
    x0: face.cx - halfX,
    y0: Math.max(5, face.top - 8),
    x1: face.cx + halfX,
    y1: Math.max(face.top + 8, floorY - 5),
  };
}

/** 红点位置。扑中后冻结在扑中的那一拍，炸环不会跟着轨迹继续跑。 */
export function laserAt(state: LaserState, now: number, bounds: LaserBounds): { x: number; y: number } {
  const t = (Math.max(0, (state.caughtAt >= 0 ? state.caughtAt : now) - state.bornAt)) / 1000;
  const phase = state.seed * Math.PI * 2;
  const u = 0.5 + 0.44 * Math.sin(t * 1.9 + phase);
  const v = 0.5 + 0.4 * Math.sin(t * 2.7 + phase * 1.7);
  return {
    x: bounds.x0 + Math.max(0, Math.min(1, u)) * (bounds.x1 - bounds.x0),
    y: bounds.y0 + Math.max(0, Math.min(1, v)) * (bounds.y1 - bounds.y0),
  };
}

export function laserAlive(state: LaserState, now: number): boolean {
  if (state.caughtAt >= 0) return now - state.caughtAt <= LASER_CATCH_MS;
  return now - state.bornAt < LASER_MS;
}

export function laserHitRadius(face: LaserFace): number {
  return Math.max(6, face.w * 0.2);
}

export function laserAtPoint(
  state: LaserState,
  now: number,
  bounds: LaserBounds,
  face: LaserFace,
  x: number,
  y: number,
): boolean {
  if (state.caughtAt >= 0) return false;
  const dot = laserAt(state, now, bounds);
  return Math.hypot(x - dot.x, y - dot.y) <= laserHitRadius(face);
}

export function catchLaser(state: LaserState, now: number): void {
  if (state.caughtAt < 0) state.caughtAt = now;
}

function dotOps(x: number, y: number, r: number, alpha: number): DrawOp[] {
  return [
    // 奶油光晕：深色桌布上红点会糊掉，先给一圈纸色。
    { kind: "fillEllipse", fill: withAlpha(PAPER, 0.5 * alpha), cx: x, cy: y, rx: r * 1.55, ry: r * 1.55 },
    { kind: "fillEllipse", fill: withAlpha(ROSE, 0.75 * alpha), cx: x, cy: y, rx: r, ry: r },
    { kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.98 * alpha), cx: x, cy: y, rx: r * 0.56, ry: r * 0.56 },
  ];
}

export function buildLaserOps(state: LaserState, now: number, face: LaserFace, floorY: number): DrawOp[] {
  const bounds = laserBoundsFor(face, floorY);
  const pos = laserAt(state, now, bounds);
  const r = Math.max(2.2, face.w * 0.075);
  const ops: DrawOp[] = [];
  // 轨迹：过去三拍各留一颗小点，越远越淡。
  if (state.caughtAt < 0) {
    for (let i = 3; i >= 1; i -= 1) {
      const trail = laserAt(state, now - i * 45, bounds);
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.3 - i * 0.045), cx: trail.x, cy: trail.y, rx: r * 0.55, ry: r * 0.55 });
    }
  }
  ops.push(...dotOps(pos.x, pos.y, r, 1));
  // 四道旋转的短光：红点不是死圆，像一束正在晃的激光。
  const spin = now / 240;
  for (let i = 0; i < 4; i += 1) {
    const a = spin + (i * Math.PI) / 2;
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(PAPER, 0.7),
      width: 0.8,
      points: [
        [pos.x + Math.cos(a) * r * 1.5, pos.y + Math.sin(a) * r * 1.5],
        [pos.x + Math.cos(a) * r * 2.3, pos.y + Math.sin(a) * r * 2.3],
      ],
    });
  }
  if (state.caughtAt >= 0) {
    const p = Math.max(0, Math.min(1, (now - state.caughtAt) / LASER_CATCH_MS));
    for (let i = 0; i < 2; i += 1) {
      const rr = r * (1.4 + p * 3.4) + i * 2.2;
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(i === 0 ? PAPER : ROSE, 0.9 * (1 - p)), width: 1.2, cx: pos.x, cy: pos.y, rx: rr, ry: rr * 0.82 });
    }
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3;
      const rr = r * (1 + p * 3);
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(PAPER, 0.95 * (1 - p)),
        width: 1.1,
        points: [
          [pos.x + Math.cos(a) * rr * 0.7, pos.y + Math.sin(a) * rr * 0.7],
          [pos.x + Math.cos(a) * rr * 1.4, pos.y + Math.sin(a) * rr * 1.4],
        ],
      });
    }
  }
  return ops;
}

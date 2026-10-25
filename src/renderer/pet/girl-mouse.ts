/**
 * 发条老鼠：一只上着发条的小老鼠在脚边来回窜 6.4 秒，点中＝按住它的背。
 * 抓住后老鼠被拎起来 800ms 再收走；抓没抓中、什么时候抓，全部由时刻解析。
 */
import { EYE, INK_SOFT, PAPER, ROSE, ROSE_DEEP, PAPER_SHADE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const MOUSE_MS = 6_400;
export const MOUSE_CATCH_MS = 800;

export interface MouseFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface MouseState {
  bornAt: number;
  seed: number;
  /** 按住的时刻；-1 = 还在跑。 */
  caughtAt: number;
  /** 按住那一拍的位置：抓住后不再跟着轨迹跑。 */
  caughtX: number;
  caughtY: number;
}

export function createMouse(now: number, seed = Math.random()): MouseState {
  return { bornAt: now, seed, caughtAt: -1, caughtX: 0, caughtY: 0 };
}

export function mouseAlive(state: MouseState, now: number): boolean {
  const age = now - state.bornAt;
  if (age < 0) return false;
  if (state.caughtAt >= 0) return now - state.caughtAt <= MOUSE_CATCH_MS;
  return age < MOUSE_MS;
}

export function mouseRadius(face: MouseFace): number {
  return Math.max(5, Math.min(8, face.w * 0.14));
}

/** 没过肩的小碎步：1.5s 一个来回，贴着地面跑；每趟方向由正弦符号给。 */
export function mouseAt(
  state: MouseState,
  now: number,
  face: MouseFace,
  floorY: number,
): { x: number; y: number; dir: 1 | -1 } {
  if (state.caughtAt >= 0) {
    const lift = Math.min(10, (now - state.caughtAt) * 0.03);
    return { x: state.caughtX, y: state.caughtY - lift, dir: 1 };
  }
  const t = Math.max(0, now - state.bornAt) / 1000;
  const range = Math.max(18, Math.min(34, face.w * 0.72));
  const phase = t * 2.1 + state.seed * Math.PI * 2;
  const swing = Math.sin(phase);
  const dir: 1 | -1 = Math.cos(phase) >= 0 ? 1 : -1;
  return {
    x: face.cx + swing * range,
    y: floorY - 3.6 - Math.abs(Math.sin(t * 8.4 + state.seed * 3)) * 1.6,
    dir,
  };
}

export function mouseAtPoint(
  state: MouseState,
  now: number,
  face: MouseFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (!mouseAlive(state, now)) return false;
  const pos = mouseAt(state, now, face, floorY);
  return Math.hypot(x - pos.x, y - pos.y) <= mouseRadius(face) + 2.5;
}

/** 按住：第一次有效；已经抓住的再点不算。 */
export function catchMouse(state: MouseState, now: number, face: MouseFace, floorY: number): boolean {
  if (!mouseAlive(state, now) || state.caughtAt >= 0) return false;
  const pos = mouseAt(state, now, face, floorY);
  state.caughtAt = now;
  state.caughtX = pos.x;
  state.caughtY = pos.y;
  return true;
}

export function buildMouseOps(
  state: MouseState,
  now: number,
  face: MouseFace,
  floorY: number,
): DrawOp[] {
  if (!mouseAlive(state, now)) return [];
  const pos = mouseAt(state, now, face, floorY);
  const r = mouseRadius(face);
  const age = now - state.bornAt;
  const fade = state.caughtAt >= 0
    ? Math.max(0, 1 - Math.max(0, now - state.caughtAt - 500) / (MOUSE_CATCH_MS - 500))
    : Math.min(1, Math.max(0, age / 220)) * Math.min(1, Math.max(0, (MOUSE_MS - age) / 320));
  const caught = state.caughtAt >= 0;
  const ops: DrawOp[] = [];
  // 影子只在没被拎起来时贴着地。
  if (!caught) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.16 * fade), cx: pos.x, cy: floorY + 1, rx: r * 1.1, ry: 1.5 });
  }
  // 尾巴：朝身后拖一条折线。
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(ROSE_DEEP, 0.9 * fade),
    width: 0.9,
    points: [
      [pos.x - pos.dir * r * 0.8, pos.y + r * 0.2],
      [pos.x - pos.dir * r * 1.5, pos.y + r * 0.5],
      [pos.x - pos.dir * r * 1.9, pos.y + r * 0.1],
      [pos.x - pos.dir * r * 2.2, pos.y + r * 0.55],
    ],
  });
  // 身体：奶油椭圆，头朝行进方向。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * fade), cx: pos.x, cy: pos.y, rx: r * 1.2, ry: r * 0.82 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * fade), cx: pos.x + pos.dir * r * 0.9, cy: pos.y - r * 0.18, rx: r * 0.62, ry: r * 0.55 });
  // 耳朵。
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95 * fade), cx: pos.x + pos.dir * r * 1.05, cy: pos.y - r * 0.72, rx: r * 0.34, ry: r * 0.3 });
  // 眼睛与鼻头。
  ops.push({ kind: "fillEllipse", fill: withAlpha(EYE, 0.95 * fade), cx: pos.x + pos.dir * r * 1.05, cy: pos.y - r * 0.2, rx: 0.75, ry: 0.75 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95 * fade), cx: pos.x + pos.dir * r * 1.45, cy: pos.y + r * 0.06, rx: 0.6, ry: 0.5 });
  // 背上的发条：一根轴 + 一个环。
  ops.push({ kind: "strokePath", stroke: withAlpha(INK_SOFT, 0.9 * fade), width: 0.8, points: [[pos.x - pos.dir * r * 0.2, pos.y - r * 0.55], [pos.x - pos.dir * r * 0.2, pos.y - r * 1.05]] });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER_SHADE, 0.95 * fade), width: 0.9, cx: pos.x - pos.dir * r * 0.2, cy: pos.y - r * 1.25, rx: r * 0.3, ry: r * 0.22 });
  // 小轮子。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.9 * fade), cx: pos.x + pos.dir * r * 0.45, cy: pos.y + r * 0.62, rx: r * 0.22, ry: r * 0.22 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.9 * fade), cx: pos.x - pos.dir * r * 0.5, cy: pos.y + r * 0.62, rx: r * 0.22, ry: r * 0.22 });
  // 跑动的短线：没抓住时在身后留两道。
  if (!caught) {
    for (let i = 1; i <= 2; i += 1) {
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(PAPER_SHADE, (0.55 - i * 0.16) * fade),
        width: 0.7,
        points: [
          [pos.x - pos.dir * (r * 1.3 + i * 2.4), pos.y + r * 0.1],
          [pos.x - pos.dir * (r * 1.3 + i * 2.4), pos.y + r * 0.6],
        ],
      });
    }
  } else {
    // 被拎起来：一圈奶油光环 + 玫瑰星，双色压住深桌布。
    const p = Math.max(0, Math.min(1, (now - state.caughtAt) / MOUSE_CATCH_MS));
    for (let i = 0; i < 2; i += 1) {
      const rr = r * (1.4 + p * 2.8) + i * 2;
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(i === 0 ? PAPER : ROSE, 0.9 * (1 - p)), width: 1.2, cx: pos.x, cy: pos.y, rx: rr, ry: rr * 0.7 });
    }
    const star: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r * 0.9 : r * 0.32;
      star.push([pos.x + Math.cos(ang) * rad, pos.y - r * 1.4 + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * (1 - p)), points: star.map(([x, y]) => [pos.x + (x - pos.x) * 1.4, pos.y - r * 1.4 + (y - (pos.y - r * 1.4)) * 1.4]) });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * (1 - p)), points: star });
  }
  return ops;
}

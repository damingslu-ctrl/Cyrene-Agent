/**
 * 铃铛球：一颗带铃铛的小球在脚边滚来滚去，她隔一会儿扒拉一下。
 * 点中球＝摇铃，铃铛响一声、球弹一下；整轮 5.6 秒后自己滚走。
 *
 * 球位是解析量（正弦滚动），命中与绘制读同一拍坐标；铃声环只在最近 650ms 内画。
 */
import { INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BELL_MS = 5_600;
export const BELL_RING_MS = 650;
export const BELL_RING_COOLDOWN_MS = 360;
/** 一轮里最多记五次摇铃：再点只响不计数，免得刷成就。 */
export const BELL_MAX_RINGS = 5;

export interface BellFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface BellState {
  bornAt: number;
  seed: number;
  rings: number;
  ringAt: number;
  lastRingAt: number;
}

export function createBell(now: number, seed = Math.random()): BellState {
  return { bornAt: now, seed, rings: 0, ringAt: -1, lastRingAt: -1 };
}

export function bellAlive(state: BellState, now: number): boolean {
  return now - state.bornAt >= 0 && now - state.bornAt < BELL_MS;
}

export function bellRadius(face: BellFace): number {
  return Math.max(4.2, Math.min(7, face.w * 0.12));
}

/** 球在脚边小幅滚动：横向正弦 + 一点弹跳；不让它跑出脸宽范围。 */
export function bellAt(
  state: BellState,
  now: number,
  face: BellFace,
  floorY: number,
): { x: number; y: number } {
  const t = Math.max(0, now - state.bornAt) / 1000;
  const range = Math.max(12, Math.min(26, face.w * 0.42));
  const x = face.cx + Math.sin(t * 1.7 + state.seed * Math.PI * 2) * range;
  const r = bellRadius(face);
  const bounce = Math.abs(Math.sin(t * 4.2 + state.seed * 2.1)) * 2.2;
  return { x, y: floorY - r - 1 - bounce };
}

export function bellAtPoint(
  state: BellState,
  now: number,
  face: BellFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (!bellAlive(state, now)) return false;
  const pos = bellAt(state, now, face, floorY);
  return Math.hypot(x - pos.x, y - pos.y) <= bellRadius(face) + 3;
}

/** 摇铃：冷却外成功；超过五声只返回 true 但不加计数（手感不断）。 */
export function ringBell(state: BellState, now: number): boolean {
  if (!bellAlive(state, now)) return false;
  if (state.lastRingAt >= 0 && now - state.lastRingAt < BELL_RING_COOLDOWN_MS) return false;
  state.lastRingAt = now;
  state.ringAt = now;
  if (state.rings < BELL_MAX_RINGS) state.rings += 1;
  return true;
}

export function buildBellOps(
  state: BellState,
  now: number,
  face: BellFace,
  floorY: number,
): DrawOp[] {
  if (!bellAlive(state, now)) return [];
  const pos = bellAt(state, now, face, floorY);
  const r = bellRadius(face);
  const age = now - state.bornAt;
  const fadeIn = Math.min(1, Math.max(0, age / 260));
  const fadeOut = Math.min(1, Math.max(0, (BELL_MS - age) / 420));
  const a = Math.min(fadeIn, fadeOut);
  const ops: DrawOp[] = [];
  // 影子先落地。
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.16 * a), cx: pos.x, cy: floorY + 1.2, rx: r * 0.95, ry: 1.7 });
  // 球身：奶油底 + 玫瑰色纬带；深桌布上靠奶油托住。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * a), cx: pos.x, cy: pos.y, rx: r, ry: r });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.9 * a), points: [
    [pos.x - r * 0.96, pos.y - r * 0.2],
    [pos.x + r * 0.96, pos.y - r * 0.2],
    [pos.x + r * 0.8, pos.y + r * 0.28],
    [pos.x - r * 0.8, pos.y + r * 0.28],
  ] });
  // 铃铛：球心一枚小圆 + 一道缝。
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.98 * a), cx: pos.x, cy: pos.y + r * 0.1, rx: r * 0.34, ry: r * 0.34 });
  ops.push({ kind: "strokePath", stroke: withAlpha(INK, 0.7 * a), width: 0.6, points: [[pos.x, pos.y + r * 0.02], [pos.x, pos.y + r * 0.34]] });
  // 高光。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85 * a), cx: pos.x - r * 0.36, cy: pos.y - r * 0.42, rx: r * 0.22, ry: r * 0.16 });
  // 滚动残影：往后两拍的小点。
  for (let i = 1; i <= 2; i += 1) {
    const trail = bellAt(state, now - i * 70, face, floorY);
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, (0.28 - i * 0.09) * a), cx: trail.x, cy: trail.y + r * 0.2, rx: r * 0.28, ry: r * 0.2 });
  }
  // 铃声：两圈弧 + 一颗星，双色叠（深桌布也读得出）。
  if (state.ringAt >= 0 && now - state.ringAt < BELL_RING_MS) {
    const p = (now - state.ringAt) / BELL_RING_MS;
    for (let i = 0; i < 2; i += 1) {
      const rr = r * (1.5 + p * 2.6) + i * 2;
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.85 * (1 - p)), width: 1.4, cx: pos.x, cy: pos.y - r * 0.2, rx: rr, ry: rr * 0.75 });
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE_DEEP, 0.55 * (1 - p)), width: 0.7, cx: pos.x, cy: pos.y - r * 0.2, rx: rr, ry: rr * 0.75 });
    }
    const cx = pos.x + r * 1.4;
    const cy = pos.y - r * 1.9;
    const starR = Math.max(2, r * 0.55);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? starR * (1 + p * 0.5) : starR * 0.36;
      points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * (1 - p)), points: points.map(([px, py]) => [cx + (px - cx) * 1.7, cy + (py - cy) * 1.7]) });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * (1 - p)), points });
  }
  return ops;
}

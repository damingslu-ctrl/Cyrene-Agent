/**
 * 逗猫棒：一根从窗顶垂下来的羽毛，绕着她的脸慢慢摆 7 秒。
 *
 * 位置全部由「出生时刻 + 种子」解析出来，没有逐帧可变物理——点中只记一个 caughtAt，
 * 这样渲染、诊断、探针看到的是同一个落点，窗口搬动也不会把羽毛留在旧坐标。
 */
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const WAND_MS = 7_000;
export const WAND_CATCH_MS = 520;

export interface WandFace {
  cx: number;
  top: number;
  w: number;
  h: number;
}

export interface WandState {
  bornAt: number;
  caughtAt: number;
  seed: number;
}

export function createWand(now: number, seed = Math.random()): WandState {
  return { bornAt: now, caughtAt: -1, seed };
}

export function wandAlive(state: WandState, now: number): boolean {
  if (state.caughtAt >= 0) return now - state.caughtAt <= WAND_CATCH_MS;
  return now - state.bornAt < WAND_MS;
}

/** 羽毛尖端（绘制空间）。摆动幅度跟脸宽走，小档/大档都不出窗。 */
export function wandTip(state: WandState, now: number, face: WandFace, facing: 1 | -1): { x: number; y: number } {
  const age = Math.max(0, now - state.bornAt) / 1000;
  const phase = state.seed * Math.PI * 2;
  const swing = Math.sin(age * 2.3 + phase);
  const x = face.cx + facing * face.w * 0.22 + swing * face.w * 0.62;
  const y = face.top - face.h * 0.5 + Math.cos(age * 1.7 + phase) * face.h * 0.1;
  return {
    x: Math.max(face.cx - face.w * 0.95, Math.min(face.cx + face.w * 0.95, x)),
    y: Math.max(2, y),
  };
}

export function wandHitRadius(face: WandFace): number {
  return Math.max(6, face.w * 0.34);
}

export function wandAt(
  state: WandState,
  now: number,
  face: WandFace,
  facing: 1 | -1,
  x: number,
  y: number,
): boolean {
  if (state.caughtAt >= 0) return false;
  const tip = wandTip(state, now, face, facing);
  return Math.hypot(x - tip.x, y - tip.y) <= wandHitRadius(face);
}

export function catchWand(state: WandState, now: number): void {
  if (state.caughtAt < 0) state.caughtAt = now;
}

function rotate(points: Array<[number, number]>, cx: number, cy: number, ang: number): Array<[number, number]> {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return points.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function scale(points: Array<[number, number]>, cx: number, cy: number, k: number): Array<[number, number]> {
  return points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

function featherOps(x: number, y: number, r: number, ang: number, alpha: number): DrawOp[] {
  const leaf: Array<[number, number]> = [
    [0, -r * 0.25], [r * 0.5, -r * 0.85], [r * 1.05, -r * 0.55],
    [r * 0.92, r * 0.2], [r * 0.3, r * 0.42], [-r * 0.08, r * 0.1],
  ];
  const body = rotate(leaf, x, y, ang);
  const ops: DrawOp[] = [];
  // 奶油光边：羽毛先落在桌布上，再压玫瑰——深色桌布也读得出一片羽。
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.94 * alpha), points: scale(body, x, y, 1.55) });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE_DEEP, 0.95 * alpha), points: body });
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(PAPER, 0.88 * alpha),
    width: Math.max(0.7, r * 0.16),
    points: rotate([[x - r * 0.05, y - r * 0.2], [x + r * 0.55, y - r * 0.5], [x + r * 0.82, y - r * 0.3]], x, y, ang),
  });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.9 * alpha), cx: x + r * 0.28, cy: y - r * 0.28, rx: r * 0.22, ry: r * 0.16, rot: ang });
  return ops;
}

export function buildWandOps(state: WandState, now: number, face: WandFace, facing: 1 | -1): DrawOp[] {
  const tip = wandTip(state, now, face, facing);
  const r = Math.max(3.4, face.w * 0.2);
  const age = (now - state.bornAt) / 1000;
  const ang = Math.sin(age * 2.3 + state.seed * Math.PI * 2) * 0.5;
  // 线从窗顶外垂进来：起点故意高出画布，视觉上就是「有人在上头拎着」。
  const handleX = tip.x - facing * r * 0.9;
  const ops: DrawOp[] = [
    { kind: "strokePath", stroke: withAlpha(PAPER, 0.9), width: 2.1, points: [[handleX, -6], [tip.x, tip.y - r * 0.45]] },
    { kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.85), width: 0.9, points: [[handleX, -6], [tip.x, tip.y - r * 0.45]] },
  ];
  const fade = state.caughtAt >= 0 ? Math.max(0, 1 - (now - state.caughtAt) / WAND_CATCH_MS) : 1;
  ops.push(...featherOps(tip.x, tip.y, r, ang, fade));
  // 羽毛眼 + 小铃铛
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * fade), cx: tip.x - r * 0.1, cy: tip.y + r * 0.1, rx: r * 0.2, ry: r * 0.2 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.95 * fade), cx: tip.x - r * 0.1, cy: tip.y + r * 0.1, rx: r * 0.1, ry: r * 0.1 });
  if (state.caughtAt >= 0) {
    // 捉住了：四道短线炸开，和捉虫的闪光同一语义。
    const p = (now - state.caughtAt) / WAND_CATCH_MS;
    const rr = r * (0.8 + p * 1.8);
    for (let i = 0; i < 4; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(PAPER, 0.9 * (1 - p)),
        width: 1.4,
        points: [
          [tip.x + Math.cos(a) * rr * 0.55, tip.y + Math.sin(a) * rr * 0.55],
          [tip.x + Math.cos(a) * rr, tip.y + Math.sin(a) * rr],
        ],
      });
    }
  }
  return ops;
}

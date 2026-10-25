/**
 * 撒一把落叶：七片叶子从头顶打着旋儿落到脚边，5.6 秒收场。
 * 纯观众型玩具，不接点击——她抬手一扬，剩下的交给风。
 */
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const LEAVES_MS = 5_600;
export const LEAF_COUNT = 7;

export interface LeafFace {
  cx: number;
  top: number;
  w: number;
  h: number;
}

interface Leaf {
  x0: number;
  delay: number;
  fallMs: number;
  size: number;
  phase: number;
  tone: 0 | 1;
}

export interface LeafState {
  bornAt: number;
  leaves: Leaf[];
}

export function createLeaves(now: number, face: LeafFace, rand = Math.random): LeafState {
  const leaves: Leaf[] = [];
  for (let i = 0; i < LEAF_COUNT; i += 1) {
    const t = i / (LEAF_COUNT - 1);
    leaves.push({
      x0: face.cx + (t - 0.5) * face.w * 1.1 + (rand() - 0.5) * face.w * 0.3,
      delay: rand() * 700,
      fallMs: 3_400 + rand() * 1_000,
      size: Math.max(1.8, face.w * (0.055 + rand() * 0.03)),
      phase: rand() * Math.PI * 2,
      tone: i % 2 === 0 ? 0 : 1,
    });
  }
  return { bornAt: now, leaves };
}

export function leavesAlive(state: LeafState, now: number): boolean {
  return now - state.bornAt < LEAVES_MS;
}

export function liveLeafCount(state: LeafState, now: number, face: LeafFace, floorY: number): number {
  if (!leavesAlive(state, now)) return 0;
  return state.leaves.filter((leaf) => leafPos(state, leaf, now, face, floorY) !== null).length;
}

function leafPos(
  state: LeafState,
  leaf: Leaf,
  now: number,
  face: LeafFace,
  floorY: number,
): { x: number; y: number; p: number } | null {
  const age = now - state.bornAt - leaf.delay;
  if (age < 0) return null;
  const p = age / leaf.fallMs;
  if (p > 1) return null;
  const from = face.top - 8;
  const to = floorY - 2;
  return {
    x: leaf.x0 + Math.sin(leaf.phase + p * 6.2) * face.w * 0.1,
    y: from + (to - from) * p,
    p,
  };
}

export function buildLeafOps(state: LeafState, now: number, face: LeafFace, floorY: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const leaf of state.leaves) {
    const pos = leafPos(state, leaf, now, face, floorY);
    if (!pos) continue;
    const spin = leaf.phase + pos.p * 9.5;
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const w = leaf.size;
    const h = leaf.size * 1.55;
    const tone = leaf.tone === 0 ? ROSE_DEEP : ACCENT;
    const pts: Array<[number, number]> = [
      [0, -h], [w, -h * 0.2], [w * 0.65, h * 0.7], [0, h], [-w * 0.65, h * 0.7], [-w, -h * 0.2],
    ];
    const placed = pts.map(([px, py]) => [pos.x + px * c - py * s, pos.y + px * s + py * c] as [number, number]);
    const halo = placed.map(([px, py]) => [pos.x + (px - pos.x) * 1.55, pos.y + (py - pos.y) * 1.55] as [number, number]);
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9), points: halo });
    ops.push({ kind: "fillPath", fill: withAlpha(tone, 0.94), points: placed });
    // 叶脉：跟着叶片一起转的一笔短奶油线。
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(PAPER, 0.72),
      width: Math.max(0.5, w * 0.14),
      points: [
        [pos.x - s * h * 0.55, pos.y + c * h * 0.55],
        [pos.x + s * h * 0.55, pos.y - c * h * 0.55],
      ],
    });
    // 落地那一刻压出一小片玫瑰影子，叶子不是凭空消失的。
    if (pos.p > 0.9) {
      const a = (pos.p - 0.9) / 0.1;
      ops.push({
        kind: "strokeEllipse",
        stroke: withAlpha(ROSE, 0.5 * a),
        width: 0.8,
        cx: pos.x,
        cy: floorY + 1,
        rx: leaf.size * (1 + a),
        ry: leaf.size * 0.35,
      });
    }
  }
  return ops;
}

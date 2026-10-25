/**
 * 打地鼠：脚边排三个洞，地鼠按固定时刻表轮流冒头，每次只露 720ms。
 * 点中冒头的地鼠就算一下；同一只不能点两次，整轮 6 秒后洞收走。
 *
 * 时刻表是常量数组：探针、绘制、命中读的是同一张表，掉帧也不会走位。
 */
import { EYE, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const MOLE_MS = 6_000;
export const MOLE_POP_MS = 720;

export interface MoleFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface MolePop {
  at: number;
  slot: 0 | 1 | 2;
}

/** 六次冒头：左右交替，最后一次回到中间，节奏像真的在敲。 */
export const MOLE_POPS: readonly MolePop[] = [
  { at: 500, slot: 0 },
  { at: 1_350, slot: 1 },
  { at: 2_200, slot: 2 },
  { at: 3_150, slot: 1 },
  { at: 4_050, slot: 0 },
  { at: 4_950, slot: 2 },
];

export interface MoleState {
  bornAt: number;
  seed: number;
  hits: number;
  /** 冒头序号 → 打中的次数（同一只最多记一次）。 */
  hitPops: number[];
}

export function createMole(now: number, seed = Math.random()): MoleState {
  return { bornAt: now, seed, hits: 0, hitPops: [] };
}

export function moleAlive(state: MoleState, now: number): boolean {
  const age = now - state.bornAt;
  return age >= 0 && age < MOLE_MS;
}

export function moleHoleGap(face: MoleFace): number {
  return Math.max(18, Math.min(28, face.w * 0.62));
}

export function moleHoleAt(
  face: MoleFace,
  floorY: number,
  slot: 0 | 1 | 2,
): { x: number; y: number; rx: number; ry: number } {
  const gap = moleHoleGap(face);
  return {
    x: face.cx + (slot - 1) * gap,
    y: floorY - 1.2,
    rx: Math.max(5, face.w * 0.1),
    ry: 2.4,
  };
}

export interface MoleActive {
  index: number;
  slot: 0 | 1 | 2;
  /** 0..1：冒头高度。 */
  up: number;
}

/** 当前冒头的是哪一只；没有就是 null。 */
export function moleActive(state: MoleState, now: number): MoleActive | null {
  const age = now - state.bornAt;
  for (let i = 0; i < MOLE_POPS.length; i += 1) {
    const pop = MOLE_POPS[i];
    const local = age - pop.at;
    if (local < 0 || local >= MOLE_POP_MS) continue;
    const rise = Math.min(1, local / 160);
    const fall = Math.min(1, (MOLE_POP_MS - local) / 180);
    return { index: i, slot: pop.slot, up: Math.max(0, Math.min(rise, fall)) };
  }
  return null;
}

export function moleHeadAt(
  state: MoleState,
  now: number,
  face: MoleFace,
  floorY: number,
): { x: number; y: number; r: number; active: MoleActive } | null {
  const active = moleActive(state, now);
  if (!active) return null;
  const hole = moleHoleAt(face, floorY, active.slot);
  const r = Math.max(4.2, Math.min(7, face.w * 0.12));
  return { x: hole.x, y: hole.y - r * 0.4 - active.up * r * 1.2, r, active };
}

export function moleAtPoint(
  state: MoleState,
  now: number,
  face: MoleFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  const head = moleHeadAt(state, now, face, floorY);
  if (!head) return false;
  return Math.hypot(x - head.x, y - head.y) <= head.r + 3;
}

/** 敲中：每只地鼠只认一次。 */
export function whackMole(state: MoleState, now: number, face: MoleFace, floorY: number): boolean {
  const head = moleHeadAt(state, now, face, floorY);
  if (!head) return false;
  if (state.hitPops.includes(head.active.index)) return false;
  state.hitPops.push(head.active.index);
  state.hits += 1;
  return true;
}

export function buildMoleOps(
  state: MoleState,
  now: number,
  face: MoleFace,
  floorY: number,
): DrawOp[] {
  if (!moleAlive(state, now)) return [];
  const age = now - state.bornAt;
  const fade = Math.min(1, Math.max(0, age / 240)) * Math.min(1, Math.max(0, (MOLE_MS - age) / 320));
  const ops: DrawOp[] = [];
  // 三个洞先摆好：墨底 + 奶油沿，深桌布上也读得出「有洞」。
  for (const slot of [0, 1, 2] as const) {
    const hole = moleHoleAt(face, floorY, slot);
    ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.55 * fade), cx: hole.x, cy: hole.y, rx: hole.rx, ry: hole.ry });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER_SHADE, 0.8 * fade), width: 0.8, cx: hole.x, cy: hole.y, rx: hole.rx, ry: hole.ry });
  }
  const head = moleHeadAt(state, now, face, floorY);
  if (head) {
    const { x, y, r } = head;
    const hit = state.hitPops.includes(head.active.index);
    const squash = hit ? 0.72 : 1;
    // 身体与头：奶油色，耳朵与鼻头压玫瑰。
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * fade), cx: x, cy: y + r * 0.55, rx: r * 0.9, ry: r * 0.75 * squash });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * fade), cx: x, cy: y, rx: r * 0.85, ry: r * 0.8 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.9 * fade), cx: x - r * 0.55, cy: y - r * 0.55, rx: r * 0.3, ry: r * 0.26 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.9 * fade), cx: x + r * 0.55, cy: y - r * 0.55, rx: r * 0.3, ry: r * 0.26 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(EYE, 0.95 * fade), cx: x - r * 0.3, cy: y - r * 0.08, rx: 0.75, ry: 0.85 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(EYE, 0.95 * fade), cx: x + r * 0.3, cy: y - r * 0.08, rx: 0.75, ry: 0.85 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95 * fade), cx: x, cy: y + r * 0.28, rx: 0.7, ry: 0.55 });
    // 打中：脑门上一颗奶油星 + 玫瑰内星。
    if (hit) {
      const star: Array<[number, number]> = [];
      for (let i = 0; i < 8; i += 1) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 4;
        const rad = i % 2 === 0 ? r * 0.8 : r * 0.3;
        star.push([x + Math.cos(ang) * rad, y - r * 1.05 + Math.sin(ang) * rad]);
      }
      ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.95 * fade), points: star.map(([px, py]) => [x + (px - x) * 1.5, y - r * 1.05 + (py - (y - r * 1.05)) * 1.5]) });
      ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.98 * fade), points: star });
    }
  }
  // 战果：每敲中一只，就在洞边留一颗小星，最多六颗。
  for (let i = 0; i < state.hits; i += 1) {
    const pop = MOLE_POPS[state.hitPops[i]];
    const hole = moleHoleAt(face, floorY, pop.slot);
    const x = hole.x + (i % 2 === 0 ? -1 : 1) * (hole.rx + 2.4);
    const y = hole.y - 4.6 - Math.floor(i / 3) * 2.4;
    const points: Array<[number, number]> = [];
    for (let k = 0; k < 8; k += 1) {
      const ang = -Math.PI / 2 + (k * Math.PI) / 4;
      const rad = k % 2 === 0 ? 1.9 : 0.7;
      points.push([x + Math.cos(ang) * rad, y + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * fade), points: points.map(([px, py]) => [x + (px - x) * 1.6, y + (py - y) * 1.6]) });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * fade), points });
  }
  return ops;
}

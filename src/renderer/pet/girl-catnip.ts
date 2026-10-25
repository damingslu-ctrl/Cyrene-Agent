/**
 * 猫薄荷：脚边冒出一小枝薄荷。她先低头闻（1.6s），随后脑袋周围星子打转、滚作一团（3s），
 * 最后慢慢坐回来（1.8s）。点薄荷枝会再喷一小蓬叶子，纯演出，数值只在开局记一次。
 */
import { GREEN, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";
import { heartWithHalo, starOp } from "./girl-prop-art";

export const CATNIP_MS = 6_400;
export const CATNIP_PUFF_MS = 650;

const SNIFF_END = 1_600;
const ROLL_END = 4_600;

export type CatnipPhase = "sniff" | "roll" | "settle" | "gone";

export interface CatnipFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface CatnipState {
  bornAt: number;
  seed: number;
  puffAt: number;
  puffs: number;
}

export function createCatnip(now: number, seed = Math.random()): CatnipState {
  return { bornAt: now, seed, puffAt: -1, puffs: 0 };
}

export function catnipPhase(state: CatnipState, now: number): CatnipPhase {
  const age = now - state.bornAt;
  if (age < 0) return "sniff";
  if (age < SNIFF_END) return "sniff";
  if (age < ROLL_END) return "roll";
  if (age < CATNIP_MS) return "settle";
  return "gone";
}

export function catnipAlive(state: CatnipState, now: number): boolean {
  return catnipPhase(state, now) !== "gone";
}

/** 薄荷枝的位置：脚边偏她面朝的那一侧。 */
export function catnipAt(state: CatnipState, now: number, face: CatnipFace, floorY: number, facing: 1 | -1): { x: number; y: number } {
  return {
    x: face.cx + facing * Math.max(10, Math.min(16, face.w * 0.5)),
    y: floorY - 3,
  };
}

export function catnipHitRadius(face: CatnipFace): number {
  return Math.max(7, face.w * 0.25);
}

export function catnipAtPoint(
  state: CatnipState,
  now: number,
  face: CatnipFace,
  floorY: number,
  facing: 1 | -1,
  x: number,
  y: number,
): boolean {
  const sprig = catnipAt(state, now, face, floorY, facing);
  return Math.hypot(x - sprig.x, y - sprig.y) <= catnipHitRadius(face);
}

export function puffCatnip(state: CatnipState, now: number): boolean {
  if (!catnipAlive(state, now)) return false;
  if (state.puffAt >= 0 && now - state.puffAt < CATNIP_PUFF_MS + 120) return false;
  state.puffAt = now;
  state.puffs += 1;
  return true;
}

function leafShape(x: number, y: number, len: number, ang: number): Array<[number, number]> {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const raw: Array<[number, number]> = [
    [0, 0], [len * 0.35, -len * 0.34], [len, 0], [len * 0.35, len * 0.3],
  ];
  return raw.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
}

export function buildCatnipOps(state: CatnipState, now: number, face: CatnipFace, floorY: number, facing: 1 | -1): DrawOp[] {
  const phase = catnipPhase(state, now);
  if (phase === "gone") return [];
  const age = now - state.bornAt;
  const appear = Math.min(1, age / 280);
  const leave = phase === "settle" ? Math.min(1, (age - ROLL_END) / (CATNIP_MS - ROLL_END)) : 0;
  const alpha = appear * (1 - leave * 0.85);
  const sprig = catnipAt(state, now, face, floorY, facing);
  const sway = Math.sin(now / 380 + state.seed * 5) * 0.18;
  const ops: DrawOp[] = [];
  // 枝与叶：绿色压在奶油描边上（画在桌布上，必须双色）。
  const stem: Array<[number, number]> = [
    [sprig.x, sprig.y],
    [sprig.x + facing * 1.2 + sway * 2, sprig.y - 5],
    [sprig.x + facing * 0.8 + sway * 3.2, sprig.y - 9],
  ];
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.9 * alpha), width: 2.4, points: stem });
  ops.push({ kind: "strokePath", stroke: withAlpha(GREEN, 0.98 * alpha), width: 1.1, points: stem });
  for (let i = 0; i < 3; i += 1) {
    const lx = sprig.x + facing * (0.6 + i * 0.35) + sway * (2 + i);
    const ly = sprig.y - 3.4 - i * 2.3;
    const ang = (i % 2 === 0 ? -1 : 1) * (0.55 + sway) + (facing < 0 ? Math.PI : 0);
    const leaf = leafShape(lx, ly, 3.6 - i * 0.5, ang);
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * alpha), points: leaf });
    const inner = leaf.map(([x, y]) => [lx + (x - lx) * 0.78, ly + (y - ly) * 0.78] as [number, number]);
    ops.push({ kind: "fillPath", fill: withAlpha(GREEN, 0.96 * alpha), points: inner });
  }
  // 闻香：三道绿色小弯从枝头飘向鼻尖
  if (phase === "sniff") {
    const noseX = face.cx + facing * face.w * 0.1;
    const noseY = (face.top + face.bottom) / 2;
    for (let i = 0; i < 3; i += 1) {
      const p = ((now - state.bornAt) / 900 + i / 3) % 1;
      const x = sprig.x + (noseX - sprig.x) * p + Math.sin(p * 8 + i) * 1.6;
      const y = sprig.y - 4 - (sprig.y - 4 - noseY) * p;
      ops.push({ kind: "strokePath", stroke: withAlpha(GREEN, 0.55 * (1 - p) * alpha), width: 0.9, points: [[x, y], [x + 1.4, y - 1.4], [x, y - 2.8]] });
    }
  }
  // 上头了：六颗星绕头转，两颗心往上飘
  if (phase === "roll") {
    const p = (age - SNIFF_END) / (ROLL_END - SNIFF_END);
    const orbitX = face.cx;
    const orbitY = face.top + face.h * 0.15;
    const radius = face.w * 0.62;
    for (let i = 0; i < 6; i += 1) {
      const a = now / 300 + (i * Math.PI) / 3;
      const wobble = Math.sin(p * 6 + i) * 1.4;
      const sx = orbitX + Math.cos(a) * (radius + wobble);
      const sy = orbitY + Math.sin(a) * radius * 0.42;
      ops.push(starOp(sx, sy, Math.max(1.3, face.w * 0.075), withAlpha(i % 2 === 0 ? ROSE : PAPER, 0.92 * alpha), 4, a));
    }
    for (let i = 0; i < 2; i += 1) {
      const hp = (p * 1.4 + i * 0.5) % 1;
      ops.push(...heartWithHalo(face.cx + (i === 0 ? -1 : 1) * face.w * 0.45, orbitY - hp * 14, 2.1, withAlpha(ROSE, 0.9 * (1 - hp)), withAlpha(PAPER, 0.9 * (1 - hp))));
    }
  }
  // 点薄荷：一小蓬叶子与星从枝头炸开
  if (state.puffAt >= 0 && now - state.puffAt <= CATNIP_PUFF_MS) {
    const p = (now - state.puffAt) / CATNIP_PUFF_MS;
    for (let i = 0; i < 7; i += 1) {
      const a = -Math.PI / 2 + (i - 3) * 0.34;
      const rr = 3 + p * 10;
      const px = sprig.x + Math.cos(a) * rr;
      const py = sprig.y - 4 + Math.sin(a) * rr;
      if (i % 2 === 0) {
        ops.push(starOp(px, py, 1.5 * (1 - p * 0.5), withAlpha(PAPER, 0.95 * (1 - p)), 4, a));
      } else {
        ops.push({ kind: "fillPath", fill: withAlpha(GREEN, 0.95 * (1 - p)), points: leafShape(px, py, 2.6 * (1 - p * 0.4), a) });
      }
    }
  }
  // 薄荷旁边一颗小小的「香」星，提示这里可以点
  if (phase !== "settle") {
    const tw = 0.5 + 0.5 * Math.sin(now / 260);
    ops.push(starOp(sprig.x + facing * 4, sprig.y - 12, 1.8 + tw * 0.6, withAlpha(ROSE_DEEP, 0.75 * alpha), 4));
  }
  return ops;
}

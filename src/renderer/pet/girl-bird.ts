/**
 * 小鸟来访：一只奶油色小鸟从右上角飞进来，停在窗框上点头、甩尾 5 秒；
 * 点它就会受惊飞走，飘下两根羽毛。它只是来看她一眼——不产出数值，只给一句台词。
 */
import { INK, PAPER, PAPER_SHADE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BIRD_MS = 7_200;
export const BIRD_FLY_MS = 900;
const PERCH_AT = 5_600;

export interface BirdFace {
  cx: number;
  top: number;
  w: number;
}

export interface BirdState {
  bornAt: number;
  seed: number;
  /** 被点走的时刻；-1 = 还在。 */
  flewAt: number;
}

export type BirdPose = "in" | "perch" | "away" | "gone";

export interface BirdPos {
  x: number;
  y: number;
  alpha: number;
  pose: BirdPose;
}

export function createBird(now: number, seed = Math.random()): BirdState {
  return { bornAt: now, seed, flewAt: -1 };
}

/** 落脚点：她头顶右上方；夹在窗内（基址宽 82）。 */
export function birdPerch(face: BirdFace): { x: number; y: number } {
  return {
    x: Math.max(10, Math.min(72, face.cx + face.w * 0.8)),
    y: Math.max(7, face.top - 11),
  };
}

function easeOut(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return 1 - (1 - p) ** 3;
}

function easeIn(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return p * p;
}

export function birdAt(state: BirdState, now: number, face: BirdFace): BirdPos {
  const perch = birdPerch(face);
  const age = now - state.bornAt;
  if (state.flewAt >= 0) {
    const t = Math.max(0, Math.min(1, (now - state.flewAt) / BIRD_FLY_MS));
    return {
      x: perch.x - 46 * easeIn(t),
      y: perch.y + 2 - 16 * Math.sin(t * Math.PI * 0.6) - 10 * t,
      alpha: 1 - Math.max(0, (t - 0.55) / 0.45),
      pose: t >= 1 ? "gone" : "away",
    };
  }
  if (age < BIRD_FLY_MS) {
    const t = easeOut(age / BIRD_FLY_MS);
    return {
      x: perch.x + 34 - 34 * t,
      y: -8 + (perch.y + 8) * t - Math.sin(t * Math.PI) * 4,
      alpha: 1,
      pose: "in",
    };
  }
  if (age >= PERCH_AT) {
    const t = Math.max(0, Math.min(1, (age - PERCH_AT) / (BIRD_MS - PERCH_AT)));
    return {
      x: perch.x - 40 * easeIn(t),
      y: perch.y + 2 - 14 * Math.sin(t * Math.PI * 0.6) - 8 * t,
      alpha: 1 - Math.max(0, (t - 0.5) / 0.5),
      pose: t >= 1 ? "gone" : "away",
    };
  }
  return {
    x: perch.x,
    y: perch.y + Math.sin(now / 380 + state.seed * 4) * 0.6,
    alpha: 1,
    pose: "perch",
  };
}

export function birdAlive(state: BirdState, now: number, face: BirdFace): boolean {
  return birdAt(state, now, face).pose !== "gone";
}

export function birdHitRadius(): number {
  return 7;
}

export function birdAtPoint(state: BirdState, now: number, face: BirdFace, x: number, y: number): boolean {
  const pos = birdAt(state, now, face);
  if (pos.pose !== "perch") return false;
  return Math.hypot(x - pos.x, y - (pos.y - 1)) <= birdHitRadius();
}

export function scareBird(state: BirdState, now: number): boolean {
  if (state.flewAt >= 0) return false;
  state.flewAt = now;
  return true;
}

function rotate(points: Array<[number, number]>, cx: number, cy: number, ang: number): Array<[number, number]> {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return points.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/** 鸟脸朝左（看着猫）；尾巴甩一下的幅度由时间给。 */
function birdOps(x: number, y: number, now: number, alpha: number): DrawOp[] {
  const bob = Math.sin(now / 210) * 0.28;
  const flick = Math.sin(now / 150) * 0.25;
  const ops: DrawOp[] = [];
  // 尾巴
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.95 * alpha), width: 2.4, points: [[x + 2.6, y - 0.4], [x + 7.2, y - 2.2 + flick * 2]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.8 * alpha), width: 0.8, points: [[x + 2.6, y - 0.4], [x + 7.2, y - 2.2 + flick * 2]] });
  // 身体
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98 * alpha), cx: x, cy: y, rx: 4.2, ry: 3.3 });
  // 翅膀
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.95 * alpha), cx: x + 0.8, cy: y - 0.2, rx: 2.6, ry: 1.7, rot: -0.35 + flick });
  // 头
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.99 * alpha), cx: x - 2.7, cy: y - 2.5 + bob, rx: 2.7, ry: 2.5 });
  // 嘴
  ops.push({
    kind: "fillPath",
    fill: withAlpha(ROSE_DEEP, 0.95 * alpha),
    points: [[x - 5.1, y - 2.6 + bob], [x - 7.2, y - 2.1 + bob], [x - 5.1, y - 1.7 + bob]],
  });
  // 眼：奶油小底 + 墨点
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx: x - 3.5, cy: y - 3.1 + bob, rx: 1.25, ry: 1.25 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK, 0.9 * alpha), cx: x - 3.6, cy: y - 3.1 + bob, rx: 0.62, ry: 0.62 });
  // 脚：两笔抓住枝
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.9 * alpha), width: 0.7, points: [[x - 1, y + 3], [x - 1.3, y + 5]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.9 * alpha), width: 0.7, points: [[x + 1.2, y + 3], [x + 1.5, y + 5]] });
  return ops;
}

export function buildBirdOps(state: BirdState, now: number, face: BirdFace): DrawOp[] {
  const pos = birdAt(state, now, face);
  if (pos.pose === "gone" || pos.alpha <= 0.01) return [];
  const perch = birdPerch(face);
  const ops: DrawOp[] = [];
  // 窗框上的小枝：只在停稳后出现；奶油垫底线保证深桌布看得见。
  if (pos.pose === "perch" || (pos.pose === "in" && now - state.bornAt > BIRD_FLY_MS * 0.7)) {
    const twig: Array<[number, number]> = [[perch.x - 9, perch.y + 5.5], [perch.x + 1, perch.y + 4.6], [perch.x + 10, perch.y + 6]];
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.85), width: 2.6, points: twig });
    ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.85), width: 0.9, points: twig });
  }
  ops.push(...birdOps(pos.x, pos.y, now, pos.alpha));
  // 飞走时飘两根羽毛
  if (pos.pose === "away") {
    const t = Math.max(0, Math.min(1, (now - (state.flewAt >= 0 ? state.flewAt : state.bornAt + PERCH_AT)) / BIRD_FLY_MS));
    for (let i = 0; i < 2; i += 1) {
      const fx = perch.x - 8 - i * 3 + Math.sin(t * 4 + i) * 2;
      const fy = perch.y + 4 + t * (10 + i * 4);
      const ang = t * 3 + i * 1.4;
      ops.push({
        kind: "fillPath",
        fill: withAlpha(PAPER, 0.9 * (1 - t)),
        points: rotate([[0, -1.8], [1.2, 0], [0, 1.8], [-1.2, 0]], fx, fy, ang),
      });
    }
  }
  return ops;
}

/** 只在停稳时能点；起手飞入/正在离开都点不到（探针与 tapAt 同一判据）。 */
export function birdClickable(state: BirdState, now: number, face: BirdFace): boolean {
  return birdAt(state, now, face).pose === "perch";
}

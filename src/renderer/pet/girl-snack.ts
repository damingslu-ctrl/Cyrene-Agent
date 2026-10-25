import { ACCENT, INK, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { GirlFaceBox } from "./girl-sprite";
import type { DrawOp } from "./ops";

/**
 * 喂食时的一枚小鱼干：从她头顶落到手边，捧住一小会儿再化成一圈星星。
 * 是「投喂」这件事的可见回执——不引入新的状态机，只是纯道具动画。
 */
export const SNACK_MS = 2_600;
/** 下落段时长；之后是捧住段。 */
const FALL_MS = 620;

export interface SnackState {
  bornAt: number;
  facing: 1 | -1;
  x: number;
  y: number;
  startX: number;
  startY: number;
  landX: number;
  landY: number;
  groundY: number;
  /** 最近一次推进的时刻（坏时钟兜底）。 */
  at: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function createSnack(now: number, face: GirlFaceBox, groundY: number, facing: 1 | -1): SnackState {
  const t = Number.isFinite(now) ? now : 0;
  const startY = face.top - face.h * 0.55;
  const landY = groundY - Math.max(14, face.h * 1.2);
  const startX = face.cx + facing * Math.max(1.6, face.w * 0.16);
  const landX = face.cx + facing * Math.max(3.5, face.w * 0.42);
  return {
    bornAt: t,
    facing,
    x: startX,
    y: startY,
    startX,
    startY,
    landX,
    landY,
    groundY: Number.isFinite(groundY) ? groundY : face.bottom,
    at: t,
  };
}

function posAt(state: SnackState, now: number): { x: number; y: number } {
  const t = Number.isFinite(now) ? now : state.at;
  const age = Math.max(0, t - state.bornAt);
  if (age < FALL_MS) {
    const p = clamp01(age / FALL_MS);
    const ease = 1 - (1 - p) ** 3;
    return {
      x: state.startX + (state.landX - state.startX) * ease,
      y: state.startY + (state.landY - state.startY) * ease,
    };
  }
  const held = age - FALL_MS;
  return {
    x: state.landX,
    y: state.landY + Math.sin((held / 1000) * 18) * Math.max(0.25, (state.groundY - state.landY) * 0.012),
  };
}

export function stepSnack(state: SnackState, now: number, face: GirlFaceBox, groundY: number): void {
  void face;
  if (!Number.isFinite(now)) return;
  state.groundY = Number.isFinite(groundY) ? groundY : state.groundY;
  const p = posAt(state, now);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  state.x = p.x;
  state.y = p.y;
  state.at = now;
}

export function snackProgress(state: SnackState, now: number): number {
  const t = Number.isFinite(now) ? now : state.at;
  return clamp01((t - state.bornAt) / SNACK_MS);
}

export function snackAlive(state: SnackState, now: number): boolean {
  const t = Number.isFinite(now) ? now : state.at;
  return t - state.bornAt < SNACK_MS;
}

/** 鱼形：头朝 facing，尾在身后；身体双色（奶油光边 + 玫瑰鱼身）。 */
export function buildSnackOps(state: SnackState, now: number, face: GirlFaceBox): DrawOp[] {
  if (!snackAlive(state, now)) return [];
  const p = posAt(state, now);
  const r = Math.max(2.4, face.w * 0.19);
  const dir = state.facing;
  const t = Number.isFinite(now) ? now : state.at;
  const age = t - state.bornAt;
  const settled = age >= FALL_MS;
  const wobble = settled ? Math.sin((age / 1000) * 18) * 0.10 : Math.sin((age / 1000) * 9) * 0.16;
  const cos = Math.cos(wobble);
  const sin = Math.sin(wobble);
  const at = (lx: number, ly: number): [number, number] => [
    p.x + (lx * dir) * cos - ly * sin,
    p.y + (lx * dir) * sin + ly * cos,
  ];
  const ops: DrawOp[] = [];
  const tail: Array<[number, number]> = [at(-r * 1.5, -r * 0.85), at(-r * 2.45, 0), at(-r * 1.5, r * 0.85)];
  const fin: Array<[number, number]> = [at(-r * 0.35, -r * 0.62), at(r * 0.15, -r * 1.1), at(r * 0.55, -r * 0.55)];
  const body: Array<[number, number]> = [
    at(r * 1.55, 0), at(r * 0.85, -r * 0.72), at(-r * 0.65, -r * 0.62),
    at(-r * 1.15, 0), at(-r * 0.65, r * 0.62), at(r * 0.85, r * 0.72),
  ];
  const halo = (pts: Array<[number, number]>, k = 1.5): Array<[number, number]> =>
    pts.map(([px, py]) => [p.x + (px - p.x) * k, p.y + (py - p.y) * k]);

  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.92), points: halo(tail, 1.28), layer: "stars" });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.92), points: halo(fin, 1.34), layer: "stars" });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.94), points: halo(body, 1.22), layer: "stars" });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE_DEEP, 0.95), points: tail, layer: "stars" });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE_DEEP, 0.85), points: fin, layer: "stars" });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.96), points: body, layer: "stars" });
  // 腹腔高光 + 眼睛 + 鳞片。
  ops.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.62),
    cx: at(r * 0.15, r * 0.18)[0], cy: at(r * 0.15, r * 0.18)[1],
    rx: r * 0.72, ry: r * 0.34, layer: "stars",
  });
  ops.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.9),
    cx: at(r * 0.86, -r * 0.16)[0], cy: at(r * 0.86, -r * 0.16)[1],
    rx: r * 0.19, ry: r * 0.19, layer: "stars",
  });
  ops.push({
    kind: "fillEllipse", fill: withAlpha(INK, 0.92),
    cx: at(r * 0.84, -r * 0.16)[0], cy: at(r * 0.84, -r * 0.16)[1],
    rx: r * 0.1, ry: r * 0.1, layer: "stars",
  });
  ops.push({
    kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.7), width: Math.max(0.6, r * 0.1),
    points: [at(r * 0.1, -r * 0.4), at(r * 0.45, 0), at(r * 0.1, r * 0.4)], layer: "stars",
  });
  if (settled) {
    const ring = 0.55 + 0.45 * clamp01((age - FALL_MS) / 420);
    for (let i = 0; i < 3; i += 1) {
      const ang = -Math.PI / 2 + i * 2.1 + age / 900;
      const sx = p.x + Math.cos(ang) * r * 2.6 * ring;
      const sy = p.y - r * 1.1 + Math.sin(ang) * r * 1.3 * ring;
      const rr = Math.max(0.5, r * 0.23);
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85), cx: sx, cy: sy, rx: rr * 1.8, ry: rr * 1.8, layer: "stars" });
      ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.9), cx: sx, cy: sy, rx: rr, ry: rr, layer: "stars" });
    }
  }
  return ops;
}

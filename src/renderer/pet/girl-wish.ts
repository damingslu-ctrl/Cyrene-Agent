/**
 * 许愿星：一颗亮星在她头顶慢慢游过去，点它一下＝许一个愿。
 * 愿望本身不落到任何数值上，只留一串往上飘的星屑——许愿是件私人的事。
 */
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const WISH_MS = 6_000;
export const WISH_RISE_MS = 900;
export const WISH_HOVER_END_MS = 4_600;

export interface WishFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface WishState {
  bornAt: number;
  seed: number;
  wishedAt: number;
}

export type WishPhase = "rise" | "hover" | "fade" | "gone";

export function createWish(now: number, seed = Math.random()): WishState {
  return { bornAt: now, seed, wishedAt: -1 };
}

export function wishPhase(state: WishState, now: number): WishPhase {
  const age = now - state.bornAt;
  if (age < 0 || age < WISH_RISE_MS) return "rise";
  if (age < WISH_HOVER_END_MS) return "hover";
  return age < WISH_MS ? "fade" : "gone";
}

export function wishAlive(state: WishState, now: number): boolean {
  return wishPhase(state, now) !== "gone";
}

export interface WishStar {
  x: number;
  y: number;
  r: number;
}

export function wishStarAt(state: WishState, now: number, face: WishFace): WishStar {
  const age = Math.max(0, now - state.bornAt);
  const x = face.cx + Math.sin((age / 1_400) * Math.PI + state.seed * Math.PI * 2) * face.w * 0.55;
  const y = face.top - 4 + Math.sin(age / 500) * 1.5;
  return {
    x: Math.max(3, Math.min(79, x)),
    y: Math.max(2, Math.min(face.top + 2, y)),
    r: 3.2 + Math.sin(age / 220) * 0.4,
  };
}

export function wishAtPoint(state: WishState, now: number, face: WishFace, x: number, y: number): boolean {
  const phase = wishPhase(state, now);
  if (phase === "rise" || phase === "gone") return false;
  const star = wishStarAt(state, now, face);
  return Math.hypot(x - star.x, y - star.y) <= star.r + 5;
}

export function makeWish(state: WishState, now: number): boolean {
  if (wishPhase(state, now) !== "hover") return false;
  if (state.wishedAt >= 0) return false;
  state.wishedAt = now;
  return true;
}

function star(cx: number, cy: number, r: number, fill: string): DrawOp {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.34;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return { kind: "fillPath", fill, points };
}

export function buildWishOps(state: WishState, now: number, face: WishFace): DrawOp[] {
  if (wishPhase(state, now) === "gone") return [];
  const age = Math.max(0, now - state.bornAt);
  const alpha = Math.min(1, age / 320) * Math.min(1, (WISH_MS - age) / 500);
  const starAt = wishStarAt(state, now, face);
  const ops: DrawOp[] = [];
  // 光晕：两圈奶油 + 一圈蓝，深桌布上也亮得起来。
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.28 * alpha), width: 1, cx: starAt.x, cy: starAt.y, rx: starAt.r * 2.6, ry: starAt.r * 2.6 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(ACCENT, 0.5 * alpha), width: 0.8, cx: starAt.x, cy: starAt.y, rx: starAt.r * 1.8, ry: starAt.r * 1.8 });
  // 星体：奶油底 + 玫瑰/蓝双色芯。
  ops.push(star(starAt.x, starAt.y, starAt.r * 1.5, withAlpha(PAPER, 0.95 * alpha)));
  ops.push(star(starAt.x, starAt.y, starAt.r, withAlpha(ROSE, 0.95 * alpha)));
  ops.push(star(starAt.x, starAt.y, starAt.r * 0.42, withAlpha(ACCENT, 0.98 * alpha)));
  // 三颗固定的伴星：让「星空」不是一颗孤零零的星。
  const companions: ReadonlyArray<readonly [number, number, number]> = [
    [face.cx - face.w * 0.62, face.top + 2, 1.1],
    [face.cx + face.w * 0.58, face.top + 7, 0.9],
    [face.cx - face.w * 0.3, face.top - 6, 0.7],
  ];
  for (let i = 0; i < companions.length; i += 1) {
    const [x, y, r] = companions[i];
    const twinkle = 0.55 + 0.35 * Math.sin(now / 260 + i * 2.1);
    ops.push({ kind: "fillEllipse", fill: withAlpha(i === 0 ? ACCENT : PAPER, twinkle * alpha), cx: x, cy: y, rx: r, ry: r });
  }
  // 许愿后：一串星屑从星星处往上飘。
  if (state.wishedAt >= 0) {
    const since = now - state.wishedAt;
    for (let i = 0; i < 5; i += 1) {
      const p = ((since / 1_500 + i * 0.2) % 1);
      const x = starAt.x + Math.sin(i * 2.3 + state.seed * 6.28) * 6;
      const y = starAt.y - p * (face.h * 0.9);
      const r = (1.7 - p * 0.6) * alpha;
      ops.push(i % 2 === 0
        ? star(x, y, Math.max(0.6, r), withAlpha(PAPER, (1 - p) * alpha))
        : { kind: "fillEllipse", fill: withAlpha(i % 3 === 0 ? ROSE_DEEP : ACCENT, (1 - p) * alpha), cx: x, cy: y, rx: Math.max(0.5, r * 0.6), ry: Math.max(0.5, r * 0.6) });
    }
    // 愿望的余温：一圈很淡的心。
    ops.push({
      kind: "fillPath",
      fill: withAlpha(ROSE, 0.4 * Math.max(0, 1 - since / 2_000) * alpha),
      points: [
        [face.cx, face.top + 4],
        [face.cx - 2.4, face.top + 2.4],
        [face.cx, face.top + 0.8],
        [face.cx + 2.4, face.top + 2.4],
      ],
    });
  }
  return ops;
}

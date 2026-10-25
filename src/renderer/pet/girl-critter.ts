import { ACCENT, INK_SOFT, PAPER, ROSE, ROSE_DEEP, WARN, withAlpha } from "../../shared/pet-tokens";
import type { GirlFaceBox } from "./girl-sprite";
import type { DrawOp } from "./ops";

/**
 * 伴飞小虫：白天一只蝴蝶、入夜换成流萤，绕着她的脸飞一小会儿就走。
 * 它是「活着的环境」而不是状态提示——所以不落在任何 HUD 通道上，
 * 只借 `stars` 层画在人物之后。
 *
 * 双色纪律：翅膀/发光都先铺奶油光边，深色桌布上也读得出来。
 */
export type CritterKind = "butterfly" | "firefly";

/** 一只小虫最多待多久。 */
export const CRITTER_LIFE_MS = 12_000;
/** 捉到之后先亮一小下（这段里还能画）再消失。 */
export const CATCH_FLASH_MS = 520;

export interface CritterState {
  kind: CritterKind;
  seed: number;
  bornAt: number;
  /** 被捉住的时刻；-1 = 还在飞。 */
  caughtAt: number;
  /** 最近一次推进到的位置：命中判定按这个点，而不是按调用时刻重算。 */
  x: number;
  y: number;
  /** 最近一次推进的时刻（坏时钟兜底）。 */
  at: number;
}

export interface CritterSpawnInput {
  now: number;
  kind: CritterKind;
  seed: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function critterKindFor(hour: number): CritterKind {
  if (!Number.isFinite(hour)) return "firefly";
  return hour >= 6 && hour < 18 ? "butterfly" : "firefly";
}

function orbitAt(state: CritterState, nowMs: number, face: GirlFaceBox): { x: number; y: number } {
  const t = Math.max(0, nowMs - state.bornAt) / 1000;
  const seed = state.seed;
  const ang = seed * Math.PI * 2 + t * 1.25;
  const swing = state.kind === "butterfly" ? 1 : 0.74;
  const x = face.cx + Math.cos(ang) * face.w * 1.12 * swing + Math.sin(t * 0.9 + seed * 9) * face.w * 0.22;
  const y =
    face.cy - face.h * 0.42 +
    Math.sin(ang * 1.35 + seed * 4) * face.h * 0.5 -
    Math.cos(t * 0.7 + seed * 5) * face.h * 0.12;
  return { x, y };
}

export function spawnCritter(input: CritterSpawnInput): CritterState {
  const now = Number.isFinite(input.now) ? input.now : 0;
  const seed = clamp(Number.isFinite(input.seed) ? input.seed : 0.5, 0, 1);
  const state: CritterState = {
    kind: input.kind === "firefly" ? "firefly" : "butterfly",
    seed,
    bornAt: now,
    caughtAt: -1,
    x: 0,
    y: 0,
    at: now,
  };
  return state;
}

/** 当前时刻的位置（不写回 state）：被捉住后定格在被捉的那一点。 */
export function critterPos(state: CritterState, now: number, face: GirlFaceBox): { x: number; y: number } {
  const at = state.caughtAt >= 0 ? state.caughtAt : Number.isFinite(now) ? now : state.at;
  const p = orbitAt(state, at, face);
  return { x: Number.isFinite(p.x) ? p.x : face.cx, y: Number.isFinite(p.y) ? p.y : face.cy };
}

export function stepCritter(state: CritterState, now: number, face: GirlFaceBox): void {
  if (!Number.isFinite(now) || state.caughtAt >= 0) return;
  const p = orbitAt(state, now, face);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  state.x = p.x;
  state.y = p.y;
  state.at = now;
}

export function critterAlive(state: CritterState, now: number): boolean {
  if (state.caughtAt >= 0) return false;
  const t = Number.isFinite(now) ? now : state.at;
  return t - state.bornAt < CRITTER_LIFE_MS;
}

/** 命中半径按脸宽走：小窗里也点得中，但不会一口气罩住半只猫。 */
function hitRadius(face: GirlFaceBox): number {
  return Math.max(6, face.w * 0.42);
}

export function critterAt(state: CritterState, now: number, face: GirlFaceBox, x: number, y: number): boolean {
  if (!critterAlive(state, now)) return false;
  const p = critterPos(state, now, face);
  return Math.hypot(x - p.x, y - p.y) <= hitRadius(face);
}

/** 返回 true 只代表「这一下真的捉到了」——重复点击/超时返回 false。 */
export function catchCritter(state: CritterState, now: number): boolean {
  if (state.caughtAt >= 0) return false;
  const t = Number.isFinite(now) ? now : state.at;
  if (t - state.bornAt >= CRITTER_LIFE_MS) return false;
  state.caughtAt = t;
  return true;
}

function wingPath(side: 1 | -1, size: number, flap: number, lift: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [side * 1.1, -size * 0.55],
    [side * (size * 1.55), -size * (0.85 + lift * 0.2)],
    [side * (size * 1.85 * flap), size * 0.05],
    [side * size * 0.72, size * 0.72],
  ];
  return pts;
}

function butterflyOps(x: number, y: number, size: number, nowMs: number, alpha: number): DrawOp[] {
  const flap = 0.5 + 0.5 * Math.abs(Math.cos((nowMs / 1000) * Math.PI * 2 * 6.5));
  const lift = Math.sin((nowMs / 1000) * Math.PI * 2 * 6.5) * 0.5 + 0.5;
  const move = (pts: Array<[number, number]>, k = 1, dy = 0): Array<[number, number]> =>
    pts.map(([px, py]) => [x + px * k, y + py * k + dy] as [number, number]);
  const ops: DrawOp[] = [];
  for (const side of [-1, 1] as const) {
    const halo = wingPath(side, size * 1.32, flap, lift);
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.92 * alpha), points: move(halo), layer: "stars" });
  }
  for (const side of [-1, 1] as const) {
    const wing = wingPath(side, size, flap, lift);
    ops.push({ kind: "fillPath", fill: withAlpha(side > 0 ? ROSE : ROSE_DEEP, 0.95 * alpha), points: move(wing), layer: "stars" });
  }
  for (const side of [-1, 1] as const) {
    const spot = wingPath(side, size * 0.42, flap, lift);
    ops.push({
      kind: "fillPath", fill: withAlpha(PAPER, 0.75 * alpha),
      points: move(spot, 0.5, size * 0.12),
      layer: "stars",
    });
  }
  ops.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha),
    cx: x, cy: y, rx: size * 0.34, ry: size * 1.02, layer: "stars",
  });
  ops.push({
    kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.95 * alpha),
    cx: x, cy: y, rx: size * 0.22, ry: size * 0.82, layer: "stars",
  });
  // 触角：奶油外圈 + 玫瑰细线。
  for (const side of [-1, 1] as const) {
    const from: [number, number] = [x + side * size * 0.1, y - size * 0.7];
    const to: [number, number] = [x + side * size * 0.7, y - size * (1.25 + lift * 0.12)];
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.85 * alpha), width: 2.2, points: [from, to], layer: "stars" });
    ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.9 * alpha), width: 0.9, points: [from, to], layer: "stars" });
  }
  return ops;
}

function fireflyOps(x: number, y: number, size: number, nowMs: number, alpha: number): DrawOp[] {
  const pulse = 0.62 + 0.38 * Math.max(0, Math.sin((nowMs / 1000) * 4.2));
  const a = alpha * pulse;
  const ops: DrawOp[] = [
    { kind: "fillEllipse", fill: withAlpha(PAPER, 0.30 * a), cx: x, cy: y + size * 0.35, rx: size * 2.6, ry: size * 2.35, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(WARN, 0.22 * a), cx: x, cy: y + size * 0.35, rx: size * 1.75, ry: size * 1.6, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(PAPER, 0.92 * a), cx: x, cy: y + size * 0.35, rx: size * 0.95, ry: size * 0.9, layer: "stars" },
    { kind: "fillEllipse", fill: withAlpha(WARN, 0.95 * a), cx: x, cy: y + size * 0.35, rx: size * 0.62, ry: size * 0.58, layer: "stars" },
  ];
  for (const side of [-1, 1] as const) {
    ops.push({
      kind: "fillEllipse", fill: withAlpha(PAPER, 0.78 * a),
      cx: x + side * size * 0.62, cy: y - size * 0.22,
      rx: size * 0.78, ry: size * 0.34, rot: side * 0.55, layer: "stars",
    });
    ops.push({
      kind: "fillEllipse", fill: withAlpha(ACCENT, 0.45 * a),
      cx: x + side * size * 0.6, cy: y - size * 0.22,
      rx: size * 0.42, ry: size * 0.2, rot: side * 0.55, layer: "stars",
    });
  }
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.9 * a), cx: x, cy: y, rx: size * 0.4, ry: size * 0.34, layer: "stars" });
  return ops;
}

export function buildCritterOps(state: CritterState, now: number, face: GirlFaceBox): DrawOp[] {
  const t = Number.isFinite(now) ? now : state.at;
  const age = t - state.bornAt;
  if (age >= CRITTER_LIFE_MS) return [];
  let alpha = 1;
  let catchPop = 0;
  if (state.caughtAt >= 0) {
    const since = t - state.caughtAt;
    if (since > CATCH_FLASH_MS) return [];
    const p = clamp(since / CATCH_FLASH_MS, 0, 1);
    alpha = 1 - p;
    catchPop = Math.sin(p * Math.PI) * 1.4;
  } else if (age > CRITTER_LIFE_MS - 700) {
    alpha = clamp((CRITTER_LIFE_MS - age) / 700, 0, 1);
  }
  if (alpha <= 0.01) return [];
  const p = critterPos(state, now, face);
  const size = Math.max(2.2, face.w * 0.155);
  const ops =
    state.kind === "butterfly"
      ? butterflyOps(p.x, p.y, size, t, alpha)
      : fireflyOps(p.x, p.y, size, t, alpha);
  if (catchPop > 0) {
    for (let i = 0; i < 4; i += 1) {
      const ang = (i * Math.PI) / 2 + 0.4;
      const r = size * (1.6 + catchPop * 2.2);
      const sx = p.x + Math.cos(ang) * r;
      const sy = p.y + Math.sin(ang) * r * 0.8;
      const rr = Math.max(0.8, size * 0.28 * alpha);
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: sx, cy: sy, rx: rr * 1.7, ry: rr * 1.7, layer: "stars" });
      ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, alpha), cx: sx, cy: sy, rx: rr, ry: rr, layer: "stars" });
    }
  }
  return ops;
}

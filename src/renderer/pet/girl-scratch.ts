/**
 * 猫抓板：一块瓦楞纸板从脚边升起来，她按着板面磨爪，爪痕一条条叠上去；
 * 点板面＝再帮她按一下（多一道爪痕），整轮走完才记一次「磨爪」。
 *
 * 爪痕数是解析量：基础痕按时间表长，加痕由点击计数补，帧率与掉帧都不影响张数。
 */
import { INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const SCRATCH_MS = 5_200;
export const SCRATCH_ENTER_MS = 600;
export const SCRATCH_BONUS_COOLDOWN_MS = 420;
export const SCRATCH_MAX_MARKS = 8;
/** 点击最多补三道：再多板面就糊成一片玫瑰色，读不出「一道道」。 */
export const SCRATCH_MAX_BOOSTS = 3;

export interface ScratchFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface ScratchState {
  bornAt: number;
  seed: number;
  /** 点板面补出来的爪痕数（0..3）。 */
  boosts: number;
  lastBoostAt: number;
}

export interface ScratchRect {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

export type ScratchPhase = "enter" | "scratch" | "gone";

export function createScratch(now: number, seed = Math.random()): ScratchState {
  return { bornAt: now, seed, boosts: 0, lastBoostAt: -1 };
}

export function scratchPhase(state: ScratchState, now: number): ScratchPhase {
  const age = now - state.bornAt;
  if (age < 0) return "enter";
  if (age < SCRATCH_ENTER_MS) return "enter";
  return age < SCRATCH_MS ? "scratch" : "gone";
}

export function scratchAlive(state: ScratchState, now: number): boolean {
  return scratchPhase(state, now) !== "gone";
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 基础五道按 620ms 一道长，加痕盖在最后：最多八道。 */
export function scratchMarks(state: ScratchState, now: number): number {
  const age = Math.max(0, now - state.bornAt);
  const base = Math.min(5, Math.floor(Math.max(0, age - 650) / 620));
  return Math.max(0, Math.min(SCRATCH_MAX_MARKS, base + state.boosts));
}

export function scratchRectFor(state: ScratchState, now: number, face: ScratchFace, floorY: number): ScratchRect {
  const w = Math.max(34, Math.min(58, face.w * 1.35));
  const h = 12;
  const restY = floorY - 9;
  const phase = scratchPhase(state, now);
  let y = restY;
  let alpha = 1;
  if (phase === "enter") {
    const t = clamp01((now - state.bornAt) / SCRATCH_ENTER_MS);
    const e = 1 - (1 - t) ** 3;
    y = restY + 12 * (1 - e);
    alpha = 0.35 + 0.65 * e;
  } else if (phase === "gone") {
    alpha = 0;
  }
  // 磨爪时板子随落爪轻颤：只抖板不抖人。
  const shake = phase === "scratch" ? Math.sin((now - state.bornAt) / 47) * 0.5 : 0;
  return { x: face.cx - w / 2 + shake, y, w, h, alpha };
}

/** 点板面：`scratch` 段内、冷却外、没补满就再多一道。 */
export function boostScratch(state: ScratchState, now: number): boolean {
  if (scratchPhase(state, now) !== "scratch") return false;
  if (state.boosts >= SCRATCH_MAX_BOOSTS) return false;
  if (state.lastBoostAt >= 0 && now - state.lastBoostAt < SCRATCH_BONUS_COOLDOWN_MS) return false;
  state.lastBoostAt = now;
  state.boosts += 1;
  return true;
}

function inside(rect: ScratchRect, x: number, y: number, pad = 3): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

export function scratchAtPoint(
  state: ScratchState,
  now: number,
  face: ScratchFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (scratchPhase(state, now) !== "scratch") return false;
  return inside(scratchRectFor(state, now, face, floorY), x, y);
}

export function buildScratchOps(
  state: ScratchState,
  now: number,
  face: ScratchFace,
  floorY: number,
): DrawOp[] {
  if (scratchPhase(state, now) === "gone") return [];
  const rect = scratchRectFor(state, now, face, floorY);
  const { x, y, w, h } = rect;
  const a = rect.alpha;
  if (a <= 0.01) return [];
  const marks = scratchMarks(state, now);
  const ops: DrawOp[] = [];
  // 地面影子：板子得先「落在桌布上」。
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.18 * a), cx: x + w / 2, cy: y + h + 1.4, rx: w * 0.5, ry: 2.1 });
  // 板身：奶油纸 + 上沿双层，瓦楞用竖短线表示。
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.98 * a), x, y, w, h, r: 2.2 });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER_SHADE, 0.9 * a), points: [[x + 1, y + h - 2.4], [x + w - 1, y + h - 2.4], [x + w - 1, y + h - 0.6], [x + 1, y + h - 0.6]] });
  const ribs = Math.max(5, Math.floor(w / 5));
  for (let i = 1; i < ribs; i += 1) {
    const rx = x + (i / ribs) * w;
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(PAPER_SHADE, 0.75 * a),
      width: 0.6,
      points: [[rx, y + 1.6], [rx, y + 4.2]],
    });
  }
  // 爪痕：斜着从左下到右上，越到后面越淡一点，像一层层磨出来的。
  for (let i = 0; i < marks; i += 1) {
    const mx = x + 4 + i * ((w - 9) / Math.max(1, SCRATCH_MAX_MARKS - 1));
    const tone = i % 2 === 0 ? ROSE : ROSE_DEEP;
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(tone, (0.92 - i * 0.04) * a),
      width: 1.15,
      points: [[mx - 1.6, y + h - 2.6], [mx + 1.8, y + 2.4]],
    });
  }
  // 落爪的纸屑：基础痕翻新与点击补痕时各炸一下。
  const sinceMark = (now - state.bornAt - 650) % 620;
  const fresh = scratchPhase(state, now) === "scratch" && sinceMark < 240;
  const boostFresh = state.lastBoostAt >= 0 && now - state.lastBoostAt < 300;
  if (fresh || boostFresh) {
    const at = (boostFresh ? 1 : 0.55) * a;
    for (let i = 0; i < 3; i += 1) {
      const ang = -0.7 + i * 0.7 + Math.sin(i * 2.1 + state.seed * 6) * 0.2;
      const px = x + w * (0.6 + i * 0.1);
      const py = y + 3 - (now - state.bornAt) % 200 * 0.02;
      ops.push({ kind: "fillEllipse", fill: withAlpha(i === 0 ? PAPER : PAPER_SHADE, at * 0.85), cx: px + Math.cos(ang) * 3, cy: py + Math.sin(ang) * 1.5, rx: 0.9, ry: 0.7 });
    }
  }
  // 补痕的那一下：板面弹一颗小星，告诉用户这一下算数。
  if (state.lastBoostAt >= 0 && now - state.lastBoostAt < 420) {
    const p = (now - state.lastBoostAt) / 420;
    const cx = x + w * 0.72;
    const cy = y - 3;
    const r = 3 + p * 3;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : r * 0.34;
      points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.9 * (1 - p)), points });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * (1 - p)), points: points.map(([px, py]) => [cx + (px - cx) * 0.62, cy + (py - cy) * 0.62]) });
  }
  ops.push({ kind: "strokeRoundRect", stroke: withAlpha(ROSE_DEEP, 0.45 * a), width: 0.7, x, y, w, h, r: 2.2 });
  return ops;
}

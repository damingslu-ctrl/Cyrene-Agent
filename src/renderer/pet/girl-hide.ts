/**
 * 躲猫猫：她捂住眼睛数三下，然后探头找你——在探头那 2.6 秒里点她一下就算逮到。
 * 纯函数只管三段时钟、点中判定与头顶那枚双色记号；记账与说话在引擎。
 */
import { INK_SOFT, PAPER, PAPER_SHADE, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const HIDE_COVER_MS = 1_100;
export const HIDE_PEEK_MS = 2_600;
export const HIDE_FOUND_MS = 900;
export const HIDE_MISS_MS = 700;

export type HidePhase = "cover" | "peek" | "found" | "miss" | "gone";
export type TapHideResult = "found" | "late" | "none";

export interface HideState {
  bornAt: number;
  /** 逮到的时刻；-1 = 还没逮到。 */
  tappedAt: number;
}

export interface HideFace {
  cx: number;
  top: number;
  w: number;
  h: number;
}

export function createHide(now: number): HideState {
  return { bornAt: now, tappedAt: -1 };
}

export function hidePhase(state: HideState, now: number): HidePhase {
  if (now < state.bornAt) return "gone";
  if (state.tappedAt >= 0) {
    const since = now - state.tappedAt;
    return since >= 0 && since < HIDE_FOUND_MS ? "found" : "gone";
  }
  const age = now - state.bornAt;
  if (age < HIDE_COVER_MS) return "cover";
  if (age < HIDE_COVER_MS + HIDE_PEEK_MS) return "peek";
  if (age < HIDE_COVER_MS + HIDE_PEEK_MS + HIDE_MISS_MS) return "miss";
  return "gone";
}

export function hideAlive(state: HideState, now: number): boolean {
  return hidePhase(state, now) !== "gone";
}

/** 捂眼时点＝太早；探头时点＝逮到；其余时刻不响应。 */
export function tapHide(state: HideState, now: number): TapHideResult {
  const phase = hidePhase(state, now);
  if (phase === "cover") return "late";
  if (phase === "peek") {
    state.tappedAt = now;
    return "found";
  }
  return "none";
}

export function buildHideOps(state: HideState, now: number, face: HideFace): DrawOp[] {
  const phase = hidePhase(state, now);
  if (phase === "gone" || phase === "miss") {
    if (phase === "gone") return [];
    const p = Math.max(0, Math.min(1, (now - (state.bornAt + HIDE_COVER_MS + HIDE_PEEK_MS)) / HIDE_MISS_MS));
    const alpha = 1 - p;
    return [
      { kind: "fillEllipse", fill: withAlpha(PAPER, 0.7 * alpha), cx: face.cx, cy: face.top - face.h * 0.12, rx: face.w * 0.2, ry: face.w * 0.14 },
      { kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.7 * alpha), cx: face.cx, cy: face.top - face.h * 0.12, rx: face.w * 0.12, ry: face.w * 0.08 },
    ];
  }
  const ops: DrawOp[] = [];
  if (phase === "cover") {
    const y = face.top - face.h * 0.14 + Math.sin(now / 260) * 0.8;
    for (let i = -1; i <= 1; i += 1) {
      const x = face.cx + i * face.w * 0.16;
      const tone = i === 0 ? ROSE : INK_SOFT;
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9), cx: x, cy: y, rx: 1.8, ry: 1.8 });
      ops.push({ kind: "fillEllipse", fill: withAlpha(tone, 0.85), cx: x, cy: y, rx: 0.9, ry: 0.9 });
    }
    return ops;
  }
  if (phase === "peek") {
    const p = Math.min(1, Math.max(0, (now - (state.bornAt + HIDE_COVER_MS)) / 300));
    const y = face.top - face.h * 0.16 - p * 2;
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95), cx: face.cx, cy: y, rx: 2.1, ry: 4.2 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95), cx: face.cx, cy: y, rx: 1.1, ry: 3.1 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95), cx: face.cx, cy: y + 6.2, rx: 1.5, ry: 1.5 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95), cx: face.cx, cy: y + 6.2, rx: 0.8, ry: 0.8 });
    return ops;
  }
  // found：一圈双色光环 + 一颗星，随后收走。
  const p = Math.max(0, Math.min(1, (now - state.tappedAt) / HIDE_FOUND_MS));
  const x = face.cx;
  const y = face.top - face.h * 0.2;
  const r = Math.max(3.4, face.w * 0.13) * (1 + p * 1.2);
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.9 * (1 - p)), width: 1.2, cx: x, cy: y, rx: r, ry: r * 0.8 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE, 0.9 * (1 - p)), width: 0.7, cx: x, cy: y, rx: r * 0.66, ry: r * 0.53 });
  const star: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r * 0.9 : r * 0.3;
    star.push([x + Math.cos(ang) * rad, y + Math.sin(ang) * rad]);
  }
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.95 * (1 - p)), points: star.map(([sx, sy]) => [x + (sx - x) * 1.25, y + (sy - y) * 1.25]) });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * (1 - p)), points: star });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * (1 - p)), cx: x - r * 1.4, cy: y + r * 0.7, rx: 1.2, ry: 1.2 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * (1 - p)), cx: x + r * 1.4, cy: y + r * 0.7, rx: 1.2, ry: 1.2 });
  return ops;
}

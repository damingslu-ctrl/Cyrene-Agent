/**
 * 纸箱躲猫猫：把纸箱扣在脚边，她钻进去；箱子顶在「盖住整张脸」与「露出脑袋」之间起落，
 * 三次探头里点中脑袋就算抓住，箱子当场翻倒、她跳出来。
 *
 * 位置全是解析量：箱子高/宽只由脸框推，探头的三个窗口是固定时间表，
 * 这样绘制、诊断与探针看到的是同一个箱沿，窗口搬动也不会留下旧坐标。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BOX_MS = 6_600;
export const BOX_POP_MS = 900;
export const BOX_KNOCK_MS = 320;

const ENTER_MS = 800;
const LEAVE_AT = 5_200;
const PEEK_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [1_500, 2_300],
  [2_950, 3_750],
  [4_400, 5_200],
];

export type BoxPhase = "enter" | "hidden" | "peek" | "pop" | "leave" | "gone";

export interface BoxFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface BoxState {
  bornAt: number;
  seed: number;
  /** 抓住脑袋的时刻；-1 = 还没抓住。 */
  poppedAt: number;
  /** 上一次敲箱子的时刻；-1 = 没敲过。 */
  knockAt: number;
  knocks: number;
}

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 离场时淡出；常驻段恒 1。 */
  alpha: number;
}

export function createBox(now: number, seed = Math.random()): BoxState {
  return { bornAt: now, seed, poppedAt: -1, knockAt: -1, knocks: 0 };
}

export function boxPhase(state: BoxState, now: number): BoxPhase {
  if (state.poppedAt >= 0) {
    return now - state.poppedAt <= BOX_POP_MS ? "pop" : "gone";
  }
  const age = now - state.bornAt;
  if (age < 0) return "enter";
  if (age < ENTER_MS) return "enter";
  if (age >= LEAVE_AT) return age < BOX_MS ? "leave" : "gone";
  return PEEK_WINDOWS.some(([a, b]) => age >= a && age < b) ? "peek" : "hidden";
}

export function boxAlive(state: BoxState, now: number): boolean {
  return boxPhase(state, now) !== "gone";
}

export function boxWidth(face: BoxFace): number {
  return Math.max(26, Math.min(54, face.w * 1.7));
}

function easeOut(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return 1 - (1 - p) ** 3;
}

function easeIn(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return p * p;
}

/** 箱沿高度：hidden 时盖过发顶，peek 时落在下巴，enter 从脚边升上来。 */
export function boxRectFor(state: BoxState, now: number, face: BoxFace, floorY: number): BoxRect {
  const phase = boxPhase(state, now);
  const bw = boxWidth(face);
  const bottom = floorY + 4;
  const rimTop = face.bottom + 0.5;
  const hiddenTop = face.top - Math.max(2, face.h * 0.12);
  let top = rimTop;
  let width = bw;
  let alpha = 1;
  if (phase === "enter") {
    const t = easeOut((now - state.bornAt) / ENTER_MS);
    top = bottom - (bottom - rimTop) * t;
    width = bw * (0.72 + 0.28 * t);
  } else if (phase === "hidden") {
    top = hiddenTop;
  } else if (phase === "leave") {
    const t = easeIn((now - state.bornAt - LEAVE_AT) / (BOX_MS - LEAVE_AT));
    top = rimTop + (bottom - rimTop + 10) * t;
    alpha = 1 - t * 0.9;
  } else if (phase === "pop") {
    const t = (now - state.poppedAt) / BOX_POP_MS;
    top = rimTop + 10 * easeIn(t);
    width = bw * (1 + 0.06 * t);
  }
  // 敲箱子：箱沿左右抖两下，只抖箱子不抖人。
  const wiggle = state.knockAt >= 0 && now - state.knockAt <= BOX_KNOCK_MS
    ? Math.sin((now - state.knockAt) / 22) * 2.2 * (1 - (now - state.knockAt) / BOX_KNOCK_MS)
    : 0;
  return { x: face.cx - width / 2 + wiggle, y: top, w: width, h: bottom - top, alpha };
}

/** 探头时脑袋的可点矩形（诊断与探针同一把尺）。 */
export function boxHeadRect(state: BoxState, now: number, face: BoxFace): BoxRect {
  return {
    x: face.cx - face.w * 0.45,
    y: face.top,
    w: face.w * 0.9,
    h: Math.max(4, face.h * 0.85),
    alpha: 1,
  };
}

function inside(rect: BoxRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 点箱子：`head` 只在探头窗口可抓；其余时候点箱面算敲门。 */
export function boxAt(
  state: BoxState,
  now: number,
  face: BoxFace,
  floorY: number,
  x: number,
  y: number,
): "head" | "box" | null {
  const phase = boxPhase(state, now);
  if (phase === "pop" || phase === "gone") return null;
  if (phase === "peek" && inside(boxHeadRect(state, now, face), x, y)) return "head";
  const rect = boxRectFor(state, now, face, floorY);
  return inside(rect, x, y) ? "box" : null;
}

export function catchBox(state: BoxState, now: number): void {
  if (state.poppedAt < 0) state.poppedAt = now;
}

export function knockBox(state: BoxState, now: number): boolean {
  if (state.poppedAt >= 0) return false;
  if (state.knockAt >= 0 && now - state.knockAt < BOX_KNOCK_MS + 160) return false;
  state.knockAt = now;
  state.knocks += 1;
  return true;
}

function flap(points: Array<[number, number]>, fill: string): DrawOp {
  return { kind: "fillPath", fill, points };
}

export function buildBoxOps(state: BoxState, now: number, face: BoxFace, floorY: number): DrawOp[] {
  const phase = boxPhase(state, now);
  if (phase === "gone") return [];
  const rect = boxRectFor(state, now, face, floorY);
  const alpha = rect.alpha;
  if (alpha <= 0.01) return [];
  const { x, y, w, h } = rect;
  const flapH = Math.max(5, h * 0.22);
  const ops: DrawOp[] = [];
  // 后翻的两片纸板先画，箱身压住它们的根。
  ops.push(flap([[x + w * 0.02, y + 1], [x - w * 0.2, y - flapH], [x + w * 0.08, y - flapH * 0.72], [x + w * 0.34, y + 1]], withAlpha(PAPER_SHADE, 0.95 * alpha)));
  ops.push(flap([[x + w * 0.98, y + 1], [x + w * 1.2, y - flapH], [x + w * 0.92, y - flapH * 0.72], [x + w * 0.66, y + 1]], withAlpha(PAPER_SHADE, 0.95 * alpha)));
  ops.push(flap([[x + w * 0.02, y + 1], [x - w * 0.2, y - flapH], [x - w * 0.06, y - flapH * 0.42], [x + w * 0.22, y + 1]], withAlpha(PAPER, 0.9 * alpha)));
  ops.push(flap([[x + w * 0.98, y + 1], [x + w * 1.2, y - flapH], [x + w * 1.06, y - flapH * 0.42], [x + w * 0.78, y + 1]], withAlpha(PAPER, 0.9 * alpha)));
  // 箱身
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.98 * alpha), x, y, w, h, r: Math.min(2.4, w * 0.08) });
  // 右侧厚度
  ops.push(flap([[x + w * 0.86, y + 1], [x + w, y + 1], [x + w, y + h - 1], [x + w * 0.86, y + h - 1]], withAlpha(PAPER_SHADE, 0.9 * alpha)));
  // 盖过脑袋时，箱沿下沿一条阴影让「里面很深」读得出来
  if (phase === "hidden") {
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER_SHADE, 0.55 * alpha), points: [[x + 1, y + 0.6], [x + w - 1, y + 0.6], [x + w - 1, y + 0.6 + Math.max(1.4, h * 0.05)], [x + 1, y + 0.6 + Math.max(1.4, h * 0.05)]] });
  }
  // 胶带：一竖一横，玫瑰色；深桌布上靠奶油箱身托住。
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.92 * alpha), points: [[x + w / 2 - 1.6, y + 1], [x + w / 2 + 1.6, y + 1], [x + w / 2 + 1.6, y + 1 + Math.min(h * 0.42, 12)], [x + w / 2 - 1.6, y + 1 + Math.min(h * 0.42, 12)]] });
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.55 * alpha), points: [[x + 1, y + 3], [x + w - 1, y + 3], [x + w - 1, y + 4.2], [x + 1, y + 4.2]] });
  // 爪印：箱面中央一枚小肉垫
  const px = x + w * 0.5;
  const py = y + h * 0.68;
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.95 * alpha), cx: px, cy: py + 1.2, rx: 2.4, ry: 1.9 });
  for (let i = 0; i < 3; i += 1) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.95 * alpha), cx: px + (i - 1) * 1.5, cy: py - 1.5, rx: 0.85, ry: 0.85 });
  }
  ops.push({ kind: "strokeRoundRect", stroke: withAlpha(ROSE_DEEP, 0.62 * alpha), width: 0.7, x, y, w, h, r: Math.min(2.4, w * 0.08) });
  // 抓住的那一下：箱沿炸开四道奶油线 + 一颗星
  if (phase === "pop") {
    const p = (now - state.poppedAt) / BOX_POP_MS;
    const r = Math.max(7, face.w * 0.42) * (0.7 + p * 1.6);
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(i % 2 === 0 ? PAPER : ROSE, 0.9 * (1 - p)),
        width: 1.3,
        points: [
          [face.cx + Math.cos(a) * r * 0.55, face.top + Math.sin(a) * r * 0.4],
          [face.cx + Math.cos(a) * r, face.top + Math.sin(a) * r * 0.7],
        ],
      });
    }
  }
  return ops;
}

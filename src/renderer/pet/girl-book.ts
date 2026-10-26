/**
 * 看书：一本摊开的书浮在她胸前，点一下翻一页；三页翻完才算读完。
 * 字行是短横线（82px 里画不了真字），页数与翻页动画都由时刻/计数解析。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, INK_SOFT, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BOOK_MS = 7_200;
export const BOOK_SETTLE_MS = 400;
export const BOOK_PAGES = 3;
export const BOOK_TURN_COOLDOWN_MS = 450;

export interface BookFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface BookState {
  bornAt: number;
  seed: number;
  page: number;
  lastTurnAt: number;
}

export type BookPhase = "settle" | "read" | "gone";

export interface BookRect {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

export function createBook(now: number, seed = Math.random()): BookState {
  return { bornAt: now, seed, page: 0, lastTurnAt: -1 };
}

export function bookPhase(state: BookState, now: number): BookPhase {
  const age = now - state.bornAt;
  if (age < 0 || age < BOOK_SETTLE_MS) return "settle";
  return age < BOOK_MS ? "read" : "gone";
}

export function bookAlive(state: BookState, now: number): boolean {
  return bookPhase(state, now) !== "gone";
}

export function bookRectFor(state: BookState, now: number, face: BookFace): BookRect {
  const w = Math.max(26, Math.min(40, face.w * 0.72));
  const h = w * 0.62;
  const age = Math.max(0, now - state.bornAt);
  const settle = Math.min(1, age / BOOK_SETTLE_MS);
  const ease = 1 - (1 - settle) ** 3;
  return {
    x: face.cx - w / 2,
    y: face.bottom - h * 0.55 + (1 - ease) * 6,
    w,
    h,
    alpha: 0.3 + 0.7 * ease,
  };
}

export function turnPage(state: BookState, now: number): boolean {
  if (bookPhase(state, now) !== "read") return false;
  if (state.page >= BOOK_PAGES) return false;
  if (state.lastTurnAt >= 0 && now - state.lastTurnAt < BOOK_TURN_COOLDOWN_MS) return false;
  state.lastTurnAt = now;
  state.page += 1;
  return true;
}

export function bookAtPoint(
  state: BookState,
  now: number,
  face: BookFace,
  x: number,
  y: number,
): boolean {
  if (bookPhase(state, now) !== "read") return false;
  const rect = bookRectFor(state, now, face);
  return x >= rect.x - 3 && x <= rect.x + rect.w + 3 && y >= rect.y - 3 && y <= rect.y + rect.h + 3;
}

export function buildBookOps(state: BookState, now: number, face: BookFace): DrawOp[] {
  if (bookPhase(state, now) === "gone") return [];
  const rect = bookRectFor(state, now, face);
  const { x, y, w, h } = rect;
  const a = rect.alpha;
  const mid = x + w / 2;
  const pageW = w / 2 - 1.6;
  const ops: DrawOp[] = [];
  // 书影 + 封底：先让书落在她怀里。
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.16 * a), cx: mid, cy: y + h + 2, rx: w * 0.52, ry: 1.6 });
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER_SHADE, 0.95 * a), x: x - 0.6, y: y - 0.6, w: w + 1.2, h: h + 1.2, r: 2.2 });
  // 左右两页：奶油纸，书脊压玫瑰。
  for (const side of [-1, 1] as const) {
    const px = side < 0 ? x + 1.4 : mid + 0.2;
    ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.98 * a), x: px, y: y + 0.8, w: pageW, h: h - 1.6, r: 1.4 });
    // 字行：每页三行短横线，行宽随页数轻微变化（像真的在读）。
    for (let line = 0; line < 3; line += 1) {
      const lw = pageW * (0.78 - line * 0.12) * (state.page > 0 ? 1 : 0.82);
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(INK_SOFT, 0.36 * a),
        width: 0.55,
        points: [[px + 2, y + 3.4 + line * 3.4], [px + 2 + lw, y + 3.4 + line * 3.4]],
      });
    }
  }
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.5 * a), width: 0.7, points: [[mid, y + 1], [mid, y + h - 1]] });
  // 刚翻的那一页：右下角卷起来一截。
  if (state.lastTurnAt >= 0 && now - state.lastTurnAt < 380) {
    const p = (now - state.lastTurnAt) / 380;
    const side = state.page % 2 === 1 ? 1 : -1;
    const cx = side > 0 ? x + w - 3 : x + 3;
    ops.push({
      kind: "fillPath",
      fill: withAlpha(PAPER, 0.9 * (1 - p) * a),
      points: [[cx, y + h - 4], [cx + side * 4 * (1 - p), y + h - 8], [cx + side * 5, y + h - 1.4]],
    });
    ops.push({ kind: "strokePath", stroke: withAlpha(ROSE, 0.55 * (1 - p) * a), width: 0.6, points: [[cx, y + h - 4], [cx + side * 4 * (1 - p), y + h - 8]] });
  }
  // 翻页进度：页边三颗小点，读过的点亮。
  for (let i = 0; i < BOOK_PAGES; i += 1) {
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(i < state.page ? ROSE : PAPER_SHADE, 0.9 * a),
      cx: mid + (i - 1) * 3.2,
      cy: y + h + 2.6,
      rx: 0.9,
      ry: 0.9,
    });
  }
  return ops;
}

/**
 * 礼物盒：脚边一只系着缎带的盒子先自己抖两下，点开以后彩纸炸开、浮出一件小奖励。
 * 奖励种类按种子稳定三选一（小鱼干/心/星），只是画法，不产生额外玩法状态。
 */
import { PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, ACCENT, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const GIFT_MS = 6_000;
export const GIFT_OPEN_MIN_MS = 300;
export const GIFT_REVEAL_MS = 1_400;

export interface GiftFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface GiftState {
  bornAt: number;
  seed: number;
  openedAt: number;
}

export type GiftPhase = "shake" | "open" | "gone";
export type GiftReward = "fish" | "heart" | "star";

export interface GiftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createGift(now: number, seed = Math.random()): GiftState {
  return { bornAt: now, seed, openedAt: -1 };
}

export function giftPhase(state: GiftState, now: number): GiftPhase {
  if (now - state.bornAt < 0) return "shake";
  if (state.openedAt >= 0) return now - state.bornAt < GIFT_MS ? "open" : "gone";
  return now - state.bornAt < GIFT_MS ? "shake" : "gone";
}

export function giftAlive(state: GiftState, now: number): boolean {
  return giftPhase(state, now) !== "gone";
}

export function giftRewardKind(seed: number): GiftReward {
  return seed < 1 / 3 ? "fish" : seed < 2 / 3 ? "heart" : "star";
}

export function giftRectFor(state: GiftState, now: number, face: GiftFace, floorY: number): GiftRect {
  const w = Math.max(22, Math.min(32, face.w * 0.6));
  const h = w * 0.7;
  const age = Math.max(0, now - state.bornAt);
  const enter = Math.min(1, age / 260);
  const shake = giftPhase(state, now) === "shake" ? Math.sin(age / 55) * 0.6 : 0;
  return { x: face.cx - w / 2 + shake, y: floorY - h - 1 + (1 - enter) * 5, w, h };
}

export function giftAtPoint(
  state: GiftState,
  now: number,
  face: GiftFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (giftPhase(state, now) === "gone") return false;
  const rect = giftRectFor(state, now, face, floorY);
  return x >= rect.x - 3 && x <= rect.x + rect.w + 3 && y >= rect.y - 3 && y <= rect.y + rect.h + 3;
}

export function openGift(state: GiftState, now: number): boolean {
  const age = now - state.bornAt;
  if (age < GIFT_OPEN_MIN_MS || age >= GIFT_MS) return false;
  if (state.openedAt >= 0) return false;
  state.openedAt = now;
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

export function buildGiftOps(state: GiftState, now: number, face: GiftFace, floorY: number): DrawOp[] {
  const phase = giftPhase(state, now);
  if (phase === "gone") return [];
  const rect = giftRectFor(state, now, face, floorY);
  const { x, y, w, h } = rect;
  const age = Math.max(0, now - state.bornAt);
  const alpha = Math.min(1, age / 240) * Math.min(1, (GIFT_MS - age) / 400);
  const opens = state.openedAt >= 0 ? Math.max(0, now - state.openedAt) : 0;
  const ops: DrawOp[] = [];
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.3 * alpha), cx: x + w / 2, cy: y + h + 1.2, rx: w * 0.55, ry: 1.8 });
  // 盒身：玫瑰纸 + 奶油缎带十字。
  const bodyY = y + h * 0.22;
  const bodyH = h * 0.78;
  ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE, 0.95 * alpha), x, y: bodyY, w, h: bodyH, r: 1.8 });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.92 * alpha), points: [[x + w * 0.43, bodyY], [x + w * 0.57, bodyY], [x + w * 0.57, y + h], [x + w * 0.43, y + h]] });
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.85 * alpha), points: [[x + 1, bodyY + bodyH * 0.42], [x + w - 1, bodyY + bodyH * 0.42], [x + w - 1, bodyY + bodyH * 0.56], [x + 1, bodyY + bodyH * 0.56]] });
  // 盒盖：没拆时盖着，拆开以后掀到左上方。
  if (state.openedAt < 0) {
    ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE_DEEP, 0.96 * alpha), x: x - 1.2, y: y + h * 0.1, w: w + 2.4, h: h * 0.2, r: 1.4 });
  } else {
    const lidY = y + h * 0.1 - Math.min(1, opens / 300) * 6;
    ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE_DEEP, 0.9 * alpha), x: x - 2, y: lidY, w: w + 3, h: h * 0.18, r: 1.4 });
    // 彩纸：从盒口炸开，八片两色。
    const spread = Math.min(1, opens / 600);
    for (let i = 0; i < 10; i += 1) {
      const ang = -Math.PI / 2 + (i / 9 - 0.5) * 2.1;
      const dist = (6 + (i % 3) * 3) * spread;
      const px = x + w / 2 + Math.cos(ang) * dist;
      const py = y + h * 0.2 + Math.sin(ang) * dist - spread * 8;
      ops.push({
        kind: "fillEllipse",
        fill: withAlpha(i % 3 === 0 ? ACCENT : i % 2 === 0 ? PAPER : ROSE_DEEP, 0.85 * alpha * (1 - Math.max(0, opens - GIFT_REVEAL_MS) / 900)),
        cx: px,
        cy: py,
        rx: 1.1 + (i % 2) * 0.5,
        ry: 0.7,
        rot: ang,
      });
    }
    // 奖励：按种子浮起来，拆开 250ms 后出现。
    if (opens > 250) {
      const rise = Math.min(1, (opens - 250) / 500);
      const cx = x + w / 2;
      const cy = y + h * 0.1 - rise * 11;
      const kind = giftRewardKind(state.seed);
      if (kind === "fish") {
        ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx, cy, rx: 3.6, ry: 1.9 });
        ops.push({ kind: "fillPath", fill: withAlpha(ACCENT, 0.9 * alpha), points: [[cx + 3.2, cy], [cx + 6, cy - 2.4], [cx + 6, cy + 2.4]] });
        ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.95 * alpha), cx: cx - 1.6, cy: cy - 0.4, rx: 0.55, ry: 0.55 });
      } else if (kind === "heart") {
        ops.push({
          kind: "fillPath",
          fill: withAlpha(ROSE_DEEP, 0.95 * alpha),
          points: [[cx, cy + 3.2], [cx - 3.6, cy], [cx - 2, cy - 2.2], [cx, cy - 0.8], [cx + 2, cy - 2.2], [cx + 3.6, cy]],
        });
      } else {
        ops.push(star(cx, cy, 3.6, withAlpha(PAPER, 0.95 * alpha)));
        ops.push(star(cx, cy, 2, withAlpha(ACCENT, 0.95 * alpha)));
      }
    }
  }
  return ops;
}

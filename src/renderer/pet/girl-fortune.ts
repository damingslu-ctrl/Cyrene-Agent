/**
 * 每日抽签：一张签纸挂在她脸侧，点一下揭晓今日签文（大吉/中吉/小吉/末吉）。
 * 签只揭一次；档位是「四颗星里亮几颗」，比一行字更像运气本身。
 *
 * 这一轮不算玩法数值，只是每天早上的一点点仪式感——真正的落盘在引擎里，
 * 一天只抽一张，重复打开看到的还是早上那张。
 */
import { INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const FORTUNE_MS = 7_000;
export const FORTUNE_SETTLE_MS = 500;

export interface FortuneFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface FortuneTier {
  name: string;
  line: string;
}

export const FORTUNE_TIERS: readonly FortuneTier[] = [
  { name: "大吉", line: "今天想做的事都会顺" },
  { name: "中吉", line: "慢慢来，也会有好事" },
  { name: "小吉", line: "小确幸就藏在手边" },
  { name: "末吉", line: "歇一歇，明天再说" },
] as const;

export interface FortuneState {
  bornAt: number;
  seed: number;
  revealed: boolean;
  result: { tier: number; line: string } | null;
}

export type FortunePhase = "settle" | "ready" | "gone";

export function createFortune(now: number, seed = Math.random()): FortuneState {
  return { bornAt: now, seed, revealed: false, result: null };
}

export function fortunePhase(state: FortuneState, now: number): FortunePhase {
  const age = now - state.bornAt;
  if (age < 0 || age < FORTUNE_SETTLE_MS) return "settle";
  return age < FORTUNE_MS ? "ready" : "gone";
}

/** roll 是 0..1 的一把签：<0.12 大吉、<0.42 中吉、<0.78 小吉、其余末吉。 */
export function fortuneTierAt(roll: number): number {
  if (roll < 0.12) return 0;
  if (roll < 0.42) return 1;
  if (roll < 0.78) return 2;
  return 3;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface FortuneSlip {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SLIP_W = 16;
const SLIP_H = 22;

export function fortuneSlipAt(state: FortuneState, now: number, face: FortuneFace): FortuneSlip {
  const age = Math.max(0, now - state.bornAt);
  // 挂上去之前从上方垂下来，之后轻轻摆。
  const drop = clamp(age / FORTUNE_SETTLE_MS, 0, 1);
  const sway = Math.sin(age / 640 + state.seed * 6.28) * 1.1;
  const x = clamp(face.cx + face.w * 0.5 - 2 + sway * drop, 2, 82 - SLIP_W - 2);
  const y = face.top + 6 - (1 - drop) * 10;
  return { x, y, w: SLIP_W, h: SLIP_H };
}

function inside(rect: FortuneSlip, x: number, y: number, pad = 2): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

export function fortuneAtPoint(
  state: FortuneState,
  now: number,
  face: FortuneFace,
  x: number,
  y: number,
): boolean {
  if (fortunePhase(state, now) !== "ready") return false;
  return inside(fortuneSlipAt(state, now, face), x, y);
}

export function revealFortune(state: FortuneState, result: { tier: number; line: string }): boolean {
  if (state.revealed) return false;
  state.revealed = true;
  state.result = { tier: result.tier, line: result.line };
  return true;
}

function starPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.36;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return points;
}

export function buildFortuneOps(state: FortuneState, now: number, face: FortuneFace): DrawOp[] {
  const phase = fortunePhase(state, now);
  if (phase === "gone") return [];
  const age = now - state.bornAt;
  const alpha = clamp(age / 260, 0, 1) * clamp((FORTUNE_MS - age) / 800, 0, 1);
  if (alpha <= 0.01) return [];
  const slip = fortuneSlipAt(state, now, face);
  const cx = slip.x + slip.w / 2;
  const ops: DrawOp[] = [];

  // 系绳与挂钉：签纸得先「挂在那儿」。
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(INK_SOFT, 0.55 * alpha),
    width: 0.7,
    points: [[cx + Math.sin(now / 700) * 0.8, face.top + 1], [cx, slip.y + 1.5]],
  });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.9 * alpha), cx, cy: slip.y + 1.2, rx: 1.1, ry: 1.1 });

  // 签纸：奶油底、玫瑰描边、顶端一条红带。
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.97 * alpha), x: slip.x, y: slip.y, w: slip.w, h: slip.h, r: 2 });
  ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE, 0.9 * alpha), x: slip.x + 1, y: slip.y + 2.5, w: slip.w - 2, h: 2.6, r: 1 });
  ops.push({
    kind: "strokeRoundRect",
    stroke: withAlpha(ROSE_DEEP, 0.55 * alpha),
    width: 0.7,
    x: slip.x,
    y: slip.y,
    w: slip.w,
    h: slip.h,
    r: 2,
  });

  if (!state.revealed) {
    // 未揭晓：三道墨痕当「还没读」的字，外加一颗轻轻跳的朱点。
    for (let i = 0; i < 3; i += 1) {
      const yy = slip.y + 9 + i * 3.4;
      ops.push({
        kind: "strokePath",
        stroke: withAlpha(INK_SOFT, 0.42 * alpha),
        width: 0.8,
        points: [[slip.x + 3.5, yy], [slip.x + slip.w - 3.5 - (i === 2 ? 3 : 0), yy]],
      });
    }
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(ROSE, (0.7 + Math.sin(now / 220) * 0.25) * alpha),
      cx: cx,
      cy: slip.y + slip.h - 3.4,
      rx: 1.2,
      ry: 1.2,
    });
  } else {
    const tier = clamp(Math.round(state.result?.tier ?? 3), 0, FORTUNE_TIERS.length - 1);
    // 档位名写在签上；越小的字越要压在中间，免得被卷边吃掉。
    ops.push({
      kind: "text",
      text: FORTUNE_TIERS[tier].name,
      x: cx,
      y: slip.y + 9.6,
      size: 5.6,
      color: withAlpha(tier === 3 ? INK_SOFT : ROSE_DEEP, 0.95 * alpha),
      align: "center",
      maxWidth: slip.w - 4,
    });
    // 四颗星：亮几颗＝这一签有多好。暗星也画出来，才读得出「四颗里亮几颗」。
    const lit = FORTUNE_TIERS.length - tier;
    for (let i = 0; i < FORTUNE_TIERS.length; i += 1) {
      const sx = cx + (i - 1.5) * 4;
      const sy = slip.y + slip.h + 3.6 + Math.sin(now / 260 + i) * 0.4;
      const on = i < lit;
      ops.push({
        kind: "fillPath",
        fill: withAlpha(on ? (i === 0 ? ROSE : ROSE_DEEP) : PAPER_SHADE, (on ? 0.95 : 0.4) * alpha),
        points: starPoints(sx, sy, on ? 2 : 1.7),
      });
    }
    // 揭晓那一下：签纸周围炸一圈亮屑。
    const since = now - state.bornAt;
    if (since >= 0 && since < FORTUNE_MS - 1_200) {
      const p = (since / 900) % 1;
      for (let i = 0; i < 4; i += 1) {
        const ang = -Math.PI / 2 + i * 1.2;
        const d = 6 + p * 8;
        ops.push({
          kind: "fillEllipse",
          fill: withAlpha(i % 2 === 0 ? ROSE : PAPER, (1 - p) * 0.7 * alpha),
          cx: cx + Math.cos(ang) * d,
          cy: slip.y + 10 + Math.sin(ang) * d,
          rx: 0.9,
          ry: 0.9,
        });
      }
    }
  }
  return ops;
}

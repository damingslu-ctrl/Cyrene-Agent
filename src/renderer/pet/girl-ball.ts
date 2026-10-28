/**
 * 拍皮球：她把球往地上拍，球按固定周期弹起，落地的**那一拍**再点一下才算接住。
 * 踩点算连击，半空中抓算掉球（连击清零）；连击三下以上才给星星，免得一眼望去全是星。
 *
 * 弹跳高度是解析量（`4f(1−f)` 抛物线 × 逐拍衰减），不累积积分：掉帧、探针取样、
 * 点击时刻都读同一条曲线，球不会越走越低或穿地。
 */
import { ACCENT, EYE, INK, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const BALL_MS = 9_000;
export const BALL_PERIOD_MS = 820;
/** 落地前后这么久都算踩点。 */
export const BALL_WINDOW_MS = 260;
export const BALL_COOLDOWN_MS = 140;
/** 连击到几下才画星。 */
export const BALL_STAR_STREAK = 3;
const MAX_LIFT_FACTOR = 0.5;
const DECAY = 0.94;
const MIN_AMP = 0.42;
/** 粉笔正字最多记这么多下（再多的字会写出窗）。 */
const TALLY_CAP = 15;

export interface BallFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface BallState {
  bornAt: number;
  seed: number;
  bounces: number;
  drops: number;
  streak: number;
  best: number;
  lastPatAt: number;
}

/** "hit" 踩点拍中 · "off" 半空抓（掉球） · "miss" 没点到/过期/冷却吞掉。 */
export type BallPat = "hit" | "off" | "miss";

export function createBall(now: number, seed = Math.random()): BallState {
  return { bornAt: now, seed, bounces: 0, drops: 0, streak: 0, best: 0, lastPatAt: -1 };
}

export function ballAge(state: BallState, now: number): number {
  // rAF 的帧时间戳是帧起点，可能早于出生那一拍；夹到 0 当「刚出生」，别判死。
  return Math.max(0, now - state.bornAt);
}

export function ballAlive(state: BallState, now: number): boolean {
  return ballAge(state, now) < BALL_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function ampAt(cycle: number): number {
  return Math.max(MIN_AMP, Math.pow(DECAY, cycle));
}

export function ballRadius(face: BallFace): number {
  return clamp(face.w * 0.13, 4.5, 7.5);
}

/** 离地高度（px）：落地那一下正好 0，半周期最高。 */
export function ballLift(state: BallState, now: number, face: BallFace): number {
  const age = ballAge(state, now);
  const cycle = Math.floor(age / BALL_PERIOD_MS);
  const local = age - cycle * BALL_PERIOD_MS;
  const f = local / BALL_PERIOD_MS;
  const maxLift = face.w * MAX_LIFT_FACTOR;
  return ampAt(cycle) * 4 * f * (1 - f) * maxLift;
}

/** 距离最近一次落地还有多久（毫秒，整数运算，边界按「算踩点」）。 */
export function ballToFloorMs(state: BallState, now: number): number {
  const age = ballAge(state, now);
  const cycle = Math.floor(age / BALL_PERIOD_MS);
  const local = age - cycle * BALL_PERIOD_MS;
  return Math.min(local, BALL_PERIOD_MS - local);
}

export function ballAt(state: BallState, now: number, face: BallFace, floorY: number): { x: number; y: number; r: number } {
  const age = ballAge(state, now);
  const r = ballRadius(face);
  const x = face.cx + Math.sin(age / 430 + state.seed * 6) * face.w * 0.16;
  return { x, y: floorY - r - ballLift(state, now, face), r };
}

export function ballAtPoint(
  state: BallState,
  now: number,
  face: BallFace,
  floorY: number,
  x: number,
  y: number,
): boolean {
  if (!ballAlive(state, now)) return false;
  const ball = ballAt(state, now, face, floorY);
  return Math.hypot(x - ball.x, y - ball.y) <= ball.r + 2.6;
}

export function patBall(
  state: BallState,
  now: number,
  face: BallFace,
  floorY: number,
  x: number,
  y: number,
): BallPat {
  if (!ballAtPoint(state, now, face, floorY, x, y)) return "miss";
  if (state.lastPatAt >= 0 && now - state.lastPatAt >= 0 && now - state.lastPatAt < BALL_COOLDOWN_MS) return "miss";
  state.lastPatAt = now;
  if (ballToFloorMs(state, now) <= BALL_WINDOW_MS) {
    state.bounces += 1;
    state.streak += 1;
    state.best = Math.max(state.best, state.streak);
    return "hit";
  }
  state.drops += 1;
  state.streak = 0;
  return "off";
}

function starPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.38;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return points;
}

export function buildBallOps(state: BallState, now: number, face: BallFace, floorY: number): DrawOp[] {
  if (!ballAlive(state, now)) return [];
  const age = ballAge(state, now);
  // 出生就当「已经在这儿」：淡入到 0.42 起步，早于出生的那一帧也画得出球。
  const alpha = Math.min(1, 0.42 + age / 300) * clamp((BALL_MS - age) / 620, 0, 1);
  const ball = ballAt(state, now, face, floorY);
  const lift = ballLift(state, now, face);
  const liftNorm = clamp(lift / (face.w * MAX_LIFT_FACTOR), 0, 1);
  const ops: DrawOp[] = [];
  // 地面影：球越高，影子越小越淡（深桌布上也得有两色关系）。
  ops.push({
    kind: "fillEllipse",
    fill: withAlpha(INK, (0.2 - 0.11 * liftNorm) * alpha),
    cx: ball.x,
    cy: floorY + 1.2,
    rx: ball.r * (1.2 - 0.34 * liftNorm),
    ry: 1.9,
  });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95 * alpha), cx: ball.x, cy: ball.y, rx: ball.r, ry: ball.r });
  // 橡胶条纹：一条深玫瑰横带，球就不是一枚粉点。
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.85 * alpha), cx: ball.x, cy: ball.y, rx: ball.r * 0.92, ry: ball.r * 0.3 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: ball.x - ball.r * 0.34, cy: ball.y - ball.r * 0.38, rx: ball.r * 0.26, ry: ball.r * 0.26 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(EYE, 0.9 * alpha), cx: ball.x + ball.r * 0.28, cy: ball.y + ball.r * 0.22, rx: ball.r * 0.14, ry: ball.r * 0.14 });
  // 墨线描边：74px 下粉球会被吃掉轮廓，这一圈是「双色」的那一笔。
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(INK, 0.7 * alpha), width: 1, cx: ball.x, cy: ball.y, rx: ball.r, ry: ball.r });

  // 踩点的那一下：两圈亮环（描边，不占 fillPath，星星只归连击）。
  const since = state.lastPatAt >= 0 ? now - state.lastPatAt : -1;
  if (since >= 0 && since < 240 && state.streak > 0) {
    const p = since / 240;
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ACCENT, (1 - p) * 0.8 * alpha), width: 1.1, cx: ball.x, cy: ball.y, rx: ball.r * (1.4 + p * 1.6), ry: ball.r * (1.4 + p * 1.6) });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, (1 - p) * 0.6 * alpha), width: 0.8, cx: ball.x, cy: floorY + 1.2, rx: ball.r * (1.6 + p * 2.2), ry: 2.2 });
  }

  // 粉笔正字：每五字一组（四竖一斜），最多三组。
  const tally = Math.min(state.bounces, TALLY_CAP);
  if (tally > 0) {
    const x0 = clamp(face.cx + face.w * 0.5 + 2, 2, 82 - 16);
    const yTop = floorY - 12;
    for (let i = 0; i < tally; i += 1) {
      const group = Math.floor(i / 5);
      const within = i % 5;
      const gx = x0 + group * 15;
      if (within < 4) {
        ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.86 * alpha), width: 0.9, points: [[gx + within * 3, yTop], [gx + within * 3 + 0.6, yTop + 8]] });
        ops.push({ kind: "strokePath", stroke: withAlpha(INK, 0.4 * alpha), width: 0.5, points: [[gx + within * 3 + 0.7, yTop], [gx + within * 3 + 1.3, yTop + 8]] });
      } else {
        ops.push({ kind: "strokePath", stroke: withAlpha(ROSE, 0.9 * alpha), width: 1, points: [[gx - 1.4, yTop + 7], [gx + 10.4, yTop + 1]] });
      }
    }
  }

  // 连击星：三下以上才亮，掉球就收回。
  if (state.streak >= BALL_STAR_STREAK) {
    const bob = Math.sin(now / 200) * 1.2;
    for (let i = 0; i < 2; i += 1) {
      const cx = ball.x + (i === 0 ? -ball.r - 4 : ball.r + 4);
      const cy = ball.y - ball.r - 4 + bob;
      ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.95 * alpha), points: starPoints(cx, cy, 3.4) });
      ops.push({ kind: "fillPath", fill: withAlpha(i === 0 ? ACCENT : ROSE, 0.9 * alpha), points: starPoints(cx, cy, 2) });
    }
  }
  return ops;
}

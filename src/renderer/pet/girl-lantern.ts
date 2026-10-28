/**
 * 入夜小灯笼：她提着一盏小灯，火苗自己呼吸（亮度一直在小幅波动），风把灯吹得轻轻晃，
 * 一只飞蛾绕着灯火转。点火苗会炸亮一下（只持续窗口内），点飞蛾会把它吓跑一圈。
 *
 * 亮度是纯函数：暖机 500ms、常态 0.69..0.95 呼吸、加光期封顶 1、收走前 900ms 淡到 0。
 * 灯与蛾全部画在猫身外，所以每一处记号都是双色（墨底 + 亮色）。
 */
import { ACCENT, INK, INK_SOFT, PAPER, ROSE, ROSE_DEEP, WARN, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const LANTERN_MS = 12_000;
export const LANTERN_COOLDOWN_MS = 200;
/** 炸亮持续多久。 */
export const LANTERN_FLARE_MS = 900;
export const LANTERN_WARM_MS = 500;
export const LANTERN_FADE_MS = 900;
/** 飞蛾轨道半轴。 */
const MOTH_RX = 10;
const MOTH_RY = 6;
const MOTH_PERIOD_MS = 1_400;

export interface LanternFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface LanternState {
  bornAt: number;
  seed: number;
  flares: number;
  /** 吓跑的飞蛾数（它绕回来还得再吓）。 */
  scares: number;
  lastFlareAt: number;
  lastScareAt: number;
  /** 上一次「点中东西」的时刻：冷却只认这个，点蛾子不许白点。 */
  lastTouchAt: number;
}

export type LanternTouch = "flare" | "moth" | "miss";

export function createLantern(now: number, seed = Math.random()): LanternState {
  return { bornAt: now, seed, flares: 0, scares: 0, lastFlareAt: -1, lastScareAt: -1, lastTouchAt: -1 };
}

export function lanternAge(state: LanternState, now: number): number {
  // 帧起点可能早于出生那一拍：夹到 0 当「刚出生」，别判死。
  return Math.max(0, now - state.bornAt);
}

export function lanternAlive(state: LanternState, now: number): boolean {
  return lanternAge(state, now) < LANTERN_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 火光 0..1。暖机从 0 起来，常态是两列不同周期的正弦叠出来的呼吸
 * （只靠一列的话，采样步长撞上周期会被读成常亮）。
 */
export function lanternGlow(state: LanternState, now: number): number {
  const age = lanternAge(state, now);
  const warm = clamp(age / LANTERN_WARM_MS, 0, 1);
  const breath = 0.82 + 0.08 * Math.sin(age / 210 + state.seed * 7) + 0.05 * Math.sin(age / 77 + state.seed * 13);
  let flare = 0;
  if (state.lastFlareAt >= 0) {
    const since = now - state.lastFlareAt;
    if (since >= 0 && since < LANTERN_FLARE_MS) flare = (1 - since / LANTERN_FLARE_MS) * 0.45;
  }
  const fade = clamp((LANTERN_MS - age) / LANTERN_FADE_MS, 0, 1);
  return clamp(warm * (breath + flare), 0, 1) * fade;
}

/** 灯身（含提梁下沿）；x 是晃出来的，摆幅有界。 */
export function lanternBodyAt(
  state: LanternState,
  now: number,
  face: LanternFace,
  floorY: number,
): { x: number; y: number; w: number; h: number; sway: number } {
  const age = lanternAge(state, now);
  const sway = Math.sin(age / 620 + state.seed * 5) * 2.2 + Math.sin(age / 240) * 0.5;
  const w = clamp(face.w * 0.28, 10, 14);
  const h = w * 1.18;
  const x = face.cx + face.w * 0.3 + sway - w / 2;
  const y = floorY - h - 12;
  return { x, y, w, h, sway };
}

export function lanternFlameAt(
  state: LanternState,
  now: number,
  face: LanternFace,
  floorY: number,
): { x: number; y: number; r: number } {
  const body = lanternBodyAt(state, now, face, floorY);
  return {
    x: clamp(body.x + body.w / 2 + body.sway * 0.25, 2, 80),
    y: body.y + body.h * 0.62,
    r: body.w * 0.24,
  };
}

export function mothAt(
  state: LanternState,
  now: number,
  face: LanternFace,
  floorY: number,
): { x: number; y: number; flap: number } {
  const flame = lanternFlameAt(state, now, face, floorY);
  const age = lanternAge(state, now);
  // 被吓跑的那 1.6 秒把轨道撑大一圈，然后自己绕回来。
  const since = state.lastScareAt >= 0 ? now - state.lastScareAt : -1;
  const grow = since >= 0 && since < 1_600 ? 1.5 : 1;
  const ang = (age / MOTH_PERIOD_MS) * Math.PI * 2 + state.seed * 6;
  return {
    x: clamp(flame.x + Math.cos(ang) * MOTH_RX * grow, 2, 80),
    y: clamp(flame.y + Math.sin(ang) * MOTH_RY * grow, 2, floorY + 4),
    flap: Math.sin(age / 60),
  };
}

export function flareLantern(
  state: LanternState,
  now: number,
  face: LanternFace,
  floorY: number,
  x: number,
  y: number,
): LanternTouch {
  if (!lanternAlive(state, now)) return "miss";
  if (state.lastTouchAt >= 0 && now - state.lastTouchAt >= 0 && now - state.lastTouchAt < LANTERN_COOLDOWN_MS) return "miss";
  const flame = lanternFlameAt(state, now, face, floorY);
  if (Math.hypot(x - flame.x, y - flame.y) <= flame.r + 3.2) {
    state.lastTouchAt = now;
    state.lastFlareAt = now;
    state.flares += 1;
    return "flare";
  }
  const moth = mothAt(state, now, face, floorY);
  if (Math.hypot(x - moth.x, y - moth.y) <= 4.2) {
    state.lastTouchAt = now;
    state.lastScareAt = now;
    state.scares += 1;
    return "moth";
  }
  return "miss";
}

export function buildLanternOps(
  state: LanternState,
  now: number,
  face: LanternFace,
  floorY: number,
): DrawOp[] {
  if (!lanternAlive(state, now)) return [];
  const age = lanternAge(state, now);
  const alpha = Math.min(1, 0.42 + age / 300) * clamp((LANTERN_MS - age) / 620, 0, 1);
  const glow = lanternGlow(state, now);
  const body = lanternBodyAt(state, now, face, floorY);
  const flame = lanternFlameAt(state, now, face, floorY);
  const moth = mothAt(state, now, face, floorY);
  const ops: DrawOp[] = [];

  // 地上一摊暖光：双色关系靠墨底撑住，深桌布上也读得出「这儿亮」。
  ops.push({ kind: "fillEllipse", fill: withAlpha(WARN, 0.2 * glow * alpha), cx: body.x + body.w / 2, cy: floorY + 1.6, rx: body.w * (0.9 + glow * 0.5), ry: 2.4 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.34 * glow * alpha), width: 0.7, cx: body.x + body.w / 2, cy: floorY + 1.6, rx: body.w * (0.9 + glow * 0.5), ry: 2.4 });

  // 提梁 + 挂钩：从她爪子那儿斜下去，灯才不是飘在那儿的。
  const hookX = face.cx + face.w * 0.16;
  const hookY = face.bottom - 4;
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(INK_SOFT, 0.9 * alpha),
    width: 1,
    points: [[hookX, hookY], [body.x + body.w / 2, body.y - 3.4]],
  });
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.4 * alpha), width: 0.5, points: [[hookX, hookY - 0.8], [body.x + body.w / 2, body.y - 4.2]] });

  // 灯身：奶油壳 + 墨框 + 玫瑰骨架（画在身外，必须双色）。
  ops.push({ kind: "fillRoundRect", fill: withAlpha(PAPER, 0.9 * alpha), x: body.x, y: body.y, w: body.w, h: body.h, r: body.w * 0.34 });
  ops.push({ kind: "strokeRoundRect", stroke: withAlpha(INK, 0.75 * alpha), width: 1, x: body.x, y: body.y, w: body.w, h: body.h, r: body.w * 0.34 });
  for (const at of [0.33, 0.66]) {
    ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.7 * alpha), width: 0.7, points: [[body.x + body.w * at, body.y + 0.8], [body.x + body.w * at, body.y + body.h - 0.8]] });
  }
  ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE, 0.85 * alpha), x: body.x + body.w * 0.22, y: body.y - 1.6, w: body.w * 0.56, h: 2, r: 0.8 });
  ops.push({ kind: "fillRoundRect", fill: withAlpha(INK_SOFT, 0.8 * alpha), x: body.x + body.w * 0.28, y: body.y + body.h, w: body.w * 0.44, h: 1.6, r: 0.6 });

  // 灯里的火：一弯月牙 + 一枚亮芯，亮度跟着 glow 走。
  ops.push({ kind: "crescent", fill: withAlpha(WARN, (0.55 + 0.4 * glow) * alpha), cx: flame.x, cy: flame.y, r: flame.r * (1 + glow * 0.25), dx: flame.r * 0.42, dy: -flame.r * 0.36, cut: flame.r * 0.9 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, (0.6 + 0.38 * glow) * alpha), cx: flame.x, cy: flame.y + flame.r * 0.1, rx: flame.r * 0.34, ry: flame.r * 0.46 });

  // 光晕两圈（呼吸）+ 炸亮时 extra 的第四圈与火星。
  for (const mul of [1.5, 2.2]) {
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(WARN, 0.3 * glow * alpha), width: 0.7, cx: flame.x, cy: flame.y, rx: flame.r * mul * (1 + glow * 0.3), ry: flame.r * mul * 0.86 });
  }
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.16 * glow * alpha), cx: flame.x, cy: flame.y, rx: flame.r * 2.6 * (0.8 + glow * 0.4), ry: flame.r * 2.2 * (0.8 + glow * 0.4) });
  const since = state.lastFlareAt >= 0 ? now - state.lastFlareAt : -1;
  if (since >= 0 && since < LANTERN_FLARE_MS) {
    const p = since / LANTERN_FLARE_MS;
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(ACCENT, (1 - p) * 0.7 * alpha), width: 1, cx: flame.x, cy: flame.y, rx: flame.r * (1.8 + p * 3.4), ry: flame.r * (1.8 + p * 3.4) });
    for (let i = 0; i < 4; i += 1) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 2 + p * 0.6;
      const rad = flame.r * (1.6 + p * 3.2);
      ops.push({ kind: "fillEllipse", fill: withAlpha(i % 2 === 0 ? PAPER : WARN, (1 - p) * 0.9 * alpha), cx: flame.x + Math.cos(ang) * rad, cy: flame.y + Math.sin(ang) * rad * 0.8, rx: 1.1 - p * 0.5, ry: 1.1 - p * 0.5 });
    }
  }

  // 飞蛾：两翼双色，翅随 flap 张合。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: moth.x, cy: moth.y, rx: 1.1 + moth.flap * 0.5, ry: 1.5 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.8 * alpha), cx: moth.x - 2.2, cy: moth.y - 0.4, rx: 1.6, ry: 1.1 + moth.flap * 0.5 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.8 * alpha), cx: moth.x + 2.2, cy: moth.y - 0.4, rx: 1.6, ry: 1.1 - moth.flap * 0.5 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(INK, 0.55 * alpha), width: 0.6, cx: moth.x, cy: moth.y, rx: 2.6, ry: 2 });
  return ops;
}

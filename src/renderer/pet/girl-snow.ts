/**
 * 下雪与堆雪人：一场 24s 的雪，雪花铺满整窗，她脚边慢慢积起三堆雪。
 * 每堆只能拍实一次（点堆＝按一掌），三堆都拍实才立起雪人——雪人是「攒出来的」，
 * 不是开场就摆好的布景，所以先有雪、再有堆、最后才有人。
 *
 * 雪花是解析量：位置/速度只由 seed、序号和时间推出来，不存粒子数组，
 * 掉帧不会让雪下得慢一截，重开一轮也不会沿用上一轮的随机数。
 */
import { ACCENT, INK_SOFT, PAPER, PAPER_SHADE, ROSE, WARN, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const SNOW_MS = 24_000;
export const SNOW_FLAKES = 30;
export const SNOW_PILES = 3;
export const SNOW_PACK_COOLDOWN_MS = 300;

export interface SnowFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface SnowState {
  bornAt: number;
  seed: number;
  /** 三堆各自是否已经被拍实。 */
  packed: boolean[];
  lastPackAt: number;
  /** 第三堆拍实的时刻；-1 表示雪人还没立起来。 */
  builtAt: number;
}

export interface SnowFlake {
  x: number;
  y: number;
  r: number;
}

export interface SnowPile {
  x: number;
  y: number;
  w: number;
  h: number;
  packed: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 稳定伪随机：同一个 seed + 序号永远得到同一片雪，截图比对才有意义。 */
function rand(i: number, seed: number, salt: number): number {
  const v = Math.sin((i + 1) * 12.9898 + seed * 78.233 + salt * 37.719) * 43_758.5453;
  return v - Math.floor(v);
}

export function createSnow(now: number, seed = Math.random()): SnowState {
  return {
    bornAt: now,
    seed,
    packed: Array.from({ length: SNOW_PILES }, () => false),
    lastPackAt: -1,
    builtAt: -1,
  };
}

export function snowAlive(state: SnowState, now: number): boolean {
  const age = now - state.bornAt;
  return age >= 0 && age < SNOW_MS;
}

/** 入场 700ms 淡入、收尾 1000ms 淡出；雪花与积雪共用同一条包络。 */
export function snowAmount(state: SnowState, now: number): number {
  if (!snowAlive(state, now) && now - state.bornAt >= SNOW_MS) return 0;
  const age = Math.max(0, now - state.bornAt);
  return clamp(Math.min(1, age / 700, (SNOW_MS - age) / 1_000), 0, 1);
}

export function snowflakeAt(state: SnowState, i: number, now: number, w: number, h: number): SnowFlake {
  const age = Math.max(0, now - state.bornAt);
  const speed = 38 + rand(i, state.seed, 1) * 52;
  const sway = Math.sin(age / 900 + i * 1.7 + state.seed * 6.28) * 2.2;
  const x = clamp(rand(i, state.seed, 2) * w + sway, -4, w + 4);
  const fall = (rand(i, state.seed, 3) * (h + 8) + (age / 1_000) * speed) % (h + 8);
  return { x, y: fall - 8, r: 0.7 + rand(i, state.seed, 4) * 0.9 };
}

export function snowPileAt(state: SnowState, now: number, face: SnowFace, floorY: number, i: number): SnowPile {
  const spacing = Math.min(15, face.w * 0.34);
  const cx = face.cx + (i - 1) * spacing;
  const w = 12;
  return {
    x: clamp(cx - w / 2, 0, Math.max(0, 82 - w)),
    // 收尾时雪堆跟着雪一起化掉，往下缩而不是原地消失。
    y: floorY - 5 + (1 - snowAmount(state, now)) * 3,
    w,
    h: 6,
    packed: state.packed[i] === true,
  };
}

export function packSnow(state: SnowState, now: number, index: number): boolean {
  if (!snowAlive(state, now)) return false;
  if (!Number.isInteger(index) || index < 0 || index >= SNOW_PILES) return false;
  if (state.packed[index]) return false;
  if (state.lastPackAt >= 0 && now - state.lastPackAt < SNOW_PACK_COOLDOWN_MS) return false;
  state.packed[index] = true;
  state.lastPackAt = now;
  if (snowmanBuilt(state) && state.builtAt < 0) state.builtAt = now;
  return true;
}

export function snowmanBuilt(state: SnowState): boolean {
  return state.packed.every(Boolean);
}

function snowmanOps(state: SnowState, now: number, face: SnowFace, floorY: number): DrawOp[] {
  const grow = clamp((now - state.builtAt) / 420, 0, 1);
  const scale = 0.55 + 0.45 * grow;
  // 雪人站在最右那堆雪上，不抢她脸的正中。
  const cx = clamp(face.cx + Math.min(15, face.w * 0.34), 12, 70);
  const base = floorY;
  const bodyR = 6.5 * scale;
  const headR = 4.6 * scale;
  const bodyCy = base - 7 * scale;
  const headCy = bodyCy - 6.5 * scale;
  const alpha = 0.98 * grow + 0.02;
  const ops: DrawOp[] = [];

  ops.push({
    kind: "fillPath",
    fill: withAlpha(PAPER, alpha),
    points: [
      [cx - bodyR, bodyCy + 2 * scale],
      [cx - bodyR * 0.9, bodyCy - bodyR * 0.6],
      [cx - bodyR * 0.45, bodyCy - bodyR],
      [cx + bodyR * 0.45, bodyCy - bodyR],
      [cx + bodyR * 0.9, bodyCy - bodyR * 0.6],
      [cx + bodyR, bodyCy + 2 * scale],
    ],
  });
  ops.push({
    kind: "fillPath",
    fill: withAlpha(PAPER, alpha),
    points: [
      [cx - headR, headCy + headR * 0.6],
      [cx - headR * 0.85, headCy - headR * 0.35],
      [cx, headCy - headR],
      [cx + headR * 0.85, headCy - headR * 0.35],
      [cx + headR, headCy + headR * 0.6],
    ],
  });
  // 帽子：墨蓝小毡帽 + 奶油帽檐，深桌布上也读得出轮廓。
  ops.push({
    kind: "fillPath",
    fill: withAlpha(INK_SOFT, alpha),
    points: [
      [cx - headR * 0.7, headCy - headR],
      [cx - headR * 0.55, headCy - headR * 1.9],
      [cx + headR * 0.55, headCy - headR * 1.9],
      [cx + headR * 0.7, headCy - headR],
    ],
  });
  ops.push({
    kind: "fillPath",
    fill: withAlpha(PAPER_SHADE, alpha),
    points: [
      [cx - headR * 0.95, headCy - headR * 0.95],
      [cx + headR * 0.95, headCy - headR * 0.95],
      [cx + headR * 0.95, headCy - headR * 0.6],
      [cx - headR * 0.95, headCy - headR * 0.6],
    ],
  });
  // 蓝围巾＝与客户端主色同一条，脖颈一圈 + 一截垂下来。
  ops.push({
    kind: "fillPath",
    fill: withAlpha(ACCENT, alpha),
    points: [
      [cx - headR * 0.95, headCy + headR * 0.35],
      [cx + headR * 0.95, headCy + headR * 0.35],
      [cx + headR * 1.05, headCy + headR * 0.85],
      [cx - headR * 1.05, headCy + headR * 0.85],
    ],
  });
  ops.push({
    kind: "fillPath",
    fill: withAlpha(ACCENT, 0.9 * alpha),
    points: [
      [cx + headR * 0.55, headCy + headR * 0.8],
      [cx + headR * 1.15, headCy + headR * 2.1],
      [cx + headR * 1.55, headCy + headR * 1.85],
      [cx + headR * 0.95, headCy + headR * 0.75],
    ],
  });
  // 脸：两颗墨点 + 一根胡萝卜鼻（玫瑰深）。
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, alpha), cx: cx - headR * 0.35, cy: headCy - headR * 0.1, rx: 0.6, ry: 0.6 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, alpha), cx: cx + headR * 0.35, cy: headCy - headR * 0.1, rx: 0.6, ry: 0.6 });
  ops.push({
    kind: "fillPath",
    fill: withAlpha(WARN, alpha),
    points: [
      [cx + headR * 0.05, headCy + headR * 0.3],
      [cx + headR * 0.75, headCy + headR * 0.45],
      [cx + headR * 0.05, headCy + headR * 0.55],
    ],
  });
  // 身上的三颗扣子。
  for (let i = 0; i < 3; i += 1) {
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(ROSE, 0.85 * alpha),
      cx,
      cy: bodyCy - bodyR * 0.5 + i * bodyR * 0.55,
      rx: 0.7,
      ry: 0.7,
    });
  }
  // 立起来那一刻的雪尘：一圈往外炸的白点。
  const since = now - state.builtAt;
  if (since >= 0 && since < 700) {
    const p = since / 700;
    for (let i = 0; i < 5; i += 1) {
      const ang = -Math.PI / 2 + (i - 2) * 0.55;
      const d = 4 + p * 12;
      ops.push({
        kind: "fillEllipse",
        fill: withAlpha(PAPER, (1 - p) * 0.85),
        cx: cx + Math.cos(ang) * d,
        cy: base - 4 + Math.sin(ang) * d * 0.6,
        rx: 1.2 * (1 - p * 0.5),
        ry: 1.2 * (1 - p * 0.5),
      });
    }
  }
  return ops;
}

export function buildSnowOps(
  state: SnowState,
  now: number,
  w: number,
  h: number,
  face: SnowFace,
  floorY: number,
): DrawOp[] {
  if (!snowAlive(state, now)) return [];
  const amount = snowAmount(state, now);
  if (amount <= 0.01) return [];
  const ops: DrawOp[] = [];
  for (let i = 0; i < SNOW_FLAKES; i += 1) {
    const flake = snowflakeAt(state, i, now, w, h);
    // 三成雪花带一点蓝，雪才不会像一团灰点。
    const cool = i % 3 === 0;
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(cool ? ACCENT : PAPER, (cool ? 0.55 : 0.8) * amount),
      cx: flake.x,
      cy: flake.y,
      rx: flake.r,
      ry: flake.r,
    });
  }
  for (let i = 0; i < SNOW_PILES; i += 1) {
    const pile = snowPileAt(state, now, face, floorY, i);
    const a = amount * (pile.packed ? 1 : 0.72);
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(PAPER, 0.9 * a),
      cx: pile.x + pile.w / 2,
      cy: pile.y + pile.h * 0.55,
      rx: pile.w / 2,
      ry: pile.h * 0.55,
    });
    ops.push({
      kind: "fillEllipse",
      fill: withAlpha(PAPER_SHADE, 0.5 * a),
      cx: pile.x + pile.w / 2,
      cy: pile.y + pile.h * 0.82,
      rx: pile.w * 0.34,
      ry: 1.1,
    });
    if (pile.packed) {
      ops.push({
        kind: "fillEllipse",
        fill: withAlpha(PAPER, 0.75 * a),
        cx: pile.x + pile.w * 0.62,
        cy: pile.y + pile.h * 0.34,
        rx: 1.3,
        ry: 0.9,
      });
    }
  }
  if (snowmanBuilt(state) && state.builtAt >= 0) ops.push(...snowmanOps(state, now, face, floorY));
  return ops;
}

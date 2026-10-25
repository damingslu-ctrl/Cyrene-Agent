/**
 * 雨天：窗外下起小雨，雨丝斜着落，脚边溅起水花。纯氛围层，不参与点击。
 * 每颗雨滴的位置由序号哈希 + 时刻解析，窗口多大就下多大，不存粒子。
 */
import { ACCENT, PAPER, PAPER_SHADE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const RAIN_MS = 20_000;
export const RAIN_DROPS = 26;

export interface RainState {
  bornAt: number;
  seed: number;
}

export function createRain(now: number, seed = Math.random()): RainState {
  return { bornAt: now, seed };
}

export function rainAlive(state: RainState, now: number): boolean {
  const age = now - state.bornAt;
  return age >= 0 && age < RAIN_MS;
}

/** 收放包络：入场 600ms、收尾 900ms。 */
export function rainAmount(state: RainState, now: number): number {
  const age = now - state.bornAt;
  if (age < 0 || age >= RAIN_MS) return 0;
  return Math.min(1, age / 600, (RAIN_MS - age) / 900);
}

function hash(n: number, seed: number): number {
  const v = Math.sin(n * 127.1 + seed * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}

export interface RainDrop {
  x: number;
  y: number;
  len: number;
  /** 贴近地面时 >0，用来画水花。 */
  splash: number;
}

/** 第 i 颗雨滴在 w×h 画布里的位置；落到地面（h）之前水花为 0。 */
export function rainDropAt(state: RainState, i: number, now: number, w: number, h: number): RainDrop {
  const t = Math.max(0, now - state.bornAt) / 1000;
  const speed = 34 + hash(i * 2.7, state.seed) * 30;
  const x0 = hash(i * 4.3 + 1, state.seed) * w;
  const span = h + 26;
  const y = ((hash(i * 7.9 + 3, state.seed) * span + t * speed) % span) - 14;
  const drift = Math.sin(now / 1400 + i * 1.7) * 1.6;
  const x = x0 + drift;
  const len = 3.2 + hash(i * 5.1 + 5, state.seed) * 4.4;
  const splash = y > h - 8 ? Math.min(1, (y - (h - 8)) / 8) : 0;
  return { x, y, len, splash };
}

export function buildRainOps(state: RainState, now: number, w: number, h: number): DrawOp[] {
  const amount = rainAmount(state, now);
  if (amount <= 0.01 || w <= 0 || h <= 0) return [];
  const ops: DrawOp[] = [];
  for (let i = 0; i < RAIN_DROPS; i += 1) {
    const drop = rainDropAt(state, i, now, w, h);
    const a = (0.35 + hash(i * 3.3, state.seed) * 0.4) * amount;
    // 双色雨丝：奶油粗底 + 蓝色细线，深桌布上不会「像划痕」。
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(PAPER, a * 0.32),
      width: 1.7,
      points: [[drop.x, drop.y], [drop.x - 1.4, drop.y + drop.len]],
    });
    ops.push({
      kind: "strokePath",
      stroke: withAlpha(ACCENT, a),
      width: 0.75,
      points: [[drop.x, drop.y], [drop.x - 1.4, drop.y + drop.len]],
    });
    if (drop.splash > 0) {
      const p = drop.splash;
      ops.push({
        kind: "strokeEllipse",
        stroke: withAlpha(PAPER, 0.5 * amount * (1 - p * 0.5)),
        width: 0.8,
        cx: drop.x - 1.4,
        cy: h - 1.5,
        rx: 2 + p * 3.2,
        ry: 0.9 + p * 1.1,
      });
    }
  }
  // 顶上的一层薄雾：奶油色横带把「雨是从上面来的」交代清楚。
  ops.push({ kind: "fillPath", fill: withAlpha(PAPER_SHADE, 0.12 * amount), points: [[0, 0], [w, 0], [w, 2.4], [0, 2.4]] });
  return ops;
}

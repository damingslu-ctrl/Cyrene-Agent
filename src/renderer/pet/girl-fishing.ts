/**
 * 钓鱼：脚边支一汪水，她握着小鱼竿。甩线 900ms 后开始等，鱼按表咬钩
 * （每口 900ms 窗口），窗口内点浮标上鱼，平静时点算空竿，走完没收就是跑鱼。
 *
 * 咬钩表是常量：探针、画法、命中读同一张表；「跑鱼」计数在查相位时幂等补账，
 * 所以渲染器不必额外 tick 也不会漏记（seen 里存已经结过账的口号）。
 */
import { ACCENT, EYE, INK, INK_SOFT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const FISH_MS = 15_000;
export const FISH_CAST_MS = 900;
export const FISH_BITE_MS = 900;
export const FISH_COOLDOWN_MS = 120;
/** 一口咬下去的时长；上鱼闪光比它短，收完就没了。 */
export const FISH_FLASH_MS = 700;

export interface FishBit {
  at: number;
}

/** 四口：越往后越犹豫，节奏像真的在等。 */
export const FISH_BITS: readonly FishBit[] = [
  { at: 2_600 },
  { at: 5_400 },
  { at: 8_600 },
  { at: 11_800 },
];

const LAST_BITE_END = FISH_BITS[FISH_BITS.length - 1].at + FISH_BITE_MS;

export interface FishingFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface FishingState {
  bornAt: number;
  seed: number;
  catches: number;
  misses: number;
  escaped: number;
  lastCatchAt: number;
  lastReelAt: number;
  /** 已经收过杆的口号。 */
  reeled: number[];
  /** 已经结过账（跑鱼）的口号。 */
  settled: number[];
}

export type FishPhase = "cast" | "wait" | "bite" | "haul" | "gone";
export type FishReel = "catch" | "nibble" | "empty" | "miss";

export function createFishing(now: number, seed = Math.random()): FishingState {
  return {
    bornAt: now, seed, catches: 0, misses: 0, escaped: 0,
    lastCatchAt: -1, lastReelAt: -1, reeled: [], settled: [],
  };
}

export function fishAge(state: FishingState, now: number): number {
  // 帧起点可能早于出生那一拍：夹到 0 当「刚出生」，别判死。
  return Math.max(0, now - state.bornAt);
}

export function fishingAlive(state: FishingState, now: number): boolean {
  return fishAge(state, now) < FISH_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 当前在第几口里（不在任何窗口内给 -1）。 */
export function fishBiteIndex(state: FishingState, now: number): number {
  const age = fishAge(state, now);
  for (let i = 0; i < FISH_BITS.length; i += 1) {
    const local = age - FISH_BITS[i].at;
    if (local >= 0 && local < FISH_BITE_MS) return i;
  }
  return -1;
}

export function fishPhaseAt(state: FishingState, now: number): FishPhase {
  if (!fishingAlive(state, now)) return "gone";
  const age = fishAge(state, now);
  // 顺手补跑鱼的账：相位查询每帧都走，这里幂等，不会重复记。
  for (let i = 0; i < FISH_BITS.length; i += 1) {
    const end = FISH_BITS[i].at + FISH_BITE_MS;
    if (age >= end && !state.reeled.includes(i) && !state.settled.includes(i)) {
      state.settled.push(i);
      state.escaped += 1;
    }
  }
  if (age < FISH_CAST_MS) return "cast";
  if (age >= LAST_BITE_END) return "haul";
  return fishBiteIndex(state, now) >= 0 ? "bite" : "wait";
}

/** 水塘中心（在她脚前偏一侧，不挡她自己的脸）。 */
function pondCenter(face: FishingFace, floorY: number): { x: number; y: number; rx: number; ry: number } {
  return {
    x: face.cx + face.w * 0.34,
    y: floorY - 1.5,
    rx: clamp(face.w * 0.34, 12, 19),
    ry: 3.4,
  };
}

export function fishBobberAt(
  state: FishingState,
  now: number,
  face: FishingFace,
  floorY: number,
): { x: number; y: number; r: number; dip: number } {
  const age = fishAge(state, now);
  const pond = pondCenter(face, floorY);
  const r = clamp(face.w * 0.075, 2.6, 4);
  // 甩线：浮标从她爪子那儿划一道弧飞出去，落点就是水塘心。
  if (age < FISH_CAST_MS) {
    const p = clamp(age / FISH_CAST_MS, 0, 1);
    const fromX = face.cx + face.w * 0.05;
    const fromY = face.bottom - 6;
    const toY = pond.y - r;
    return {
      x: fromX + (pond.x - fromX) * p,
      y: fromY + (toY - fromY) * p - Math.sin(p * Math.PI) * face.h * 0.35,
      r,
      dip: 0,
    };
  }
  const idx = fishBiteIndex(state, now);
  let dip = 0.35 * Math.sin(age / 300 + state.seed * 5);
  let drift = Math.sin(age / 540 + state.seed * 3) * 1.6;
  if (idx >= 0) {
    const local = age - FISH_BITS[idx].at;
    // 咬钩：三口短促的下沉，一口比一口深，手指看得见「就是现在」。
    const p = local / FISH_BITE_MS;
    dip = 1.6 + Math.abs(Math.sin(p * Math.PI * 3)) * (2.2 + p * 2.6);
    drift += Math.sin(local / 70) * 1.2;
  } else if (age >= LAST_BITE_END) {
    const p = clamp((age - LAST_BITE_END) / (FISH_MS - LAST_BITE_END), 0, 1);
    // 收竿：浮标一路被拖回她手边，最后停在那儿。
    const fromX = pond.x;
    const toX = face.cx + face.w * 0.05;
    dip = 0.6 + p * 1.2;
    return { x: fromX + (toX - fromX) * p, y: pond.y - r + dip, r, dip };
  }
  return { x: pond.x + drift, y: pond.y - r + dip, r, dip };
}

export function reelFish(
  state: FishingState,
  now: number,
  face: FishingFace,
  floorY: number,
  x: number,
  y: number,
): FishReel {
  if (!fishingAlive(state, now)) return "miss";
  const bob = fishBobberAt(state, now, face, floorY);
  if (Math.hypot(x - bob.x, y - bob.y) > bob.r + 5) return "miss";
  if (state.lastReelAt >= 0 && now - state.lastReelAt >= 0 && now - state.lastReelAt < FISH_COOLDOWN_MS) return "miss";
  state.lastReelAt = now;
  const idx = fishBiteIndex(state, now);
  if (idx >= 0) {
    if (state.reeled.includes(idx)) return "nibble";
    state.reeled.push(idx);
    state.settled.push(idx);
    state.catches += 1;
    state.lastCatchAt = now;
    return "catch";
  }
  const phase = fishPhaseAt(state, now);
  if (phase !== "wait") return "miss";
  state.misses += 1;
  return "empty";
}

export function buildFishingOps(
  state: FishingState,
  now: number,
  face: FishingFace,
  floorY: number,
): DrawOp[] {
  if (!fishingAlive(state, now)) return [];
  const age = fishAge(state, now);
  const alpha = Math.min(1, 0.42 + age / 300) * clamp((FISH_MS - age) / 620, 0, 1);
  const pond = pondCenter(face, floorY);
  const bob = fishBobberAt(state, now, face, floorY);
  const phase = fishPhaseAt(state, now);
  const ops: DrawOp[] = [];

  // 一汪水：墨底压住、奶油描一圈（画在猫身外，双色才在深桌布上读得出）。
  ops.push({ kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.42 * alpha), cx: pond.x, cy: pond.y, rx: pond.rx, ry: pond.ry });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.72 * alpha), width: 0.9, cx: pond.x, cy: pond.y, rx: pond.rx, ry: pond.ry });
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.4 * alpha), width: 0.7, points: [[pond.x - pond.rx * 0.6, pond.y - 1], [pond.x - pond.rx * 0.1, pond.y - 1.6], [pond.x + pond.rx * 0.5, pond.y - 1]] });

  // 竿与线：竿从她爪子斜伸出去，线吊着浮标。
  const paw = { x: face.cx + face.w * 0.2, y: face.bottom - 5 };
  const tip = { x: bob.x - 2, y: paw.y - face.h * 0.55 };
  ops.push({ kind: "strokePath", stroke: withAlpha(INK, 0.85 * alpha), width: 1.2, points: [[paw.x, paw.y], [tip.x, tip.y]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.6 * alpha), width: 0.6, points: [[paw.x + 0.6, paw.y - 0.4], [tip.x + 0.6, tip.y - 0.4]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.7 * alpha), width: 0.6, points: [[tip.x, tip.y], [bob.x, bob.y - bob.r]] });

  // 浮标：红头白身，沉下去的时候整颗往下带。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx: bob.x, cy: bob.y, rx: bob.r, ry: bob.r });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95 * alpha), cx: bob.x, cy: bob.y - bob.r * 0.9, rx: bob.r * 0.7, ry: bob.r * 0.7 });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(INK, 0.6 * alpha), width: 0.6, cx: bob.x, cy: bob.y, rx: bob.r, ry: bob.r });

  // 咬钩：涟漪三圈 + 「就是现在」的箭头点。
  if (phase === "bite") {
    const local = age - (FISH_BITS[fishBiteIndex(state, now)]?.at ?? age);
    const p = clamp(local / FISH_BITE_MS, 0, 1);
    for (const mul of [1.4, 2.2, 3]) {
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(ACCENT, (0.8 - p * 0.5) * alpha), width: 0.8, cx: bob.x, cy: pond.y, rx: bob.r * mul * (1 + p), ry: bob.r * mul * 0.42 * (1 + p) });
    }
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: bob.x, cy: pond.y - pond.ry - 6 - Math.sin(now / 140) * 1.2, rx: 1.5, ry: 1.5 });
  }

  // 上鱼的那一下：一条小鱼从水里翻出来，闪光过了就收。
  const sinceCatch = state.lastCatchAt >= 0 ? now - state.lastCatchAt : -1;
  if (sinceCatch >= 0 && sinceCatch < FISH_FLASH_MS) {
    const p = sinceCatch / FISH_FLASH_MS;
    const fx = bob.x + 2;
    const fy = pond.y - 6 - Math.sin(p * Math.PI) * 10;
    const body: Array<[number, number]> = [
      [fx - 4, fy], [fx - 1, fy - 2.4], [fx + 3, fy - 1.2], [fx + 4.2, fy], [fx + 3, fy + 1.4], [fx - 1, fy + 2.2],
    ];
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, (1 - p) * 0.95 * alpha), points: body });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE_DEEP, (1 - p) * 0.9 * alpha), points: [[fx - 4, fy], [fx - 6.6, fy - 2.4], [fx - 6.6, fy + 2.4]] });
    ops.push({ kind: "fillEllipse", fill: withAlpha(EYE, (1 - p) * 0.95 * alpha), cx: fx + 2, cy: fy - 0.4, rx: 0.6, ry: 0.6 });
    for (const side of [-1, 1] as const) {
      ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, (1 - p) * 0.5 * alpha), width: 0.7, cx: bob.x + side * bob.r * 1.2, cy: pond.y, rx: bob.r * (2.4 + p * 3), ry: bob.r * 0.9 * (1 + p) });
    }
  }

  // 鱼篓账：上鱼一颗实心、跑鱼一颗空心，收竿段最清楚。
  const marks = state.catches + state.escaped;
  for (let i = 0; i < Math.min(marks, 8); i += 1) {
    const x = face.cx - 12 + (i % 4) * 8;
    const y = floorY - 20 - Math.floor(i / 4) * 6;
    ops.push({ kind: "fillEllipse", fill: withAlpha(i < state.catches ? ACCENT : INK_SOFT, 0.72 * alpha), cx: x, cy: y, rx: 1.6, ry: 1.6 });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.55 * alpha), width: 0.6, cx: x, cy: y, rx: 1.6, ry: 1.6 });
  }
  return ops;
}

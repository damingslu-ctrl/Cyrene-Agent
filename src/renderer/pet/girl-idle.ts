/**
 * 待机的「一天」：站着 → 回头看看 → 坐一会 → 蜷着歇够 → 站起来 → 伸懒腰 / 开心一下。
 *
 * 纯状态机，时间全由调用方给；抖动用调用方传的 seed 算，同一 seed 同一串时长，
 * 单测不需要 mock Math.random。v1.13 的底子是一段跳舞视频，坐/趴靠压扁跳舞帧演；
 * 从 v1.14 起每一段都换成真正的姿态图（坐、蜷、回头、伸懒腰、跳），舞蹈不再参与待机。
 *
 * 三条设计约束：
 * - **免打扰里不蜷、不庆祝**：闭眼蜷着会被读成睡着（native #67），月牙是安静的唯一记号；
 *   正在蜷/庆祝的时候打开免打扰，她要当场站起来。
 * - **起身必须经过 stand**：坐/蜷不能直接跳回别的动作，否则读起来像换了一张贴图。
 * - **累了才坐**：主动段攒疲劳、坐/蜷还疲劳；越累越偏向坐/蜷，坐够了才可能继续蜷。
 */

import type { GirlPoseId } from "./girl-pet-poses-meta";

export type GirlLifePhase = "stand" | "look" | "sit" | "curl" | "stretch" | "joy";

export interface GirlIdleState {
  phase: GirlLifePhase;
  /** 本段起止（绝对 ms，调用方的时钟）。 */
  since: number;
  until: number;
  /** 疲劳 0..1：主动段上涨，坐着/蜷着回落；越高越容易进入 sit/curl。 */
  weariness: number;
  /** 一共歇过几回（诊断/成就口径）。 */
  rests: number;
  /** 用过的段数：抖动的序号。 */
  bouts: number;
  /** 连着几段没歇了：到上限就强制歇一段，坐/蜷不靠抽签运气。 */
  activeBouts: number;
  /** 自上次蜷起坐过几次：坐过一次还没蜷时，下一次歇息改成蜷。 */
  sitsSinceCurl: number;
  seed: number;
}

/** 每一档的时长区间（ms）。坐/蜷明显长于主动段——歇息不是「停一拍」。 */
export const GIRL_IDLE_TIMING = {
  stand: [2_200, 4_200] as const,
  look: [1_600, 3_000] as const,
  sit: [6_000, 10_000] as const,
  curl: [8_000, 13_000] as const,
  stretch: [1_800, 2_600] as const,
  joy: [1_800, 2_800] as const,
};

/** 产品用固定 seed：同一台机器的节奏可复现，真窗探针也能推同一串时长。 */
export const GIRL_IDLE_SEED = 0x51ede;

/** 段 → 姿态格。每一段都有对应的真姿态，不再借跳舞帧。 */
export function girlIdlePose(phase: GirlLifePhase): GirlPoseId {
  return phase;
}

/** 0..1 的确定性抖动：同一 (seed, bout, salt) 永远同一个数。 */
export function idleJitter(seed: number, bout: number, salt = 0): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x ^= Math.imul(bout | 0, 0x85ebca6b);
  x ^= Math.imul(salt | 0, 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const PHASE_SALT: Record<GirlLifePhase, number> = {
  stand: 1,
  look: 2,
  sit: 3,
  curl: 4,
  stretch: 5,
  joy: 6,
};

/** 走完这一段，疲劳怎么变（正=更累，负=歇回来）。 */
const PHASE_COST: Record<GirlLifePhase, number> = {
  stand: 0.015,
  look: 0.02,
  sit: -0.22,
  curl: -0.32,
  stretch: -0.04,
  joy: 0.10,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function spanFor(phase: GirlLifePhase, seed: number, bout: number): number {
  const [lo, hi] = GIRL_IDLE_TIMING[phase];
  return Math.round(lo + (hi - lo) * idleJitter(seed, bout, PHASE_SALT[phase]));
}

/** 连歇之前最多能连玩几段。四段主动约 10 秒，之后必须坐下或趴下。 */
const ACTIVE_BOUTS_MAX = 4;

function enter(
  state: GirlIdleState,
  phase: GirlLifePhase,
  now: number,
  weariness = state.weariness,
): GirlIdleState {
  const bouts = state.bouts + 1;
  const resting = phase === "sit" || phase === "curl";
  return {
    ...state,
    phase,
    since: now,
    until: now + spanFor(phase, state.seed, bouts),
    bouts,
    weariness: clamp01(weariness),
    rests: state.rests + (resting ? 1 : 0),
    activeBouts: resting ? 0 : state.activeBouts + 1,
    sitsSinceCurl: phase === "curl" ? 0 : phase === "sit" ? state.sitsSinceCurl + 1 : state.sitsSinceCurl,
  };
}

/** 站着的时候下一步做什么：累不累、安不安静，各有一条权重表。 */
function fromStand(state: GirlIdleState, quiet: boolean, weariness: number): GirlLifePhase {
  const r = idleJitter(state.seed, state.bouts, 23);
  if (quiet) return r < 0.42 ? "stand" : r < 0.76 ? "look" : "sit";
  if (state.activeBouts >= ACTIVE_BOUTS_MAX) return "sit";
  if (weariness >= 0.78) return r < 0.55 ? "curl" : "sit";
  if (weariness >= 0.52) {
    if (r < 0.40) return "sit";
    if (r < 0.58) return "stand";
    if (r < 0.82) return "look";
    return "stretch";
  }
  if (r < 0.24) return "stand";
  if (r < 0.48) return "look";
  if (r < 0.62) return "stretch";
  if (r < 0.84) return "joy";
  return "sit";
}

function chooseNext(state: GirlIdleState, quiet: boolean, weariness: number): GirlLifePhase {
  let next: GirlLifePhase;
  switch (state.phase) {
    case "sit": {
      const doze = !quiet && idleJitter(state.seed, state.bouts, 7) < 0.55;
      next = doze ? "curl" : "stand";
      break;
    }
    case "curl":
    case "stretch":
    case "joy":
      next = "stand";
      break;
    case "look": {
      const sit = !quiet && weariness > 0.45 && idleJitter(state.seed, state.bouts, 11) < 0.5;
      next = sit ? "sit" : "stand";
      break;
    }
    default:
      next = fromStand(state, quiet, weariness);
      break;
  }
  // 坐过一次还没蜷：下一次歇息改成蜷——「歇够了趴下」不能永远只抽到坐。
  if (next === "sit" && !quiet && state.sitsSinceCurl >= 1) next = "curl";
  // 别连续两段同一个可见动作；stand 是中性档，允许连着站。
  if (next === state.phase && next !== "stand") next = "stand";
  return next;
}

export function createGirlIdle(now: number, seed: number): GirlIdleState {
  const base: GirlIdleState = {
    phase: "stand",
    since: now,
    until: now,
    weariness: 0.18,
    rests: 0,
    bouts: 0,
    activeBouts: 0,
    sitsSinceCurl: 0,
    seed: seed | 0,
  };
  return enter(base, "stand", now);
}

/** 被打断/玩完回来：站定（不是跳回舞台），并把这轮疲劳压回可继续互动的档位。 */
export function resetGirlIdle(state: GirlIdleState, now: number): GirlIdleState {
  return enter(state, "stand", now, Math.min(state.weariness, 0.35));
}

export function girlIdleLeft(state: GirlIdleState, now: number): number {
  return Math.max(0, state.until - now);
}

/**
 * 推一拍。只有跨过 `until` 或「免打扰打断了蜷/庆祝」才换段；其余情况原样返回（引用相等），
 * 渲染器可以据此判断要不要做额外动作。
 */
export function stepGirlIdle(
  state: GirlIdleState,
  now: number,
  opts: { quiet: boolean },
): GirlIdleState {
  if (now < state.until) {
    if (opts.quiet && (state.phase === "curl" || state.phase === "joy")) {
      return enter(state, "stand", now);
    }
    return state;
  }
  const weariness = clamp01(state.weariness + PHASE_COST[state.phase]);
  const next = chooseNext(state, opts.quiet, weariness);
  return enter(state, next, now, weariness);
}

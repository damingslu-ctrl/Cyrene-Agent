/**
 * 待机的「体力」编排：跳一阵 → 歇一阵（坐/趴轮换）→ 站起来 → 再跳。
 *
 * 纯状态机，时间全由调用方给；抖动用调用方传的 seed 算，同一 seed 同一串时长，
 * 单测不需要 mock Math.random。渲染器只在「她真的闲着」时推它——任何活动/手势/玩具
 * 都走 reset，玩完回来永远先给一整支舞，不接着刚才的疲惫。
 *
 * 两条设计约束：
 * - **免打扰里不趴**：闭眼趴着会被读成睡着（native #67），月牙是安静的唯一记号；
 *   正在趴的时候打开免打扰，她要当场起来。
 * - **起身必须经过 stand**：坐/趴不能直接跳回跳舞，否则读起来像换了一张贴图。
 */

export type GirlIdlePhase = "dance" | "sit" | "lie" | "stand";

export interface GirlIdleState {
  phase: GirlIdlePhase;
  /** 本段起止（绝对 ms，调用方的时钟）。 */
  since: number;
  until: number;
  /** 下一轮开场歇什么；每轮（从 dance 出来那一次）翻转。 */
  nextRest: "sit" | "lie";
  /** 一共歇过几回（诊断/成就口径）。 */
  rests: number;
  /** 用过的段数：抖动的序号。 */
  bouts: number;
  seed: number;
  /** 这一次趴是「坐够了自己再趴下」的深歇（时长走 doze 档）。 */
  deep: boolean;
}

/** 每一档的时长区间（ms）。坐够了自己趴下的那一程更短，因为已经歇过一轮。 */
export const GIRL_IDLE_TIMING = {
  dance: [9_000, 14_000] as const,
  sit: [6_500, 10_000] as const,
  lie: [9_000, 13_000] as const,
  doze: [5_000, 8000] as const,
  stand: [900, 1_400] as const,
};

/** 坐够了有多大概率继续趴下（而不是起身）。剩下的情况直接站起来。 */
export const GIRL_IDLE_DOZE_CHANCE = 0.55;

/** 产品用固定 seed：同一台机器的节奏可复现，真窗探针也能推同一串时长。 */
export const GIRL_IDLE_SEED = 0x51ede;

/** 段 → 待机时播的帧段。趴下借「打盹」那段：闭眼、蜷着，但没有 Zzz。 */
export function girlIdleClip(phase: GirlIdlePhase): "idle" | "sit" | "drowse" | "stand" {
  switch (phase) {
    case "sit": return "sit";
    case "lie": return "drowse";
    case "stand": return "stand";
    default: return "idle";
  }
}

/** 段 → 趴伏量 0..1（`GirlBody.sprawl`）：坐着收一点，趴下把整只压到地上。 */
export const GIRL_IDLE_POSTURE: Record<GirlIdlePhase, number> = {
  dance: 0,
  sit: 0.42,
  lie: 0.92,
  stand: 0,
};

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

function spanFor(
  phase: GirlIdlePhase,
  seed: number,
  bout: number,
  deep = false,
): number {
  const key = phase === "lie" && deep
    ? "doze"
    : (phase as "dance" | "sit" | "lie" | "stand");
  const [lo, hi] = GIRL_IDLE_TIMING[key];
  return Math.round(lo + (hi - lo) * idleJitter(seed, bout, phase.length));
}

function enter(
  state: GirlIdleState,
  phase: GirlIdlePhase,
  now: number,
  deep = false,
): GirlIdleState {
  const bouts = state.bouts + 1;
  return {
    ...state,
    phase,
    since: now,
    until: now + spanFor(phase, state.seed, bouts, deep),
    bouts,
    deep: phase === "lie" && deep,
  };
}

export function createGirlIdle(now: number, seed: number): GirlIdleState {
  const base: GirlIdleState = {
    phase: "dance",
    since: now,
    until: now,
    nextRest: "sit",
    rests: 0,
    bouts: 0,
    seed: seed | 0,
    deep: false,
  };
  return enter(base, "dance", now);
}

/** 被打断/玩完回来：换一整支舞，但保留「下一轮坐还是趴」的轮换游标。 */
export function resetGirlIdle(state: GirlIdleState, now: number): GirlIdleState {
  const rested = { ...state, deep: false };
  return enter(rested, "dance", now);
}

export function girlIdleLeft(state: GirlIdleState, now: number): number {
  return Math.max(0, state.until - now);
}

/**
 * 推一拍。只有跨过 `until` 或「免打扰打断了趴」才换段；其余情况原样返回（引用相等），
 * 渲染器可以据此判断要不要做额外动作。
 */
export function stepGirlIdle(
  state: GirlIdleState,
  now: number,
  opts: { quiet: boolean },
): GirlIdleState {
  if (now < state.until) {
    if (opts.quiet && state.phase === "lie") return enter(state, "stand", now);
    return state;
  }
  switch (state.phase) {
    case "dance": {
      const rest: "sit" | "lie" = opts.quiet ? "sit" : state.nextRest;
      const flipped: GirlIdleState = {
        ...state,
        nextRest: state.nextRest === "sit" ? "lie" : "sit",
        rests: state.rests + 1,
      };
      return enter(flipped, rest, now);
    }
    case "sit": {
      const doze = !opts.quiet && idleJitter(state.seed, state.bouts, 7) < GIRL_IDLE_DOZE_CHANCE;
      return doze ? enter(state, "lie", now, true) : enter(state, "stand", now);
    }
    case "lie":
      return enter(state, "stand", now);
    default:
      return enter(state, "dance", now);
  }
}

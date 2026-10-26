import { describe, expect, it } from "vitest";
import {
  GIRL_IDLE_SEED,
  GIRL_IDLE_TIMING,
  createGirlIdle,
  girlIdleLeft,
  girlIdlePose,
  idleJitter,
  resetGirlIdle,
  stepGirlIdle,
  type GirlIdleState,
  type GirlLifePhase,
} from "./girl-idle";

const T0 = 1_000_000;

function run(
  start: GirlIdleState,
  opts: { quiet?: boolean; steps?: number } = {},
): { states: GirlIdleState[]; state: GirlIdleState } {
  const states: GirlIdleState[] = [];
  let state = start;
  const steps = opts.steps ?? 40;
  for (let i = 0; i < steps; i += 1) {
    const at = state.until + 1;
    state = stepGirlIdle(state, at, { quiet: opts.quiet ?? false });
    states.push(state);
  }
  return { states, state };
}

describe("girl idle life loop", () => {
  it("starts calm on the stand pose, not a dance", () => {
    const s = createGirlIdle(T0, GIRL_IDLE_SEED);
    expect(s.phase).toBe("stand");
    expect(girlIdlePose(s.phase)).toBe("stand");
    expect(s.since).toBe(T0);
    expect(s.until - s.since).toBeGreaterThanOrEqual(GIRL_IDLE_TIMING.stand[0]);
    expect(s.until - s.since).toBeLessThanOrEqual(GIRL_IDLE_TIMING.stand[1]);
  });

  it("visits every life phase and never returns to the dance clip", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 120 });
    const phases = new Set(states.map((s) => s.phase));
    const all: GirlLifePhase[] = ["stand", "look", "sit", "curl", "stretch", "joy"];
    for (const phase of all) expect(phases.has(phase), `missing ${phase}`).toBe(true);
    expect(phases.has("dance" as never)).toBe(false);
  });

  it("rests on real seated poses and always stands up before moving on", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 120 });
    for (let i = 1; i < states.length; i += 1) {
      const prev = states[i - 1];
      const next = states[i];
      if (prev.phase === "sit") expect(["curl", "stand"]).toContain(next.phase);
      if (prev.phase === "curl") expect(next.phase).toBe("stand");
      if (prev.phase === "stretch" || prev.phase === "joy") expect(next.phase).toBe("stand");
      if (next.phase === "sit" || next.phase === "curl") expect(prev.phase).not.toBe(next.phase);
    }
    expect(states.every((s) => s.phase !== "dance")).toBe(true);
  });

  it("gets tired after active beats and prefers sitting or curling when weary", () => {
    let s = createGirlIdle(T0, GIRL_IDLE_SEED);
    s = { ...s, weariness: 0.9, phase: "stand" };
    const next = stepGirlIdle(s, s.until + 1, { quiet: false });
    expect(["sit", "curl"]).toContain(next.phase);
    expect(next.weariness).toBeGreaterThan(0.5);

    const fresh = stepGirlIdle({ ...s, weariness: 0.05 }, s.until + 1, { quiet: false });
    expect(["stand", "look", "stretch", "joy", "sit"]).toContain(fresh.phase);
  });

  it("rests within a handful of active beats instead of waiting for a lucky roll", () => {
    let s = createGirlIdle(T0, GIRL_IDLE_SEED);
    let active = 0;
    for (let i = 0; i < 12; i += 1) {
      s = stepGirlIdle(s, s.until + 1, { quiet: false });
      if (s.phase === "sit" || s.phase === "curl") break;
      active += 1;
    }
    // 「跳累了就坐下/趴下」是作息，不是抽奖：连着几段主动就必须歇一段。
    expect(active).toBeLessThanOrEqual(4);
    expect(s.phase === "sit" || s.phase === "curl").toBe(true);
  });

  it("never lets two sits pass without curling in between", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 120 });
    let sits = 0;
    let curls = 0;
    for (const s of states) {
      if (s.phase === "curl") {
        curls += 1;
        sits = 0;
      } else if (s.phase === "sit") {
        sits += 1;
        expect(sits, "two sits without a curl").toBeLessThanOrEqual(1);
      }
    }
    expect(curls).toBeGreaterThan(0);
  });

  it("counts every rest and cools down while resting", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 80 });
    const rests = states.filter((s) => s.phase === "sit" || s.phase === "curl");
    expect(rests.length).toBeGreaterThan(0);
    for (let i = 1; i < states.length; i += 1) {
      const prev = states[i - 1];
      const next = states[i];
      if (next.phase === "sit" || next.phase === "curl") {
        expect(next.rests).toBe(prev.rests + 1);
      }
    }
    const firstSit = states.find((s) => s.phase === "sit");
    const afterCurl = states.find((s) => s.weariness < 0.4);
    expect(firstSit).toBeTruthy();
    expect(afterCurl).toBeTruthy();
  });

  it("never curls or celebrates in quiet mode, and stands up if it is already curled", () => {
    const curled: GirlIdleState = {
      ...createGirlIdle(T0, GIRL_IDLE_SEED),
      phase: "curl",
      since: T0,
      until: T0 + 6_000,
      weariness: 0.7,
    };
    const woken = stepGirlIdle(curled, T0 + 1_000, { quiet: true });
    expect(woken.phase).toBe("stand");

    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { quiet: true, steps: 80 });
    expect(states.every((s) => s.phase !== "curl" && s.phase !== "joy")).toBe(true);
    expect(states.some((s) => s.phase === "sit")).toBe(true);
  });

  it("resets to a calm stand, not into the dance", () => {
    const state = { ...createGirlIdle(T0, GIRL_IDLE_SEED), phase: "curl" as const, weariness: 0.9 };
    const reset = resetGirlIdle(state, T0 + 60_000);
    expect(reset.phase).toBe("stand");
    expect(reset.since).toBe(T0 + 60_000);
    expect(reset.weariness).toBeLessThanOrEqual(0.35);
    expect(reset.bouts).toBe(state.bouts + 1);
    expect(girlIdleLeft(reset, T0 + 60_000)).toBe(reset.until - reset.since);
    expect(girlIdleLeft(reset, reset.until + 500)).toBe(0);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    const a = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 30 }).states.map((s) => s.phase).join(",");
    const b = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 30 }).states.map((s) => s.phase).join(",");
    const c = run(createGirlIdle(T0, 0x12345), { steps: 30 }).states.map((s) => s.phase).join(",");
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(idleJitter(GIRL_IDLE_SEED, 3, 7)).toBe(idleJitter(GIRL_IDLE_SEED, 3, 7));
  });

  it("maps each phase to its own real pose and keeps timing ranges sane", () => {
    expect(girlIdlePose("stand")).toBe("stand");
    expect(girlIdlePose("sit")).toBe("sit");
    expect(girlIdlePose("curl")).toBe("curl");
    expect(girlIdlePose("look")).toBe("look");
    expect(girlIdlePose("stretch")).toBe("stretch");
    expect(girlIdlePose("joy")).toBe("joy");
    for (const [lo, hi] of Object.values(GIRL_IDLE_TIMING)) expect(hi).toBeGreaterThan(lo);
    expect(GIRL_IDLE_TIMING.stand[0]).toBeLessThan(GIRL_IDLE_TIMING.sit[0]);
    expect(GIRL_IDLE_TIMING.curl[1]).toBeGreaterThan(GIRL_IDLE_TIMING.sit[1]);
  });
});

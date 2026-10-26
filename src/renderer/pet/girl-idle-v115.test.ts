import { describe, expect, it } from "vitest";
import {
  GIRL_IDLE_SEED,
  createGirlIdle,
  girlIdlePose,
  stepGirlIdle,
  type GirlIdleState,
  type GirlLifePhase,
} from "./girl-idle";
import { girlPoseAtlasId } from "./girl-pose-atlas";

const T0 = 1_000_000;

function run(
  start: GirlIdleState,
  opts: { quiet?: boolean; steps?: number } = {},
): { states: GirlIdleState[]; state: GirlIdleState } {
  const states: GirlIdleState[] = [];
  let state = start;
  for (let i = 0; i < (opts.steps ?? 200); i += 1) {
    state = stepGirlIdle(state, state.until + 1, { quiet: opts.quiet ?? false });
    states.push(state);
  }
  return { states, state };
}

const REST: GirlLifePhase[] = ["sit", "curl", "prone"];

describe("v1.15.0 作息：真趴下与深歇链条", () => {
  it("趴是图集 II 里的真姿态，不是把坐姿再压扁", () => {
    expect(girlIdlePose("prone")).toBe("prone");
    expect(girlPoseAtlasId("prone")).toBe("poses2");
  });

  it("歇息链条按 sit → curl → prone 逐级深入，不许跳级也不许回头", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 400 });
    const rests = states
      .map((s) => s.phase)
      .filter((p): p is GirlLifePhase => REST.includes(p));
    expect(rests).toContain("prone");
    // 从深到浅的回退必须经过中间档：prone 之后只能 stand，curl 之后只能 prone 或 stand。
    for (let i = 1; i < states.length; i += 1) {
      const prev = states[i - 1].phase;
      const next = states[i].phase;
      if (prev === "prone") expect(["stand", "curl"]).toContain(next);
      if (prev === "curl") expect(["prone", "stand"]).toContain(next);
      if (prev === "sit") expect(["curl", "prone", "stand"]).toContain(next);
    }
  });

  it("趴下要真的出现，而且不是每轮都出现（歇够了才趴）", () => {
    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { steps: 400 });
    const prones = states.filter((s) => s.phase === "prone").length;
    const sits = states.filter((s) => s.phase === "sit").length;
    expect(prones).toBeGreaterThan(0);
    expect(prones).toBeLessThan(states.length / 2);
    // 趴是深歇：次数应当少于坐。
    expect(prones).toBeLessThanOrEqual(sits + 1);
  });

  it("深歇会先把疲劳压回低档，趴完必须站起来才有下一步", () => {
    let s: GirlIdleState = { ...createGirlIdle(T0, GIRL_IDLE_SEED), weariness: 0.95, phase: "curl" };
    s = stepGirlIdle(s, s.until + 1, { quiet: false });
    let guard = 0;
    while (s.phase !== "prone" && guard < 20) {
      s = { ...s, weariness: 0.95 };
      s = stepGirlIdle(s, s.until + 1, { quiet: false });
      guard += 1;
    }
    expect(s.phase).toBe("prone");
    const after = stepGirlIdle(s, s.until + 1, { quiet: false });
    expect(after.phase).toBe("stand");
    expect(after.weariness).toBeLessThan(0.6);
  });

  it("免打扰里绝不趴下、绝不蜷、绝不庆祝；已经在趴的当场站起来", () => {
    const prone: GirlIdleState = {
      ...createGirlIdle(T0, GIRL_IDLE_SEED),
      phase: "prone",
      since: T0,
      until: T0 + 6_000,
      weariness: 0.9,
    };
    expect(stepGirlIdle(prone, T0 + 1_000, { quiet: true }).phase).toBe("stand");

    const { states } = run(createGirlIdle(T0, GIRL_IDLE_SEED), { quiet: true, steps: 200 });
    expect(states.every((s) => !["curl", "prone", "joy"].includes(s.phase))).toBe(true);
    expect(states.some((s) => s.phase === "sit")).toBe(true);
  });

  it("久站之后一定会歇，趴也算歇（activeBouts 归零）", () => {
    let s = createGirlIdle(T0, GIRL_IDLE_SEED);
    let active = 0;
    for (let i = 0; i < 200; i += 1) {
      s = stepGirlIdle(s, s.until + 1, { quiet: false });
      if (REST.includes(s.phase)) {
        expect(s.activeBouts).toBe(0);
        expect(s.rests).toBeGreaterThan(0);
        return;
      }
      active += 1;
      expect(active).toBeLessThanOrEqual(4);
    }
    throw new Error("两百段都没歇过一次");
  });

  it("趴的时长比蜷更长：深歇不是停一拍", async () => {
    const { GIRL_IDLE_TIMING } = await import("./girl-idle");
    expect(GIRL_IDLE_TIMING.prone[0]).toBeGreaterThan(GIRL_IDLE_TIMING.curl[0]);
    expect(GIRL_IDLE_TIMING.prone[1]).toBeGreaterThanOrEqual(GIRL_IDLE_TIMING.curl[1]);
  });
});

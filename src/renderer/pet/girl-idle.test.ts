import { describe, expect, it } from "vitest";
import {
  GIRL_IDLE_DOZE_CHANCE,
  GIRL_IDLE_POSTURE,
  GIRL_IDLE_TIMING,
  createGirlIdle,
  girlIdleClip,
  girlIdleLeft,
  idleJitter,
  resetGirlIdle,
  stepGirlIdle,
  type GirlIdleState,
} from "./girl-idle";

const T0 = 1_000_000;

function runFor(seed: number, ms: number, opts: { quiet?: boolean; from?: GirlIdleState } = {}) {
  const quiet = opts.quiet ?? false;
  let s = opts.from ?? createGirlIdle(T0, seed);
  const seen: Array<{ phase: string; since: number; until: number; deep: boolean }> = [];
  let now = s.since;
  const deadline = now + ms;
  let last = s.phase;
  while (now < deadline) {
    const next = stepGirlIdle(s, now, { quiet });
    if (next !== s) {
      seen.push({ phase: next.phase, since: next.since, until: next.until, deep: next.deep });
      last = next.phase;
    }
    s = next;
    now += Math.max(1, Math.min(250, s.until - now));
  }
  return { state: s, seen, last };
}

function inRange(span: number, [lo, hi]: readonly [number, number]): boolean {
  return span >= lo && span <= hi;
}

describe("v1.13.0 待机体力编排（跳舞 → 坐/趴 → 起身）", () => {
  it("从一支舞开始：到期前不动，到期才换姿势", () => {
    const s = createGirlIdle(T0, 7);
    expect(s.phase).toBe("dance");
    expect(s.since).toBe(T0);
    expect(inRange(s.until - T0, GIRL_IDLE_TIMING.dance)).toBe(true);
    expect(stepGirlIdle(s, T0 + 1, { quiet: false })).toBe(s);
    expect(stepGirlIdle(s, s.until - 1, { quiet: false })).toBe(s);

    const after = stepGirlIdle(s, s.until, { quiet: false });
    expect(after.phase).toBe("sit");
    expect(after.nextRest).toBe("lie");
    expect(after.rests).toBe(1);
  });

  it("坐/趴之后必须经过 stand 才能回到 dance（起身是一段看得见的动作）", () => {
    const { seen } = runFor(3, 120_000);
    const phases = seen.map((s) => s.phase);
    expect(phases[0]).toBe("sit");
    // 第一轮坐下之后要么先深歇趴下，要么直接起身；两条岔路都得先离开坐姿。
    expect(["stand", "lie"]).toContain(phases[1]);
    // 每一段 rest 的下一段只能是 stand 或（坐着再趴下）lie。
    for (let i = 0; i < seen.length; i += 1) {
      if (seen[i].phase !== "sit" && seen[i].phase !== "lie") continue;
      expect(["stand", "lie"]).toContain(seen[i + 1]?.phase);
      if (seen[i].phase === "lie") expect(seen[i + 1].phase).toBe("stand");
    }
  });

  it("每一轮开场歇什么会轮换：坐与趴交替出现（不是永远同一种）", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { seen } = runFor(seed, 180_000);
      const rests = seen.filter((s) => s.phase === "sit" || s.phase === "lie");
      expect(rests.length).toBeGreaterThanOrEqual(3);
      // 「开场歇」=这一轮从 dance 出来的那一次；坐够了自己趴下不算新一轮。
      const starts: string[] = [];
      for (let i = 0; i < seen.length; i += 1) {
        if (seen[i].phase !== "sit" && seen[i].phase !== "lie") continue;
        const prev = seen[i - 1]?.phase;
        if (prev !== "sit" && prev !== "lie") starts.push(seen[i].phase);
      }
      expect(starts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < starts.length; i += 1) expect(starts[i]).not.toBe(starts[i - 1]);
    }
  });

  it("坐够了可能自己再趴下（深歇），深歇时长走 doze 档", () => {
    let chained: GirlIdleState | null = null;
    let plain: GirlIdleState | null = null;
    for (let seed = 0; seed < 80 && (!chained || !plain); seed += 1) {
      let s = createGirlIdle(T0, seed);
      let now = T0;
      for (let i = 0; i < 12; i += 1) {
        now = s.until;
        const next = stepGirlIdle(s, now, { quiet: false });
        if (s.phase === "sit" && next.phase === "lie" && !chained) chained = next;
        if (s.phase === "sit" && next.phase === "stand" && !plain) plain = next;
        s = next;
      }
    }
    expect(chained).not.toBeNull();
    expect(plain).not.toBeNull();
    expect(chained!.deep).toBe(true);
    expect(inRange(chained!.until - chained!.since, GIRL_IDLE_TIMING.doze)).toBe(true);
    // 直接趴下（这一轮就该趴）的时长比「坐够了再趴」长。
    expect(GIRL_IDLE_TIMING.lie[0]).toBeGreaterThan(GIRL_IDLE_TIMING.doze[0]);
  });

  it("同一 seed 的作息完全可复现，不同 seed 会抖出不同时长", () => {
    const a = runFor(42, 120_000).seen;
    const b = runFor(42, 120_000).seen;
    expect(b).toEqual(a);
    const durations = new Set(a.map((s) => s.until - s.since));
    expect(durations.size).toBeGreaterThan(1);
    const other = runFor(43, 120_000).seen;
    expect(other.map((s) => s.until - s.since)).not.toEqual(a.map((s) => s.until - s.since));
  });

  it("所有档位的时长都落在表内，且没有零长度段", () => {
    const edges: Record<string, string[]> = {
      dance: ["sit", "lie"],
      sit: ["lie", "stand"],
      lie: ["stand"],
      stand: ["dance"],
    };
    for (let seed = 0; seed < 500; seed += 1) {
      const { seen } = runFor(seed, 240_000);
      for (let i = 0; i < seen.length; i += 1) {
        const s = seen[i];
        const span = s.until - s.since;
        const key = s.phase === "lie" && s.deep ? "doze" : s.phase;
        expect(inRange(span, GIRL_IDLE_TIMING[key as keyof typeof GIRL_IDLE_TIMING])).toBe(true);
        if (i > 0) expect(edges[seen[i - 1].phase]).toContain(s.phase);
      }
    }
    for (const [lo, hi] of Object.values(GIRL_IDLE_TIMING)) expect(hi).toBeGreaterThan(lo);
    expect(GIRL_IDLE_DOZE_CHANCE).toBeGreaterThan(0);
    expect(GIRL_IDLE_DOZE_CHANCE).toBeLessThan(1);
    expect(idleJitter(9, 1)).toBeGreaterThanOrEqual(0);
    expect(idleJitter(9, 1)).toBeLessThan(1);
    expect(idleJitter(9, 1)).not.toBe(idleJitter(9, 2));
  });

  it("免打扰：不趴（闭眼趴着会被读成睡着），正在趴就立刻起来", () => {
    const { seen } = runFor(11, 240_000, { quiet: true });
    expect(seen.some((s) => s.phase === "lie")).toBe(false);
    expect(seen.some((s) => s.phase === "sit")).toBe(true);

    // 找一个正在趴的现场：关掉免打扰跑，趴下那一帧改开安静。
    let lying: GirlIdleState | null = null;
    let s = createGirlIdle(T0, 2);
    for (let now = T0; now < T0 + 120_000; now += 250) {
      s = stepGirlIdle(s, now, { quiet: false });
      if (s.phase === "lie") {
        lying = s;
        break;
      }
    }
    expect(lying).not.toBeNull();
    const woken = stepGirlIdle(lying!, lying!.since + 500, { quiet: true });
    expect(woken.phase).toBe("stand");
    expect(woken.since).toBe(lying!.since + 500);
    expect(inRange(woken.until - woken.since, GIRL_IDLE_TIMING.stand)).toBe(true);
  });

  it("玩完回来（reset）永远先给一整支舞，不接着刚才的疲惫", () => {
    let s = createGirlIdle(T0, 5);
    for (let now = T0; now < T0 + 60_000; now += 250) s = stepGirlIdle(s, now, { quiet: false });
    const interrupted = s;

    const reset = resetGirlIdle(s, T0 + 60_000);
    expect(reset.phase).toBe("dance");
    expect(reset.since).toBe(T0 + 60_000);
    expect(inRange(reset.until - reset.since, GIRL_IDLE_TIMING.dance)).toBe(true);
    // 轮换游标保留：下一轮该趴还是趴，不会因为被打断就重洗。
    expect(reset.nextRest).toBe(interrupted.nextRest);
    expect(girlIdleLeft(reset, T0 + 60_000)).toBe(reset.until - reset.since);
    expect(girlIdleLeft(reset, reset.until + 500)).toBe(0);
  });

  it("姿势/片名映射：跳舞站着、坐着、趴着、起身各有自己的段", () => {
    expect(girlIdleClip("dance")).toBe("idle");
    expect(girlIdleClip("sit")).toBe("sit");
    expect(girlIdleClip("lie")).toBe("drowse");
    expect(girlIdleClip("stand")).toBe("stand");
    expect(GIRL_IDLE_POSTURE.dance).toBe(0);
    expect(GIRL_IDLE_POSTURE.stand).toBe(0);
    expect(GIRL_IDLE_POSTURE.lie).toBeGreaterThan(GIRL_IDLE_POSTURE.sit);
    expect(GIRL_IDLE_POSTURE.sit).toBeGreaterThan(0.2);
    expect(GIRL_IDLE_POSTURE.lie).toBeLessThan(1);
  });
});

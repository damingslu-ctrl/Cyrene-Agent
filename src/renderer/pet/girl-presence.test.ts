import { describe, expect, it } from "vitest";
import { GirlPresence, PRESENCE, restingPresence, type GirlPresenceInput } from "./girl-presence";

const HEAD: [number, number] = [0, 0];

function input(over: Partial<GirlPresenceInput> = {}): GirlPresenceInput {
  return {
    now: 0,
    gaze: HEAD,
    head: HEAD,
    facing: 1,
    allowTurn: true,
    awake: true,
    ...over,
  };
}

/** 从 t0 起每 step 一拍跑到 t1，返回最后一拍。 */
function run(p: GirlPresence, from: number, to: number, step: number, over: Partial<GirlPresenceInput> = {}) {
  let last = p.update(input({ now: from, ...over }));
  for (let t = from + step; t <= to; t += step) last = p.update(input({ now: t, ...over }));
  return last;
}

describe("girl presence", () => {
  it("离得远＝完全无感（不倾、不挪、不转身）", () => {
    const p = new GirlPresence();
    const { pose } = run(p, 0, 600, 60, { gaze: [400, -200] });
    expect(pose.attention).toBeLessThan(0.02);
    expect(pose.leanDeg).toBe(0);
    expect(pose.shiftX).toBe(0);
    expect(pose.facing).toBe(1);
  });

  it("光标在右侧：朝右压、往右挪，而且真的会收敛到上限附近", () => {
    const p = new GirlPresence();
    // 200px：超过两个饱和距离，倾斜与侧移都到满档；仍在 300px 的注意圈里。
    const { pose } = run(p, 0, 1_200, 60, { gaze: [200, 0] });
    expect(pose.leanDeg).toBeGreaterThan(PRESENCE.leanMaxDeg * 0.9);
    expect(pose.leanDeg).toBeLessThanOrEqual(PRESENCE.leanMaxDeg + 1e-9);
    expect(pose.shiftX).toBeGreaterThan(PRESENCE.shiftMaxPx * 0.9);
    expect(pose.facing).toBe(1);
  });

  it("光标换到左侧：先等 hold，再翻面；不是一跨中线就抽", () => {
    const p = new GirlPresence();
    run(p, 0, 500, 50, { gaze: [130, 0] });
    let r = run(p, 550, 850, 50, { gaze: [-130, 0] });
    expect(r.pose.facing, "hold 未满不该翻").toBe(1);
    r = run(p, 900, 1_100, 50, { gaze: [-130, 0] });
    expect(r.pose.facing).toBe(-1);
    expect(r.pose.leanDeg).toBeLessThan(0);
  });

  it("翻完锁 900ms：期间再跨回去也翻不动", () => {
    const p = new GirlPresence();
    run(p, 0, 300, 50, { gaze: [130, 0] });
    const flip = run(p, 350, 800, 50, { gaze: [-130, 0] }); // 350 起算 hold，730 左右翻到 −1
    expect(flip.pose.facing).toBe(-1);
    // 立刻往右看：hold 期满也不许翻（还在锁里，锁到 ~1630）
    const locked = run(p, 850, 1_600, 50, { gaze: [130, 0] });
    expect(locked.pose.facing).toBe(-1);
    // 锁过期后再走满 hold 才翻回来
    const after = run(p, 1_650, 2_300, 50, { gaze: [130, 0] });
    expect(after.pose.facing).toBe(1);
  });

  it("靠近到 0.86 才「!」，且冷却期内不再发", () => {
    const p = new GirlPresence();
    const first = p.update(input({ now: 0, gaze: [0, 0] }));
    expect(first.notice).toBe(true);
    const far = run(p, 100, 500, 100, { gaze: [420, 0] });
    expect(far.notice).toBe(false);
    // 冷却期内再靠近：不发
    const nearAgain = run(p, 600, 1_000, 100, { gaze: [0, 0] });
    expect(nearAgain.notice).toBe(false);
    // 先离开注意圈，冷却过后再靠近才发
    run(p, 1_100, 2_000, 100, { gaze: [420, 0] });
    const afterCooldown = p.update(input({ now: PRESENCE.noticeCooldownMs + 1_000, gaze: [0, 0] }));
    expect(afterCooldown.notice).toBe(true);
  });

  it("睡着时不「!」", () => {
    const p = new GirlPresence();
    expect(p.update(input({ now: 0, awake: false })).notice).toBe(false);
    expect(p.update(input({ now: 100, awake: false })).notice).toBe(false);
  });

  it("走路/拖拽时朝向归引擎，倾斜与侧移归零", () => {
    const p = new GirlPresence();
    run(p, 0, 600, 60, { gaze: [130, 0] });
    const { pose } = run(p, 660, 1_200, 60, { gaze: [130, 0], allowTurn: false, facing: -1 });
    expect(pose.facing).toBe(-1);
    expect(Math.abs(pose.leanDeg)).toBeLessThan(0.4);
    expect(Math.abs(pose.shiftX)).toBeLessThan(0.3);
  });

  it("光标离开后回到静止姿态，但朝向保留", () => {
    const p = new GirlPresence();
    run(p, 0, 300, 50, { gaze: [130, 0] });
    run(p, 350, 700, 50, { gaze: [-130, 0] });
    const facing = p.current.facing;
    const { pose } = run(p, 750, 2_000, 50, { gaze: null });
    expect(pose.attention).toBeLessThan(0.02);
    expect(pose.leanDeg).toBe(0);
    expect(pose.shiftX).toBe(0);
    expect(pose.facing).toBe(facing);
  });

  it("restingPresence 是合法初值（渲染器第一帧就有朝向）", () => {
    expect(restingPresence(-1)).toEqual({ attention: 0, proximity: 0, leanDeg: 0, shiftX: 0, facing: -1 });
  });
});

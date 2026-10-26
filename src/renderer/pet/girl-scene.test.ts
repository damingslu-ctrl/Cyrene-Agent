import { describe, expect, it } from "vitest";
import { GIRL_ANIM_FADE_MS, clipDurationMs, type GirlActivity } from "./girl-anim";
import type { GirlLifePhase } from "./girl-idle";
import {
  GIRL_POSE_REDRAW_FPS,
  GirlScenePlayer,
  girlBaseVisualFor,
  type GirlVisual,
} from "./girl-scene";

const T0 = 10_000;
const pose = (id: "stand" | "sit" | "curl" | "look" | "stretch" | "joy"): GirlVisual => ({ kind: "pose", id });
const clip = (id: "walk" | "wave" | "idle" | "sit", loop = false): GirlVisual => ({ kind: "clip", id, loop });

describe("girl scene player", () => {
  it("starts on the requested pose and holds it", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    const a = scene.sample(T0);
    expect(a.current).toEqual({ kind: "pose", id: "stand" });
    expect(a.prev).toBeNull();
    expect(a.fade).toBe(0);
    expect(scene.sample(T0 + GIRL_ANIM_FADE_MS).fade).toBe(1);
    expect(scene.poseId()).toBe("stand");
    expect(scene.clipId()).toBeNull();
    expect(scene.redrawFloor()).toBe(GIRL_POSE_REDRAW_FPS);
  });

  it("crossfades from a pose to another pose", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    expect(scene.setVisual(pose("sit"), T0 + 1_000)).toBe(true);
    const atSwitch = scene.sample(T0 + 1_000);
    expect(atSwitch.prev).toEqual({ kind: "pose", id: "stand" });
    expect(atSwitch.current).toEqual({ kind: "pose", id: "sit" });
    expect(atSwitch.fade).toBe(0);
    const mid = scene.sample(T0 + 1_000 + GIRL_ANIM_FADE_MS / 2);
    expect(mid.fade).toBeCloseTo(0.5, 5);
    expect(mid.prev).toEqual({ kind: "pose", id: "stand" });
    const done = scene.sample(T0 + 1_000 + GIRL_ANIM_FADE_MS);
    expect(done.prev).toBeNull();
    expect(done.fade).toBe(1);
  });

  it("starts a clip at frame zero and advances it on its own clock", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    scene.setVisual(clip("walk", true), T0 + 2_000);
    const atSwitch = scene.sample(T0 + 2_000);
    expect(atSwitch.prev).toEqual({ kind: "pose", id: "stand" });
    expect(atSwitch.current).toEqual({ kind: "clip", id: "walk", index: 0 });
    const later = scene.sample(T0 + 2_000 + 100);
    expect(later.current).toMatchObject({ kind: "clip", id: "walk", index: 2 });
    expect(scene.clipId()).toBe("walk");
    expect(scene.poseId()).toBeNull();
  });

  it("freezes the clip frame that was actually on screen when switching back to a pose", () => {
    const scene = new GirlScenePlayer(clip("walk", true), T0);
    scene.sample(T0 + 100);
    scene.setVisual(pose("sit"), T0 + 300);
    const atSwitch = scene.sample(T0 + 300);
    expect(atSwitch.prev).toEqual({ kind: "clip", id: "walk", index: 7 });
    expect(atSwitch.current).toEqual({ kind: "pose", id: "sit" });
    expect(atSwitch.fade).toBe(0);
  });

  it("freezes a one-shot clip at its last frame and reports done", () => {
    const scene = new GirlScenePlayer(clip("wave"), T0);
    const end = T0 + clipDurationMs("wave") + 500;
    expect(scene.isDone(end)).toBe(true);
    scene.setVisual(pose("stand"), end);
    expect(scene.sample(end).prev).toEqual({ kind: "clip", id: "wave", index: 16 });
    expect(scene.isDone(end + 1)).toBe(false);
  });

  it("does not restart a visual that is already current", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    expect(scene.setVisual(pose("stand"), T0 + 500)).toBe(false);
    expect(scene.sample(T0 + 500).fade).toBe(1);

    scene.setVisual(clip("walk", true), T0 + 1_000);
    expect(scene.setVisual(clip("walk", true), T0 + 1_500)).toBe(false);
    // walk 只有 8 帧，500ms 已经走到往返段的回程第 2 帧。
    expect(scene.sample(T0 + 1_500).current).toMatchObject({ kind: "clip", id: "walk", index: 2 });
  });

  it("uses the clip's own loop flag when it differs from the visual", () => {
    const scene = new GirlScenePlayer(clip("idle", false), T0);
    expect(scene.isDone(T0 + clipDurationMs("idle") + 10)).toBe(true);
    scene.setVisual({ kind: "clip", id: "idle" }, T0 + 5_000);
    expect(scene.isDone(T0 + 5_000 + clipDurationMs("idle") + 10)).toBe(false);
  });

  it("keeps a stable sample object shape across transitions", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    scene.setVisual(clip("wave"), T0 + 200);
    const s = scene.sample(T0 + 240);
    expect(Object.keys(s).sort()).toEqual(["current", "fade", "prev"]);
    expect(scene.isFading(T0 + 240)).toBe(true);
    expect(scene.isFading(T0 + 200 + GIRL_ANIM_FADE_MS)).toBe(false);
  });
});

describe("base visual mapping", () => {
  const base = (
    activity: GirlActivity,
    phase: GirlLifePhase,
    opts: { quiet?: boolean; posesReady?: boolean } = {},
  ) => girlBaseVisualFor({
    activity,
    phase,
    quiet: opts.quiet ?? false,
    posesReady: opts.posesReady ?? true,
  });

  it("maps every life phase to its real pose", () => {
    expect(base("idle", "stand")).toEqual({ kind: "pose", id: "stand" });
    expect(base("idle", "look")).toEqual({ kind: "pose", id: "look" });
    expect(base("idle", "sit")).toEqual({ kind: "pose", id: "sit" });
    expect(base("idle", "curl")).toEqual({ kind: "pose", id: "curl" });
    expect(base("idle", "stretch")).toEqual({ kind: "pose", id: "stretch" });
    expect(base("idle", "joy")).toEqual({ kind: "pose", id: "joy" });
  });

  it("sits on the engine's rest and curls up for sleep", () => {
    expect(base("rest", "stand")).toEqual({ kind: "pose", id: "sit" });
    expect(base("sleep", "stand")).toEqual({ kind: "pose", id: "curl" });
  });

  it("stands instead of curling under quiet — the crescent must not look asleep", () => {
    expect(base("sleep", "stand", { quiet: true })).toEqual({ kind: "pose", id: "stand" });
  });

  it("keeps locomotion and grooming on frame clips", () => {
    expect(base("walk", "stand")).toEqual({ kind: "clip", id: "walk", loop: true });
    expect(base("groom", "stand")).toEqual({ kind: "clip", id: "wink", loop: true });
    expect(base("drag", "stand")).toEqual({ kind: "clip", id: "stretch", loop: true });
  });

  it("falls back to the closest clip when the pose atlas is unavailable", () => {
    expect(base("idle", "sit", { posesReady: false })).toEqual({ kind: "clip", id: "sit", loop: true });
    expect(base("idle", "curl", { posesReady: false })).toEqual({ kind: "clip", id: "sleep", loop: true });
    expect(base("idle", "look", { posesReady: false })).toEqual({ kind: "clip", id: "peek", loop: true });
    expect(base("rest", "stand", { posesReady: false })).toEqual({ kind: "clip", id: "sit", loop: true });
    expect(base("sleep", "stand", { posesReady: false })).toEqual({ kind: "clip", id: "sleep", loop: true });
    expect(base("sleep", "stand", { posesReady: false, quiet: true })).toEqual({ kind: "clip", id: "idle", loop: true });
  });
});

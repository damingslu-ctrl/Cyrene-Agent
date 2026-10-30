import { describe, expect, it } from "vitest";
import { GIRL_ANIM_FADE_MS, clipDurationMs, type GirlActivity } from "./girl-anim";
import { girlActionDurationMs, girlActionRedrawFloor } from "./girl-action";
import type { GirlLifePhase } from "./girl-idle";
import {
  GIRL_POSE_REDRAW_FPS,
  GIRL_ACTIVITY_ACTION,
  GIRL_GESTURE_ACTION,
  GirlScenePlayer,
  girlBaseVisualFor,
  girlWildVisualFor,
  type GirlVisual,
} from "./girl-scene";

const T0 = 10_000;
const pose = (id: "stand" | "sit" | "curl" | "look" | "stretch" | "joy"): GirlVisual => ({ kind: "pose", id });
const clip = (id: "walk" | "wave" | "idle" | "sit", loop = false): GirlVisual => ({ kind: "clip", id, loop });
const action = (id: "zoom" | "stalk" | "hunt"): GirlVisual => ({ kind: "action", id });

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

  it("动作从第 0 帧起播、按自己的节拍走，读完是动作不是姿态", () => {
    const scene = new GirlScenePlayer(pose("stand"), T0);
    scene.setVisual(action("zoom"), T0 + 1_000);
    expect(scene.sample(T0 + 1_000).current).toEqual({ kind: "action", id: "zoom", index: 0 });
    // 冲刺 12fps：90ms 已经进了第 1 格。
    expect(scene.sample(T0 + 1_090).current).toMatchObject({ kind: "action", id: "zoom", index: 1 });
    expect(scene.actionId()).toBe("zoom");
    expect(scene.poseId()).toBeNull();
    expect(scene.clipId()).toBeNull();
    expect(scene.redrawFloor()).toBe(girlActionRedrawFloor("zoom"));
  });

  it("扑击演完停在最后一格并报 done；冲刺一直循环", () => {
    const oneShot = new GirlScenePlayer(action("hunt"), T0);
    expect(oneShot.isDone(T0 + girlActionDurationMs("hunt") - 1)).toBe(false);
    expect(oneShot.isDone(T0 + girlActionDurationMs("hunt") + 1)).toBe(true);
    expect(oneShot.sample(T0 + girlActionDurationMs("hunt") + 1).current)
      .toMatchObject({ kind: "action", id: "hunt", index: 5 });
    const loop = new GirlScenePlayer(action("zoom"), T0);
    expect(loop.isDone(T0 + girlActionDurationMs("zoom") * 4)).toBe(false);
  });

  it("切走时冻住屏幕上那一格动作，同一式重设不重播", () => {
    const scene = new GirlScenePlayer(action("stalk"), T0);
    scene.sample(T0 + 200);
    expect(scene.setVisual(action("stalk"), T0 + 250)).toBe(false);
    scene.setVisual(pose("stand"), T0 + 300);
    // 潜行 6fps：200ms 已经进了第 1 格。
    expect(scene.sample(T0 + 300).prev).toEqual({ kind: "action", id: "stalk", index: 1 });
  });
});

describe("base visual mapping", () => {
  const base = (
    activity: GirlActivity,
    phase: GirlLifePhase,
    opts: { quiet?: boolean; posesReady?: boolean; actionsReady?: boolean } = {},
  ) => girlBaseVisualFor({
    activity,
    phase,
    quiet: opts.quiet ?? false,
    posesReady: opts.posesReady ?? true,
    actionsReady: opts.actionsReady ?? false,
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

describe("v1.22 吃/拍/跳/打字各播自己那一行", () => {
  it("喂食时打底就是吃饭那一行、玩耍时是拍打那一行（不再是 happy/wave 换皮）", () => {
    const eat = girlBaseVisualFor({
      activity: "eat", phase: "stand", quiet: false, posesReady: true, actionsReady: true,
    });
    const play = girlBaseVisualFor({
      activity: "play", phase: "stand", quiet: false, posesReady: true, actionsReady: true,
    });
    expect(eat).toEqual({ kind: "action", id: "eat" });
    expect(play).toEqual({ kind: "action", id: "bat" });
  });

  it("动作图缺席时退回原来那段帧动画，不空窗", () => {
    expect(girlBaseVisualFor({
      activity: "eat", phase: "stand", quiet: false, posesReady: true, actionsReady: false,
    })).toEqual({ kind: "clip", id: "happy", loop: true });
    expect(girlBaseVisualFor({
      activity: "play", phase: "stand", quiet: false, posesReady: true, actionsReady: false,
    })).toEqual({ kind: "clip", id: "wave", loop: true });
  });

  it("没配专属动画的活动一个都不许被这张表顺走", () => {
    expect(GIRL_ACTIVITY_ACTION.walk).toBeUndefined();
    expect(GIRL_ACTIVITY_ACTION.drag).toBeUndefined();
    expect(GIRL_ACTIVITY_ACTION.sleep).toBeUndefined();
    expect(girlBaseVisualFor({
      activity: "walk", phase: "stand", quiet: false, posesReady: true, actionsReady: true,
    })).toEqual({ kind: "clip", id: "walk", loop: true });
  });

  it("跳=hop、打字=type：手势也走自己那一行，且和野性三式不重名", () => {
    expect(GIRL_GESTURE_ACTION.hop).toBe("hop");
    expect(GIRL_GESTURE_ACTION.typeCode).toBe("type");
    expect(GIRL_GESTURE_ACTION.wave).toBeUndefined();
    expect(GIRL_GESTURE_ACTION.bow).toBeUndefined();
  });

  it("v1.23 点头/摇头/拍手/捂脸也各走自己那一行，有真姿态的手势不许被抢", () => {
    expect(GIRL_GESTURE_ACTION.nod).toBe("nod");
    expect(GIRL_GESTURE_ACTION.shake).toBe("shake");
    expect(GIRL_GESTURE_ACTION.clap).toBe("clap");
    expect(GIRL_GESTURE_ACTION.coverFace).toBe("coverFace");
    // 招手/鞠躬/剪刀手/歪头/洗脸/哈欠/伸懒腰已经有姿态图，手势表不许把它们顺走。
    for (const posed of ["wave", "bow", "curtsy", "point", "tilt", "groom", "yawn", "stretch"]) {
      expect(GIRL_GESTURE_ACTION[posed], posed).toBeUndefined();
    }
  });
});

describe("v1.20 野性三式的姿态", () => {
  const wild = (
    act: "zoom" | "stalk" | "hunt" | null,
    opts: { posesReady?: boolean; poses2Ready?: boolean; actionsReady?: boolean } = {},
  ) => girlWildVisualFor(act, {
    posesReady: opts.posesReady ?? true,
    poses2Ready: opts.poses2Ready ?? true,
    actionsReady: opts.actionsReady ?? false,
  });

  it("冲刺=奔跑、潜行=压低身子、扑击=跃起；没在撒野就不抢底子", () => {
    expect(wild(null)).toBeNull();
    expect(wild("zoom")).toEqual({ kind: "pose", id: "run" });
    expect(wild("stalk")).toEqual({ kind: "pose", id: "prone" });
    expect(wild("hunt")).toEqual({ kind: "pose", id: "joy" });
  });

  it("图集缺席时退回最接近的帧段，且两套图各拉各的", () => {
    // 奔跑在图集 I，趴在图集 II：坏一套不许把另一套也拖下水。
    expect(wild("zoom", { posesReady: false })).toEqual({ kind: "clip", id: "walk", loop: true });
    expect(wild("stalk", { poses2Ready: false })).toEqual({ kind: "clip", id: "sit", loop: true });
    expect(wild("stalk", { posesReady: false, poses2Ready: true })).toEqual({ kind: "pose", id: "prone" });
    expect(wild("hunt", { posesReady: false })).toEqual({ kind: "clip", id: "happy", loop: true });
  });
});

describe("v1.21 野性三式各有一条独立动画", () => {
  const wild = (
    act: "zoom" | "stalk" | "hunt" | null,
    opts: { posesReady?: boolean; poses2Ready?: boolean; actionsReady?: boolean } = {},
  ) => girlWildVisualFor(act, {
    posesReady: opts.posesReady ?? true,
    poses2Ready: opts.poses2Ready ?? true,
    actionsReady: opts.actionsReady ?? true,
  });

  it("动作图集在位：三式各播自己那一行，不再借姿态图当舞台", () => {
    expect(wild("zoom")).toEqual({ kind: "action", id: "zoom" });
    expect(wild("stalk")).toEqual({ kind: "action", id: "stalk" });
    expect(wild("hunt")).toEqual({ kind: "action", id: "hunt" });
    expect(wild(null)).toBeNull();
    // 三种冲动 → 三条不同的动画：不是同一段换了张底图。
    const ids = new Set(["zoom", "stalk", "hunt"].map((act) => {
      const v = wild(act as "zoom");
      return v && v.kind === "action" ? v.id : null;
    }));
    expect(ids.size).toBe(3);
  });

  it("动作图集坏了才退回姿态；姿态也坏了才退帧段（两套姿态图各拉各的）", () => {
    expect(wild("zoom", { actionsReady: false })).toEqual({ kind: "pose", id: "run" });
    expect(wild("stalk", { actionsReady: false, poses2Ready: false })).toEqual({ kind: "clip", id: "sit", loop: true });
    expect(wild("zoom", { actionsReady: false, posesReady: false })).toEqual({ kind: "clip", id: "walk", loop: true });
    expect(wild("hunt", { actionsReady: false, posesReady: false })).toEqual({ kind: "clip", id: "happy", loop: true });
  });
});

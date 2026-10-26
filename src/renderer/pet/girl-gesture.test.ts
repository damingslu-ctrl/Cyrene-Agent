import { describe, expect, it } from "vitest";
import { GIRL_POSE_NAMES, girlPoseAtlasId } from "./girl-pose-atlas";
import { gestureClipFor } from "./girl-anim";
import { GIRL_GESTURE_POSE, gesturePoseFor } from "./girl-gesture";

describe("v1.15.0 手势落到真姿态", () => {
  it("招手/鞠躬/剪刀手/歪头/洗脸/哈欠都有真姿态", () => {
    expect(gesturePoseFor("wave")?.pose).toBe("wave");
    expect(gesturePoseFor("bow")?.pose).toBe("bow");
    expect(gesturePoseFor("curtsy")?.pose).toBe("bow");
    expect(gesturePoseFor("point")?.pose).toBe("peace");
    expect(gesturePoseFor("tilt")?.pose).toBe("tilt");
    expect(gesturePoseFor("groom")?.pose).toBe("wash");
    expect(gesturePoseFor("yawn")?.pose).toBe("yawn");
    expect(gesturePoseFor("stretch")?.pose).toBe("stretch");
  });

  it("每张手势姿态都在册，且表态时长够看清、又不会赖着不走", () => {
    for (const [id, g] of Object.entries(GIRL_GESTURE_POSE)) {
      expect(GIRL_POSE_NAMES, id).toContain(g.pose);
      expect(g.holdMs, id).toBeGreaterThanOrEqual(800);
      expect(g.holdMs, id).toBeLessThanOrEqual(3_000);
    }
  });

  it("手势不许落到会读成睡着/趴下的姿态上（免打扰的唯一记号是月牙）", () => {
    for (const [id, g] of Object.entries(GIRL_GESTURE_POSE)) {
      expect(["curl", "prone"], id).not.toContain(g.pose);
    }
  });

  it("没有对应画的动作用帧动画兜底，而不是硬套一张姿态", () => {
    for (const id of ["nod", "shake", "typeCode", "shiver", "hop", "clap", "coverFace", "sip"]) {
      expect(gesturePoseFor(id), id).toBeNull();
      expect(gestureClipFor(id), id).not.toBeNull();
    }
  });

  it("不认识的 id 既没有姿态也不炸", () => {
    expect(gesturePoseFor("no-such-gesture")).toBeNull();
  });

  it("图集 II 的手势指向图集 II，图集 I 的指向图集 I", () => {
    expect(girlPoseAtlasId(gesturePoseFor("wave")!.pose)).toBe("poses2");
    expect(girlPoseAtlasId(gesturePoseFor("stretch")!.pose)).toBe("poses");
  });
});

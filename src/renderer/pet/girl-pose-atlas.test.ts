import { describe, expect, it } from "vitest";
import {
  GIRL_POSE_ATLASES,
  GIRL_POSE_NAMES,
  girlPoseAtlasId,
  girlPoseCell,
  girlPoseFaceRect,
  girlPoseGeom,
  girlPoseInkRect,
} from "./girl-pose-atlas";

const heightOf = (pose: (typeof GIRL_POSE_NAMES)[number]): number => {
  const [x0, y0, x1, y1] = girlPoseInkRect(pose);
  return y1 - y0;
};
const widthOf = (pose: (typeof GIRL_POSE_NAMES)[number]): number => {
  const [x0, y0, x1, y1] = girlPoseInkRect(pose);
  return x1 - x0;
};

describe("v1.15.0 两套姿态图集的统一寻址", () => {
  it("16 张姿态都在册：图集 I 八格 + 图集 II 八格，格号不撞车", () => {
    expect(GIRL_POSE_NAMES).toHaveLength(16);
    expect(new Set(GIRL_POSE_NAMES).size).toBe(16);
    expect(GIRL_POSE_NAMES).toContain("prone");
    expect(GIRL_POSE_NAMES).toContain("curl");
    expect(girlPoseAtlasId("prone")).toBe("poses2");
    expect(girlPoseAtlasId("curl")).toBe("poses");
  });

  it("趴着归图集 II，剪影又矮又宽——不会被撑成站姿那么高", () => {
    expect(girlPoseGeom("prone").cellW).toBe(400);
    expect(widthOf("prone")).toBeGreaterThan(heightOf("prone"));
    expect(heightOf("prone")).toBeLessThan(heightOf("wave"));
  });

  it("图集 I 的尺一格都不许动（v1.14 的锚点、墨高、脸框逐条锁住）", () => {
    const stand = girlPoseGeom("stand");
    expect(stand.cellW).toBe(340);
    expect(stand.cellH).toBe(248);
    expect(stand.anchorX).toBeCloseTo(0.5, 6);
    expect(stand.anchorY).toBeCloseTo(0.959677, 6);
    expect(stand.inkRefPx).toBe(229);
    expect(stand.inkVb).toBe(91);
    expect(girlPoseFaceRect("curl")).toEqual([158, 122, 108, 80]);
    expect(girlPoseCell("curl")).toBe(2);
  });

  it("两套图集共用一条 91vb 的尺：站姿墨高相等，跨图集不会忽大忽小", () => {
    expect(Math.abs(heightOf("wave") - heightOf("stand"))).toBeLessThanOrEqual(8);
    for (const pose of GIRL_POSE_NAMES) {
      expect(girlPoseGeom(pose).inkVb).toBe(91);
      expect(girlPoseGeom(pose).inkRefPx).toBe(229);
      // 共用一把尺的前提：格子高与锚点也必须一致，否则 body.k 就不能与姿态无关。
      expect(girlPoseGeom(pose).cellH).toBe(248);
      expect(girlPoseGeom(pose).anchorY).toBeCloseTo(0.959677, 6);
      expect(girlPoseGeom(pose).anchorX).toBeCloseTo(0.5, 6);
    }
  });

  it("每张姿态的脸框都落在自己的墨框里（手工量测容差 3px）", () => {
    // 脸框是 20px 网格上手工量的，容差只补量测舍入，不给「脸飘到身子外」放行。
    for (const pose of GIRL_POSE_NAMES) {
      const [x0, y0, x1, y1] = girlPoseInkRect(pose);
      const [cx, cy, w, h] = girlPoseFaceRect(pose);
      expect(cx - w / 2, pose).toBeGreaterThanOrEqual(x0 - 3);
      expect(cx + w / 2, pose).toBeLessThanOrEqual(x1 + 3);
      expect(cy - h / 2, pose).toBeGreaterThanOrEqual(y0 - 3);
      expect(cy + h / 2, pose).toBeLessThanOrEqual(y1 + 3);
    }
  });

  it("格号连续且每图集各 8 格", () => {
    const atlas1 = GIRL_POSE_NAMES.filter((p) => girlPoseAtlasId(p) === "poses");
    const atlas2 = GIRL_POSE_NAMES.filter((p) => girlPoseAtlasId(p) === "poses2");
    expect(atlas1).toHaveLength(8);
    expect(atlas2).toHaveLength(8);
    expect(atlas2.map(girlPoseCell).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(atlas1.map(girlPoseCell).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("两套图集各自的图源都在册，且指向不同的 webp", () => {
    expect(GIRL_POSE_ATLASES.poses.src).toBe("./pet/girl-poses.webp");
    expect(GIRL_POSE_ATLASES.poses2.src).toBe("./pet/girl-poses2.webp");
    expect(GIRL_POSE_ATLASES.poses2.cellW).toBe(400);
    expect(GIRL_POSE_ATLASES.poses2.count).toBe(8);
  });
});

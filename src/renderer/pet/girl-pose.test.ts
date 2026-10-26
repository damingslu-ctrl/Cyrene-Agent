import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import {
  GIRL_PET_POSES,
  GIRL_PET_POSE_CELLS,
  GIRL_PET_POSE_FACE,
  GIRL_PET_POSE_INK,
  type GirlPoseId,
} from "./girl-pet-poses-meta";
import { girlPoseGeom } from "./girl-pose-atlas";
import {
  buildGirlPoseOverlayOps,
  girlPoseBodyFor,
  girlPoseCellPoint,
  girlPoseFaceBox,
  girlPoseInkBox,
  girlPoseOverlayCenter,
} from "./girl-sprite";

const SIZE_U = 37;
const S = (SIZE_U * 2) / 120;
const POSES = Object.keys(GIRL_PET_POSE_CELLS) as GirlPoseId[];

function mk(overrides: Partial<CatInput> = {}): CatInput {
  return {
    center: { x: 100, y: 200 },
    u: SIZE_U,
    mood: "idle",
    t: 0,
    energy: 1,
    mouse: null,
    blink: 0,
    jumpY: 0,
    pet: 0,
    quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
    ...overrides,
  };
}

describe("桌宠姿态图集元数据", () => {
  it("八格恰好铺满 0..7，脸框在墨框里，墨框在格子里", () => {
    expect(GIRL_PET_POSES.count).toBe(8);
    expect(GIRL_PET_POSES.cols * GIRL_PET_POSES.rows).toBe(GIRL_PET_POSES.count);
    expect(new Set(Object.values(GIRL_PET_POSE_CELLS)).size).toBe(8);
    expect([...Object.values(GIRL_PET_POSE_CELLS)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // 脸框是 2× 网格手工量的，与 alpha 墨框有 1px 级的量测差；只锁「在角色身上」。
    const faceSlack = 1.5;
    for (const pose of POSES) {
      const [fx, fy, fw, fh] = GIRL_PET_POSE_FACE[pose];
      const [ix0, iy0, ix1, iy1] = GIRL_PET_POSE_INK[pose];
      expect(fx - fw / 2, `${pose} 脸左`).toBeGreaterThanOrEqual(ix0 - faceSlack);
      expect(fx + fw / 2, `${pose} 脸右`).toBeLessThanOrEqual(ix1 + faceSlack);
      expect(fy - fh / 2, `${pose} 脸上`).toBeGreaterThanOrEqual(iy0 - faceSlack);
      expect(fy + fh / 2, `${pose} 脸下`).toBeLessThanOrEqual(iy1 + faceSlack);
      expect(ix0).toBeGreaterThanOrEqual(0);
      expect(iy0).toBeGreaterThanOrEqual(0);
      expect(ix1).toBeLessThanOrEqual(GIRL_PET_POSES.cellW);
      expect(iy1).toBeLessThanOrEqual(GIRL_PET_POSES.cellH);
      expect(ix1, `${pose} 墨框非空`).toBeGreaterThan(ix0);
      expect(iy1, `${pose} 墨框非空`).toBeGreaterThan(iy0);
    }
  });

  it("运行时图集真在盘上且是 WebP", () => {
    const buf = readFileSync(new URL("../public/pet/girl-poses.webp", import.meta.url));
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(buf.byteLength).toBeGreaterThan(50_000);
  });
});

describe("姿态刚体几何", () => {
  it("静止时刻 = 原样：脚心对齐、不转不压；呼吸只在这一层轻轻叠", () => {
    const b = girlPoseBodyFor(mk());
    expect(b.pivot).toEqual({ x: 100, y: 200 });
    expect(b.rot).toBeCloseTo(0, 6);
    expect(b.sx).toBeCloseTo(1, 6);
    expect(b.sy).toBeCloseTo(1, 6);
    expect(b.k).toBeCloseTo((S * GIRL_PET_POSES.inkVb) / GIRL_PET_POSES.inkRefPx, 9);

    // 呼吸是整身 1.2% 的纵向起伏，不是旧版那种「趴下压扁」。
    const inhale = girlPoseBodyFor(mk({ t: Math.PI / 2 / 1.5 }));
    expect(inhale.sy).toBeGreaterThan(1.005);
    expect(inhale.sy).toBeLessThan(1.02);
  });

  it("sprawl 彻底失效：真坐/真蜷不再靠压扁假扮", () => {
    const base = mk().pose;
    const flat = girlPoseBodyFor(mk());
    const sprawled = girlPoseBodyFor(mk({ pose: { ...base, sprawl: 0.92 } }));
    expect(sprawled.sy).toBeCloseTo(flat.sy, 9);
    expect(sprawled.sx).toBeCloseTo(flat.sx, 9);
    expect(sprawled.pivot).toEqual(flat.pivot);
  });

  it("落地压扁、歪头、跳起、朝向、存在感都还生效", () => {
    const base = mk().pose;
    const squash = girlPoseBodyFor(mk({ pose: { ...base, squash: 1 } }));
    expect(squash.sy).toBeLessThan(0.87);
    expect(squash.sx).toBeGreaterThan(1.1);

    const lean = girlPoseBodyFor(mk({ pose: { ...base, tilt: 5 } }));
    expect(lean.rot).toBeCloseTo((3.5 * Math.PI) / 180, 6);

    const jump = girlPoseBodyFor(mk({ jumpY: -10 }));
    expect(jump.pivot.y).toBe(190);

    const left = girlPoseBodyFor(mk({ facing: -1 }));
    expect(left.facing).toBe(-1);

    const presence = girlPoseBodyFor(mk(), { leanDeg: 4.2, shiftX: 2.2, facing: -1 });
    expect(presence.pivot.x).toBeCloseTo(102.2, 6);
    expect(presence.rot).toBeCloseTo((4.2 * Math.PI) / 180, 6);
    expect(presence.facing).toBe(-1);
  });

  it("格子锚点正好落在支点上", () => {
    const body = girlPoseBodyFor(mk(), { leanDeg: 3, shiftX: 1.5 });
    // 两套图集各取一张：锚点与格宽都从这张姿态自己的图集来。
    for (const pose of ["stand", "prone"] as const) {
      const geom = girlPoseGeom(pose);
      const anchor = girlPoseCellPoint(body, pose, geom.anchorX, geom.anchorY);
      expect(anchor.x, pose).toBeCloseTo(body.pivot.x, 6);
      expect(anchor.y, pose).toBeCloseTo(body.pivot.y, 6);
    }
  });
});

describe("姿态的脸框与墨框", () => {
  it("每一格、两个朝向，脸都在墨框内，且脸心落在墨框上半部", () => {
    const bodyR = girlPoseBodyFor(mk({ facing: 1 }));
    const bodyL = girlPoseBodyFor(mk({ facing: -1 }));
    for (const pose of POSES) {
      for (const body of [bodyR, bodyL]) {
        const face = girlPoseFaceBox(body, pose);
        const ink = girlPoseInkBox(body, pose);
        expect(face.left, `${pose} 左缘`).toBeGreaterThanOrEqual(ink.left - 0.5);
        expect(face.right, `${pose} 右缘`).toBeLessThanOrEqual(ink.right + 0.5);
        expect(face.top, `${pose} 上缘`).toBeGreaterThanOrEqual(ink.top - 0.5);
        expect(face.bottom, `${pose} 下缘`).toBeLessThanOrEqual(ink.bottom + 0.5);
        expect(face.cy, `${pose} 脸心`).toBeLessThan(ink.top + ink.h * 0.55);
        expect(face.bottom, `${pose} 脸不压脚线`).toBeLessThan(body.pivot.y);
      }
    }
  });

  it("站立墨高与静态立绘同尺；蜷缩的脸比站立低", () => {
    const body = girlPoseBodyFor(mk());
    const standInk = girlPoseInkBox(body, "stand");
    // 图集里实测 alpha 墨框 y0..y1 = 9..239，换算后与 91vb 的名义尺差不到 1vb。
    expect(standInk.h / S).toBeGreaterThan(90.5);
    expect(standInk.h / S).toBeLessThan(92.5);
    expect(standInk.bottom).toBeCloseTo(body.pivot.y, 0);

    const standFace = girlPoseFaceBox(body, "stand");
    const curlFace = girlPoseFaceBox(body, "curl");
    expect(curlFace.cy).toBeGreaterThan(standFace.cy + 3);
  });

  it("翻身时脸跟着挪到另一侧", () => {
    const right = girlPoseFaceBox(girlPoseBodyFor(mk({ facing: 1 })), "look");
    const left = girlPoseFaceBox(girlPoseBodyFor(mk({ facing: -1 })), "look");
    const offR = right.cx - 100;
    const offL = left.cx - 100;
    expect(Math.abs(offR)).toBeGreaterThan(1);
    expect(Math.sign(offR)).toBe(-Math.sign(offL));
  });
});

describe("姿态的记号锚点", () => {
  it("站立时与旧口径同高；坐下/蜷起时记号跟着头降下来", () => {
    const body = girlPoseBodyFor(mk());
    const stand = girlPoseOverlayCenter(body, "stand");
    expect(stand.y).toBeCloseTo(200 - 54.5 * S, 0);
    const curl = girlPoseOverlayCenter(body, "curl");
    const sit = girlPoseOverlayCenter(body, "sit");
    expect(curl.y).toBeGreaterThan(stand.y + 3);
    expect(sit.y).toBeGreaterThan(stand.y);
    expect(curl.y).toBeGreaterThan(sit.y - 2);
  });

  it("Zzz/月牙在姿态头顶之上；朝左时记号落点跟着翻边", () => {
    const body = girlPoseBodyFor(mk());
    const ops = buildGirlPoseOverlayOps(mk({ mood: "sleep", t: 0 }), "curl", body);
    const zzz = ops.filter((o) => o.layer === "zzz");
    expect(zzz.length).toBeGreaterThan(0);
    const face = girlPoseFaceBox(body, "curl");
    for (const o of zzz) {
      if (o.kind === "text") expect(o.y, `Zzz ${o.text}`).toBeLessThan(face.top);
    }

    const right = girlPoseOverlayCenter(girlPoseBodyFor(mk({ facing: 1 })), "look");
    const left = girlPoseOverlayCenter(girlPoseBodyFor(mk({ facing: -1 })), "look");
    expect(Math.sign(right.x - 100)).toBe(-Math.sign(left.x - 100));
  });
});

import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import { girlAnimBodyFor, girlFaceBox } from "./girl-sprite";
import {
  CRITTER_LIFE_MS,
  buildCritterOps,
  catchCritter,
  critterAlive,
  critterAt,
  critterKindFor,
  critterPos,
  spawnCritter,
  stepCritter,
  type CritterState,
} from "./girl-critter";

function mkFace() {
  const cat: CatInput = {
    center: { x: 41, y: 88 },
    u: 37,
    mood: "idle",
    t: 0,
    energy: 1,
    mouse: null,
    blink: 0,
    jumpY: 0,
    pet: 0,
    quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
  };
  return girlFaceBox(girlAnimBodyFor(cat), 0);
}

describe("伴飞小虫", () => {
  it("白天是蝴蝶、入夜是流萤；边界按 6/18 点切", () => {
    expect(critterKindFor(5)).toBe("firefly");
    expect(critterKindFor(6)).toBe("butterfly");
    expect(critterKindFor(12)).toBe("butterfly");
    expect(critterKindFor(17)).toBe("butterfly");
    expect(critterKindFor(18)).toBe("firefly");
    expect(critterKindFor(2)).toBe("firefly");
  });

  it("出生时贴着、活着，绕着脸飞但不出身子太远；同种子同刻完全一致", () => {
    const face = mkFace();
    const bug = spawnCritter({ now: 1_000, kind: "butterfly", seed: 0.4 });
    expect(critterAlive(bug, 1_000)).toBe(true);
    const p0 = critterPos(bug, 1_000, face);
    expect(Math.abs(p0.x - face.cx)).toBeLessThan(face.w * 2);
    expect(p0.y).toBeLessThan(face.bottom);
    expect(p0.y).toBeGreaterThan(face.top - face.h * 2.2);

    const twin = spawnCritter({ now: 1_000, kind: "butterfly", seed: 0.4 });
    expect(critterPos(twin, 1_400, face)).toEqual(critterPos(bug, 1_400, face));
    const later = critterPos(bug, 2_000, face);
    expect(Math.hypot(later.x - p0.x, later.y - p0.y)).toBeGreaterThan(0.5);
  });

  it("step 把当前位置推进到当前时刻；命中判定按这颗位置，远处点不中", () => {
    const face = mkFace();
    const bug = spawnCritter({ now: 0, kind: "firefly", seed: 0.2 });
    stepCritter(bug, 900, face);
    const p = critterPos(bug, 900, face);
    expect(bug.x).toBeCloseTo(p.x, 6);
    expect(bug.y).toBeCloseTo(p.y, 6);
    expect(critterAt(bug, 900, face, p.x, p.y)).toBe(true);
    expect(critterAt(bug, 900, face, p.x + 40, p.y)).toBe(false);
  });

  it("捉到后先亮一小下再消失；到寿命也会走", () => {
    const face = mkFace();
    const bug = spawnCritter({ now: 0, kind: "butterfly", seed: 0.8 });
    expect(catchCritter(bug, 1_000)).toBe(true);
    expect(catchCritter(bug, 1_010)).toBe(false);
    expect(critterAlive(bug, 1_010)).toBe(false);
    expect(buildCritterOps(bug, 1_050, face).length).toBeGreaterThan(0);
    expect(buildCritterOps(bug, 1_600, face)).toEqual([]);

    const old = spawnCritter({ now: 0, kind: "firefly", seed: 0.1 });
    expect(critterAlive(old, CRITTER_LIFE_MS - 1)).toBe(true);
    expect(critterAlive(old, CRITTER_LIFE_MS)).toBe(false);
    expect(buildCritterOps(old, CRITTER_LIFE_MS, face)).toEqual([]);
  });

  it("两种小虫都双色、坐标有限；蝴蝶翅膀会扇", () => {
    const face = mkFace();
    const butterfly = spawnCritter({ now: 0, kind: "butterfly", seed: 0.3 });
    const firefly = spawnCritter({ now: 0, kind: "firefly", seed: 0.3 });
    for (const bug of [butterfly, firefly]) {
      const ops = buildCritterOps(bug, 500, face);
      expect(ops.length).toBeGreaterThanOrEqual(6);
      for (const op of ops) {
        expect(op.layer).toBe("stars");
        const numbers = [
          ...("points" in op ? op.points.flat() : []),
          ...(op.kind === "fillEllipse" || op.kind === "strokeEllipse" ? [op.cx, op.cy, op.rx, op.ry] : []),
        ];
        for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      }
      const fills = ops.map((op) => (op.kind === "fillEllipse" ? op.fill : op.kind === "fillPath" ? op.fill : ""));
      expect(fills.some((f) => f.startsWith("rgba(247, 244, 236"))).toBe(true);
    }
    const flapA = JSON.stringify(buildCritterOps(butterfly, 500, face));
    const flapB = JSON.stringify(buildCritterOps(butterfly, 560, face));
    expect(flapA).not.toBe(flapB);
  });

  it("坏时钟不把虫子变到 NaN", () => {
    const face = mkFace();
    const bug: CritterState = spawnCritter({ now: 0, kind: "butterfly", seed: 0.5 });
    stepCritter(bug, Number.NaN, face);
    expect(Number.isFinite(bug.x)).toBe(true);
    expect(Number.isFinite(bug.y)).toBe(true);
  });
});

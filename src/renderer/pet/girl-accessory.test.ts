import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import { girlAnimBodyFor, girlFaceBox, girlInkBox } from "./girl-sprite";
import { buildAccessoryOps } from "./girl-accessory";
import { ACCESSORY_IDS, normalizeAccessory } from "../../shared/pet-accessory";
import { opsBounds } from "./ops";

function mkCat(over: Partial<CatInput> = {}): CatInput {
  return {
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
    ...over,
  };
}

const body = girlAnimBodyFor(mkCat());

describe("accessory ids", () => {
  it("六档装扮按固定表；坏值一律回 none", () => {
    expect(ACCESSORY_IDS).toEqual(["none", "bell", "bow", "scarf", "flower", "star"]);
    expect(normalizeAccessory("bell")).toBe("bell");
    expect(normalizeAccessory("BOW")).toBe("none");
    expect(normalizeAccessory(undefined)).toBe("none");
    expect(normalizeAccessory("")).toBe("none");
    expect(normalizeAccessory(3)).toBe("none");
  });
});

describe("猫娘装扮画法", () => {
  it("不戴时一支签都不多画", () => {
    expect(buildAccessoryOps({ body, frame: 0, nowSec: 1, activity: "idle", facing: 1 })).toEqual([]);
  });

  it("每一件都画在墨框里、双色、坐标有限", () => {
    const ink = girlInkBox(body, 0);
    const face = girlFaceBox(body, 0);
    for (const id of ACCESSORY_IDS) {
      const ops = buildAccessoryOps({ body, frame: 0, nowSec: 2.4, activity: "idle", facing: 1, accessory: id });
      if (id === "none") {
        expect(ops).toEqual([]);
        continue;
      }
      expect(ops.length).toBeGreaterThanOrEqual(6);
      // 第一笔必须是奶油光边：桌布/猫身两种底色下都要读得出来。
      const first = ops[0];
      expect(first.kind === "fillEllipse" ? first.fill : first.kind === "strokePath" ? first.stroke : "").toMatch(/^rgba\(247, 244, 236/);
      for (const op of ops) {
        expect(op.layer === "collar" || op.layer === "hair_front").toBe(true);
        const numbers = [
          ...("points" in op ? op.points.flat() : []),
          ...(op.kind === "fillEllipse" || op.kind === "strokeEllipse" ? [op.cx, op.cy, op.rx, op.ry] : []),
          ...(op.kind === "fillRoundRect" || op.kind === "strokeRoundRect" ? [op.x, op.y, op.w, op.h, op.r] : []),
        ];
        for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      }
      const bounds = opsBounds(ops)!;
      expect(bounds.x).toBeGreaterThanOrEqual(ink.left - 4);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(ink.right + 4);
      expect(bounds.y).toBeGreaterThanOrEqual(ink.top - 4);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(ink.bottom + 4);
      // 装扮贴着身子/头，不许飘出半只猫远。
      expect(Math.abs(bounds.x + bounds.width / 2 - face.cx)).toBeLessThan(face.w * 1.2);
    }
  });

  it("脖子上的（铃铛/围巾）落在脸下半以下，头上的（结/花/星）落在脸部上半", () => {
    const face = girlFaceBox(body, 0);
    const centerY = (id: "bell" | "bow" | "scarf" | "flower" | "star") => {
      const ops = buildAccessoryOps({ body, frame: 0, nowSec: 1, activity: "idle", facing: 1, accessory: id });
      const b = opsBounds(ops)!;
      return b.y + b.height / 2;
    };
    expect(centerY("bell")).toBeGreaterThan(face.cy + face.h * 0.2);
    expect(centerY("scarf")).toBeGreaterThan(face.cy + face.h * 0.2);
    expect(centerY("bow")).toBeLessThan(face.cy);
    expect(centerY("flower")).toBeLessThan(face.cy + face.h * 0.2);
    expect(centerY("star")).toBeLessThan(face.cy);
  });

  it("五件各不相同；朝向翻转时耳边花换边；铃铛会随呼吸摆", () => {
    const arts = (["bell", "bow", "scarf", "flower", "star"] as const).map((id) =>
      JSON.stringify(buildAccessoryOps({ body, frame: 0, nowSec: 1.2, activity: "idle", facing: 1, accessory: id })),
    );
    expect(new Set(arts).size).toBe(5);

    const flowerRight = opsBounds(buildAccessoryOps({ body, frame: 0, nowSec: 1, activity: "idle", facing: 1, accessory: "flower" }))!;
    const flowerLeft = opsBounds(buildAccessoryOps({ body, frame: 0, nowSec: 1, activity: "idle", facing: -1, accessory: "flower" }))!;
    const face = girlFaceBox(body, 0);
    expect(flowerRight.x + flowerRight.width / 2).toBeGreaterThan(face.cx);
    expect(flowerLeft.x + flowerLeft.width / 2).toBeLessThan(face.cx);

    const bell0 = JSON.stringify(buildAccessoryOps({ body, frame: 0, nowSec: 0, activity: "idle", facing: 1, accessory: "bell" }));
    const bell1 = JSON.stringify(buildAccessoryOps({ body, frame: 0, nowSec: 0.7, activity: "idle", facing: 1, accessory: "bell" }));
    expect(bell0).not.toBe(bell1);
  });
});

describe("姿态图的脸框覆盖", () => {
  it("花/星钉到姿态的脸，而不是帧号那张脸", () => {
    const real = girlFaceBox(body, 0);
    const face = {
      ...real,
      cx: real.cx + 40,
      cy: real.cy + 30,
      left: real.left + 40,
      right: real.right + 40,
      top: real.top + 30,
      bottom: real.bottom + 30,
    };
    const base = buildAccessoryOps({ body, frame: 0, nowSec: 2.4, activity: "idle", facing: 1, accessory: "flower" });
    const moved = buildAccessoryOps({ body, frame: 0, nowSec: 2.4, activity: "idle", facing: 1, accessory: "flower", face });
    const b0 = opsBounds(base)!;
    const b1 = opsBounds(moved)!;
    expect(b1.x - b0.x).toBeGreaterThan(30);
  });
});

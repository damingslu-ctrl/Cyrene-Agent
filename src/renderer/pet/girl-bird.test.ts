import { describe, expect, it } from "vitest";
import {
  BIRD_FLY_MS, BIRD_MS, birdAlive, birdAt, birdAtPoint, birdClickable, birdHitRadius, birdPerch, buildBirdOps, createBird, scareBird,
} from "./girl-bird";

const FACE = { cx: 41, top: 22, w: 46 };

function allNumbersFinite(ops: ReturnType<typeof buildBirdOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("小鸟来访", () => {
  it("落脚点在她头顶右上方，且始终夹在窗内", () => {
    for (const cx of [0, 12, 41, 70, 82, 120]) {
      for (const w of [10, 46, 90]) {
        const p = birdPerch({ cx, top: 22, w });
        expect(p.x).toBeGreaterThanOrEqual(10);
        expect(p.x).toBeLessThanOrEqual(72);
        expect(p.y).toBeGreaterThanOrEqual(7);
        expect(Number.isFinite(p.x)).toBe(true);
      }
    }
  });

  it("飞入 0.9s → 停稳 → 5.6s 后自己飞走；全程寿命约 7.2s", () => {
    const bird = createBird(0, 0.4);
    expect(birdAt(bird, 0, FACE).pose).toBe("in");
    expect(birdAt(bird, BIRD_FLY_MS - 1, FACE).pose).toBe("in");
    expect(birdAt(bird, BIRD_FLY_MS + 10, FACE).pose).toBe("perch");
    expect(birdAt(bird, BIRD_MS - 1, FACE).pose).toBe("away");
    expect(birdAlive(bird, 0, FACE)).toBe(true);
    expect(birdAlive(bird, BIRD_MS + 1, FACE)).toBe(false);
  });

  it("飞入从右上角滑到枝头、离开往左淡出；停稳时只在枝头小范围点头", () => {
    const bird = createBird(0, 0.4);
    const perch = birdPerch(FACE);
    const enter = birdAt(bird, 0, FACE);
    expect(enter.x).toBeGreaterThan(perch.x);
    expect(enter.y).toBeLessThan(perch.y);
    const settled = birdAt(bird, 2_000, FACE);
    expect(settled.x).toBeCloseTo(perch.x, 6);
    expect(Math.abs(settled.y - perch.y)).toBeLessThanOrEqual(0.7);
    const away = birdAt(bird, BIRD_MS - 1, FACE);
    expect(away.x).toBeLessThan(perch.x);
    expect(away.alpha).toBeLessThan(0.3);
  });

  it("只有停稳时可点；点走后不再可点，也不重复受惊", () => {
    const bird = createBird(0, 0.2);
    expect(birdClickable(bird, 500, FACE)).toBe(false);
    expect(birdClickable(bird, 2_000, FACE)).toBe(true);
    const pos = birdAt(bird, 2_000, FACE);
    expect(birdAtPoint(bird, 2_000, FACE, pos.x, pos.y - 1)).toBe(true);
    expect(birdAtPoint(bird, 2_000, FACE, pos.x + birdHitRadius() + 2, pos.y - 1)).toBe(false);
    expect(birdAtPoint(bird, 600, FACE, birdAt(bird, 600, FACE).x, birdAt(bird, 600, FACE).y)).toBe(false);

    expect(scareBird(bird, 2_100)).toBe(true);
    expect(scareBird(bird, 2_900)).toBe(false);
    expect(birdClickable(bird, 2_150, FACE)).toBe(false);
    expect(birdAtPoint(bird, 2_150, FACE, pos.x, pos.y - 1)).toBe(false);
  });

  it("画法：奶油鸟 + 墨点眼睛 + 小枝垫底；飞走时飘两根羽毛，坐标全有限", () => {
    const bird = createBird(0, 0.1);
    const perched = buildBirdOps(bird, 2_000, FACE);
    expect(perched.length).toBeGreaterThan(8);
    expect(perched.filter((op) => op.kind === "fillEllipse")).toHaveLength(5);
    expect(perched.some((op) => op.kind === "strokePath" && (op.points?.length ?? 0) === 3)).toBe(true);
    expect(allNumbersFinite(perched)).toBe(true);

    scareBird(bird, 2_000);
    const away = buildBirdOps(bird, 2_000 + 400, FACE);
    expect(allNumbersFinite(away)).toBe(true);
    expect(buildBirdOps(bird, 2_000 + BIRD_FLY_MS + 1, FACE)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  HIDE_COVER_MS,
  HIDE_FOUND_MS,
  HIDE_MISS_MS,
  HIDE_PEEK_MS,
  buildHideOps,
  createHide,
  hideAlive,
  hidePhase,
  tapHide,
} from "./girl-hide";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };

function finite(ops: ReturnType<typeof buildHideOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("躲猫猫", () => {
  it("捂眼 → 探头 → 收场：三段首尾相接，不重叠", () => {
    const s = createHide(1_000);
    expect(hidePhase(s, 999)).toBe("gone");
    expect(hidePhase(s, 1_000)).toBe("cover");
    expect(hidePhase(s, 1_000 + HIDE_COVER_MS - 1)).toBe("cover");
    expect(hidePhase(s, 1_000 + HIDE_COVER_MS)).toBe("peek");
    expect(hidePhase(s, 1_000 + HIDE_COVER_MS + HIDE_PEEK_MS - 1)).toBe("peek");
    expect(hidePhase(s, 1_000 + HIDE_COVER_MS + HIDE_PEEK_MS)).toBe("miss");
    expect(hideAlive(s, 1_000 + HIDE_COVER_MS + HIDE_PEEK_MS + HIDE_MISS_MS - 1)).toBe(true);
    expect(hideAlive(s, 1_000 + HIDE_COVER_MS + HIDE_PEEK_MS + HIDE_MISS_MS)).toBe(false);
  });

  it("捂眼时点＝太早不算；探头时点才逮到；逮到后不再重复", () => {
    const s = createHide(0);
    expect(tapHide(s, HIDE_COVER_MS - 1)).toBe("late");
    expect(hidePhase(s, HIDE_COVER_MS - 1)).toBe("cover");
    const hitAt = HIDE_COVER_MS + 500;
    expect(tapHide(s, hitAt)).toBe("found");
    expect(hidePhase(s, hitAt)).toBe("found");
    expect(tapHide(s, hitAt + 1)).toBe("none");
    expect(hidePhase(s, hitAt + HIDE_FOUND_MS)).toBe("gone");
  });

  it("探头期没点到：收成 miss，之后再点都不算", () => {
    const s = createHide(0);
    const end = HIDE_COVER_MS + HIDE_PEEK_MS + 1;
    expect(hidePhase(s, end)).toBe("miss");
    expect(tapHide(s, end)).toBe("none");
  });

  it("画法：捂眼时问号、探头时感叹号、收场有记号；全是有限数", () => {
    const s = createHide(0);
    const cover = buildHideOps(s, 200, FACE);
    const peek = buildHideOps(s, HIDE_COVER_MS + 200, FACE);
    expect(cover.length).toBeGreaterThan(0);
    expect(peek.length).toBeGreaterThan(0);
    expect(buildHideOps(s, HIDE_COVER_MS + HIDE_PEEK_MS + 1, FACE).length).toBeGreaterThan(0);
    expect(finite(cover) && finite(peek)).toBe(true);

    tapHide(s, HIDE_COVER_MS + 100);
    const found = buildHideOps(s, HIDE_COVER_MS + 300, FACE);
    expect(found.length).toBeGreaterThan(peek.length);
    expect(finite(found)).toBe(true);
    expect(buildHideOps(s, 2_000 + HIDE_COVER_MS + HIDE_FOUND_MS, FACE)).toEqual([]);
  });
});

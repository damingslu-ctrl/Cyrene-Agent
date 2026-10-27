import { describe, expect, it } from "vitest";
import { EMPTY_STATS } from "./girl-achievements";
import {
  FAVORITE_MIN,
  FAVORITE_TOYS,
  favoriteReport,
  favoriteRequestLine,
  favoriteToy,
} from "./girl-favorite";

const stats = (patch: Partial<typeof EMPTY_STATS>) => ({ ...EMPTY_STATS, ...patch });

describe("本命玩具", () => {
  it("玩过三次以上才算本命；没有够数的返回 null", () => {
    expect(favoriteToy(EMPTY_STATS)).toBeNull();
    expect(favoriteToy(stats({ wand: FAVORITE_MIN - 1 }))).toBeNull();
    const fav = favoriteToy(stats({ wand: FAVORITE_MIN }));
    expect(fav).toMatchObject({ id: "wand", label: "逗猫棒", count: FAVORITE_MIN });
  });

  it("多个都够数：取玩得最多的那个；打平按词表顺序，不随刷新变", () => {
    const fav = favoriteToy(stats({ bell: 5, bubbles: 9, wand: 9 }));
    expect(fav?.id).toBe("wand");
    expect(favoriteToy(stats({ bell: 6, bubbles: 9 }))?.id).toBe("bubbles");
  });

  it("请求句带玩具名，且只从三条里出；roll 会归一化", () => {
    const fav = { id: "wand" as const, label: "逗猫棒", count: 4 };
    const lines = new Set([0, 0.34, 0.67, 0.999].map((r) => favoriteRequestLine(fav, r)));
    for (const line of lines) expect(line).toContain("逗猫棒");
    expect(lines.size).toBeGreaterThan(1);
    expect(favoriteRequestLine(fav, 1.7)).toBe(favoriteRequestLine(fav, 0.7));
  });

  it("成长记录一行：本命 + 次数；没有本命时给一句等出来的话", () => {
    expect(favoriteReport(null)).toContain("还没");
    const line = favoriteReport({ id: "wand", label: "逗猫棒", count: 6 });
    expect(line).toContain("逗猫棒");
    expect(line).toContain("6");
  });

  it("词表里每一件都能从统计里读到数；id 不重复", () => {
    const ids = FAVORITE_TOYS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const toy of FAVORITE_TOYS) {
      expect(toy.label.length).toBeGreaterThan(0);
      expect(EMPTY_STATS).toHaveProperty(toy.stat);
    }
    expect(FAVORITE_MIN).toBeGreaterThanOrEqual(2);
  });
});

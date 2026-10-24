import { describe, expect, it } from "vitest";
import { MIN_PIXEL_DIFF, pixelDiffRatio, type RasterLike } from "./min-pixel-diff";

const mk = (w: number, h: number, fill = 0): RasterLike => ({
  width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(fill),
});

describe("pixelDiffRatio", () => {
  it("阈值是 0.005（资产门与尺 #72 同一个数）", () => {
    expect(MIN_PIXEL_DIFF).toBe(0.005);
  });

  it("同一张图零差", () => {
    const a = mk(4, 5, 7);
    expect(pixelDiffRatio(a, a)).toBe(0);
  });

  it("单像素改动 = 1/(w·h)", () => {
    const a = mk(4, 5);
    const b = mk(4, 5);
    b.rgba[3] = 255;
    expect(pixelDiffRatio(a, b)).toBeCloseTo(1 / 20, 12);
  });

  it("尺寸不同抛错（静默比出一个数比抛错更难查）", () => {
    expect(() => pixelDiffRatio(mk(4, 5), mk(5, 4))).toThrow(/尺寸不同/);
  });
});

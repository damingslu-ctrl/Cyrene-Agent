import { describe, expect, it } from "vitest";
import { renderOps } from "./sprite-raster";

describe("软件光栅化器", () => {
  it("fillEllipse 画出非空像素", () => {
    const r = renderOps([{ kind: "fillEllipse", fill: "#ff0000", cx: 8, cy: 8, rx: 6, ry: 6 }], 16, 16);
    const nonZero = r.data.filter((v, i) => i % 4 === 3 && v > 0).length;
    expect(nonZero).toBeGreaterThan(10);
  });
});

import { describe, expect, it } from "vitest";
import { alphaCoverage, inkCentroid, renderOps, subtractSpans } from "./sprite-raster";
import type { DrawOp } from "./draw-ops";

const over = (ops: DrawOp[], size = 10): Uint8Array => renderOps(ops, size, size).rgba;
const alphaAt = (rgba: Uint8Array, size: number, x: number, y: number): number => rgba[(y * size + x) * 4 + 3];

describe("软件光栅化器", () => {
  it("两块半透同色按 source-over 叠：α=0.5 两层叠出 0.75，不是 0.5", () => {
    const sq: DrawOp = { kind: "fillPath", fill: "rgba(43,47,58,0.5)", points: [[0,0],[10,0],[10,10],[0,10]] };
    const px = over([sq, sq]);
    expect(px[3]).toBe(191); // 255*0.75 = 191.25 → 191
    expect(px[0]).toBeCloseTo(43, 0); // 半透色不许在降采样里被除以两次 alpha
  });

  it("透明底上的白爪不许被降采样拉成灰边：alpha 加权平均", () => {
    const disc: DrawOp = { kind: "fillEllipse", fill: "#ffffff", cx: 5, cy: 5, rx: 4, ry: 4 };
    const r = renderOps([disc], 40, 40, { ss: 4 });
    let edge = -1;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i + 3] > 40 && r.rgba[i + 3] < 200) { edge = i; break; }
    expect(edge).toBeGreaterThan(-1);
    expect(r.rgba[edge]).toBeGreaterThan(240); // 半透边缘仍是白的
    expect(r.rgba[edge + 1]).toBeGreaterThan(240);
  });

  it("月牙是差集不是对称差（native #69 双色那条几何）", () => {
    const moon: DrawOp = { kind: "crescent", fill: "#2b2f3a", cx: 20, cy: 20, r: 16, dx: 8, dy: -5, cut: 14.7 };
    const r = renderOps([moon], 40, 40, { ss: 2 });
    // 内圆伸出外圆那一截（右上）一行都不该填
    expect(r.rgba[(8 * 40 + 34) * 4 + 3]).toBe(0);
    expect(alphaCoverage(renderOps([moon], 40, 40))).toBeGreaterThan(0.15);
  });

  it("text 图元直接抛——位图管线不支持字体（R-D10）", () => {
    expect(() => renderOps([{ kind: "text", text: "Z", x: 1, y: 1, size: 8, color: "#fff" }], 8, 8))
      .toThrow(/text/);
  });

  it("disc 遮罩把四角切干净（圆头像档）", () => {
    const bg: DrawOp = { kind: "fillPath", fill: "#5b8def", points: [[0,0],[64,0],[64,64],[0,64]] };
    const r = renderOps([bg], 64, 64, { mask: "disc" });
    expect(r.rgba[0 * 64 * 4 + 3]).toBe(0);
    expect(r.rgba[(32 * 64 + 32) * 4 + 3]).toBe(255);
    expect(inkCentroid(r).x).toBeCloseTo(32, 0);
    // 正对照：同一张图不加遮罩时角上是满的
    expect(renderOps([bg], 64, 64).rgba[3]).toBe(255);
  });

  it("gradPath 沿 from→to 插值，而不是拿第一个 stop 当平色", () => {
    const g: DrawOp = {
      kind: "gradPath", from: [0, 0], to: [0, 10], points: [[0,0],[10,0],[10,10],[0,10]],
      stops: [{ at: 0, color: "#000000" }, { at: 1, color: "#ffffff" }],
    };
    const r = renderOps([g], 10, 10);
    expect(r.rgba[(0 * 10 + 5) * 4 + 3]).toBe(255);
    expect(r.rgba[(0 * 10 + 5) * 4]).toBeLessThan(60);
    expect(r.rgba[(9 * 10 + 5) * 4]).toBeGreaterThan(190);
  });

  it("strokePath 不闭合：V 形的弦不许被连出来（native #56）", () => {
    const open: DrawOp = { kind: "strokePath", stroke: "#000000", width: 1, points: [[5,5],[10,10],[15,5]] };
    const r = renderOps([open], 20, 20, { ss: 4 });
    expect(alphaAt(r.rgba, 20, 5, 5)).toBeGreaterThan(0);
    expect(alphaAt(r.rgba, 20, 10, 10)).toBeGreaterThan(0);
    expect(alphaAt(r.rgba, 20, 10, 5)).toBe(0);
    // 正对照：闭合之后弦就在了
    const closed: DrawOp = { ...open, close: true };
    expect(alphaAt(renderOps([closed], 20, 20, { ss: 4 }).rgba, 20, 10, 5)).toBeGreaterThan(0);
  });

  it("椭圆描边是以路径为中心的圆环：环上有墨、圆心无墨", () => {
    const ring: DrawOp = { kind: "strokeEllipse", stroke: "#000000", width: 2, cx: 10, cy: 10, rx: 6, ry: 6 };
    const r = renderOps([ring], 20, 20, { ss: 4 });
    expect(alphaAt(r.rgba, 20, 10, 10)).toBe(0);
    expect(alphaAt(r.rgba, 20, 15, 10)).toBeGreaterThan(0);
    expect(alphaAt(r.rgba, 20, 10, 3)).toBeGreaterThan(0);
    expect(alphaAt(r.rgba, 20, 10, 1)).toBe(0);
  });

  it("圆角矩形：中心实、角上虚；描边是外扩的环", () => {
    const fill: DrawOp = { kind: "fillRoundRect", fill: "#000000", x: 4, y: 4, w: 12, h: 12, r: 4 };
    const rf = renderOps([fill], 20, 20, { ss: 4 });
    expect(alphaAt(rf.rgba, 20, 10, 10)).toBe(255);
    expect(alphaAt(rf.rgba, 20, 4, 4)).toBe(0);

    const ring: DrawOp = { kind: "strokeRoundRect", stroke: "#000000", width: 2, x: 6, y: 6, w: 8, h: 8, r: 2 };
    const rr = renderOps([ring], 20, 20, { ss: 4 });
    expect(alphaAt(rr.rgba, 20, 5, 10)).toBeGreaterThan(0); // 外扩 1px：描边以路径为中心
    expect(alphaAt(rr.rgba, 20, 10, 10)).toBe(0);
  });

  it("image 图元：1:1 采样保持源像素、支持 crop、缺图当场报错", () => {
    const rgba = new Uint8Array(16 * 4);
    const put = (x: number, y: number, c: number[]) => rgba.set(c, (y * 4 + x) * 4);
    for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) put(x, y, [255, 0, 0, 255]);
    for (let y = 0; y < 2; y += 1) for (let x = 2; x < 4; x += 1) put(x, y, [0, 255, 0, 255]);
    for (let y = 2; y < 4; y += 1) for (let x = 0; x < 2; x += 1) put(x, y, [0, 0, 255, 255]);
    for (let y = 2; y < 4; y += 1) for (let x = 2; x < 4; x += 1) put(x, y, [255, 255, 0, 255]);
    const src = { width: 4, height: 4, rgba };
    const op: DrawOp = { kind: "image", src: "q", sx: 0, sy: 0, sw: 4, sh: 4, x: 0, y: 0, w: 4, h: 4 };
    const r = renderOps([op], 4, 4, { ss: 1, images: { q: src } });
    expect([...r.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...r.rgba.subarray(12, 16)]).toEqual([0, 255, 0, 255]);
    expect([...r.rgba.subarray(48, 52)]).toEqual([0, 0, 255, 255]);
    expect([...r.rgba.subarray(60, 64)]).toEqual([255, 255, 0, 255]);

    // crop 左上 2×2 再放大到 4×4：四角依然是红
    const crop = renderOps([{ ...op, sx: 0, sy: 0, sw: 2, sh: 2 }], 4, 4, { ss: 1, images: { q: src } });
    expect([...crop.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...crop.rgba.subarray(60, 64)]).toEqual([255, 0, 0, 255]);

    expect(() => renderOps([op], 4, 4, { ss: 1 })).toThrow(/缺少源图：q/);
  });

  it("image 图元也吃 disc 遮罩（圆头像档）", () => {
    const src = { width: 2, height: 2, rgba: new Uint8Array(16).fill(255) };
    const op: DrawOp = { kind: "image", src: "w", sx: 0, sy: 0, sw: 2, sh: 2, x: 0, y: 0, w: 16, h: 16 };
    const r = renderOps([op], 16, 16, { mask: "disc", ss: 1, images: { w: src } });
    expect(r.rgba[3]).toBe(0);
    expect(r.rgba[(8 * 16 + 8) * 4 + 3]).toBe(255);
  });

  it("稳健量：覆盖度与 alpha 加权质心", () => {
    const sq: DrawOp = { kind: "fillPath", fill: "#000000", points: [[0,10],[20,10],[20,20],[0,20]] };
    const r = renderOps([sq], 20, 20);
    expect(alphaCoverage(r)).toBeCloseTo(0.5, 2);
    const c = inkCentroid(r);
    expect(c.x).toBeCloseTo(10, 0);
    expect(c.y).toBeCloseTo(15, 0);
    // 空图回落中心，不是 NaN
    const empty = inkCentroid(renderOps([], 20, 20));
    expect(empty).toEqual({ x: 10, y: 10 });
  });

  it("subtractSpans 处理交叠/相离/包裹三种形态", () => {
    expect(subtractSpans([[0, 10]], [[2, 4]])).toEqual([[0, 2], [4, 10]]);
    expect(subtractSpans([[0, 10]], [[12, 14]])).toEqual([[0, 10]]);
    expect(subtractSpans([[2, 4], [8, 12]], [[0, 20]])).toEqual([]);
  });
});

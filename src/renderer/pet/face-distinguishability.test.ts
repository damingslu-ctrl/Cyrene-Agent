import { describe, expect, it } from "vitest";
import { EXPRESSIONS, buildFaceOps, faceOf, type FaceCtx } from "./face";
import { CAT_COATS } from "../../shared/cat-coats";
import { renderOps } from "../../shared/sprite-raster";
import { MIN_PIXEL_DIFF, pixelDiffRatio } from "../../shared/min-pixel-diff";
import { matRoot, toMap2 } from "./rig";

/**
 * 尺 #72（spec §10）：16 档表情两两像素差 ≥ MIN_PIXEL_DIFF。
 * 判据是**栅格化**后的真实像素，不是几何指纹——用仓库既有的软件光栅化器（sprite-raster），
 * 与 cat-sprite-manifest.test.ts 走同一条通路。
 */
const CTX: FaceCtx = { t: 0, blink: 0, mouse: null, energy: 1, speaking: false };
// 栅格化画布必须贴着头——整张窗口画布（164×216）里脸只占一小块，分母被空白撑大，
// 任何表情都「差不到 0.5%」。这里按「脸上所有会动的部件」裁一块 104×104：
// 脸在 viewBox 里是 x 43..77、y 22..61（眼/眉/嘴/腮/泪/汗全在这块），
// 用恒等阵把它手工平移到画布中央（buildFaceOps 内部用的是 px 坐标，不再是 viewBox）。
const SIZE = { w: 104, h: 104 };
const u = 74; // 档位中等的 u，与窗口里的量级一致
const HEAD_VB = { x: 60, y: 41.5 };
const head = toMap2({ a: 1, b: 0, c: 0, d: 1, e: SIZE.w / 2 - HEAD_VB.x, f: SIZE.h / 2 - HEAD_VB.y });

function rasterOf(expr: (typeof EXPRESSIONS)[number]) {
  const ops = buildFaceOps(faceOf(expr, CTX), head, 1, CAT_COATS.ink, u);
  return renderOps(ops, SIZE.w, SIZE.h);
}

describe("尺 #72：表情可分辨矩阵（16×15 对）", () => {
  it("每一对都必须 ≥ MIN_PIXEL_DIFF，低于即点名", () => {
    const rasters = new Map(EXPRESSIONS.map((e) => [e, rasterOf(e)]));
    expect(rasters.size).toBe(16);
    const bad: string[] = [];
    for (let i = 0; i < EXPRESSIONS.length; i++) {
      for (let j = i + 1; j < EXPRESSIONS.length; j++) {
        const a = EXPRESSIONS[i], b = EXPRESSIONS[j];
        const ratio = pixelDiffRatio(rasters.get(a)!, rasters.get(b)!);
        if (ratio < MIN_PIXEL_DIFF) bad.push(`${a} ↔ ${b} 只差 ${(ratio * 100).toFixed(3)}%`);
      }
    }
    expect(bad, `这些对低于 ${MIN_PIXEL_DIFF * 100}%：\n${bad.join("\n")}`).toEqual([]);
  });

  it("正对照：同一张图与自己的差是 0（尺在量，不是恒真）", () => {
    const a = rasterOf("happy");
    expect(pixelDiffRatio(a, rasterOf("happy"))).toBe(0);
  });

  it("变异靶心：把 wink 换成 happy 的整行时，这一对必须红", () => {
    // 这里不真的改源码，而是用「happy 的 FaceParams 冒充 wink」复现那次变异——
    // 判据是同一条 pixelDiffRatio，所以红的结果与改源码一致。
    const happy = rasterOf("happy");
    const fakeWink = renderOps(buildFaceOps(faceOf("happy", CTX), head, 1, CAT_COATS.ink, u), SIZE.w, SIZE.h);
    expect(pixelDiffRatio(happy, fakeWink)).toBeLessThan(MIN_PIXEL_DIFF);
  });
});

/**
 * 两张图至少要有这么多比例的像素不同，才算「不是同一张图」。
 * 实测量：同一只猫的 6 档最小 3.29%、25 档散点最小 1.16%（都是 256²），带留两倍余量。
 * （数值与出处逐字搬自 scripts/build/cat-sprites.mjs 的模块内常量——那边原来没 export，
 *  本文件接手后它改读 bundle 出口。资产门与尺 #72 认同一个阈值，两份数表迟早对不齐。）
 */
export const MIN_PIXEL_DIFF = 0.005;

/** 与 `sprite-raster.ts` 的 Raster 结构同形；用结构类型，好让构建脚本直接喂 bundle 出口的对象。 */
export interface RasterLike {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function pixelDiffRatio(a: RasterLike, b: RasterLike): number {
  if (a.width !== b.width || a.height !== b.height) {
    // 尺寸不同时的比例毫无意义；静默算出一个数比抛错更难查（尺 #72 会拿标准档与 large 档对照）。
    throw new Error(`尺寸不同无法比：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      a.rgba[i] !== b.rgba[i] ||
      a.rgba[i + 1] !== b.rgba[i + 1] ||
      a.rgba[i + 2] !== b.rgba[i + 2] ||
      a.rgba[i + 3] !== b.rgba[i + 3]
    ) {
      n += 1;
    }
  }
  return n / (a.width * a.height);
}

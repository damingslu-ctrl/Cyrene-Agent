/** 小道具共用的记号形状：四角星、爱心、闪光点。颜色一律由调用方给令牌。 */
import type { DrawOp } from "./ops";

export function starPoints(cx: number, cy: number, r: number, arms = 4, rot = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arms * 2; i += 1) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / arms;
    const rad = i % 2 === 0 ? r : r * 0.38;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return out;
}

export function starOp(cx: number, cy: number, r: number, fill: string, arms = 4, rot = 0): DrawOp {
  return { kind: "fillPath", fill, points: starPoints(cx, cy, r, arms, rot) };
}

/** 爱心：16sin³t / 13cos t−5cos2t−2cos3t−cos4t 的 14 点采样，y 轴翻成屏幕向下。 */
export function heartPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 14; i += 1) {
    const t = (i / 14) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([cx + (x / 17) * r, cy - (y / 17) * r]);
  }
  return out;
}

export function heartOp(cx: number, cy: number, r: number, fill: string): DrawOp {
  return { kind: "fillPath", fill, points: heartPoints(cx, cy, r) };
}

/** 双色爱心：奶油放大一圈垫底，玫瑰压上去（画在猫身外，深桌布也读得出）。 */
export function heartWithHalo(cx: number, cy: number, r: number, fill: string, halo: string): DrawOp[] {
  return [heartOp(cx, cy, r * 1.45, halo), heartOp(cx, cy, r, fill)];
}

export function sparkleOps(cx: number, cy: number, r: number, halo: string, core: string): DrawOp[] {
  return [
    starOp(cx, cy, r * 1.5, halo, 4),
    starOp(cx, cy, r, core, 4),
  ];
}

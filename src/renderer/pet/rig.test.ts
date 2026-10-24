import { describe, expect, it } from "vitest";
import { Xf } from "./xf";
import type { Point2 } from "./ops";
import {
  MAT_ID, map2OfXf, matFromJoint, matJoint, matLocal, matMap, matMul, matOfXf, matRoot,
  matScale, matTranslation, toMap2, type LocalJoint,
} from "./rig";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("Mat 原语", () => {
  it("canvas 口径：x' = a·x + c·y + e，y' = b·x + d·y + f", () => {
    const m = { a: 2, b: 3, c: 5, d: 7, e: 11, f: 13 };
    expect(matMap(m, [1, 1])).toEqual([2 + 5 + 11, 3 + 7 + 13]);
    expect(matMap(MAT_ID, [4, -9])).toEqual([4, -9]);
  });

  it("matScale 的 e/f 为 0，且 scaleX/scaleY 与符号无关（负缩放＝镜像，半径仍为正）", () => {
    const m = matScale(-2, 3);
    expect(matMap(m, [4, 5])).toEqual([-8, 15]);
    const map = toMap2(m);
    expect(map.scaleX()).toBeCloseTo(2, 9);
    expect(map.scaleY()).toBeCloseTo(3, 9);
    expect(map.k()).toBeCloseTo(Math.sqrt(6), 9);
  });

  it("matRoot：脚线 viewBox (60,100) → center，与 Xf 的支点同一条线", () => {
    const m = matRoot({ x: 41, y: 43 }, 37 / 60);
    close(matMap(m, [60, 100])[0], 41);
    close(matMap(m, [60, 100])[1], 43);
    close(matMap(m, [60, 70])[1], 43 - 30 * (37 / 60));
    close(toMap2(m).scaleX(), 37 / 60);
  });
});

describe("关节与挂链", () => {
  const shoulder: LocalJoint = { at: [60, 40], rot: Math.PI / 2, sx: 1, sy: 1 };

  it("matLocal 绕 at 自转：at 是不动点，轴上的另一点被转到正下方", () => {
    const m = matLocal(shoulder);
    close(matMap(m, [60, 40])[0], 60);
    close(matMap(m, [60, 40])[1], 40);
    const tip = matMap(m, [60, 50]); // at 下方 10 → 逆时针 90° 后落在 at 左侧 10
    close(tip[0], 50);
    close(tip[1], 40);
  });

  it("matFromJoint 把关节摆到全局位置：pivot 落点必须等于 (gx, gy)", () => {
    const m = matFromJoint({ gx: 72, gy: 55, rot: 0.4, sx: 1.1, sy: 0.9 }, [60, 40]);
    const p = matMap(m, [60, 40]);
    close(p[0], 72);
    close(p[1], 55);
  });

  it("matJoint = 先局部再父级（父在左），链长 2 的落点与手算一致", () => {
    const root = matTranslation(10, 20);
    const arm = matJoint(root, { at: [60, 40], rot: 0, sx: 1, sy: 1 });
    expect(matMap(arm, [60, 40])).toEqual([70, 60]);
    const nested = matJoint(arm, { at: [60, 60], rot: 0, sx: 1, sy: 1 });
    expect(matMap(nested, [60, 60])).toEqual([70, 80]);
  });

  it("★变异靶心：matMul 若忘了父级（把子单独生效），整条手臂就脱钩", () => {
    const parent = matScale(2, 2);
    const child = matTranslation(5, 0);
    // 合成后：先平移再放大 → x = (5)·2 = 10；若父级被忽略则得 5
    expect(matMap(matMul(parent, child), [0, 0])).toEqual([10, 0]);
    expect(matMap(child, [0, 0])).toEqual([5, 0]);
  });

  it("旋转不可交换：这条断言保证测试真的在测顺序", () => {
    const r = matLocal({ at: [0, 0], rot: Math.PI / 2, sx: 1, sy: 1 });
    const t = matTranslation(10, 0);
    expect(matMap(matMul(r, t), [0, 0])).not.toEqual(matMap(matMul(t, r), [0, 0]));
  });
});

describe("与 Xf 的接缝", () => {
  /** 覆盖 Xf 的全部 8 个字段，含 rot/sx/sy/dy 非默认与负缩放。 */
  const XF_CASES = [
    { s: 37 / 60, ox: 41 - 60 * (37 / 60), oy: 43 - 100 * (37 / 60), sx: 1, sy: 1, dy: 0, rot: 0 },
    { s: 0.5, ox: 10, oy: -4, sx: 1.055, sy: 0.925, dy: -3, rot: 0.23 },
    { s: 1.3, ox: 70, oy: 90, sx: -1, sy: 1, dy: 6, rot: -0.9 },
    { s: 0.6166666, ox: 30.5, oy: 65, sx: 0.8, sy: 1.4, dy: 12, rot: 2.4 },
  ];
  const POINTS: Point2[] = [[60, 100], [60, 34], [16, 8], [137, 112], [0, 0], [-5, 200]];

  it("matOfXf 与 Xf.map 逐点相等（1e-9），含 rot≠0 的歪头档", () => {
    for (const c of XF_CASES) {
      const xf = Object.assign(new Xf(), c);
      const m = matOfXf(xf);
      for (const p of POINTS) {
        const a = xf.map(p);
        const b = matMap(m, p);
        close(a[0], b[0]);
        close(a[1], b[1]);
      }
    }
  });

  it("Xf 的三个倍数取法与 Mat 的一致（接缝两侧同口径）", () => {
    for (const c of XF_CASES) {
      const xf = Object.assign(new Xf(), c);
      const m = map2OfXf(xf);
      close(m.scaleX(), xf.s * Math.abs(xf.sx));
      close(m.scaleY(), xf.s * Math.abs(xf.sy));
      close(m.k(), xf.s);
    }
  });

  it("反面对照：toMap2(matOfXf(x)) 的 scaleX **不等于** s·sx（sx≠sy 且 rot≠0 时列长为椭圆弦）", () => {
    // 这条不是「两边一样」的证明，而是「为什么四足必须走 map2OfXf」的实测记录：
    // 若哪天有人把 art.ts 的 xf 换成 toMap2(matOfXf(...))，椭圆的 rx 会偏千分之几。
    const xf = Object.assign(new Xf(), XF_CASES[1]);
    const bad = toMap2(matOfXf(xf)).scaleX();
    expect(Math.abs(bad - xf.s * Math.abs(xf.sx))).toBeGreaterThan(1e-3);
  });

  it("toMap2 的 map 与 matMap 同值，且返回的 Point2 是新数组（不许原地改输入）", () => {
    const p: Point2 = [3, 4];
    const m = toMap2(matScale(2, 3));
    expect(m.map(p)).toEqual([6, 12]);
    expect(p).toEqual([3, 4]);
  });
});

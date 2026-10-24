import type { Point2 } from "./ops";
import type { Xf } from "./xf";

/**
 * 2×3 仿射与骨架原语。
 *
 * 现在整只猫只有**一个** Xf，所有部件共用同一支点和同一组 sx/sy/rot，「歪头」只能歪全身。
 * 猫娘要头、臂、手各转各的，所以变换必须能**挂起来**：matMul(parent, child)。
 * Xf 是一个具体类，做不了这件事；Mat 是它的仿射等价物。
 *
 * 口径与 CanvasRenderingContext2D.transform 一致：x' = a·x + c·y + e，y' = b·x + d·y + f。
 * 行向量左乘（p' = [x y 1]·M），所以挂链是 matMul(parent, child)——子先作用于点、父后作用。
 */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

/** 全局关节：关节在目标空间里的落点 (gx,gy) + 该部件的旋转与两轴缩放。 */
export interface Joint { gx: number; gy: number; rot: number; sx: number; sy: number }

/** 父空间关节：锚点 at 在父空间坐标里，rot/sx/sy 是相对父级的增量。 */
export interface LocalJoint { at: Point2; rot: number; sx: number; sy: number }

/**
 * 绘图助手唯一认的变换面。三个量的语义固定：
 * - scaleX()/scaleY()：沿目标轴的单位长度放大倍数，**恒非负**（喂椭圆半径，负 rx 会抛）；
 * - k()：面积开方意义上的均匀缩放（喂线宽、字号）。
 * Xf 侧是 s·|sx|、s·|sy|、s；Mat 侧是 hypot(a,b)、hypot(c,d)、sqrt(|ad−bc|)。
 */
export interface Map2 {
  map(p: Point2): Point2;
  scaleX(): number;
  scaleY(): number;
  k(): number;
}

export const MAT_ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function matTranslation(dx: number, dy: number): Mat {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function matScale(sx: number, sy: number): Mat {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** 根映射：viewBox 脚线 (60, 100) → center（与 Xf 的支点同一条线，猫娘脚才不会跳）。 */
export function matRoot(center: { x: number; y: number }, s: number): Mat {
  return { a: s, b: 0, c: 0, d: s, e: center.x - 60 * s, f: center.y - 100 * s };
}

export function matMap(m: Mat, p: Point2): Point2 {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** 绕原点转 rot、按 sx/sy 拉，再平移使 pivot 落在 (gx,gy)。 */
export function matFromJoint(j: Joint, pivot: Point2): Mat {
  const cos = Math.cos(j.rot), sin = Math.sin(j.rot);
  const a = j.sx * cos, b = j.sy * sin;
  const c = -j.sx * sin, d = j.sy * cos;
  return { a, b, c, d, e: j.gx - (a * pivot[0] + c * pivot[1]), f: j.gy - (b * pivot[0] + d * pivot[1]) };
}

export function matLocal(j: LocalJoint): Mat {
  return matFromJoint({ gx: j.at[0], gy: j.at[1], rot: j.rot, sx: j.sx, sy: j.sy }, j.at);
}

/** 父在左：对点而言 child 先作用、parent 后作用。 */
export function matMul(p: Mat, c: Mat): Mat {
  return {
    a: p.a * c.a + p.c * c.b,
    b: p.b * c.a + p.d * c.b,
    c: p.a * c.c + p.c * c.d,
    d: p.b * c.c + p.d * c.d,
    e: p.a * c.e + p.c * c.f + p.e,
    f: p.b * c.e + p.d * c.f + p.f,
  };
}

export function matJoint(parent: Mat, j: LocalJoint): Mat {
  return matMul(parent, matLocal(j));
}

export function toMap2(m: Mat): Map2 {
  return {
    map: (p: Point2) => matMap(m, p),
    scaleX: () => Math.hypot(m.a, m.b),
    scaleY: () => Math.hypot(m.c, m.d),
    k: () => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
  };
}

/**
 * Xf 的适配器：**四足路径唯一该用的那个**。
 *
 * 为什么不能拿 `toMap2(matOfXf(xf))` 顶替：Xf 是「先转、再各向异性缩」，矩阵的两列
 * 一般**不正交**，`hypot(a,b)` 求的是 e1 的像长，不等于椭圆的半轴 `s·sx`；rot≠0 且
 * sx≠sy 时两者相差千分之几（rig.test 里有实测差值的对照条）。四足的椭圆半径必须逐像素
 * 等于 `s·sx / s·sy`（art.test 的 golden 就是它的验收），所以猫这条走本函数，字面对齐。
 * Mat 侧走 `toMap2`：骨架的缩放是「旋转之后的各向同性/各向异性拉伸」，列长在那里就是
 * 半轴，两条语义各自成立、不许互相顶替。
 */
export function map2OfXf(xf: Xf): Map2 {
  return {
    map: (p: Point2) => xf.map(p),
    scaleX: () => xf.s * Math.abs(xf.sx),
    scaleY: () => xf.s * Math.abs(xf.sy),
    k: () => xf.s,
  };
}

/**
 * Xf → Mat。Xf.map（xf.ts:18-27）的四步都是仿射：绕 (px,py) 转 → x 绕 px 缩 →
 * y 绕 **100** 缩（写死，不是 py，照抄） + dy → 整体 s + 偏移。这里把常数项显式解出来，
 * 接缝由 rig.test 的逐点等价测试钉住。
 */
export function matOfXf(x: Xf): Mat {
  const cos = Math.cos(x.rot), sin = Math.sin(x.rot);
  const a = x.s * x.sx * cos;
  const c = -x.s * x.sx * sin;
  const b = x.s * x.sy * sin;
  const d = x.s * x.sy * cos;
  const e = x.s * (x.px * (1 - x.sx * cos) + x.sx * sin * x.py) + x.ox;
  const f =
    x.s *
      (100 + x.sy * (-x.px * sin - x.py * cos + x.py) - x.sy * 100 + x.dy) +
    x.oy;
  return { a, b, c, d, e, f };
}

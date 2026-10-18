type MaybePoint = { x: number; y: number } | null;
type MaybeNumber = number | null;

export interface GeomProbeInput {
  t: number;
  applied: { x: number; y: number };
  actual: { x: number; y: number; width: number; height: number };
  /**
   * 以下四列是**猫模型**的量（native `main.rs:4379-4396` 由 `pet`/`e`/`peek_off` 算出）。
   * main 只拿到窗口 bounds，拿不到模型，所以未扩载荷前必须传 null 打 `-`：
   * 宁可让屏幕尺看见"这一列没有证据"，也不许用常量冒充真值。
   * Task 12 给 PET_RESIZE 载荷扩上 e/peekDx/pinInWin 后改传实际值。
   */
  pin: MaybePoint;
  center: MaybePoint;
  peekDx: MaybeNumber;
  e: MaybeNumber;
  dpr: number;
}

/** 与 native `main.rs:4392` 的 GEOM 行同构，字段顺序不许改（屏幕尺按位读）。 */
export function formatGeomProbe(input: GeomProbeInput): string {
  const f1 = (v: MaybeNumber) => (v === null ? "-" : v.toFixed(1));
  const f2 = (v: MaybeNumber) => (v === null ? "-" : v.toFixed(2));
  const pt = (p: MaybePoint) => (p === null ? "-,-" : `${f1(p.x)},${f1(p.y)}`);
  return [
    "GEOM",
    f1(input.t),
    `applied ${Math.round(input.applied.x)},${Math.round(input.applied.y)}`,
    `actual ${Math.round(input.actual.x)},${Math.round(input.actual.y)} ${Math.round(input.actual.width)}x${Math.round(input.actual.height)}`,
    `pin ${pt(input.pin)}`,
    `center ${pt(input.center)}`,
    `peek ${f1(input.peekDx)}`,
    `e ${f2(input.e)}`,
    `dpr ${f2(input.dpr)}`,
  ].join("\t");
}

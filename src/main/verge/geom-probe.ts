type MaybePoint = { x: number; y: number } | null;
type MaybeNumber = number | null;

export interface GeomProbeInput {
  t: number;
  /**
   * 只报**真正发出去**的位置。拖拽期间位置门是刻意关着的（native 那一行打的是它
   * 自己发过的 `applied_pos`，`main.rs:4391`），把没发的请求打进这一列，屏幕尺就会
   * 把「我们主动 no-op」读成「OS 吞了移动」——与 `pin: PIN` 常量冒充同一类错。
   */
  applied: MaybePoint;
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

/**
 * 列名与 native `main.rs:4392` 对齐，但**不是同构**：native 是 10 列
 * （`actual` 打整个 rect 的 Debug、尺寸另起一列 `size WxH`、末列叫 `ppa`），
 * 我们合成 9 列（`actual x,y WxH`、末列改名 `dpr`）。屏幕尺因此**只能按标签读，
 * 不许按位读**——按位读会在 `pin` 之后整段错位。列序改一下就要改尺，勿动。
 */
export function formatGeomProbe(input: GeomProbeInput): string {
  const f1 = (v: MaybeNumber) => (v === null ? "-" : v.toFixed(1));
  const f2 = (v: MaybeNumber) => (v === null ? "-" : v.toFixed(2));
  const pt = (p: MaybePoint) => (p === null ? "-,-" : `${f1(p.x)},${f1(p.y)}`);
  const ip = (p: MaybePoint) => (p === null ? "-,-" : `${Math.round(p.x)},${Math.round(p.y)}`);
  return [
    "GEOM",
    f1(input.t),
    `applied ${ip(input.applied)}`,
    `actual ${Math.round(input.actual.x)},${Math.round(input.actual.y)} ${Math.round(input.actual.width)}x${Math.round(input.actual.height)}`,
    `pin ${pt(input.pin)}`,
    `center ${pt(input.center)}`,
    `peek ${f1(input.peekDx)}`,
    `e ${f2(input.e)}`,
    `dpr ${f2(input.dpr)}`,
  ].join("\t");
}

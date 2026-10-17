export interface GeomProbeInput {
  t: number;
  applied: { x: number; y: number };
  actual: { x: number; y: number; width: number; height: number };
  pin: { x: number; y: number };
  center: { x: number; y: number };
  peekDx: number;
  e: number;
  dpr: number;
}

/** 与 native `main.rs:4392` 的 GEOM 行同构，字段顺序不许改（屏幕尺按位读）。 */
export function formatGeomProbe(input: GeomProbeInput): string {
  const f1 = (v: number) => v.toFixed(1);
  const f2 = (v: number) => v.toFixed(2);
  return [
    "GEOM",
    f1(input.t),
    `applied ${Math.round(input.applied.x)},${Math.round(input.applied.y)}`,
    `actual ${Math.round(input.actual.x)},${Math.round(input.actual.y)} ${Math.round(input.actual.width)}x${Math.round(input.actual.height)}`,
    `pin ${f1(input.pin.x)},${f1(input.pin.y)}`,
    `center ${f1(input.center.x)},${f1(input.center.y)}`,
    `peek ${f1(input.peekDx)}`,
    `e ${f2(input.e)}`,
    `dpr ${f2(input.dpr)}`,
  ].join("\t");
}

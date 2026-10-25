/**
 * 爪印足迹：她走路时每 ~260ms 在脚下留一枚小爪印，3.2 秒淡掉。
 *
 * 记录的是**屏幕坐标**而不是窗口坐标：桌布上的脚印不跟着窗户走。绘制时按
 * 「现在的窗口原点 − 留下时的原点」换算回窗内位置，走远了脚印会自然滑出画面。
 */
import { PAPER, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const PRINT_MS = 3_200;
export const PRINT_GAP_MS = 260;
export const PRINT_MAX = 10;

export interface PawMark {
  screenX: number;
  originX: number;
  localY: number;
  facing: 1 | -1;
  bornAt: number;
}

export function spawnPrint(
  marks: PawMark[],
  now: number,
  localX: number,
  originX: number,
  localY: number,
  facing: 1 | -1,
  zoom = 1,
): void {
  marks.push({ screenX: originX + localX * zoom, originX, localY, facing, bornAt: now });
  // 上限是给「走了很久」兜底的：画面上最多同时 10 枚，旧的先掉。
  while (marks.length > PRINT_MAX) marks.shift();
}

export function stepPrints(marks: PawMark[], now: number): PawMark[] {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    if (now - marks[i].bornAt > PRINT_MS) marks.splice(i, 1);
  }
  return marks;
}

export function buildPrintOps(
  marks: PawMark[],
  now: number,
  currentOriginX: number,
  zoom = 1,
): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const mark of marks) {
    const age = now - mark.bornAt;
    if (age < 0 || age > PRINT_MS) continue;
    const fade = 1 - age / PRINT_MS;
    const x = (mark.screenX - currentOriginX) / zoom;
    const y = mark.localY;
    const r = 1.9;
    const toes: Array<[number, number]> = [
      [-r * 0.75 * mark.facing, -r * 0.95],
      [0, -r * 1.25],
      [r * 0.75 * mark.facing, -r * 0.95],
    ];
    // 双色：奶油描边先落地，玫瑰点压在中间——深色桌布上也是「她走过」而不是一团黑。
    for (const [tx, ty] of toes) {
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85 * fade), cx: x + tx, cy: y + ty, rx: r * 0.62, ry: r * 0.5 });
    }
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85 * fade), cx: x, cy: y, rx: r * 1.35, ry: r * 0.95 });
    for (const [tx, ty] of toes) {
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.78 * fade), cx: x + tx, cy: y + ty, rx: r * 0.34, ry: r * 0.27 });
    }
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.78 * fade), cx: x, cy: y, rx: r * 0.85, ry: r * 0.58 });
  }
  return ops;
}

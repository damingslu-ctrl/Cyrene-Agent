/**
 * 梦话云：她真的睡熟 1.8 秒后，头顶浮出一小朵云，云里有一条在游的鱼。
 * 只是在「她睡着了」上补一层看得见的梦，不参与任何数值；免打扰时不出——
 * 那半小时是陪你不吵，不是她睡下了。
 */
import { ACCENT, PAPER, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const DREAM_DELAY_MS = 1_800;

export function buildDreamOps(
  nowMs: number,
  sleepSince: number,
  face: { cx: number; top: number; w: number; h: number },
  quiet: boolean,
  mood: string,
): DrawOp[] {
  if (quiet || mood !== "sleep" || sleepSince < 0) return [];
  const age = nowMs - sleepSince;
  if (age < DREAM_DELAY_MS) return [];
  const appear = Math.min(1, (age - DREAM_DELAY_MS) / 420);
  const t = age / 1000;
  const x = face.cx - face.w * 0.18 + Math.sin(t * 0.7) * 2.2;
  const y = face.top - face.h * 0.17 + Math.sin(t * 0.9) * 1.4;
  const r = Math.max(3.6, face.w * 0.17);
  const ops: DrawOp[] = [];
  const puff = (dx: number, dy: number, k: number, a: number) => {
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * a), cx: x + dx, cy: y + dy, rx: r * k, ry: r * k * 0.78 });
  };
  // 奶油云先铺三团，玫瑰底边压一道：深桌布上也有轮廓。
  puff(-r * 0.75, r * 0.12, 0.62, appear);
  puff(0, -r * 0.08, 0.9, appear);
  puff(r * 0.8, r * 0.12, 0.58, appear);
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(ROSE_DEEP, 0.55 * appear), width: 0.7, cx: x, cy: y + r * 0.45, rx: r * 1.25, ry: r * 0.28 });
  // 云里的小鱼：身体 + 尾巴 + 眼睛，左右游。
  const swim = Math.sin(t * 1.6) * r * 0.28;
  const fx = x + swim;
  const fy = y - r * 0.1;
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95 * appear), cx: fx, cy: fy, rx: r * 0.46, ry: r * 0.26 });
  const tail: Array<[number, number]> = [
    [fx + r * 0.38, fy], [fx + r * 0.72, fy - r * 0.24], [fx + r * 0.72, fy + r * 0.24],
  ];
  ops.push({ kind: "fillPath", fill: withAlpha(ROSE_DEEP, 0.9 * appear), points: tail });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * appear), cx: fx - r * 0.2, cy: fy - r * 0.03, rx: r * 0.09, ry: r * 0.09 });
  // 两个越来越高的泡泡，表示「梦还在继续」。
  for (let i = 0; i < 2; i += 1) {
    const rise = ((t * 0.4 + i * 0.5) % 1);
    ops.push({
      kind: "strokeEllipse",
      stroke: withAlpha(ACCENT, 0.5 * appear * (1 - rise)),
      width: 0.6,
      cx: x + r * (1.1 + i * 0.25),
      cy: y - r * (0.3 + rise * 1.5),
      rx: r * 0.14,
      ry: r * 0.14,
    });
  }
  return ops;
}

/**
 * 呼噜：被摸顺了之后胸口发出的三圈声纹。只负责画，计时在引擎（purrLeft）。
 * 声纹是画在猫身外的记号：每圈都用奶油粗描 + 玫瑰细描两层，深桌布上才读得出。
 */
import { PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const PURR_MS = 4_000;

export interface PurrFace {
  cx: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

/**
 * `left` 是剩余毫秒（0..PURR_MS）。声纹从胸口往两侧鼓，三圈错开相位；
 * 整个 4 秒里淡入 300ms、淡出 600ms。
 */
export function buildPurrOps(face: PurrFace, left: number, nowMs: number): DrawOp[] {
  if (left <= 0) return [];
  const elapsed = Math.max(0, PURR_MS - left);
  const fade = Math.min(1, elapsed / 300) * Math.min(1, left / 600);
  if (fade <= 0.01) return [];
  const cx = face.cx;
  const cy = face.bottom + face.h * 0.5;
  const baseR = Math.max(4.6, face.w * 0.11);
  const ops: DrawOp[] = [];
  for (let i = 0; i < 3; i += 1) {
    const phase = ((nowMs / 520 + i / 3) % 1);
    const side = i % 2 === 0 ? -1 : 1;
    const r = baseR * (0.8 + phase * 1.5);
    const x = cx + side * (face.w * 0.34 + phase * face.w * 0.3);
    const y = cy + Math.sin(nowMs / 700 + i) * 1.2 - phase * 2;
    // 半圆声纹：朝外张开的弧，用三点折线近似（绘制层只有折线原语）。
    const points: Array<[number, number]> = [];
    for (let k = 0; k <= 4; k += 1) {
      const ang = -0.9 + (k / 4) * 1.8;
      points.push([x + Math.cos(ang) * r * side, y + Math.sin(ang) * r * 0.85]);
    }
    const a = (1 - phase) * fade;
    ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.55 * a), width: 1.8, points });
    ops.push({ kind: "strokePath", stroke: withAlpha(i === 1 ? ROSE_DEEP : ROSE, 0.9 * a), width: 0.8, points });
  }
  // 胸口两颗小星：呼噜是满足的记号，不是噪音。
  const puff = (nowMs / 1100) % 1;
  for (let i = 0; i < 2; i += 1) {
    const x = cx + (i === 0 ? -1 : 1) * face.w * 0.22;
    const y = cy - face.h * 0.18 - puff * 2 + i * 1.2;
    const r = Math.max(1.6, face.w * 0.045) * (1 - puff * 0.4);
    const star: Array<[number, number]> = [];
    for (let k = 0; k < 8; k += 1) {
      const ang = -Math.PI / 2 + (k * Math.PI) / 4;
      star.push([x + Math.cos(ang) * (k % 2 === 0 ? r : r * 0.34), y + Math.sin(ang) * (k % 2 === 0 ? r : r * 0.34)]);
    }
    ops.push({ kind: "fillPath", fill: withAlpha(PAPER, 0.8 * fade * (1 - puff)), points: star.map(([px, py]) => [x + (px - x) * 1.6, y + (py - y) * 1.6]) });
    ops.push({ kind: "fillPath", fill: withAlpha(ROSE, 0.95 * fade * (1 - puff)), points: star });
  }
  return ops;
}

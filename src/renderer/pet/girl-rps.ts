/**
 * 猜拳的手型：石头 / 剪刀 / 布，画在头顶当一枚大牌子，3.6 秒收起。
 * 形状只用椭圆与圆头粗线——82px 窗里手指画成细线会糊成一团。
 */
import { ACCENT, PAPER, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import { RPS_LABELS, type RpsSign } from "../../shared/pet-rps";
import type { DrawOp } from "./ops";

export const RPS_MS = 3_600;

export interface RpsState {
  player: RpsSign;
  her: RpsSign;
  outcome: "win" | "lose" | "draw";
  bornAt: number;
}

export function rpsAlive(state: RpsState, now: number): boolean {
  return now - state.bornAt < RPS_MS;
}

/** 指尖 / 手掌位置（诊断与截图定位用，避免探针猜坐标）。 */
export function rpsAnchor(face: { cx: number; top: number; h: number }): { x: number; y: number } {
  return { x: face.cx, y: face.top - face.h * 0.12 };
}

function capsule(
  ops: DrawOp[],
  x1: number, y1: number, x2: number, y2: number, width: number, color: string, alpha: number,
): void {
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.95 * alpha), width: width + 1.5, points: [[x1, y1], [x2, y2]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(color, 0.96 * alpha), width, points: [[x1, y1], [x2, y2]] });
}

export function buildRpsOps(
  sign: RpsSign,
  ageMs: number,
  face: { cx: number; top: number; w: number; h: number },
  nowSec: number,
): DrawOp[] {
  if (ageMs < 0 || ageMs > RPS_MS) return [];
  const p = ageMs / RPS_MS;
  const alpha = Math.min(1, ageMs / 180) * (p > 0.86 ? 1 - (p - 0.86) / 0.14 : 1);
  const anchor = rpsAnchor(face);
  const r = Math.max(4.4, face.w * 0.24);
  const x = anchor.x;
  const y = anchor.y + Math.sin(nowSec * 3.4) * 1.2;
  const ops: DrawOp[] = [];
  // 手背/手腕：所有手型共用的底座。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.94 * alpha), cx: x, cy: y + r * 0.95, rx: r * 0.62, ry: r * 0.5 });
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95 * alpha), cx: x, cy: y + r * 0.95, rx: r * 0.4, ry: r * 0.3 });
  const palm = (): void => {
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.95 * alpha), cx: x, cy: y, rx: r * 1.02, ry: r * 0.9 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.96 * alpha), cx: x, cy: y, rx: r * 0.78, ry: r * 0.68 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.5 * alpha), cx: x - r * 0.25, cy: y - r * 0.25, rx: r * 0.24, ry: r * 0.18 });
  };
  if (sign === "rock") {
    palm();
    // 三个指节的圆包：石头不是一颗球，是一把收起来的手。
    for (let i = 0; i < 3; i += 1) {
      const fx = x + (i - 1) * r * 0.42;
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: fx, cy: y - r * 0.55, rx: r * 0.3, ry: r * 0.27 });
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95 * alpha), cx: fx, cy: y - r * 0.55, rx: r * 0.19, ry: r * 0.17 });
    }
  } else if (sign === "scissors") {
    palm();
    const v = r * 1.35;
    capsule(ops, x - r * 0.16, y - r * 0.15, x - v * 0.72, y - v * 0.8, r * 0.34, ROSE_DEEP, alpha);
    capsule(ops, x + r * 0.16, y - r * 0.15, x + v * 0.62, y - v * 0.86, r * 0.34, ROSE_DEEP, alpha);
    // 剪刀口：两片刃在指尖交会，留一点奶油缝。
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85 * alpha), cx: x - v * 0.6, cy: y - v * 0.7, rx: r * 0.16, ry: r * 0.16 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.85 * alpha), cx: x + v * 0.52, cy: y - v * 0.76, rx: r * 0.16, ry: r * 0.16 });
  } else {
    palm();
    // 布：四根手指张开，指尖各带一颗奶油头。
    const tips: Array<[number, number]> = [
      [-0.85, -0.85], [-0.3, -1.15], [0.28, -1.12], [0.82, -0.8],
    ];
    for (const [dx, dy] of tips) {
      capsule(ops, x + dx * r * 0.28, y - r * 0.25, x + dx * r * 1.05, y + dy * r * 0.95, r * 0.3, ROSE_DEEP, alpha);
      ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: x + dx * r * 1.05, cy: y + dy * r * 0.95, rx: r * 0.2, ry: r * 0.2 });
    }
    // 拇指
    capsule(ops, x - r * 0.68, y + r * 0.1, x - r * 1.2, y + r * 0.5, r * 0.34, ROSE_DEEP, alpha);
  }
  // 结果记号：赢=蓝星，平=奶油圈，输=玫瑰小点（不是文字，窗里也读得出）。
  const markY = y - r * 1.75;
  if (p < 0.8) {
    ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.9 * alpha), cx: x, cy: markY, rx: r * 0.22, ry: r * 0.22 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9 * alpha), cx: x, cy: markY, rx: r * 0.1, ry: r * 0.1 });
  }
  return ops;
}

/** 玩家出什么：脚边一张小奶油牌，四个字以内（82px 窗装得下）。 */
export function buildRpsPlayerOps(
  player: RpsSign,
  face: { cx: number },
  floorY: number,
): DrawOp[] {
  const w = 26;
  const x = face.cx - w / 2;
  const y = floorY - 13;
  return [
    { kind: "fillRoundRect", fill: withAlpha(PAPER, 0.94), x, y, w, h: 10, r: 4 },
    { kind: "strokeRoundRect", stroke: withAlpha(ROSE_DEEP, 0.8), width: 0.7, x, y, w, h: 10, r: 4 },
    {
      kind: "text", text: `你出${RPS_LABELS[player]}`, x: face.cx, y: y + 5,
      size: 6.4, color: ROSE_DEEP, align: "center", maxWidth: w - 3,
    },
  ];
}

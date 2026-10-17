import type { Rect } from "../../shared/pet-geometry";

export type Point2 = [number, number];

export type DrawOp =
  | { kind: "fillPath"; fill: string; points: Point2[]; layer?: string }
  | { kind: "gradPath"; from: Point2; to: Point2; stops: Array<{ at: number; color: string }>; points: Point2[]; layer?: string }
  | { kind: "strokePath"; stroke: string; width: number; points: Point2[]; close?: boolean; layer?: string }
  | { kind: "fillEllipse"; fill: string; cx: number; cy: number; rx: number; ry: number; rot?: number; layer?: string }
  | { kind: "strokeEllipse"; stroke: string; width: number; cx: number; cy: number; rx: number; ry: number; layer?: string }
  | { kind: "crescent"; fill: string; cx: number; cy: number; r: number; dx: number; dy: number; cut: number; layer?: string }
  | { kind: "text"; text: string; x: number; y: number; size: number; color: string; layer?: string };

/** 只解释指令，不做任何判定——判据全在单测与探针里。 */
export function paintOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case "fillPath":
        ctx.fillStyle = op.fill;
        ctx.fill(toPath2D(op.points));
        break;
      case "gradPath": {
        const grad = ctx.createLinearGradient(op.from[0], op.from[1], op.to[0], op.to[1]);
        for (const stop of op.stops) grad.addColorStop(stop.at, stop.color);
        ctx.fillStyle = grad;
        ctx.fill(toPath2D(op.points));
        break;
      }
      case "strokePath":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke(toPath2D(op.points));
        break;
      case "fillEllipse":
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, op.rot ?? 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "strokeEllipse":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "crescent": {
        // 双色记号：底层实圆 + 上层偏移圆「咬」掉一块（native ui.rs::crescent 同构）。
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(op.cx + op.dx, op.cy + op.dy, op.cut, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "text":
        ctx.fillStyle = op.color;
        ctx.font = `${op.size}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
  }
}

export function toPath2D(points: Point2[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) path.lineTo(points[i][0], points[i][1]);
  path.closePath();
  return path;
}

export function opsBounds(ops: DrawOp[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const op of ops) {
    if ("points" in op) for (const [x, y] of op.points) eat(x, y);
    if (op.kind === "fillEllipse" || op.kind === "strokeEllipse") {
      eat(op.cx - op.rx, op.cy - op.ry);
      eat(op.cx + op.rx, op.cy + op.ry);
    }
    if (op.kind === "crescent") {
      eat(op.cx - op.r, op.cy - op.r);
      eat(op.cx + op.r, op.cy + op.r);
    }
    if (op.kind === "text") {
      eat(op.x, op.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

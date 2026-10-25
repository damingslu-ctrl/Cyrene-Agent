import type { Rect } from "../../shared/pet-geometry";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
export type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";

export function paintOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  ctx.save();
  for (const op of ops) {
    switch (op.kind) {
      case "fillPath":
        ctx.fillStyle = op.fill;
        ctx.fill(toPath2D(op.points, true));
        break;
      case "gradPath": {
        const grad = ctx.createLinearGradient(op.from[0], op.from[1], op.to[0], op.to[1]);
        for (const stop of op.stops) grad.addColorStop(stop.at, stop.color);
        ctx.fillStyle = grad;
        ctx.fill(toPath2D(op.points, true));
        break;
      }
      case "strokePath":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke(toPath2D(op.points, op.close ?? false));
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
      case "fillRoundRect":
        ctx.fillStyle = op.fill;
        ctx.fill(roundRectPath(op));
        break;
      case "strokeRoundRect":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke(roundRectPath(op));
        break;
      case "crescent": {
        // native `ui.rs:414-447` 逐行填「外圆弦裁掉内圆弦」，是**差集** outer ∖ inner，
        // 不是对称差：内圆伸出外圆的那一截（本原语的实际参数 d=0.516r、cut=0.92r，
        // 伸出最多 0.436r）native 一行都不填。所以先按外圆裁一块剪域，再在其中走
        // evenodd 的两圆差集——evenodd 单独用会把那截补回来，剪域把它切掉。
        // 被咬掉的区域**不画**，底下是什么就留什么；这里绝不能用 destination-out——
        // 那是擦除，会在猫身和 drawing buffer 上打洞，让 alpha 命中尺把那块读成穿透。
        ctx.fillStyle = op.fill;
        ctx.save();
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.arc(op.cx + op.dx, op.cy + op.dy, op.cut, 0, Math.PI * 2);
        ctx.fill("evenodd");
        ctx.restore();
        break;
      }
      case "image":
        // 位图猫娘的静帧只在构建期光栅化；运行时猫娘走图集（renderer.paintGirlFrame）。
        throw new RangeError("image 图元只由构建期光栅器渲染（sprite-raster）");
      case "text":
        ctx.fillStyle = op.color;
        ctx.font = `${op.size}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = op.align ?? "left";
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
  }
  ctx.restore();
}

export function roundRectPath(op: { x: number; y: number; w: number; h: number; r: number }): Path2D {
  const path = new Path2D();
  const r = Math.min(op.r, op.w / 2, op.h / 2);
  const { x, y, w } = op;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.arcTo(x + w, y, x + w, y + r, r);
  path.lineTo(x + w, y + op.h - r);
  path.arcTo(x + w, y + op.h, x + w - r, y + op.h, r);
  path.lineTo(x + r, y + op.h);
  path.arcTo(x, y + op.h, x, y + op.h - r, r);
  path.lineTo(x, y + r);
  path.arcTo(x, y, x + r, y, r);
  path.closePath();
  return path;
}

export function toPath2D(points: Point2[], close = true): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) path.lineTo(points[i][0], points[i][1]);
  if (close) path.closePath();
  return path;
}

/**
 * 几何并集包围盒：点列 + 椭圆/圆的中心±半径 + 圆角矩形 + 月牙外圆 + 文字**锚点**。
 * ⚠️ 不是墨迹包围盒——不吃描边宽度（长胡须少半条宽）、不吃字模尺寸、
 * 忽略 `fillEllipse.rot`。别拿它推窗口尺寸，窗尺寸的唯一出处是
 * `shared/pet-geometry` 的 PET_W/PET_H/OPEN_W/OPEN_H。
 */
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
    if (op.kind === "fillRoundRect" || op.kind === "strokeRoundRect" || op.kind === "image") {
      eat(op.x, op.y);
      eat(op.x + op.w, op.y + op.h);
    }
    if (op.kind === "text") {
      eat(op.x, op.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

import type { DrawOp, Point2 } from "./draw-ops";

export interface Raster {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export interface RenderOpts {
  scale?: number;
}

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

function fillPoly(raster: Raster, pts: Point2[], fill: string) {
  if (pts.length < 3) return;
  const [fr, fg, fb, fa] = hexToRgba(fill);
  // bounding box
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  minx = Math.max(0, Math.floor(minx)); maxx = Math.min(raster.width - 1, Math.ceil(maxx));
  miny = Math.max(0, Math.floor(miny)); maxy = Math.min(raster.height - 1, Math.ceil(maxy));
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      // ray casting
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const cond = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (cond) inside = !inside;
      }
      if (inside) {
        const idx = (y * raster.width + x) * 4;
        raster.data[idx] = fr; raster.data[idx + 1] = fg; raster.data[idx + 2] = fb; raster.data[idx + 3] = fa;
      }
    }
  }
}

function fillEllipse(raster: Raster, cx: number, cy: number, rx: number, ry: number, fill: string) {
  const [fr, fg, fb, fa] = hexToRgba(fill);
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const idx = (y * raster.width + x) * 4;
        raster.data[idx] = fr; raster.data[idx + 1] = fg; raster.data[idx + 2] = fb; raster.data[idx + 3] = fa;
      }
    }
  }
}

function fillRoundRect(raster: Raster, x: number, y: number, w: number, h: number, r: number, fill: string) {
  const [fr, fg, fb, fa] = hexToRgba(fill);
  for (let py = 0; py < raster.height; py++) {
    for (let px = 0; px < raster.width; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      let inside = cx >= x && cx <= x + w && cy >= y && cy <= y + h;
      if (inside) {
        // corner rounding
        const corners = [
          [x + r, y + r], [x + w - r, y + r], [x + r, y + h - r], [x + w - r, y + h - r],
        ];
        for (const [ccx, ccy] of corners) {
          const inCornerX = (cx < x + r || cx > x + w - r) && (cy < y + r || cy > y + h - r);
          if (inCornerX) {
            const dx = cx - ccx, dy = cy - ccy;
            if (dx * dx + dy * dy > r * r) inside = false;
          }
        }
      }
      if (inside) {
        const idx = (py * raster.width + px) * 4;
        raster.data[idx] = fr; raster.data[idx + 1] = fg; raster.data[idx + 2] = fb; raster.data[idx + 3] = fa;
      }
    }
  }
}

export function renderOps(ops: DrawOp[], width: number, height: number, _opts?: RenderOpts): Raster {
  const raster: Raster = { width, height, data: new Uint8Array(width * height * 4) };
  for (const op of ops) {
    switch (op.kind) {
      case "fillPath":
        fillPoly(raster, op.points, op.fill);
        break;
      case "gradPath": {
        // approximate gradient as solid first stop
        const color = op.stops.length ? op.stops[0].color : "#000000";
        fillPoly(raster, op.points, color);
        break;
      }
      case "fillEllipse":
        fillEllipse(raster, op.cx, op.cy, op.rx, op.ry, op.fill);
        break;
      case "fillRoundRect":
        fillRoundRect(raster, op.x, op.y, op.w, op.h, op.r, op.fill);
        break;
      default:
        break;
    }
  }
  return raster;
}

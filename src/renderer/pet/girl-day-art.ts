/**
 * v1.19「她的一天」的两组记号：天色记号（左上角）与节日挂饰（头发另一侧）。
 *
 * 双色纪律：两组记号都画在猫身之外——底下的桌布可以是任何颜色。每一件都先铺
 * 奶油光边再压强调色，深色桌布上也能读出来；节日挂饰与 v1.9 的装扮槽并存，
 * 永远挂在装扮的对面（转身时一起换边）。
 */
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { SkyKind } from "./girl-clock";
import type { FestivalOrnament } from "./girl-festival";
import type { GirlFaceBox } from "./girl-sprite";
import type { DrawOp, Point2 } from "./ops";

/** 天色记号钉在窗口左上角；`hit` 是命中圈半径（整枚记号都点得到）。 */
export const SKY_MARK = { x: 10, y: 11, r: 4.2, hit: 7 } as const;

export function skyMarkHit(cssX: number, cssY: number, zoom = 1): boolean {
  const z = zoom > 0 ? zoom : 1;
  const dx = cssX / z - SKY_MARK.x;
  const dy = cssY / z - SKY_MARK.y;
  return dx * dx + dy * dy <= SKY_MARK.hit * SKY_MARK.hit;
}

const halo = (x: number, y: number, r: number, alpha = 0.9): DrawOp =>
  ({ kind: "fillEllipse", fill: withAlpha(PAPER, alpha), cx: x, cy: y, rx: r, ry: r });

const glow = (x: number, y: number, rx: number, ry: number, alpha: number): DrawOp =>
  ({ kind: "fillEllipse", fill: withAlpha(PAPER, alpha), cx: x, cy: y, rx, ry });

function line(points: Point2[], color: string, width: number): DrawOp {
  return { kind: "strokePath", stroke: color, width, points };
}

/** 奶油底 + 强调色叠一笔：桌布上任何底色都留得下一圈亮边。 */
function duoLine(points: Point2[], color: string, width: number): DrawOp[] {
  return [line(points, withAlpha(PAPER, 0.92), width + 1.2), line(points, withAlpha(color === PAPER ? ROSE_DEEP : color, 0.95), width)];
}

function polygon(points: Point2[], fill: string): DrawOp {
  return { kind: "fillPath", fill, points };
}

function scalePts(points: Point2[], cx: number, cy: number, k: number): Point2[] {
  return points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

export function buildSkyMarkOps(kind: SkyKind, nowSec: number): DrawOp[] {
  const { x, y, r } = SKY_MARK;
  const pulse = 0.5 + 0.5 * Math.sin(nowSec * 1.8);
  const ops: DrawOp[] = [halo(x, y, r * 1.45)];

  if (kind === "moon") {
    // 月牙：亮面朝右上，旁边点一颗小星。
    ops.push({ kind: "crescent", fill: withAlpha(ACCENT, 0.96), cx: x, cy: y, r: r * 0.95, dx: r * 0.5, dy: -r * 0.22, cut: r * 0.95 });
    ops.push(glow(x - r * 1.9, y - r * 1.7, 0.85, 0.85, 0.75 + 0.25 * pulse));
    return ops;
  }

  if (kind === "sunrise") {
    // 日出：三束短射线 + 刚离开地平线的日轮。
    for (let i = 0; i < 3; i += 1) {
      const ang = -Math.PI * 0.85 + i * Math.PI * 0.35;
      const inner: Point2 = [x + Math.cos(ang) * r * 1.35, y + Math.sin(ang) * r * 1.35];
      const outer: Point2 = [x + Math.cos(ang) * r * 2.0, y + Math.sin(ang) * r * 2.0];
      ops.push(...duoLine([inner, outer], ROSE_DEEP, 1.1));
    }
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.97), cx: x, cy: y + r * 0.2, rx: r * 0.85, ry: r * 0.85 });
    ops.push(...duoLine([[x - r * 1.6, y + r], [x + r * 1.6, y + r]], ROSE_DEEP, 1));
    return ops;
  }

  // 日落：日轮压得低、脚下一条地平线，左侧留一点没散尽的暖光。
  ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.97), cx: x, cy: y + r * 0.55, rx: r * 0.9, ry: r * 0.9 });
  ops.push(glow(x - r * 1.15, y + r * 1.15, r * 0.55, r * 0.3, 0.55 + 0.25 * pulse));
  ops.push(...duoLine([[x - r * 1.7, y + r * 1.25], [x + r * 1.7, y + r * 1.25]], ACCENT, 1));
  return ops;
}

/** 五角星点列（`k` 倍大小），尖角朝上。 */
function starPts(cx: number, cy: number, r: number, k = 1): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < 10; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = (i % 2 === 0 ? r : r * 0.42) * k;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return pts;
}

/**
 * 节日挂饰：挂在**装扮槽的对面**（装扮槽按 facing 落在脸的一侧，挂饰就落在另一侧）。
 * 五件各有各的图元组合；都不进装扮槽，摘不下来也挡不住她。
 */
export function buildFestivalOrnamentOps(
  ornament: FestivalOrnament,
  face: GirlFaceBox,
  facing: 1 | -1,
  nowSec: number,
): DrawOp[] {
  const r = Math.max(2.8, face.w * 0.15);
  const sway = Math.sin(nowSec * 1.7) * 0.9 + Math.sin(nowSec * 3.1) * 0.3;
  const x = face.cx - facing * face.w * 0.56 + sway;
  const y = face.top + face.h * 0.1;
  const ops: DrawOp[] = [halo(x, y, r * 1.6, 0.86)];

  switch (ornament) {
    case "lantern": {
      const w = r * 1.5;
      const h = r * 1.7;
      ops.push({ kind: "fillRoundRect", fill: withAlpha(ROSE_DEEP, 0.96), x: x - w / 2, y: y - h / 2, w, h, r: w * 0.36 });
      ops.push(...duoLine([[x, y - h * 0.5], [x, y - h * 0.92]], ACCENT, 1));
      ops.push(...duoLine([[x, y + h * 0.5], [x, y + h * 0.95]], ROSE_DEEP, 0.9));
      return ops;
    }
    case "heart": {
      const heart: Point2[] = [
        [x, y + r * 0.95],
        [x - r * 0.95, y + r * 0.05],
        [x - r * 0.7, y - r * 0.8],
        [x, y - r * 0.35],
        [x + r * 0.7, y - r * 0.8],
        [x + r * 0.95, y + r * 0.05],
      ];
      ops.push(polygon(heart, withAlpha(ROSE, 0.97)));
      ops.push(line([[x - r * 0.52, y - r * 0.18], [x - r * 0.2, y - r * 0.5]], withAlpha(PAPER, 0.92), 1));
      return ops;
    }
    case "balloon": {
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.97), cx: x, cy: y - r * 0.2, rx: r * 0.72, ry: r * 0.92 });
      ops.push(polygon([[x, y + r * 0.7], [x - r * 0.22, y + r * 0.95], [x + r * 0.22, y + r * 0.95]], withAlpha(ROSE_DEEP, 0.95)));
      ops.push(...duoLine([[x, y + r * 0.95], [x + sway, y + r * 2.1]], ACCENT, 0.8));
      return ops;
    }
    case "pumpkin": {
      ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.96), cx: x, cy: y + r * 0.15, rx: r, ry: r * 0.82 });
      ops.push(...duoLine([[x, y - r * 0.62], [x + r * 0.16, y - r * 1.05]], ROSE_DEEP, 1));
      ops.push(line([[x, y - r * 0.55], [x, y + r * 0.85]], withAlpha(ACCENT, 0.75), 0.7));
      return ops;
    }
    case "star": {
      const star = starPts(x, y, r);
      ops.push(polygon(scalePts(star, x, y, 1.22), withAlpha(PAPER, 0.9)));
      ops.push(polygon(star, withAlpha(ACCENT, 0.97)));
      return ops;
    }
  }
}

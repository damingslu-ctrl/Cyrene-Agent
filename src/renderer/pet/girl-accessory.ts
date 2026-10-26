import type { AccessoryId } from "../../shared/pet-accessory";
import { ACCENT, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import type { CompanionActivity } from "./companion";
import { girlFaceBox, type GirlAnimBody, type GirlFaceBox } from "./girl-sprite";
import type { DrawOp } from "./ops";

/**
 * 猫娘的五件装扮。锚点全部来自 `GIRL_FACE` 的逐帧脸框：
 * 立绘每一帧的脸/头发位置都不同，按固定比例钉会飘到空气里。
 *
 * 双色纪律：装扮画在猫身上，但猫身与桌布都可能是任何颜色——每一件都先铺奶油光边
 * 再压玫瑰/强调色，深色桌布上也能读出来。
 */
export interface AccessoryInput {
  body: GirlAnimBody;
  frame: number;
  nowSec: number;
  activity: CompanionActivity;
  facing: 1 | -1;
  /** 当前显示姿态图时由 `girlPoseFaceBox` 给出；缺省按帧号取。 */
  face?: GirlFaceBox;
  /** 缺省 = 不戴（渲染器直接拿引擎快照喂进来）。 */
  accessory?: AccessoryId;
}

function haloEllipse(x: number, y: number, rx: number, ry: number, alpha = 0.94, layer: "collar" | "hair_front" = "collar"): DrawOp {
  return { kind: "fillEllipse", fill: withAlpha(PAPER, alpha), cx: x, cy: y, rx, ry, layer };
}

function fillEllipse(x: number, y: number, rx: number, ry: number, fill: string, layer: "collar" | "hair_front"): DrawOp {
  return { kind: "fillEllipse", fill, cx: x, cy: y, rx, ry, layer };
}

function stroke(
  points: Array<[number, number]>, color: string, width: number, layer: "collar" | "hair_front", close = false,
): DrawOp {
  return { kind: "strokePath", stroke: color, width, points, ...(close ? { close: true } : {}), layer };
}

function path(points: Array<[number, number]>, fill: string, layer: "collar" | "hair_front"): DrawOp {
  return { kind: "fillPath", fill, points, layer };
}

function scalePoints(points: Array<[number, number]>, cx: number, cy: number, k: number): Array<[number, number]> {
  return points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** 蝴蝶结：两片翼 + 中心结 + 两条小尾；`r` 是整只结的半径。 */
function bowOps(x: number, y: number, r: number, tilt: number, layer: "hair_front"): DrawOp[] {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const rot = (px: number, py: number): [number, number] => [x + px * c - py * s, y + px * s + py * c];
  const wingR = [rot(-r * 0.42, -r * 0.62), rot(-r * 1.5, -r * 0.05), rot(-r * 0.5, r * 0.7)];
  const wingL = [rot(r * 0.42, -r * 0.62), rot(r * 1.5, -r * 0.05), rot(r * 0.5, r * 0.7)];
  const ops: DrawOp[] = [];
  // 第一笔是奶油描边：压在猫身/桌布上都留得下一圈亮边。
  ops.push(stroke(wingR, withAlpha(PAPER, 0.94), Math.max(1.4, r * 0.5), layer, true));
  ops.push(stroke(wingL, withAlpha(PAPER, 0.94), Math.max(1.4, r * 0.5), layer, true));
  ops.push(path(scalePoints(wingR, x, y, 1.28), withAlpha(PAPER, 0.92), layer));
  ops.push(path(scalePoints(wingL, x, y, 1.28), withAlpha(PAPER, 0.92), layer));
  ops.push(haloEllipse(x, y, r * 0.62, r * 0.58, 0.95, layer));
  ops.push(path(wingR, withAlpha(ROSE_DEEP, 0.95), layer));
  ops.push(path(wingL, withAlpha(ROSE_DEEP, 0.95), layer));
  ops.push(fillEllipse(x - r * 0.25, y - r * 0.12, r * 0.42, r * 0.3, withAlpha(ROSE, 0.9), layer));
  ops.push(fillEllipse(x, y, r * 0.32, r * 0.3, withAlpha(ACCENT, 0.95), layer));
  ops.push(fillEllipse(x, y - r * 0.05, r * 0.16, r * 0.14, withAlpha(PAPER, 0.85), layer));
  // 两条飘带
  const tailA: Array<[number, number]> = [rot(-r * 0.2, r * 0.25), rot(-r * 0.55, r * 1.15), rot(-r * 0.05, r * 1.0)];
  const tailB: Array<[number, number]> = [rot(r * 0.2, r * 0.25), rot(r * 0.55, r * 1.15), rot(r * 0.05, r * 1.0)];
  ops.push(path(scalePoints(tailA, x, y, 1.22), withAlpha(PAPER, 0.88), layer));
  ops.push(path(scalePoints(tailB, x, y, 1.22), withAlpha(PAPER, 0.88), layer));
  ops.push(path(tailA, withAlpha(ROSE, 0.95), layer));
  ops.push(path(tailB, withAlpha(ROSE, 0.95), layer));
  return ops;
}

/** 铃铛项圈：颈带 + 一颗铃铛（会随呼吸/走路轻摆）。 */
function bellOps(cx: number, y: number, w: number, sway: number): DrawOp[] {
  const r = Math.max(1.7, w * 0.105);
  const bx = cx + sway;
  const by = y + r * 0.75;
  const band: Array<[number, number]> = [
    [cx - w * 0.34, y - r * 0.35],
    [cx, y + r * 0.15],
    [cx + w * 0.34, y - r * 0.35],
  ];
  const ops: DrawOp[] = [];
  ops.push(stroke(band, withAlpha(PAPER, 0.92), Math.max(2.8, r * 1.7), "collar"));
  ops.push(stroke(band, withAlpha(ROSE_DEEP, 0.92), Math.max(1.3, r * 0.8), "collar"));
  ops.push(haloEllipse(bx, by, r * 1.55, r * 1.55));
  ops.push(fillEllipse(bx, by, r * 1.18, r, withAlpha(ACCENT, 0.98), "collar"));
  ops.push(fillEllipse(bx - r * 0.28, by - r * 0.32, r * 0.36, r * 0.28, withAlpha(PAPER, 0.85), "collar"));
  ops.push(stroke([[bx - r * 0.5, by + r * 0.25], [bx + r * 0.5, by + r * 0.25]], withAlpha(ROSE_DEEP, 0.9), Math.max(0.7, r * 0.22), "collar"));
  ops.push(fillEllipse(bx, by + r * 0.55, r * 0.18, r * 0.18, withAlpha(ROSE_DEEP, 0.85), "collar"));
  return ops;
}

/** 小围巾：一圈厚领 + 一条垂下的尾巴。 */
function scarfOps(cx: number, y: number, w: number, facing: 1 | -1): DrawOp[] {
  const h = Math.max(3.2, w * 0.17);
  const band: Array<[number, number]> = [
    [cx - w * 0.4, y - h * 0.5],
    [cx - w * 0.18, y - h * 0.85],
    [cx + w * 0.24, y - h * 0.55],
    [cx + w * 0.4, y - h * 0.1],
    [cx + w * 0.2, y + h * 0.55],
    [cx - w * 0.22, y + h * 0.4],
  ];
  const tailX = cx + facing * w * 0.3;
  const tail: Array<[number, number]> = [
    [tailX - h * 0.38, y],
    [tailX + h * 0.42, y + h * 0.2],
    [tailX + h * 0.5 * facing, y + h * 2.2],
    [tailX - h * 0.5 * facing, y + h * 2.0],
  ];
  const ops: DrawOp[] = [];
  ops.push(stroke(band, withAlpha(PAPER, 0.94), Math.max(1.8, h * 0.5), "collar", true));
  ops.push(path(scalePoints(band, cx, y, 1.1), withAlpha(PAPER, 0.92), "collar"));
  ops.push(path(scalePoints(tail, cx, y, 1.16), withAlpha(PAPER, 0.9), "collar"));
  ops.push(path(band, withAlpha(ROSE, 0.96), "collar"));
  ops.push(path(tail, withAlpha(ROSE_DEEP, 0.94), "collar"));
  ops.push(stroke([[cx - w * 0.28, y - h * 0.3], [cx + w * 0.05, y - h * 0.42]], withAlpha(PAPER, 0.55), Math.max(0.7, h * 0.22), "collar"));
  const fringe = tailX + facing * h * 0.3;
  for (let i = 0; i < 2; i += 1) {
    const fx = fringe + (i - 0.5) * h * 0.36;
    ops.push(stroke([[fx, y + h * 1.9], [fx + facing * h * 0.14, y + h * 2.55]], withAlpha(PAPER, 0.85), Math.max(0.9, h * 0.2), "collar"));
    ops.push(stroke([[fx, y + h * 1.9], [fx + facing * h * 0.14, y + h * 2.55]], withAlpha(ROSE_DEEP, 0.9), Math.max(0.45, h * 0.1), "collar"));
  }
  return ops;
}

/** 耳边小花：五瓣 + 奶油花心；左右耳按朝向换边。 */
function flowerOps(x: number, y: number, r: number): DrawOp[] {
  const ops: DrawOp[] = [];
  ops.push(haloEllipse(x, y, r * 1.5, r * 1.5, 0.9, "hair_front"));
  const petals = 5;
  for (let i = 0; i < petals; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / petals;
    const px = x + Math.cos(ang) * r * 0.52;
    const py = y + Math.sin(ang) * r * 0.52;
    ops.push(fillEllipse(px, py, r * 0.42, r * 0.34, withAlpha(ROSE, 0.96), "hair_front"));
  }
  for (let i = 0; i < petals; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / petals + 0.3;
    const px = x + Math.cos(ang) * r * 0.3;
    const py = y + Math.sin(ang) * r * 0.3;
    ops.push(fillEllipse(px, py, r * 0.15, r * 0.13, withAlpha(ROSE_DEEP, 0.55), "hair_front"));
  }
  ops.push(fillEllipse(x, y, r * 0.26, r * 0.24, withAlpha(PAPER, 0.95), "hair_front"));
  ops.push(fillEllipse(x, y, r * 0.15, r * 0.14, withAlpha(ACCENT, 0.95), "hair_front"));
  return ops;
}

/** 星星发夹：四角星 + 两颗小星。 */
function starOps(x: number, y: number, r: number, spin: number): DrawOp[] {
  const star = (cx: number, cy: number, rr: number, rot: number): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const ang = rot - Math.PI / 2 + (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? rr : rr * 0.38;
      pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
    }
    return pts;
  };
  const body = star(x, y, r, spin);
  const ops: DrawOp[] = [];
  ops.push(stroke(scalePoints(body, x, y, 1.55), withAlpha(PAPER, 0.94), Math.max(1.2, r * 0.4), "hair_front", true));
  ops.push(path(scalePoints(body, x, y, 1.55), withAlpha(PAPER, 0.92), "hair_front"));
  ops.push(path(body, withAlpha(ACCENT, 0.98), "hair_front"));
  ops.push(path(scalePoints(body, x, y, 0.52), withAlpha(PAPER, 0.8), "hair_front"));
  ops.push(fillEllipse(x + r * 0.95, y - r * 0.9, r * 0.22, r * 0.22, withAlpha(PAPER, 0.85), "hair_front"));
  ops.push(fillEllipse(x + r * 0.95, y - r * 0.9, r * 0.13, r * 0.13, withAlpha(ROSE, 0.95), "hair_front"));
  ops.push(fillEllipse(x - r * 0.95, y + r * 0.7, r * 0.16, r * 0.16, withAlpha(PAPER, 0.8), "hair_front"));
  ops.push(fillEllipse(x - r * 0.95, y + r * 0.7, r * 0.09, r * 0.09, withAlpha(ROSE, 0.9), "hair_front"));
  return ops;
}

export function buildAccessoryOps(input: AccessoryInput): DrawOp[] {
  const id = input.accessory ?? "none";
  if (id === "none") return [];
  const face = input.face ?? girlFaceBox(input.body, input.frame);
  const facing = input.facing;
  const walk = input.activity === "walk";
  const sway = Math.sin(input.nowSec * 2.1) * face.w * 0.035 + (walk ? Math.sin(input.nowSec * 9.5) * face.w * 0.03 : 0);
  switch (id) {
    case "bell":
      return bellOps(face.cx, face.bottom + face.h * 0.02, face.w, sway);
    case "bow": {
      const x = face.cx + facing * face.w * 0.46 + sway * 0.5;
      const y = face.top + face.h * 0.08;
      return bowOps(x, y, Math.max(3.2, face.w * 0.19), facing * 0.22, "hair_front");
    }
    case "scarf":
      return scarfOps(face.cx, face.bottom + face.h * 0.03, face.w, facing);
    case "flower": {
      const x = face.cx + facing * face.w * 0.56 + sway * 0.4;
      const y = face.top + face.h * 0.24;
      return flowerOps(x, y, Math.max(2.2, face.w * 0.13));
    }
    case "star": {
      const x = face.cx + facing * face.w * 0.22 + sway * 0.3;
      const y = face.top + face.h * 0.06;
      return starOps(x, y, Math.max(2.4, face.w * 0.14), Math.sin(input.nowSec * 1.3) * 0.18);
    }
  }
}

import { buildOverlayOps, VB, type CatInput } from "./art";
import { matMul, matRoot, toMap2, type Map2 } from "./rig";
import type { DrawOp } from "./ops";
import { GIRL_SPRITE } from "./girl-sprite-meta";
import { GIRL_ANIM } from "./girl-anim-meta";

/**
 * 猫娘位图立绘的几何与记号钉位。
 *
 * 立绘是 `scripts/assets/build-girl-sprite.cjs` 从用户给的参考图母版上抠出来的
 * （去绿幕 → 裁到墨框 → 以脚心对齐 viewBox x=60、脚线落在 y=100），此后**只换图不换算式**：
 * - 墨高 91vb：命中框高 1.71u≈102.6vb（pet-profile.ts 实测反钉），立绘占 88.7%，
 *   余下 11.3% 是呼吸/歪头/落地的位移余量；再高就会在弹跳时顶到窗沿。
 * - 脚线 = 绘制原点 `center.y`（centerOffset.dy=79s），与四足的 matRoot 支点同一条线。
 * - 横向按脚心（meta.anchorX）对齐 `center.x`，立绘左右不对称（尾巴在右）也不歪。
 */
export const GIRL_INK_VB_HEIGHT = 91;

/**
 * 记号上抬量：四足的 `center` 是身子中心，猫娘的 `center` 是脚底。
 * 上抬 54.5vb 后，Zzz（−52..−82s）、月牙（−51.5s）、爱心（−41..−59s）都落在头顶之上，
 * 与四足「落在头顶上方」的相对位置一致；徽章仍钉 viewBox (103,28)，在头右侧空档。
 */
export const GIRL_OVERLAY_LIFT_VB = 54.5;

export interface GirlSpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 立绘在绘制空间里的墨框：脚心 = (center.x, center.y)。 */
export function girlSpriteRect(center: { x: number; y: number }, s: number): GirlSpriteRect {
  const h = GIRL_INK_VB_HEIGHT * s;
  const w = h * GIRL_SPRITE.aspect;
  return { x: center.x - GIRL_SPRITE.anchorX * w, y: center.y - h, w, h };
}

export interface GirlBody {
  /** 旋转/缩放的支点 = 脚心（吃 jumpY 与走路起伏）。 */
  pivot: { x: number; y: number };
  rot: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  facing: 1 | -1;
}

/**
 * 位图的刚体动作：呼吸、走路起伏、落地压扁、伸懒腰、歪头、睡觉下沉。
 * 不拆骨骼——立绘只有一张，动作全靠绕脚心的整体变换，所以幅度取四足的一半上下，
 * 免得「站着的猫娘」抖成布偶。相位口径与四足相同：绝对时钟，不随帧率走。
 */
export function girlBodyFor(input: CatInput): GirlBody {
  const s = (input.u * 2) / VB;
  const sleep = input.mood === "sleep" ? 1 : 0;
  const p = input.pose;
  const settle = 1 - 0.9 * Math.max(p.paw, p.yawn, p.stretch, Math.min(Math.abs(p.tilt) / 13, 1));
  const breathe = (0.02 + 0.035 * sleep) * Math.sin(input.t * (1.5 - 0.7 * sleep)) * settle;
  const walk = p.walk ?? 0;
  const walkLift = Math.max(0, Math.sin(walk)) * 1.6;
  const squash = Math.max(0, Math.min(1, p.squash ?? 0));

  // 歪头是整身倾（立绘没有独立头部），所以幅度压到七折；睡觉再压一点、并往一侧倒。
  const deg =
    Math.sin(input.t * 0.4) * 2.2 * (1 - sleep) * settle
    + p.tilt * 0.7
    + Math.sin(walk) * 1.2
    + sleep * 3.5;

  const stretch = Math.max(0, Math.min(1, p.stretch));
  const sx = (1 + 0.12 * squash + 0.03 * stretch) * (1 + 0.02 * sleep);
  const sy = (1 + breathe + 0.05 * stretch) * (1 - 0.18 * squash) * (1 - 0.04 * sleep);
  const h = GIRL_INK_VB_HEIGHT * s;

  return {
    pivot: { x: input.center.x, y: input.center.y + input.jumpY - walkLift },
    rot: (deg * Math.PI) / 180,
    sx,
    sy,
    w: h * GIRL_SPRITE.aspect,
    h,
    facing: input.facing ?? 1,
  };
}

/** 记号用的虚拟身子中心：脚底往上抬 54.5vb（见 GIRL_OVERLAY_LIFT_VB）。 */
export function girlOverlayCenter(input: CatInput): { x: number; y: number } {
  const s = (input.u * 2) / VB;
  return { x: input.center.x, y: input.center.y - GIRL_OVERLAY_LIFT_VB * s };
}

export interface GirlAnimBody {
  /** 旋转/缩放的支点 = 脚心（吃 jumpY 与走路起伏）。 */
  pivot: { x: number; y: number };
  rot: number;
  sx: number;
  sy: number;
  facing: 1 | -1;
  /** 图集像素 → 绘制空间像素：站立帧 114.5px ↔ 91vb，与静态立绘同一条尺。 */
  k: number;
}

/**
 * 帧动画的刚体位姿：帧本身已经在动（呼吸/眨眼/摆臂），这里只叠「动作之外」的整身量——
 * 走路起伏、落地压扁、歪头、朝向。**不再叠呼吸**：帧动画里每帧的胸腔位置就是呼吸。
 */
export function girlAnimBodyFor(input: CatInput): GirlAnimBody {
  const s = (input.u * 2) / VB;
  const p = input.pose;
  const walk = p.walk ?? 0;
  const walkLift = Math.max(0, Math.sin(walk)) * 1.2;
  const squash = Math.max(0, Math.min(1, p.squash ?? 0));
  const stretch = Math.max(0, Math.min(1, p.stretch));
  const deg = p.tilt * 0.7 + Math.sin(walk) * 1.0;
  return {
    pivot: { x: input.center.x, y: input.center.y + input.jumpY - walkLift },
    rot: (deg * Math.PI) / 180,
    sx: (1 + 0.12 * squash) * (1 + 0.01 * stretch),
    sy: (1 - 0.16 * squash) * (1 + 0.02 * stretch),
    facing: input.facing ?? 1,
    k: s * (GIRL_ANIM.inkVb / GIRL_ANIM.inkRefPx),
  };
}

/** viewBox x=60 的镜像（朝向 −1 时徽章跟着换边，与四足的 xfn 同口径）。 */
const MIRROR_X60 = { a: -1, b: 0, c: 0, d: 1, e: VB, f: 0 };

export function girlBadgeMap(input: CatInput): Map2 {
  const s = (input.u * 2) / VB;
  const root = matRoot(girlOverlayCenter(input), s);
  return toMap2((input.facing ?? 1) === -1 ? matMul(root, MIRROR_X60) : root);
}

/**
 * 猫娘的屏幕记号（Zzz / 月牙 / 爱心 / 星星 / 徽章）。
 * 复用四足的同一批记号：只把钉位阵换成「脚底系」并整体上抬，记号本身一个数不改。
 */
export function buildGirlOverlayOps(input: CatInput): DrawOp[] {
  const lifted: CatInput = { ...input, center: girlOverlayCenter(input) };
  return buildOverlayOps(lifted, girlBadgeMap(input));
}

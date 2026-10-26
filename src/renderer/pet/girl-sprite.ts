import { buildOverlayOps, VB, type CatInput } from "./art";
import { matMul, matRoot, toMap2, type Map2 } from "./rig";
import type { DrawOp } from "./ops";
import { GIRL_SPRITE } from "./girl-sprite-meta";
import { GIRL_ANIM } from "./girl-anim-meta";
import { GIRL_FACE, GIRL_INK_BOX } from "./girl-face-meta";
import {
  GIRL_PET_POSES,
  GIRL_PET_POSE_CELLS,
  GIRL_PET_POSE_FACE,
  GIRL_PET_POSE_INK,
  type GirlPoseId,
} from "./girl-pet-poses-meta";

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
 * 位图的刚体动作：呼吸、走路起伏、落地压扁、伸懒腰、歪头、睡觉下沉、待机坐/趴。
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
  const sprawl = Math.max(0, Math.min(1, p.sprawl ?? 0));

  // 歪头是整身倾（立绘没有独立头部），所以幅度压到七折；睡觉再压一点、并往一侧倒。
  const deg =
    Math.sin(input.t * 0.4) * 2.2 * (1 - sleep) * settle
    + p.tilt * 0.7
    + Math.sin(walk) * 1.2
    + sleep * 3.5;

  const stretch = Math.max(0, Math.min(1, p.stretch));
  const sx = (1 + 0.12 * squash + 0.03 * stretch) * (1 + 0.02 * sleep) * (1 + 0.26 * sprawl);
  const sy = (1 + breathe + 0.05 * stretch) * (1 - 0.18 * squash) * (1 - 0.04 * sleep) * (1 - 0.42 * sprawl);
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

/** 记号用的虚拟身子中心：脚底往上抬 54.5vb；趴下时按同一条压扁系数跟着降。 */
export function girlOverlayCenter(input: CatInput): { x: number; y: number } {
  const s = (input.u * 2) / VB;
  const sprawl = Math.max(0, Math.min(1, input.pose.sprawl ?? 0));
  return {
    x: input.center.x,
    y: input.center.y - GIRL_OVERLAY_LIFT_VB * s * (1 - 0.42 * sprawl),
  };
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
 * 「存在感」叠在刚体上的三个量（见 girl-presence.ts）：朝光标压、往光标挪、真翻身。
 * 都是屏幕空间量，不乘朝向——镜像后「往右倾」仍然该往右倾。
 * `dizzy` 是连点眩晕的残余 0..1：只加一点点抖，不接管姿态。
 */
export interface GirlPresenceMotion {
  leanDeg?: number;
  shiftX?: number;
  facing?: 1 | -1;
  dizzy?: number;
  /** 惊醒的余量 0..1：短促的高频抖，比眩晕快得多，读起来是「吓一跳」而不是「晕」。 */
  startle?: number;
}

/**
 * 帧动画的刚体位姿：帧本身已经在动（呼吸/眨眼/摆臂），这里只叠「动作之外」的整身量——
 * 走路起伏、落地压扁、歪头、朝向。**不再叠呼吸**：帧动画里每帧的胸腔位置就是呼吸。
 *
 * `sprawl` 是待机编排的趴伏量（坐着 0.42 / 趴下 0.92）：帧图集里没有真正的坐/趴段，
 * 靠绕脚心压扁 + 摊开把「跳累了」演出来。脚线不动，头降下来；脸框/墨框/记号都吃同一套
 * 变换，所以命中区会跟着走，不会出现「看得见的头」和「点得到的头」分家。
 */
export function girlAnimBodyFor(input: CatInput, presence?: GirlPresenceMotion): GirlAnimBody {
  const s = (input.u * 2) / VB;
  const p = input.pose;
  const walk = p.walk ?? 0;
  const walkLift = Math.max(0, Math.sin(walk)) * 1.2;
  const squash = Math.max(0, Math.min(1, p.squash ?? 0));
  const stretch = Math.max(0, Math.min(1, p.stretch));
  const sprawl = Math.max(0, Math.min(1, p.sprawl ?? 0));
  const dizzy = Math.max(0, Math.min(1, presence?.dizzy ?? 0));
  const wobble = dizzy > 0 ? Math.sin(input.t * 9.5) * 1.8 * dizzy : 0;
  const startle = Math.max(0, Math.min(1, presence?.startle ?? 0));
  const jolt = startle > 0 ? Math.sin(input.t * 34) * 2.6 * startle : 0;
  const deg = p.tilt * 0.7 + Math.sin(walk) * 1.0 + (presence?.leanDeg ?? 0) + wobble + jolt;
  return {
    pivot: { x: input.center.x + (presence?.shiftX ?? 0), y: input.center.y + input.jumpY - walkLift },
    rot: (deg * Math.PI) / 180,
    sx: (1 + 0.12 * squash) * (1 + 0.01 * stretch) * (1 + 0.26 * sprawl),
    sy: (1 - 0.16 * squash) * (1 + 0.02 * stretch) * (1 - 0.03 * dizzy) * (1 - 0.42 * sprawl),
    facing: presence?.facing ?? input.facing ?? 1,
    k: s * (GIRL_ANIM.inkVb / GIRL_ANIM.inkRefPx),
  };
}

/**
 * 格子内的归一化坐标 → 绘制空间。朝向、缩放、旋转都按 `paintGirlFrame` 的同一顺序折进去，
 * 所以记号（腮红/「!」/晕圈）与画面里那张脸永远同一个位姿。
 */
export function girlCellPoint(body: GirlAnimBody, fx: number, fy: number): { x: number; y: number } {
  const w = GIRL_ANIM.cellW * body.k;
  const h = GIRL_ANIM.cellH * body.k;
  const lx = (fx - GIRL_ANIM.anchorX) * w * body.sx * body.facing;
  const ly = (fy - GIRL_ANIM.anchorY) * h * body.sy;
  const c = Math.cos(body.rot);
  const s = Math.sin(body.rot);
  return { x: body.pivot.x + lx * c - ly * s, y: body.pivot.y + lx * s + ly * c };
}

/** 某帧的脸框（绘制空间）：记号层的唯一落点来源。 */
export interface GirlFaceBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** 脸框四角（轴对齐包围盒），给「不许贴到格子边」之类的尺用。 */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function girlFaceBox(body: GirlAnimBody, frame: number): GirlFaceBox {
  const i = Math.max(0, Math.min(GIRL_FACE.length - 1, Math.floor(frame)));
  const [cx, cy, w, h] = GIRL_FACE[i];
  const corners = [
    girlCellPoint(body, cx - w / 2, cy - h / 2),
    girlCellPoint(body, cx + w / 2, cy - h / 2),
    girlCellPoint(body, cx - w / 2, cy + h / 2),
    girlCellPoint(body, cx + w / 2, cy + h / 2),
  ];
  const center = girlCellPoint(body, cx, cy);
  const cellW = GIRL_ANIM.cellW * body.k * body.sx;
  const cellH = GIRL_ANIM.cellH * body.k * body.sy;
  return {
    cx: center.x,
    cy: center.y,
    w: w * cellW,
    h: h * cellH,
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}

/** 某帧的墨框（绘制空间）：投影宽度、命中提示都从这只人的实际占位来。 */
export function girlInkBox(body: GirlAnimBody, frame: number): GirlFaceBox {
  const i = Math.max(0, Math.min(GIRL_INK_BOX.length - 1, Math.floor(frame)));
  const [x, y, w, h] = GIRL_INK_BOX[i];
  const cx = x + w / 2;
  const cy = y + h / 2;
  const corners = [
    girlCellPoint(body, x, y),
    girlCellPoint(body, x + w, y),
    girlCellPoint(body, x, y + h),
    girlCellPoint(body, x + w, y + h),
  ];
  const center = girlCellPoint(body, cx, cy);
  const cellW = GIRL_ANIM.cellW * body.k * body.sx;
  const cellH = GIRL_ANIM.cellH * body.k * body.sy;
  return {
    cx: center.x,
    cy: center.y,
    w: w * cellW,
    h: h * cellH,
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}

/** 姿态图的刚体位姿：与帧动画同一套「绕脚心」变换，但 `k` 换算的是姿态图集。 */
export interface GirlPoseBody {
  pivot: { x: number; y: number };
  rot: number;
  sx: number;
  sy: number;
  facing: 1 | -1;
  /** 姿态图集像素 → 绘制空间像素（inkRefPx → inkVb，与静态立绘同尺）。 */
  k: number;
}

/**
 * 真姿态的刚体：呼吸/歪头/落地/眩晕照旧，**唯独没有 sprawl**。
 * v1.13 的坐/趴是把跳舞帧压扁演出来的；姿态图集里坐和蜷是真的画好的，
 * 再压一次只会把她变成一张饼。
 */
export function girlPoseBodyFor(input: CatInput, presence?: GirlPresenceMotion): GirlPoseBody {
  const s = (input.u * 2) / VB;
  const p = input.pose;
  const walk = p.walk ?? 0;
  const walkLift = Math.max(0, Math.sin(walk)) * 1.2;
  const squash = Math.max(0, Math.min(1, p.squash ?? 0));
  const stretch = Math.max(0, Math.min(1, p.stretch));
  const dizzy = Math.max(0, Math.min(1, presence?.dizzy ?? 0));
  const wobble = dizzy > 0 ? Math.sin(input.t * 9.5) * 1.8 * dizzy : 0;
  const startle = Math.max(0, Math.min(1, presence?.startle ?? 0));
  const jolt = startle > 0 ? Math.sin(input.t * 34) * 2.6 * startle : 0;
  // 静态图没有帧内呼吸，整身 1.2% 的起伏 + 半度的慢摆负责「她还活着」。
  const breathe = 0.012 * Math.sin(input.t * 1.5);
  const sway = Math.sin(input.t * 0.55) * 0.8;
  const deg = p.tilt * 0.7 + Math.sin(walk) * 1.0 + (presence?.leanDeg ?? 0) + wobble + jolt + sway;
  return {
    pivot: { x: input.center.x + (presence?.shiftX ?? 0), y: input.center.y + input.jumpY - walkLift },
    rot: (deg * Math.PI) / 180,
    sx: (1 + 0.12 * squash) * (1 + 0.01 * stretch),
    sy: (1 + breathe) * (1 - 0.16 * squash) * (1 + 0.02 * stretch) * (1 - 0.03 * dizzy),
    facing: presence?.facing ?? input.facing ?? 1,
    k: s * (GIRL_PET_POSES.inkVb / GIRL_PET_POSES.inkRefPx),
  };
}

/** 姿态格内的归一化坐标 → 绘制空间（与 `girlCellPoint` 同一条变换链）。 */
export function girlPoseCellPoint(body: GirlPoseBody, fx: number, fy: number): { x: number; y: number } {
  const w = GIRL_PET_POSES.cellW * body.k;
  const h = GIRL_PET_POSES.cellH * body.k;
  const lx = (fx - GIRL_PET_POSES.anchorX) * w * body.sx * body.facing;
  const ly = (fy - GIRL_PET_POSES.anchorY) * h * body.sy;
  const c = Math.cos(body.rot);
  const s = Math.sin(body.rot);
  return { x: body.pivot.x + lx * c - ly * s, y: body.pivot.y + lx * s + ly * c };
}

function poseBoxCorners(
  body: GirlPoseBody, cx: number, cy: number, w: number, h: number,
): GirlFaceBox {
  const unit = (px: number, py: number) => girlPoseCellPoint(
    body, px / GIRL_PET_POSES.cellW, py / GIRL_PET_POSES.cellH,
  );
  const corners = [
    unit(cx - w / 2, cy - h / 2),
    unit(cx + w / 2, cy - h / 2),
    unit(cx - w / 2, cy + h / 2),
    unit(cx + w / 2, cy + h / 2),
  ];
  const center = unit(cx, cy);
  return {
    cx: center.x,
    cy: center.y,
    w: w * body.k * body.sx,
    h: h * body.k * body.sy,
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}

/** 某姿态的脸框（绘制空间）。 */
export function girlPoseFaceBox(body: GirlPoseBody, pose: GirlPoseId): GirlFaceBox {
  const [cx, cy, w, h] = GIRL_PET_POSE_FACE[pose];
  return poseBoxCorners(body, cx, cy, w, h);
}

/** 某姿态的墨框（绘制空间）：投影、命中提示从这一格的实际占位来。 */
export function girlPoseInkBox(body: GirlPoseBody, pose: GirlPoseId): GirlFaceBox {
  const [x0, y0, x1, y1] = GIRL_PET_POSE_INK[pose];
  return poseBoxCorners(body, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0);
}

/**
 * 记号（Zzz/月牙/爱心/徽章）的虚拟身子中心：跟着**当前姿态的脸**走。
 * 站立时脸顶在 −69.5vb、留 15vb → 与旧口径的 −54.5vb 重合；坐下/蜷起时头更低，
 * 记号跟着降，不会飘在原来的头顶高度。
 */
export const GIRL_POSE_FACE_CLEAR_VB = 15;

export function girlPoseOverlayCenter(body: GirlPoseBody, pose: GirlPoseId): { x: number; y: number } {
  const face = girlPoseFaceBox(body, pose);
  const s = body.k * (GIRL_PET_POSES.inkRefPx / GIRL_PET_POSES.inkVb);
  return { x: face.cx, y: face.top + GIRL_POSE_FACE_CLEAR_VB * s };
}

/** 姿态下的屏幕记号：把姿态锚点翻译回 `buildGirlOverlayOps` 的脚底系。 */
export function buildGirlPoseOverlayOps(
  input: CatInput, pose: GirlPoseId, body: GirlPoseBody = girlPoseBodyFor(input),
): DrawOp[] {
  const center = girlPoseOverlayCenter(body, pose);
  const s = (input.u * 2) / VB;
  return buildGirlOverlayOps({
    ...input,
    center: { x: center.x, y: center.y + GIRL_OVERLAY_LIFT_VB * s },
  });
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

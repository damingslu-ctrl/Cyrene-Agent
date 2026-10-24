import type { CatInput } from "./art";
import { INK_COAT } from "../../shared/cat-coats";
import { arc, cubicTo } from "./xf";
import { matRoot, toMap2, type Map2 } from "./rig";
import { buildFaceOps, faceOf, type Expression } from "./face";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
import { ACCENT, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, wash, withAlpha } from "../../shared/pet-tokens";
import type { CatCoat } from "../../shared/cat-coats";

/**
 * 猫娘站姿（v1.5.0 P1 Task 6）。
 *
 * 比例是 spec §4 的硬律：冠 22 → 下巴 61 ＝ 下巴 61 → 脚线 100（二头身），
 * 头心 (60, 41.5)、半径 (17, 19.5)。viewBox 仍是 120、脚支点仍是 (60,100)——
 * 影子、月牙锚点、藏身分步全按这条线算，改它等于作废一批屏幕尺。
 *
 * 静帧纯度（R-D9）：本文件不读任何时钟，全部数值只由 input 与比例常量决定。
 * 动起来是 Task 14 的事（channels 挂到骨架上），这一版先把「站在那里」画对。
 *
 * 色板：每个颜色都来自 `CatCoat` 或板内 token 的 `wash/withAlpha` 派生（R-D11）；
 * 粉一律预混后再压墨（美术戒律②），发束至少两块色阶（戒律①）。
 */
export const GIRL_PROPORTION = {
  crown: 22, chin: 61, headCy: 41.5, headRx: 17, headRy: 19.5,
  eyeY: 44.5, eyeLx: 52, eyeRx: 68, eyeRr: 5.9, eyeRy: 6.6,
  shoulderY: 66, shoulderDx: 13, waistY: 79, hemY: 89, hemHalf: 16,
  kneeY: 93, footY: 100,
} as const;

/** 猫娘的层序（spec §4）。锁按这一条钉；四足那条 ORDER 一个字不动。 */
export const GIRL_LAYERS: readonly PetLayer[] = [
  "ground_shadow", "legs", "tail", "dress", "body", "arms", "hands", "collar", "ears",
  "hair_back", "hair_front", "ahoge", "brows", "eyes", "nose", "mouth", "blush", "tear",
];

export interface GirlPalette {
  hairTop: string;
  hairBot: string;
  hairEdge: string;
  earInner: string;
  skin: string;
  skinShade: string;
  dress: string;
  dressShade: string;
  apron: string;
  collar: string;
  ribbon: string;
  shoe: string;
  eye: string;
  eyeWhite: string;
  cheek: string;
  nose: string;
  outline: string;
}

/** 配色：全部从 `CatCoat` 与板内 token 派生。 */
export function girlPalette(coat: CatCoat): GirlPalette {
  return {
    hairTop: coat.furTop,
    hairBot: coat.furBot,
    hairEdge: coat.furEdge,
    earInner: coat.earInner,
    skin: wash(PAPER, 26, ROSE),
    skinShade: wash(coat.shade, 120, PAPER),
    dress: wash(ACCENT, 150, PAPER),
    dressShade: wash(ACCENT, 210, INK_SOFT),
    apron: wash(PAPER, 252, PAPER),
    collar: wash(ACCENT, 84, INK),
    ribbon: wash(ROSE, 190, PAPER),
    shoe: wash(INK_SOFT, 210, INK),
    eye: coat.eye,
    eyeWhite: PAPER,
    cheek: coat.blush,
    nose: coat.nose,
    outline: withAlpha(coat.light, 0.22),
  };
}

interface Ctx {
  m: Map2;
  p: GirlPalette;
}

const ell = (c: Ctx, layer: PetLayer, fill: string, cx: number, cy: number, rx: number, ry: number): DrawOp => {
  const [x, y] = c.m.map([cx, cy]);
  return { kind: "fillEllipse", fill, cx: x, cy: y, rx: rx * c.m.scaleX(), ry: ry * c.m.scaleY(), layer };
};

const poly = (c: Ctx, layer: PetLayer, fill: string, pts: Point2[]): DrawOp =>
  ({ kind: "fillPath", fill, points: pts.map((p) => c.m.map(p)), layer });

const line = (c: Ctx, layer: PetLayer, stroke: string, width: number, pts: Point2[]): DrawOp =>
  ({ kind: "strokePath", stroke, width: width * c.m.k(), points: pts.map((p) => c.m.map(p)), layer });

const bez = (p0: Point2, p1: Point2, p2: Point2, p3: Point2): Point2[] => cubicTo([p0, p1, p2, p3]);

/** 闭合轮廓：起点 + 若干段三次贝塞尔。 */
function blob(start: Point2, segments: Array<[Point2, Point2, Point2]>): Point2[] {
  const out: Point2[] = [start];
  let cur = start;
  for (const [a, b, e] of segments) {
    out.push(...bez(cur, a, b, e));
    cur = e;
  }
  return out;
}

/**
 * 站姿 ops。`input.blink` 只压眼睛、`input.quiet`/`mood` 等叠加层由调用方（renderer）
 * 用 `buildOverlayOps` 叠在同一个 center 上——本函数只管**长在身上的**那 18 层。
 */
export interface GirlSpriteInput extends CatInput {
  /** 表情档（缺省 neutral）。 */
  expression?: Expression;
  /**
   * 四层合成的采样结果（Task 12/14）。缺省＝全 0（P1 的静态站姿）。
   * 每个通道的语义见 motion.ts 的通道表：弧度 / viewBox px / 无量纲三套单位不许混。
   */
  channels?: Partial<Record<string, number>>;
}

const ch = (input: GirlSpriteInput, key: string, fallback = 0): number => {
  const v = input.channels?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

export function buildGirlOps(input: GirlSpriteInput): DrawOp[] {
  const P = GIRL_PROPORTION;
  const coat = input.coat ?? INK_COAT;
  const p = girlPalette(coat);
  const baseM = matRoot(input.center, (input.u * 2) / 120);
  const lean = ch(input, "lean");
  const hop = ch(input, "hop");
  const squash = ch(input, "squash");
  const headBob = ch(input, "headBob");
  const sb = (input.u * 2) / 120;
  // 根阵：绕脚线 (60,100) 前倾/侧倾 + 纵向位移 + 压扁。头/臂各自再挂子阵。
  const rootM = {
    a: baseM.a * Math.cos(lean), b: baseM.b * Math.cos(lean) + baseM.d * Math.sin(lean),
    c: baseM.c * Math.cos(lean) - baseM.a * Math.sin(lean), d: baseM.d * Math.cos(lean),
    e: baseM.e, f: baseM.f + (hop - headBob * 0.2) * sb * (1 - 0.2 * squash),
  };
  const m = toMap2(rootM);
  const c: Ctx = { m, p };
  const out: DrawOp[] = [];
  // 头阵：绕脖子 (60, chin) 转 headYaw/headPitch + headBob
  const headRot = ch(input, "headPitch") * 0.8;
  const headYaw = ch(input, "headYaw");
  const pivot: Point2 = [P.chin - 2, P.chin - 2];
  const [pcx, pcy] = m.map(pivot);
  const headMat = {
    a: Math.cos(headRot), b: Math.sin(headRot),
    c: -Math.sin(headRot) * Math.cos(headYaw), d: Math.cos(headRot) * Math.cos(headYaw),
    e: pcx - (Math.cos(headRot) * pivot[0] - Math.sin(headRot) * Math.cos(headYaw) * pivot[1]),
    f: pcy - (Math.sin(headRot) * pivot[0] + Math.cos(headRot) * Math.cos(headYaw) * pivot[1]) + headBob,
  };
  const hm = toMap2(headMat);

  // —— 投影：与四足同一条「脚线压扁、跳起收影」口径 ——
  {
    const lift = Math.max(0, Math.min(1, -input.jumpY / 26));
    out.push(ell(c, "ground_shadow", withAlpha(INK, 0.2 * (1 - 0.55 * lift)), 60, P.footY + 6,
      15 * (1 - 0.25 * lift), 3.4 * (1 - 0.3 * lift)));
  }

  // —— 腿与鞋 ——
  for (const dx of [-6.5, 6.5] as const) {
    const hip: Point2 = [60 + dx, P.hemY - 3];
    const ankle: Point2 = [60 + dx * 1.1, P.footY - 3];
    out.push(line(c, "legs", p.skinShade, 5.0, [hip, ankle]));
    out.push(ell(c, "legs", p.shoe, 60 + dx * 1.15, P.footY - 1.2, 3.6, 2.0));
  }

  // —— 尾巴：从裙后探出、向朝背一侧翘（spec：尾巴把重心拽向那一侧） ——
  {
    const spine: Point2[] = [[60, P.hemY]];
    const tailSway = ch(input, "tail");
    spine.push(...bez([60, P.hemY], [72 + tailSway * 8, P.hemY + 4], [82 + tailSway * 10, P.hemY - 2], [84 + tailSway * 8, P.hemY - 11]));
    spine.push(...bez([84, P.hemY - 11], [85.5, P.hemY - 18], [81, P.hemY - 22], [76, P.hemY - 21]));
    out.push(line(c, "tail", p.hairTop, 5.6, spine));
    out.push(line(c, "tail", p.hairBot, 2.4, spine.slice(-7)));
  }

  // —— 裙子：腰到裙摆，两侧褶线各一条（线宽 ≥1，Task 6 的描边判据） ——
  {
    const dress = blob([60 - 8, P.waistY], [
      [[60 - 5, P.hemY - 3], [60 - 12, P.hemY], [60 - P.hemHalf, P.hemY]],
      [[60 - 6, P.hemY + 2.4], [60 + 6, P.hemY + 2.4], [60 + P.hemHalf, P.hemY]],
      [[60 + 12, P.hemY], [60 + 5, P.hemY - 3], [60 + 8, P.waistY]],
      [[60 + 4, P.waistY - 1], [60 - 4, P.waistY - 1], [60 - 8, P.waistY]],
    ]);
    out.push(poly(c, "dress", p.dress, dress));

    // 围裙：比裙窄一圈、更亮一档，撑结构（COAT_READS_BY 的浅色裙面读法）
    const apron = blob([60 - 5.5, P.waistY + 2], [
      [[60 - 3, P.hemY - 3], [60 - 8, P.hemY - 1], [60 - 9.5, P.hemY - 0.5]],
      [[60 - 4, P.hemY + 1.6], [60 + 4, P.hemY + 1.6], [60 + 9.5, P.hemY - 0.5]],
      [[60 + 8, P.hemY - 1], [60 + 3, P.hemY - 3], [60 + 5.5, P.waistY + 2]],
      [[60 + 3, P.waistY + 1], [60 - 3, P.waistY + 1], [60 - 5.5, P.waistY + 2]],
    ]);
    out.push(poly(c, "dress", p.apron, apron));

    out.push(line(c, "dress", p.dressShade, 1.1, [[60 - 6.5, P.waistY + 4], [60 - 9, P.hemY - 0.5]]));
    out.push(line(c, "dress", p.dressShade, 1.1, [[60 + 6.5, P.waistY + 4], [60 + 9, P.hemY - 0.5]]));
  }

  // —— 身体（上衣：肩到腰的圆角梯形） ——
  {
    const torso = blob([60, P.shoulderY - 4], [
      [[60 + P.shoulderDx - 1, P.shoulderY - 2], [60 + P.shoulderDx + 1, P.shoulderY + 3], [60 + P.shoulderDx, P.shoulderY + 6]],
      [[60 + 8, P.waistY - 2], [60 + 8, P.waistY], [60 + 8, P.waistY]],
      [[60 - 8, P.waistY], [60 - 8, P.waistY - 2], [60 - P.shoulderDx, P.shoulderY + 6]],
      [[60 - P.shoulderDx - 1, P.shoulderY + 3], [60 - P.shoulderDx + 1, P.shoulderY - 2], [60, P.shoulderY - 4]],
    ]);
    out.push(poly(c, "body", p.dress, torso));
    // 领口以下的暗缝：撑出「上衣与裙是两件」
    out.push(line(c, "body", p.dressShade, 1.0, [[60 - 7, P.waistY - 0.5], [60 + 7, P.waistY - 0.5]]));
  }

  // —— 手臂与手：各绕自己的肩关节转（armL/armR），手跟着前臂走 ——
  for (const side of [-1, 1] as const) {
    const sx = 60 + side * P.shoulderDx;
    const shoulder: Point2 = [sx, P.shoulderY + 3];
    const swing = ch(input, side < 0 ? "armL" : "armR");
    // 绕肩旋转：手腕相对肩的位移转 −swing（负＝向前抬）
    const dx = side * 2.5;
    const dy = P.waistY + 5 - shoulder[1];
    const cos = Math.cos(-swing), sin = Math.sin(-swing);
    const wrist: Point2 = [shoulder[0] + dx * cos - dy * sin, shoulder[1] + dx * sin + dy * cos];
    out.push(line(c, "arms", p.skin, 4.4, [shoulder, wrist]));
    // hand 通道：手再沿前臂方向伸一点（0..1）
    const hx = wrist[0] + (wrist[0] - shoulder[0]) * 0.25 * ch(input, "hand");
    const hy = wrist[1] + (wrist[1] - shoulder[1]) * 0.25 * ch(input, "hand");
    out.push(ell(c, "hands", p.skin, hx, hy, 2.6, 2.4));
  }

  // —— 领口与蝴蝶结 ——
  {
    const collar = blob([60 - 6, P.shoulderY - 2], [
      [[60 - 3, P.shoulderY + 2], [60 + 3, P.shoulderY + 2], [60 + 6, P.shoulderY - 2]],
      [[60 + 3, P.shoulderY - 4], [60 - 3, P.shoulderY - 4], [60 - 6, P.shoulderY - 2]],
    ]);
    out.push(poly(c, "collar", p.collar, collar));
    out.push(poly(c, "collar", p.ribbon, [[60, P.shoulderY], [60 - 5, P.shoulderY - 2.5], [60 - 5, P.shoulderY + 2.5]]));
    out.push(poly(c, "collar", p.ribbon, [[60, P.shoulderY], [60 + 5, P.shoulderY - 2.5], [60 + 5, P.shoulderY + 2.5]]));
    out.push(ell(c, "collar", wash(p.ribbon, 200, INK), 60, P.shoulderY, 1.5, 1.5));
  }

  // —— 猫耳 ——
  for (const side of [-1, 1] as const) {
    const ox = side * 11;
    out.push(poly({ ...c, m: hm }, "ears", p.hairTop, [[60 + ox - 4.5, P.crown + 3], [60 + ox, P.crown - 4.5], [60 + ox + 5, P.crown + 4]]));
    out.push(poly({ ...c, m: hm }, "ears", p.earInner, [[60 + ox - 2.2, P.crown + 2.4], [60 + ox, P.crown - 1.6], [60 + ox + 2.6, P.crown + 2.8]]));
  }

  // —— 头发：后发整块 → 前发（刘海＋两侧发束两块色阶） ——
  {
    const back = blob([60, P.crown - 1], [
      [[60 + P.headRx + 4, P.crown + 4], [60 + P.headRx + 5, P.chin - 4], [60 + P.headRx + 1, P.chin + 6]],
      [[60 + 8, P.chin + 10], [60 - 8, P.chin + 10], [60 - P.headRx - 2, P.chin + 6]],
      [[60 - P.headRx - 5, P.chin - 4], [60 - P.headRx - 4, P.crown + 4], [60, P.crown - 1]],
    ]);
    out.push(poly({ ...c, m: hm }, "hair_back", p.hairTop, back));

    const front = blob([60 - P.headRx + 1, P.crown + 8], [
      [[60 - 9, P.crown + 1], [60 + 9, P.crown + 1], [60 + P.headRx - 1, P.crown + 8]],
      [[60 + 10, P.crown + 12], [60 + 6, P.eyeY - 4], [60 + 2, P.eyeY - 5.5]],
      [[60 - 1, P.eyeY - 8], [60 - 5, P.eyeY - 8], [60 - 8, P.eyeY - 5]],
      [[60 - 11, P.crown + 12], [60 - 13, P.crown + 10], [60 - P.headRx + 1, P.crown + 8]],
    ]);
    out.push(poly({ ...c, m: hm }, "hair_front", p.hairBot, front));

    out.push(poly({ ...c, m: hm }, "hair_front", p.hairTop, [
      [60 - P.headRx - 2, P.crown + 8], [60 - P.headRx - 5.5, P.chin + 4],
      [60 - P.headRx - 7, P.chin + 6], [60 - P.headRx - 4, P.crown + 12],
    ]));
    out.push(poly({ ...c, m: hm }, "hair_front", p.hairTop, [
      [60 + P.headRx + 2, P.crown + 8], [60 + P.headRx + 5.5, P.chin + 4],
      [60 + P.headRx + 7, P.chin + 6], [60 + P.headRx + 4, P.crown + 12],
    ]));
    out.push(line({ ...c, m: hm }, "hair_front", p.hairEdge, 1.2, [[60 - 6, P.crown + 7], [60 - 2, P.crown + 9.5], [60 + 2, P.crown + 8]]));
  }

  // —— 呆毛 ——
  out.push(line({ ...c, m: hm }, "ahoge", p.hairTop, 1.6, arc(60 - 1, P.crown + 1, 60 + 4.5, P.crown - 8, 60 + 7, P.crown - 2)));

  // —— 脸：眉/眼/鼻/嘴/腮红/泪/汗/星全交给 buildFaceOps（单一来源，16 档差分在那边） ——
  out.push(...buildFaceOps(faceOf(input.expression ?? "neutral", {
    t: 0, blink: input.blink, mouse: null, energy: input.energy, speaking: false,
  }), hm, 1, coat, input.u));

  // 泪层常态不画：Task 14 的表情层有值时才会往里推（本函数保持空层不出图元）。

  return out;
}

import type { CatInput } from "./art";
import { INK_COAT } from "../../shared/cat-coats";
import { arc, cubicTo } from "./xf";
import { matLocal, matMul, matRoot, toMap2, type Map2 } from "./rig";
import { buildFaceOps, faceOf, type Expression } from "./face";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
import { ACCENT, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, wash, withAlpha } from "../../shared/pet-tokens";
import type { CatCoat } from "../../shared/cat-coats";

/**
 * 猫娘站姿（2026-10-24 第三版：按 deepseek-pet 的**实测比例**重画）。
 *
 * 前两版被否掉的原因是「比例不是量出来的，是猜的」：头做成一颗小圆、
 * 脸铺满整颗头、身子上半段过长。参考角色的帧
 * （`dsh-pet/assets/preview/daiji-huxi-xiuxian.gif`）逐行量下来是这样（墨迹 73×93 px）：
 *
 *   | 部位 | 参考（行号 / 宽） | 归一到这里（viewBox 单位） |
 *   |---|---|---|
 *   | 发顶（含呆毛） | 0 | crown 20 |
 *   | 头最宽处     | 42 行、67 px 宽 | headCy 44、±29 → 58 宽 |
 *   | 可见皮肤     | 33..56 行、22 px 宽 | 48..68 行、±9.5 → 19 宽 |
 *   | 眼           | 39..45 行、单眼 9 px、间距 7 px | eyeY 57、±7、半宽 3.8 |
 *   | 下巴         | 56 行 | chin 68 |
 *   | 肩           | 62 行 | shoulderY 74 |
 *   | 裙摆最宽     | 82..84 行、53 px | hemY 93、±26 |
 *   | 脚           | 92 行 | footY 100 |
 *
 * 三条由此得出的硬结构（不是审美偏好，是量出来的）：
 *  ① **头占全身 60%**（48/80）——二头身，头是全身最宽处（58 宽 vs 裙摆 52）；
 *  ② **脸只有头宽的 33%**，且沉在头的下三分之一；两侧其余全是头发；
 *  ③ 头发垂到 y≈87（裙摆之上），所以「裙摆露在头发外面」是可见的。
 *
 * 配色仍走 Mochi 的奶油/墨色板 + 品牌蓝，**只借结构不借素材**（对方是 AGPL 视频资产，
 * 一帧都不取）。viewBox 仍是 120、脚支点仍是 (60,100)、静帧不读时钟（R-D9）。
 */
export const GIRL_PROPORTION = {
  /** 发团外廓：参考 22..66 行（44 行）→ y 20..71。 */
  crown: 22, headCy: 46.5, headRx: 29, headRy: 24.5,
  /** 皮肤下沿（下巴）：参考 56 行 → y 58.9。**比头团下沿高 12 单位**，差的正是长发。 */
  chin: 58.9,
  /**
   * 可见皮肤宽 42 px / 头宽 73 px ＝ 57%（参考帧实测，按亮度而不是色相分块——
   * 用「暖肤色」去量会把背光的脸颊算成头发，上一版就是这么把脸做窄成 33% 的）。
   * 42 px → 33.4 单位 → faceRx 16.7。上沿 33 行 → y 32.6，下巴 56 行 → y 58.9。
   */
  faceRx: 16.0, faceTop: 33,
  /** 眼：参考 39..45 行 → y 39.4..46.3（中心 42.9）、单眼 9 px → 半宽 3.9、中心 ±8.4。 */
  eyeY: 44.0, eyeLx: 50.2, eyeRx: 69.8, eyeRr: 5.0, eyeRy: 5.6,
  /** 肩 62 行 → 65.7；腰 70 行 → 74.9；裙摆 84 行 → 90.9、宽 53 px → ±22.9；脚 92 行 → 100。 */
  shoulderY: 65.7, shoulderDx: 8, waistY: 74.9, hemY: 90.9, hemHalf: 23.5,
  kneeY: 96, footY: 100,
} as const;

/**
 * 猫娘的层序（spec §4）。**就是绘制顺序**——paintOps 按数组序画，层标签只作判据。
 * `hair_front` 排在 `brows` 之前：刘海压住脸，但五官后画，因此眉毛/眼睛永不被刘海吃掉
 * （16 档差分靠它们分辨，盖住等于把尺 #72 废掉一半）。
 */
export const GIRL_LAYERS: readonly PetLayer[] = [
  "ground_shadow", "hair_back", "legs", "tail", "dress", "body", "arms", "hands",
  "collar", "ears", "hair_front", "ahoge", "brows", "eyes", "nose", "mouth", "blush", "tear",
];

export interface GirlPalette {
  hairTop: string;
  hairMid: string;
  hairBot: string;
  hairEdge: string;
  hairLight: string;
  earOuter: string;
  earInner: string;
  skin: string;
  skinShade: string;
  dress: string;
  dressShade: string;
  dressLight: string;
  apron: string;
  apronShade: string;
  frill: string;
  collar: string;
  ribbon: string;
  stocking: string;
  shoe: string;
  eye: string;
  eyeIris: string;
  eyeIrisLight: string;
  eyeWhite: string;
  cheek: string;
  nose: string;
  tail: string;
  tailTip: string;
}

/**
 * 四阶明度：裙 47 ＜ 发 ~95 ＜ 脸 ~240 ＜ 围裙 246（sRGB 亮度）。
 *
 * ⚠️ `wash(fg, α, bg)` 的 α 是**前景**权重（0..255）。第一版把皮肤写成
 * `wash(PAPER, 12, ROSE)`——那是 95% 玫瑰，整张脸是粉的；要「奶油里透一点玫瑰」
 * 得让 PAPER 当**前景**：`wash(PAPER, 240, ROSE)`。
 *
 * 头发是唯一不跟花色走的部件：它需要「比裙子亮两档」的中调，而墨猫的出厂色
 * （INK / INK_SOFT，亮度 47/80）没有这个档。所以发色＝板内 `ACCENT` 压深后
 * 再掺入花色的 furBot 取色相——五档花色各有各的发色，亮度都落在 95±20，
 * 与裙子之间永远拉开一档（girl.test 的「四阶明度」按这条钉）。
 */
export function girlPalette(coat: CatCoat): GirlPalette {
  const hairBase = wash(coat.furBot, 80, wash(ACCENT, 140, INK));
  return {
    hairTop: wash(PAPER, 46, hairBase),
    hairMid: hairBase,
    hairBot: wash(INK, 70, hairBase),
    hairEdge: wash(INK, 170, hairBase),
    hairLight: wash(PAPER, 120, hairBase),
    earOuter: coat.furBot,
    earInner: coat.earInner,
    skin: wash(PAPER, 224, ROSE),
    skinShade: wash(PAPER_SHADE, 185, ROSE),
    dress: INK,
    dressShade: wash(INK_SOFT, 90, INK),
    dressLight: wash(INK_SOFT, 170, INK),
    apron: PAPER,
    apronShade: wash(PAPER_SHADE, 220, PAPER),
    frill: PAPER,
    collar: wash(PAPER, 246, PAPER_SHADE),
    ribbon: wash(ROSE, 215, INK_SOFT),
    stocking: wash(INK, 150, INK_SOFT),
    shoe: wash(INK, 240, INK_SOFT),
    eye: coat.eye,
    eyeIris: wash(ACCENT, 130, coat.eye),
    eyeIrisLight: wash(ACCENT, 95, PAPER),
    eyeWhite: PAPER,
    cheek: coat.blush,
    nose: coat.nose,
    tail: wash(INK, 20, hairBase),
    tailTip: wash(PAPER, 110, hairBase),
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

/** 把「起点 + 若干段三次贝塞尔」拼成一条闭合轮廓。 */
function blob(start: Point2, segments: Array<[Point2, Point2, Point2]>): Point2[] {
  const out: Point2[] = [start];
  let cur = start;
  for (const [a, b, e] of segments) {
    out.push(...bez(cur, a, b, e));
    cur = e;
  }
  return out;
}

const ch = (input: GirlSpriteInput, key: string, fallback = 0): number => {
  const v = input.channels?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

export interface GirlSpriteInput extends CatInput {
  expression?: Expression;
  channels?: Partial<Record<string, number>>;
}

/**
 * 站姿。顺序＝GIRL_LAYERS：后发 → 腿/尾 → 裙 → 上身与脸 → 臂 → 领 → 耳 → 刘海/侧发/头饰
 * → 呆毛 → 五官。脸走 buildFaceOps（16 档差分单一来源），这里只负责骨相与服饰。
 */
export function buildGirlOps(input: GirlSpriteInput): DrawOp[] {
  const P = GIRL_PROPORTION;
  const coat = input.coat ?? INK_COAT;
  const p = girlPalette(coat);
  const sb = (input.u * 2) / 120;
  const lean = ch(input, "lean");
  const hop = ch(input, "hop");
  const squash = ch(input, "squash");
  const headBob = ch(input, "headBob");
  const baseM = matRoot(input.center, sb);
  const rootM = {
    a: baseM.a * Math.cos(lean), b: baseM.b * Math.cos(lean) + baseM.d * Math.sin(lean),
    c: baseM.c * Math.cos(lean) - baseM.a * Math.sin(lean), d: baseM.d * Math.cos(lean),
    e: baseM.e, f: baseM.f + (hop - headBob * 0.2) * sb * (1 - 0.2 * squash),
  };
  const m = toMap2(rootM);
  const c: Ctx = { m, p };
  const out: DrawOp[] = [];

  const headRot = ch(input, "headPitch") * 0.8;
  const headYaw = ch(input, "headYaw");
  const pivot: Point2 = [60, P.chin + 2];
  // ⚠️ 头部矩阵必须挂到根矩阵上（matMul），不能自己拼「绕 pivot 旋转」。
  // v1.5.0 发出去的那一版漏了这一步：头部部件的线性部分是纯旋转（缩放恒为 1），
  // 而身子按 s 缩放（standard 档 0.617）——于是头比身子大 1/s ≈ 1.62 倍，
  // 同一份 viewBox 比例在屏幕上根本对不上，读起来就是「头小身更小、整只糊成一团」。
  // 挂上之后头与身子共用同一个 s，GIRL_PROPORTION 里的比例才是真的比例。
  const headMat = matMul(
    rootM,
    matMul(
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: headBob },
      // yaw 是「转头」：横向压窄，纵向不动（压纵向会把脸拉长成马脸）
      matLocal({ at: pivot, rot: headRot, sx: Math.max(0.25, Math.cos(headYaw)), sy: 1 }),
    ),
  );
  const hm = toMap2(headMat);
  const hc: Ctx = { m: hm, p };

  {
    const lift = Math.max(0, Math.min(1, -input.jumpY / 26));
    out.push(ell(c, "ground_shadow", withAlpha(INK, 0.22 * (1 - 0.55 * lift)), 60, P.footY + 4,
      24 * (1 - 0.25 * lift), 3.4 * (1 - 0.3 * lift)));
  }

  // —— 后发：上半是头团（最宽 ±29），下半收成两条宽发尾（±8..±27），到 y=82 ——
  //    参考角色的长发不是直筒：它在肩线收进去、又在裙摆上方散开，
  //    「收」的这道腰是它读起来像头发而不是斗篷的原因。
  {
    const sway = ch(input, "hem") * 1.4;
    const tailY = 82;
    const hair = blob([60, P.crown + 2], [
      [[60 + 18, P.crown + 1], [60 + 27, P.crown + 8], [60 + 29, P.headCy - 3]],
      [[60 + 31, P.headCy + 14], [60 + 29, P.waistY - 6], [60 + 27, tailY - 6 + sway]],
      [[60 + 25, tailY + 1 + sway], [60 + 21, tailY - 3], [60 + 17, tailY + 2 + sway]],
      [[60 + 14, tailY - 2], [60 + 11, tailY - 6], [60 + 8, tailY - 1 + sway]],
      [[60 + 4, tailY + 2 + sway], [60 - 4, tailY + 2 + sway], [60 - 8, tailY - 1 + sway]],
      [[60 - 11, tailY - 6], [60 - 14, tailY - 2], [60 - 17, tailY + 2 + sway]],
      [[60 - 21, tailY - 3], [60 - 25, tailY + 1 + sway], [60 - 27, tailY - 6 + sway]],
      [[60 - 29, P.waistY - 6], [60 - 31, P.headCy + 14], [60 - 29, P.headCy - 3]],
      [[60 - 27, P.crown + 8], [60 - 18, P.crown + 1], [60, P.crown + 2]],
    ]);
    out.push(poly(hc, "hair_back", p.hairMid, hair));

    // 暗端只压两侧内缘（给「一整团」一点厚度；盖满就回到第一版的钟罩）
    for (const side of [-1, 1] as const) {
      out.push(poly(hc, "hair_back", p.hairBot, [
        [60 + side * 20, P.crown + 12],
        [60 + side * 28, P.headCy + 8], [60 + side * 28, P.waistY - 4],
        [60 + side * 25, tailY - 4], [60 + side * 20, tailY - 10],
        [60 + side * 19, P.headCy + 16],
      ] as Point2[]));
    }
    // 外廓描边（像素画靠这一圈撑体积）
    out.push(line(hc, "hair_back", p.hairEdge, 1.3, hair.filter((_, i) => i % 3 === 0).concat([hair[0]])));
  }

  // —— 腿：长袜 + 圆头皮鞋。腿随 legL/legR 前后摆（走路、踏步、踢腿全靠它；
  //     之前完全没接这两条通道，于是 12 条 body clip 里有 5 条在她身上「只上身动」）。 ——
  for (const side of [-1, 1] as const) {
    const dx = side * 4.6;
    const swing = ch(input, side < 0 ? "legL" : "legR");
    const hipY = P.hemY - 4, footY0 = P.footY - 2.6;
    const reach = Math.sin(swing) * 4.5;
    const lift = Math.max(0, (Math.cos(swing) - 0.55)) * 2.6;
    out.push(line(c, "legs", p.stocking, 4.2, [[60 + dx, hipY], [60 + dx + reach, footY0 - lift]]));
    out.push(ell(c, "legs", p.shoe, 60 + dx + reach * 1.12, P.footY - 1.4 - lift * 1.2, 3.4, 2.2));
  }

  // —— 尾：从裙右后侧探出一小截（画长/画高会读成提手） ——
  {
    // 尾巴短、低、从裙摆右后方翘出一小截（画长/画高会读成提手，这是第二版踩过的坑）
    const sway = ch(input, "tail");
    const spine: Point2[] = [[60 + 17, P.hemY - 3]];
    spine.push(...bez([60 + 17, P.hemY - 3], [60 + 24 + sway * 2, P.hemY + 1], [60 + 28 + sway * 2.5, P.hemY - 4], [60 + 26.5 + sway * 2.5, P.hemY - 9]));
    out.push(line(c, "tail", p.tail, 3.4, spine));
    out.push(line(c, "tail", p.tailTip, 1.4, spine.slice(-4)));
  }

  // —— 裙：A 字摆 + 围裙 + 下摆一圈白荷叶边 ——
  {
    const hemL: Point2 = [60 - P.hemHalf, P.hemY];
    const hemR: Point2 = [60 + P.hemHalf, P.hemY];
    const dress = blob([60 - 7, P.waistY - 2], [
      [[60 - 9, P.hemY - 8], [60 - 17, P.hemY - 3], hemL],
      [[60 - 12, P.hemY + 3], [60 + 12, P.hemY + 3], hemR],
      [[60 + 17, P.hemY - 3], [60 + 9, P.hemY - 8], [60 + 7, P.waistY - 2]],
      [[60 + 4, P.waistY - 3], [60 - 4, P.waistY - 3], [60 - 7, P.waistY - 2]],
    ]);
    out.push(poly(c, "dress", p.dress, dress));
    out.push(line(c, "dress", p.dressLight, 1.2, [[60 - 5, P.waistY + 3], [60 - 9, P.hemY - 4]]));
    out.push(line(c, "dress", p.dressLight, 1.2, [[60 + 5, P.waistY + 3], [60 + 9, P.hemY - 4]]));

    // 荷叶边：下摆外一圈圆齿。做成「连着的一条」而不是一排独立圆球——
    // 独立圆球在 64px 下会读成一串珍珠。
    const scallop: Point2[] = [];
    const n = 7;
    for (let i = 0; i <= n * 2; i++) {
      const t = i / (n * 2);
      const x = 60 - P.hemHalf + 1 + (P.hemHalf * 2 - 2) * t;
      scallop.push([x, P.hemY + 3.6 + (i % 2 === 0 ? 0.8 : -0.2)]);
    }
    const backEdge = scallop.map(([x]) => [x, P.hemY + 0.2] as Point2).reverse();
    out.push(poly(c, "dress", p.frill, [...scallop, ...backEdge]));

    // 围裙：**只到裙摆之上**（参考实测 rows 64..76 → y 75.7..86.1，hem 在 90.9）。
    // 一直盖到裙摆就成了一整块白板，裙子读不出来——第二版就是这么错的。
    // 宽度 ±8.4（16.8 / 裙宽 47 ＝ 36%，与参考的 27..36% 同量级）。
    const apronBot = 86.5;
    const apron = blob([60 - 6.6, P.waistY - 1], [
      [[60 - 7.4, apronBot - 4], [60 - 8.4, apronBot - 1], [60 - 8.4, apronBot]],
      [[60 - 4, apronBot + 2.2], [60 + 4, apronBot + 2.2], [60 + 8.4, apronBot]],
      [[60 + 8.4, apronBot - 1], [60 + 7.4, apronBot - 4], [60 + 6.6, P.waistY - 1]],
      [[60 + 3.2, P.waistY - 2.6], [60 - 3.2, P.waistY - 2.6], [60 - 6.6, P.waistY - 1]],
    ]);
    out.push(poly(c, "dress", p.apron, apron));
    out.push(line(c, "dress", p.apronShade, 0.9, [[60 - 5.6, P.waistY + 4], [60 - 7.0, apronBot - 1]]));
    out.push(line(c, "dress", p.apronShade, 0.9, [[60 + 5.6, P.waistY + 4], [60 + 7.0, apronBot - 1]]));
    // 围裙下缘一条暗线：把围裙与裙面分开（不然白块像是浮在裙子上）
    out.push(line(c, "dress", p.apronShade, 1.0, [
      [60 - 8.0, apronBot + 0.4], [60, apronBot + 2.0], [60 + 8.0, apronBot + 0.4],
    ]));
  }

  // —— 上身与脸：躯干先画，脸压在上面（同一层，脸在后） ——
  {
    const torso = blob([60, P.shoulderY - 3], [
      [[60 + P.shoulderDx - 1, P.shoulderY - 1], [60 + P.shoulderDx + 1, P.shoulderY + 2], [60 + P.shoulderDx - 1, P.shoulderY + 5]],
      [[60 + 5.5, P.waistY - 2], [60 + 5.5, P.waistY], [60 + 5.5, P.waistY]],
      [[60 - 5.5, P.waistY], [60 - 5.5, P.waistY - 2], [60 - P.shoulderDx + 1, P.shoulderY + 5]],
      [[60 - P.shoulderDx - 1, P.shoulderY + 2], [60 - P.shoulderDx + 1, P.shoulderY - 1], [60, P.shoulderY - 3]],
    ]);
    out.push(poly(c, "body", p.dress, torso));

    // 脸：上宽下尖的桃形。可见皮肤只有头宽的 33%，其余全被头发吃掉。
    const R = P.faceRx;
    // 桃形脸：上宽下尖。下巴收在 ±2（不是 ±3.2）——收得不够尖会读成「方脸」，
    // 而二次元二头身在 64px 下只剩这一笔能读出「尖下巴」。
    const face = blob([60, P.faceTop], [
      [[60 + R * 0.62, P.faceTop - 0.5], [60 + R, P.eyeY - 7], [60 + R, P.eyeY + 1]],
      [[60 + R, P.chin - 8], [60 + R * 0.5, P.chin - 2.2], [60 + 2.0, P.chin]],
      [[60.7, P.chin + 0.8], [59.3, P.chin + 0.8], [60 - 2.0, P.chin]],
      [[60 - R * 0.5, P.chin - 2.2], [60 - R, P.chin - 8], [60 - R, P.eyeY + 1]],
      [[60 - R, P.eyeY - 7], [60 - R * 0.62, P.faceTop - 0.5], [60, P.faceTop]],
    ]);
    out.push(poly(hc, "body", p.skin, face));
    // 刘海投影：脸的上缘压一条暗带（没有它会读成「脸贴反了」）
    out.push(poly(hc, "body", withAlpha(p.skinShade, 0.55), [
      [60 - R + 0.6, P.faceTop + 1.6], [60, P.faceTop + 3.4], [60 + R - 0.6, P.faceTop + 1.6],
      [60 + R - 1.4, P.faceTop - 0.4], [60, P.faceTop - 0.4], [60 - R + 1.4, P.faceTop - 0.4],
    ] as Point2[]));
  }

  // —— 臂：细、贴身，白手套。参考角色的手几乎被头发挡住，这里只露一小段 ——
  for (const side of [-1, 1] as const) {
    const sx = 60 + side * (P.shoulderDx - 1);
    const shoulder: Point2 = [sx, P.shoulderY + 1];
    const swing = ch(input, side < 0 ? "armL" : "armR");
    const dx = side * 1.6, dy = 9;
    const cos = Math.cos(-swing), sin = Math.sin(-swing);
    const wrist: Point2 = [shoulder[0] + dx * cos - dy * sin, shoulder[1] + dx * sin + dy * cos];
    out.push(line(c, "arms", p.dress, 3.8, [shoulder, wrist]));
    out.push(line(c, "arms", p.dressLight, 1.0, [shoulder, wrist]));
    const hand = ch(input, "hand");
    const hx = wrist[0] + (wrist[0] - shoulder[0]) * 0.3 * hand;
    const hy = wrist[1] + (wrist[1] - shoulder[1]) * 0.3 * hand;
    out.push(ell(c, "hands", p.collar, hx, hy, 2.4, 2.2));
  }

  // —— 领：白 V 领 + 玫瑰蝴蝶结（参考角色胸口最抢眼的一处） ——
  {
    out.push(poly(c, "collar", p.collar, [
      [60 - 5.5, P.shoulderY - 3], [60, P.shoulderY + 2.4], [60 + 5.5, P.shoulderY - 3],
      [60 + 3.6, P.shoulderY - 5], [60, P.shoulderY - 1.6], [60 - 3.6, P.shoulderY - 5],
    ] as Point2[]));
    out.push(poly(c, "collar", p.ribbon, [[60, P.shoulderY - 1], [60 - 4.4, P.shoulderY - 4.4], [60 - 4.4, P.shoulderY + 2.2]]));
    out.push(poly(c, "collar", p.ribbon, [[60, P.shoulderY - 1], [60 + 4.4, P.shoulderY - 4.4], [60 + 4.4, P.shoulderY + 2.2]]));
    out.push(ell(c, "collar", wash(p.ribbon, 190, INK), 60, P.shoulderY - 1, 1.4, 1.4));
  }

  // —— 猫耳：发顶两只小三角（外廓跟花色、内耳一亮）。
  //    参考角色的耳是在帽边露出的一角，所以位置要压住头饰两角。
  for (const side of [-1, 1] as const) {
    const base = 60 + side * 25;
    // earL/earR 是弧度：正=向外压（警觉），负=向内耷（害羞/难过）。
    const droop = ch(input, side < 0 ? "earL" : "earR");
    const dxE = side * Math.sin(droop) * 3.2;
    const dyE = (1 - Math.cos(droop)) * 2.4;
    out.push(poly(hc, "ears", p.earOuter, [
      [base - side * 6, P.crown + 10 + dyE * 0.4], [base + side * 1.5 + dxE, P.crown - 4 + dyE], [base + side * 4, P.crown + 9 + dyE * 0.4],
    ]));
    out.push(poly(hc, "ears", p.earInner, [
      [base - side * 2.6, P.crown + 8 + dyE * 0.4], [base + side * 1.4 + dxE, P.crown + 1 + dyE], [base + side * 3, P.crown + 8 + dyE * 0.4],
    ]));
  }

  // —— 刘海 + 侧发 + 女仆头饰 ——
  {
    // 刘海：从发线（crown+4）垂到眉线之上（eyeY−7），中间分三绺、绺间露出发缝。
    // 16 档差分靠眉毛/眼睛分辨，刘海压过眉线等于把尺 #72 废掉一半；
    // 但刘海又必须真盖住额头——只压住 crown 那 2 单位的话，脸会读成一张整皮。
    // 三绺大波浪（不是一排小尖牙）：参考的刘海只有 3 个尖、每个宽 14 单位。
    // 尖牙太密在 64px 下会读成一排锯齿。
    const bangs = [
      [60 - 25, P.eyeY - 6],
      [60 - 22, P.crown + 5], [60 - 11, P.crown], [60, P.crown - 0.5],
      [60 + 11, P.crown], [60 + 23, P.crown + 5], [60 + 25, P.eyeY - 6],
      [60 + 21, P.eyeY - 14], [60 + 13, P.eyeY - 4.5], [60 + 4, P.eyeY - 13],
      [60 - 4, P.eyeY - 4.5], [60 - 13, P.eyeY - 13], [60 - 21, P.eyeY - 5],
    ] as Point2[];
    out.push(poly(hc, "hair_front", p.hairMid, bangs));
    // 高光带：只留**一条窄弧**。画成一大块浅灰多边形会在 64px 下读成「秃顶」——
    // 参考角色的亮面是贴在发丝上的一道细弧，面积不到头顶的 1/6。
    out.push(line(hc, "hair_front", p.hairLight, 1.8, arc(
      60 - 14, P.crown + 8, 60 - 3, P.crown + 4.4, 60 + 8, P.crown + 6.4,
    )));
  // —— 女仆发箍：一条**压在最外层**的白荷叶边，沿发顶绕到两侧太阳穴 ——
  //     之前试过「白在后发之下」（被完全盖住）与「白在刘海之前」（自交出白斜线），
  //     唯一稳的画法是：一条等宽的**描边弧**压在头发最上层，末端停在太阳穴。
  //     参考角色量出来：白像素在头发外沿之外 2..4 px、厚度约 6 单位。
  {
    // 弧必须**坐在发顶上**（crown 就在发顶），不是浮在它上面：浮起来在 64px 下
    // 会读成两只悬空的耳环（上一版就是这样）。端点落在太阳穴（eyeY−10）。
    // 发箍是**贴着头发的一圈**，不是浮在头顶的拱桥：控制点压到 crown+8..+14，
    // 让它整条弧埋进发团外沿里，只露出中间那一段白边（参考角色就是这样）。
    const archTop = P.crown + 9;
    const sideY = P.crown + 26;
    const head = bez([60 - 27, sideY], [60 - 30, archTop + 4], [60 - 18, archTop], [60, archTop]);
    const tail = bez([60, archTop], [60 + 18, archTop], [60 + 30, archTop + 4], [60 + 27, sideY]);
    const band = [head[0], ...head.slice(1), ...tail];
    out.push(line(hc, "hair_front", p.frill, 7.2, band));
    // 荷叶齿：沿弧外侧一排（朝上/朝外，不朝下——朝下读成王冠）
    for (let i = 0; i <= 12; i++) {
      const pt = band[Math.round((i / 12) * (band.length - 1))];
      const dx = pt[0] - 60, dy = pt[1] - (P.headCy + 4);
      const len = Math.hypot(dx, dy) || 1;
      out.push(ell(hc, "hair_front", p.frill, pt[0] + (dx / len) * 3.8, pt[1] + (dy / len) * 3.8, 3.2, 3.0));
    }
    // 下沿一条细暗线：把白箍与蓝发分开（64px 下靠它读出发箍，不然就是一圈白雾）
    out.push(line(hc, "hair_front", p.apronShade, 1.0, band.map(([x, y]) => [x, y + 3.8] as Point2)));
  }

    // 侧发：贴着脸垂下的两束，压在脸的外缘上（不压瞳孔，只压脸边）
    for (const side of [-1, 1] as const) {
      // 侧发不是「贴在脸边的一条」：它比脸宽、盖住脸两侧各 1/3，从耳前垂到裙摆。
      // 参考角色能读成「大头发小脸」全靠这两束把脸夹窄。
      // 侧发只压住脸的**外缘**（脸 ±16 → 侧发内缘 ±13.5），不是从脸中间切下来。
      // 压太多会把腮削掉，整张脸变窄条——参考角色的侧发是「贴着腮边垂下」，不是「挡在脸前」。
      out.push(poly(hc, "hair_front", p.hairMid, [
        [60 + side * 13.5, P.headCy - 10],
        [60 + side * 18, P.eyeY - 10], [60 + side * 22, P.waistY - 1],
        [60 + side * 21, 80], [60 + side * 15.5, 77],
        [60 + side * 15, P.eyeY + 14], [60 + side * 14, P.chin - 2],
      ] as Point2[]));
    }

    // 女仆头饰：一圈白荷叶边帽子压在发顶（参考角色最抢眼的那块白）。
    // 齿在上缘、横带在下缘——齿朝下会读成王冠。
  }

  // 头饰两侧的小玫瑰结：参考角色帽边两角各一枚，是头部唯一的高饱和点。
  // 画在 hair_front 之后（压在后发上），否则会被后发盖住。
  for (const side of [-1, 1] as const) {
    const bx = 60 + side * 30, by = P.eyeY - 12;
    out.push(poly(hc, "hair_front", p.frill, [[bx, by], [bx + side * 4.6, by - 3.8], [bx + side * 4.6, by + 3.4]] as Point2[]));
    out.push(ell(hc, "hair_front", p.ribbon, bx + side * 1.6, by - 0.2, 1.7, 1.7));
  }

  out.push(line(hc, "ahoge", p.hairMid, 1.8, arc(60 - 1, P.crown + 1, 60 + 5, P.crown - 9, 60 + 10, P.crown + 1)));

  out.push(...buildFaceOps(faceOf(input.expression ?? "neutral", {
    t: 0, blink: input.blink, mouse: null, energy: input.energy, speaking: false,
  }), hm, 1, coat, input.u, { base: p.eyeIris, light: p.eyeIrisLight }));

  return out;
}

import type { CatInput } from "./art";
import { INK_COAT } from "../../shared/cat-coats";
import { arc, cubicTo, ribbon } from "./xf";
import { matLocal, matMul, matRoot, toMap2, type Map2 } from "./rig";
import { buildFaceOps, faceOf, type Expression } from "./face";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
import { ACCENT, EYE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, wash, withAlpha } from "../../shared/pet-tokens";
import type { CatCoat } from "../../shared/cat-coats";

/**
 * 猫娘站姿（2026-10-25 第四版：按用户给的原型图重画——**黑猫连体衣**）。
 *
 * 前三版的问题不是「少画了什么」，是**部件认不出来**：女仆装的围裙/发箍/长裙
 * 盖住了所有能认出这个角色的东西。原型图（`photo/微信图片_20261024215028_17_1.jpg`）
 * 上真正撑住身份的是这九件，少一件就变回「随便一只二头身」：
 *
 *  ① 黑色波波头 + 左侧一绺**白色挑染**（不是整头浅色，是一束）
 *  ② 两只大黑猫耳：粉内耳 + 耳根的**白色绒毛**
 *  ③ 紫粉色大眼睛（虹膜下缘更亮）
 *  ④ 小虎牙（嘴左角一颗，白）
 *  ⑤ 腮红（常态就有，不是只有害羞档）
 *  ⑥ 黑色连体衣 + 胸口到小腹一大块**白肚皮**
 *  ⑦ 粉色领结（黑色衣服上唯一的高饱和点）
 *  ⑧ 白爪手套（粉肉垫）／裸腿 + 白荷叶边短袜 + 粉色蝴蝶结鞋
 *  ⑨ 黑尾巴 + 白尾尖
 *
 * 比例仍是二头身（尺 #72 与 girl.test 都按这条钉），viewBox 仍是 120、
 * 脚支点仍是 (60,100)、静帧不读时钟（R-D9）：
 *
 *   | 部位 | viewBox |
 *   |---|---|
 *   | 发顶 / 耳尖 | 20 / 9 |
 *   | 头团中心 / 半宽 / 半高 | 45.5 / 29.5 / 25 |
 *   | 下巴 | 59.5（＝全长的 49.4%） |
 *   | 眼中心 / 眼距 | 47 / ±10（眼宽 10.8，脸宽 33） |
 *   | 肩 / 腰 / 连体衣下摆 | 68 / 78 / 86.5 |
 *   | 袜口 / 脚 / 鞋底 | 92.2 / 100 / 101 |
 *
 * 配色走 Mochi 的奶油/墨/玫瑰三系，**只借结构不借素材**：原型图只用来读部件与比例，
 * 一个像素的颜色都不抄（配色仍是板内色经 wash/withAlpha 派生，girl.test 的
 * 「全部颜色都能追溯到 token 或猫的色板」按这条钉）。
 */
export const GIRL_PROPORTION = {
  /** 发顶 20（耳尖 9 在它之上）；头团中心 45.5、半宽 29.5、半高 25 → 头团下沿 70.5。 */
  crown: 20, headCy: 45.5, headRx: 29.5, headRy: 25,
  /** 下巴：39.5 / 80 ＝ 49.4%，落在尺 #72 的 44%..54% 里。 */
  chin: 59.5,
  /** 脸宽 33 / 头宽 59 ＝ 56%：二头身里「大头发小脸」全靠这个比值。 */
  faceRx: 16.5, faceTop: 32,
  /** 眼：中心 47、±10、半宽 5.4、半高 6.1。眼外缘 15.4，脸半宽 16.5——不蹭头发。 */
  eyeY: 47.0, eyeLx: 50.0, eyeRx: 70.0, eyeRr: 5.4, eyeRy: 6.1,
  /** 肩 68、腰 78、连体衣下摆 86.5（两侧高、中线低）、袜口 92.2、脚 100。 */
  shoulderY: 68, shoulderDx: 10, waistY: 78, hemY: 86.5, hemHalf: 13.5,
  sockY: 92.2, kneeY: 96.5, footY: 100,
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
  hairMid: string;
  hairBot: string;
  hairEdge: string;
  hairLight: string;
  hairWhite: string;
  earOuter: string;
  earInner: string;
  earTuft: string;
  skin: string;
  skinShade: string;
  cheekSoft: string;
  suit: string;
  suitShade: string;
  suitLight: string;
  belly: string;
  bellyShade: string;
  bow: string;
  bowDark: string;
  mitten: string;
  pad: string;
  sock: string;
  sockShade: string;
  shoe: string;
  shoeShade: string;
  eye: string;
  eyeIris: string;
  eyeIrisLight: string;
  tail: string;
  tailTip: string;
  fang: string;
}

/**
 * 五阶明度（sRGB）：连体衣 44 ＜ 后发 ~92 ＜ 腿/脸 ~235 ＜ 白肚皮/袜/手套 246。
 *
 * ⚠️ `wash(fg, α 0..255, bg)` 的 α 是**前景权重**。第一版把皮肤写成
 * `wash(PAPER, 12, ROSE)`——那是 95% 玫瑰，整张脸是粉的。要「奶油里透一点玫瑰」
 * 得让 PAPER 当**前景**：`wash(PAPER, 240, ROSE)`（本文件这一版就是 240）。
 *
 * 头发**必须比连体衣亮两档**：两者都是黑系，只差一档时 64px 下整只糊成一团墨块
 * （第二版被否掉的主因）。所以发色＝花色 furBot 掺品牌蓝压深、再抬到 ~92 的亮度，
 * 而连体衣压在 44——同一块屏幕上永远能一眼分出「头发」与「衣服」。
 */
export function girlPalette(coat: CatCoat): GirlPalette {
  // 参考图是**近黑**的波波头（不是花色灰蓝）：发色钉在 EYE 上，
  // 连体衣用 INK 亮一档把「头发 / 衣服」分开；花色只决定内耳与瞳色。
  const hairBase = wash(EYE, 238, INK);
  return {
    hairMid: hairBase,
    hairBot: wash(EYE, 250, INK),
    hairEdge: EYE,
    hairLight: wash(PAPER, 105, hairBase),
    hairWhite: wash(PAPER, 246, hairBase),
    earOuter: wash(EYE, 240, INK),
    earInner: wash(ROSE_DEEP, 230, ROSE),
    earTuft: wash(PAPER, 235, hairBase),
    skin: wash(PAPER, 240, ROSE),
    skinShade: wash(PAPER_SHADE, 170, ROSE),
    cheekSoft: wash(ROSE, 85, PAPER),
    suit: wash(INK, 235, EYE),
    suitShade: wash(EYE, 215, INK),
    suitLight: wash(INK_SOFT, 140, INK),
    belly: PAPER,
    bellyShade: wash(PAPER_SHADE, 190, PAPER),
    bow: ROSE,
    bowDark: ROSE_DEEP,
    mitten: PAPER,
    pad: wash(ROSE, 190, PAPER),
    sock: PAPER,
    sockShade: wash(PAPER_SHADE, 200, PAPER),
    shoe: wash(ROSE, 215, PAPER),
    shoeShade: wash(ROSE_DEEP, 180, ROSE),
    eye: coat.eye,
    eyeIris: wash(ROSE, 120, wash(ACCENT, 70, INK)),
    eyeIrisLight: wash(ROSE, 120, PAPER),
    tail: wash(INK, 20, hairBase),
    tailTip: wash(PAPER, 245, hairBase),
    fang: PAPER,
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
 * 站姿。顺序＝GIRL_LAYERS：影子 → 后发 → 腿/尾 → 连体衣 → 脖子与脸 → 臂 → 手套
 * → 领结 → 猫耳 → 刘海/侧发/挑染 → 呆毛 → 五官 → 虎牙。
 * 脸走 buildFaceOps（16 档差分单一来源），这里只负责骨相与服饰。
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
    out.push(ell(c, "ground_shadow", withAlpha(INK, 0.2 * (1 - 0.55 * lift)), 60, P.footY + 4,
      21 * (1 - 0.25 * lift), 3.2 * (1 - 0.3 * lift)));
  }

  // —— 后发：黑色波波头。最宽 ±31.5（在眼线上方），下沿是三绺发尖停在肩上 ——
  //    波波头不是「扣在头上的碗」：它的外廓在中段最宽、往下收进去再散开发尖，
  //    「收」的这道腰是它读起来像头发而不是头盔的原因。
  {
    const sway = ch(input, "hem") * 0.9;
    const hair = blob([60, P.crown - 0.5], [
      [[60 + 17, P.crown - 1], [60 + 26.5, P.crown + 6], [60 + 29.5, P.crown + 16]],
      [[60 + 32, P.headCy + 4], [60 + 31.5, P.headCy + 16], [60 + 29, 62 + sway * 0.4]],
      [[60 + 27, 65.5 + sway * 0.6], [60 + 24, 68.5 + sway * 0.7], [60 + 20, 66.5 + sway * 0.7]],
      [[60 + 16, 64.5], [60 + 12, 69.5 + sway], [60 + 6.5, 68.5 + sway]],
      [[60 + 2.5, 67.8 + sway], [60 - 2.5, 67.8 + sway], [60 - 6.5, 68.5 + sway]],
      [[60 - 12, 69.5 + sway], [60 - 16, 64.5], [60 - 20, 66.5 + sway * 0.7]],
      [[60 - 24, 68.5 + sway * 0.7], [60 - 27, 65.5 + sway * 0.6], [60 - 29, 62 + sway * 0.4]],
      [[60 - 31.5, P.headCy + 16], [60 - 32, P.headCy + 4], [60 - 29.5, P.crown + 16]],
      [[60 - 26.5, P.crown + 6], [60 - 17, P.crown - 1], [60, P.crown - 0.5]],
    ]);
    out.push(poly(hc, "hair_back", p.hairMid, hair));

    // 内缘压一档暗色：给「一整团」一点厚度（盖满就回到第一版的钟罩）
    for (const side of [-1, 1] as const) {
      out.push(poly(hc, "hair_back", p.hairBot, [
        [60 + side * 21, P.crown + 14],
        [60 + side * 29, P.headCy + 6], [60 + side * 30, P.headCy + 18],
        [60 + side * 27, 63], [60 + side * 21.5, 65.5],
        [60 + side * 20, P.headCy + 10],
      ] as Point2[]));
    }
    // 外廓描边（像素画靠这一圈撑体积）
    out.push(line(hc, "hair_back", p.hairEdge, 1.2, hair.filter((_, i) => i % 3 === 0).concat([hair[0]])));
  }

  // —— 腿：裸腿 + 白荷叶边短袜 + 粉蝴蝶结鞋（原型图里最下面那一截） ——
  //    腿随 legL/legR 前后摆（走路、踏步、踢腿全靠它；这两条通道不接，12 条 body clip
  //    里有 5 条在她身上会变成「只上身动」）。
  for (const side of [-1, 1] as const) {
    const dx = side * 6.0;
    const swing = ch(input, side < 0 ? "legL" : "legR");
    const hipY = 83.5;
    const reach = Math.sin(swing) * 4.2;
    const lift = Math.max(0, Math.cos(swing) - 0.55) * 2.4;
    const ankleY = 93.4 - lift;
    const ax = 60 + dx + reach * 0.7;
    // 腿：先一条深一档的底，再压一条亮一档的芯——单线在 64px 下会细得看不见
    out.push(line(c, "legs", p.skinShade, 7.0, [[60 + dx, hipY], [ax, ankleY]]));
    out.push(line(c, "legs", p.skin, 5.6, [[60 + dx, hipY], [ax, ankleY]]));
    // 袜口：一条横带 + 三颗小圆齿（齿朝上，朝下会读成鞋口）
    out.push(ell(c, "legs", p.sock, ax, P.sockY + 0.6, 4.4, 2.4));
    for (const k of [-1, 0, 1] as const) {
      out.push(ell(c, "legs", p.sock, ax + k * 2.5, P.sockY - 1.2, 1.6, 1.4));
    }
    out.push(line(c, "legs", p.sockShade, 0.9, [[ax - 3.4, P.sockY + 1.8], [ax + 3.4, P.sockY + 1.8]]));
    // 鞋：粉色圆头 + 深一档的鞋底 + 踝上两只蝴蝶结耳（鞋宽 11.2 ＜ 脚距 12，中间留得下一条缝）
    out.push(ell(c, "legs", p.shoe, ax, 97.6, 5.6, 3.5));
    out.push(line(c, "legs", p.shoeShade, 1.1, [[ax - 4.0, 99.2], [ax + 4.0, 99.2]]));
    out.push(poly(c, "legs", p.bow, [[ax, 95.0], [ax - 2.9, 92.9], [ax - 2.3, 95.9]] as Point2[]));
    out.push(poly(c, "legs", p.bow, [[ax, 95.0], [ax + 2.9, 92.9], [ax + 2.3, 95.9]] as Point2[]));
  }

  // —— 尾：黑色粗尾 + 白尾尖，从右胯后方绕出、翘到肩高（原型图里那条大尾巴） ——
  //    尾巴必须**绕到头发外面**：发团最宽到 ±32（y≈53），早先那条曲率把尾尖送到
  //    (87,67)——正好压在发缘上，白尾尖贴在黑发上等于没画（放大图里像挂上去一只白挂钩）。
  //    现在控制点外推到 x≈100、尾尖落在 x≈96，离开发缘还有 7 单位。
  {
    const sway = ch(input, "tail");
    const bx = 60 + 14.5, by = 84.5;
    const spine: Point2[] = [
      [bx, by],
      ...bez([bx, by], [bx + 15, by + 5.5], [bx + 26.5 + sway * 1.5, by - 8],
        [bx + 21.5 + sway * 2.5, by - 27.5]),
    ];
    // 等宽描边会在末端留一个「棒子头」，而 slice(-5) 在更长的尾巴上曾把 42% 涂成白——
    // 白尾尖只占末梢那一段（约 1/4，从 y≈73 起），长度靠 ribbon 的收尖给。
    // 黑段与白段**分开画**，接头宽度对齐（4.4 → 4.4）；白段往下**变宽**（6.0）再收圆头，
    // 才是「蓬起来的一撮毛」。反过来（白段一亮就收窄）会被黑尾包住，只从边上漏一道白线。
    out.push(poly(c, "tail", p.tail, ribbon(spine.slice(0, -3), 6.0, 4.4)));
    out.push(poly(c, "tail", p.tailTip, ribbon(spine.slice(-4), 4.4, 6.0)));
  }

  // —— 连体衣：黑色紧身衣，胸口到小腹一大块白肚皮（原型图的主体） ——
  {
    const suit = blob([60, P.shoulderY - 4], [
      [[60 + 8, P.shoulderY - 4.5], [60 + 11.8, P.shoulderY + 1], [60 + 12.2, P.shoulderY + 5]],
      [[60 + 12.2, P.waistY - 5], [60 + 10.5, P.waistY], [60 + 11.5, P.waistY + 4]],
      [[60 + 13.5, 82], [60 + 13.5, 85], [60 + 12.5, P.hemY]],
      [[60 + 6, P.hemY + 1.6], [60 - 6, P.hemY + 1.6], [60 - 12.5, P.hemY]],
      [[60 - 13.5, 85], [60 - 13.5, 82], [60 - 11.5, P.waistY + 4]],
      [[60 - 10.5, P.waistY], [60 - 12.2, P.waistY - 5], [60 - 12.2, P.shoulderY + 5]],
      [[60 - 11.8, P.shoulderY + 1], [60 - 8, P.shoulderY - 4.5], [60, P.shoulderY - 4]],
    ]);
    out.push(poly(c, "dress", p.suit, suit));
    // 侧缝：两条亮线把「一片黑」撑出圆柱体积
    out.push(line(c, "dress", p.suitLight, 1.0, [[60 - 9.6, P.shoulderY + 6], [60 - 10.2, P.waistY + 2], [60 - 11.8, 83]]));
    out.push(line(c, "dress", p.suitLight, 1.0, [[60 + 9.6, P.shoulderY + 6], [60 + 10.2, P.waistY + 2], [60 + 11.8, 83]]));
    // 白肚皮：从领结下方一直盖到小腹，**不能铺满整件衣服**——铺满就成了一块白板，
    // 黑色连体衣读不出来（前两版正是这么错的）。宽度 ±9.5 / 衣宽 27 ＝ 70%。
    const belly = blob([60, 67.5], [
      [[60 + 5.5, 67.2], [60 + 9.2, 71], [60 + 9.5, 76]],
      [[60 + 9.8, 81], [60 + 6.5, 84.6], [60, 85.0]],
      [[60 - 6.5, 84.6], [60 - 9.8, 81], [60 - 9.5, 76]],
      [[60 - 9.2, 71], [60 - 5.5, 67.2], [60, 67.5]],
    ]);
    out.push(poly(c, "dress", p.belly, belly));
    // 肚皮下缘一条暗线：把白肚皮与衣服分开（不然白块像是浮在衣服上）
    out.push(line(c, "dress", p.bellyShade, 1.0, [[60 - 6.4, 83.4], [60, 84.6], [60 + 6.4, 83.4]]));
    // 胯下阴影：把下摆与腿分开
    out.push(line(c, "dress", p.suitShade, 1.4, [[60 - 11.5, P.hemY - 1.2], [60, P.hemY + 0.6], [60 + 11.5, P.hemY - 1.2]]));
  }

  // —— 脖子与脸：脖子先画（被下巴压住），脸后画 ——
  {
    out.push(poly(hc, "body", p.skinShade, [
      [60 - 3.4, 56], [60 + 3.4, 56], [60 + 4.0, 65.5], [60 - 4.0, 65.5],
    ] as Point2[]));

    // 脸：上宽下尖的桃形。下巴收在 ±2.2——收得不够尖会读成「方脸」，
    // 而二次元二头身在 64px 下只剩这一笔能读出「尖下巴」。
    const R = P.faceRx;
    const face = blob([60, P.faceTop], [
      [[60 + R * 0.62, P.faceTop - 0.5], [60 + R, P.eyeY - 7], [60 + R, P.eyeY + 1]],
      [[60 + R, P.chin - 8], [60 + R * 0.5, P.chin - 2.4], [60 + 2.2, P.chin]],
      [[60.7, P.chin + 0.8], [59.3, P.chin + 0.8], [60 - 2.2, P.chin]],
      [[60 - R * 0.5, P.chin - 2.4], [60 - R, P.chin - 8], [60 - R, P.eyeY + 1]],
      [[60 - R, P.eyeY - 7], [60 - R * 0.62, P.faceTop - 0.5], [60, P.faceTop]],
    ]);
    out.push(poly(hc, "body", p.skin, face));
    // 刘海投影：脸的上缘压一条暗带（没有它会读成「脸贴反了」）
    out.push(poly(hc, "body", withAlpha(p.skinShade, 0.5), [
      [60 - R + 0.6, P.faceTop + 1.6], [60, P.faceTop + 3.4], [60 + R - 0.6, P.faceTop + 1.6],
      [60 + R - 1.4, P.faceTop - 0.4], [60, P.faceTop - 0.4], [60 - R + 1.4, P.faceTop - 0.4],
    ] as Point2[]));
    // 常态腮红：原型图不是只有害羞档才有腮红，脸颊上永远有一层粉底
    for (const cx of [P.eyeLx - 0.6, P.eyeRx + 0.6] as const) {
      out.push(ell(hc, "body", withAlpha(p.cheekSoft, 0.6), cx, P.eyeY + 5.6, 3.2, 1.9));
    }
  }

  // —— 臂：黑色泡泡短袖 + 裸前臂；双手是白爪手套（下一层） ——
  //    腕点先收集，臂全画完再画手套——否则左右手会按「臂、手、臂、手」交错，
  //    左手会被右臂盖住一条边。
  const wrists: Array<{ x: number; y: number; sx: number; side: -1 | 1 }> = [];
  for (const side of [-1, 1] as const) {
    const sx = 60 + side * 10.2;
    const shoulder: Point2 = [sx, P.shoulderY + 1.5];
    const swing = ch(input, side < 0 ? "armL" : "armR");
    const dx = side * 3.0, dy = 11.0;
    const cos = Math.cos(-swing), sin = Math.sin(-swing);
    const at = (t: number): Point2 => [
      shoulder[0] + dx * t * cos - dy * t * sin,
      shoulder[1] + dx * t * sin + dy * t * cos,
    ];
    const elbow = at(0.52), wrist = at(1);
    out.push(ell(c, "arms", p.suit, shoulder[0] + side * 0.4, shoulder[1] - 0.2, 4.4, 4.0));
    out.push(line(c, "arms", p.suit, 6.4, [shoulder, elbow]));
    out.push(line(c, "arms", p.suitLight, 1.0, [shoulder, elbow]));
    out.push(line(c, "arms", p.skin, 3.4, [elbow, wrist]));
    wrists.push({ x: wrist[0], y: wrist[1], sx, side });
  }
  for (const w of wrists) {
    const hand = ch(input, "hand");
    const hx = w.x + (w.x - w.sx) * 0.22 * hand;
    const hy = w.y + 0.8 + 0.8 * hand;
    out.push(ell(c, "hands", p.mitten, hx, hy, 4.7, 4.5));
    out.push(ell(c, "hands", p.pad, hx, hy + 1.5, 2.4, 1.8));
    for (const k of [-1, 0, 1] as const) {
      out.push(ell(c, "hands", p.pad, hx + k * 1.4, hy - 1.8 - (k === 0 ? 0.4 : 0), 0.9, 0.9));
    }
  }

  // —— 领结：粉色，黑色衣服上唯一的高饱和点（原型图胸口最抢眼的一处） ——
  {
    out.push(poly(c, "collar", p.bow, [[60, 65.2], [60 - 6.0, 61.8], [60 - 5.2, 68.4]] as Point2[]));
    out.push(poly(c, "collar", p.bow, [[60, 65.2], [60 + 6.0, 61.8], [60 + 5.2, 68.4]] as Point2[]));
    // 领结的两条飘带垂在白肚皮上沿
    out.push(poly(c, "collar", p.bow, [[60 - 1.2, 65.6], [60 - 4.6, 70.6], [60 - 1.8, 70.2]] as Point2[]));
    out.push(poly(c, "collar", p.bow, [[60 + 1.2, 65.6], [60 + 4.6, 70.6], [60 + 1.8, 70.2]] as Point2[]));
    out.push(poly(c, "collar", p.bowDark, [[60, 64.4], [60 - 2.6, 62.8], [60 - 2.6, 66.8]] as Point2[]));
    out.push(poly(c, "collar", p.bowDark, [[60, 64.4], [60 + 2.6, 62.8], [60 + 2.6, 66.8]] as Point2[]));
    out.push(ell(c, "collar", p.bow, 60, 65.0, 2.0, 1.9));
  }

  // —— 猫耳：两只大三角，粉内耳 + 耳根白绒毛（原型图的第二眼特征） ——
  //    尖端收在 ±24：原型图上耳尖比头团外缘（29.5）**还靠里**，画到 ±31 就成了
  //    「两只犄角」——那是第一版被否掉时最刺眼的一条（72px 下两片粉三角离得比脸还宽）。
  for (const side of [-1, 1] as const) {
    // earL/earR 是弧度：正=向外压（警觉），负=向内耷（害羞/难过）。
    const droop = ch(input, side < 0 ? "earL" : "earR");
    const dxE = side * Math.sin(droop) * 4.0;
    const dyE = (1 - Math.cos(droop)) * 3.2;
    out.push(poly(hc, "ears", p.earOuter, [
      [60 + side * 9, P.crown + 12 + dyE * 0.4],
      [60 + side * 24 + dxE, P.crown - 12.5 + dyE],
      [60 + side * 29.5, P.crown + 12 + dyE * 0.4],
    ] as Point2[]));
    out.push(poly(hc, "ears", p.earInner, [
      [60 + side * 13.5, P.crown + 11 + dyE * 0.4],
      [60 + side * 22 + dxE, P.crown - 5.5 + dyE],
      [60 + side * 26.5, P.crown + 11 + dyE * 0.4],
    ] as Point2[]));
    out.push(ell(hc, "ears", p.earTuft, 60 + side * 16.0, P.crown + 12.5 + dyE * 0.4, 2.4, 1.8));
    out.push(ell(hc, "ears", p.earTuft, 60 + side * 20.0, P.crown + 10.5 + dyE * 0.4, 3.2, 2.2));
  }

  // —— 刘海 + 白色挑染 + 侧发 ——
  {
    // 刘海：从发线垂到眉线之上（眉弧顶 38.9，下沿最高只到 35.8）。
    // 16 档差分靠眉毛/眼睛分辨，刘海压过眉线等于把尺 #72 废掉一半；
    // 但刘海又必须真盖住额头——只压住 crown 那 2 单位的话，脸会读成一张整皮。
    // 五个尖（不是一排小锯齿）：尖牙太密在 64px 下会读成梳子。
    const bangs = [
      [60 - 27.5, 41.5],
      [60 - 27, 26], [60 - 14, P.crown - 1], [60, P.crown - 1.5],
      [60 + 14, P.crown - 1], [60 + 27, 26], [60 + 27.5, 41.5],
      [60 + 23.5, 37.2], [60 + 16, 32.4], [60 + 9.5, 35.8],
      [60 + 3.5, 32.6], [60, 35.0], [60 - 3.5, 32.6],
      [60 - 9.5, 35.8], [60 - 16, 32.4], [60 - 23.5, 37.2],
    ] as Point2[];
    out.push(poly(hc, "hair_front", p.hairMid, bangs));
    // 高光带：只留**一条窄弧**。画成一大块浅灰多边形会在 64px 下读成「秃顶」。
    out.push(line(hc, "hair_front", p.hairLight, 1.8, arc(
      60 - 16, P.crown + 6.5, 60 - 3, P.crown + 2.6, 60 + 9, P.crown + 4.6,
    )));
    // 白色挑染：**一束**，从发顶垂到刘海下沿（原型图正中偏左那一绺）。
    // 整头变浅＝换了个人；只有这一束才是「同一个角色」的记号。
    // 走向要**近似竖直**：先画成一条 38° 的斜杠，512 下读成一个白色的「7」；
    // 原型图上是自上而下略微内收的一束，末端收成尖。颜色取 96% 纸白
    // （hairLight 只有 59%，会读成一道灰刮痕——第一版正是这么错的）。
    out.push(poly(hc, "hair_front", p.hairWhite, [
      [60 - 6.0, P.crown + 0.3],
      [60 - 10.6, P.crown + 7.2], [60 - 12.6, 32.6], [60 - 12.6, 34.2],
      [60 - 9.4, 31.4], [60 - 6.0, 25.4], [60 - 1.4, P.crown + 0.2],
    ] as Point2[]));

    // 侧发：贴着脸外缘垂下的两束，一路盖到肩上（波波头的「前片」）。
    // 内缘停在 ±14.6：眼外缘在 ±15.4，再往里就会把眼白压出一道缺口。
    for (const side of [-1, 1] as const) {
      const sway = ch(input, "hem") * 0.6;
      out.push(poly(hc, "hair_front", p.hairMid, [
        [60 + side * 14.6, P.eyeY - 14],
        [60 + side * 19.0, P.eyeY - 12], [60 + side * 21.8, P.chin - 3],
        [60 + side * 22.4 + sway, 65.0], [60 + side * 17.0 + sway, 66.6],
        [60 + side * 16.2, P.chin + 1], [60 + side * 15.0, P.eyeY + 9],
      ] as Point2[]));
    }
  }

  // 呆毛：一缕从发顶斜挑出来的细毛（原型图没有，但它是「猫」的记号之一）。
  // 画成半圆环会在 64px 下读成「脑袋上挂了只耳环」，所以只留一根斜挑的弯。
  out.push(line(hc, "ahoge", p.hairMid, 2.2, arc(60.5, 19.6, 55.2, 15.0, 60.8, 10.2)));

  out.push(...buildFaceOps(faceOf(input.expression ?? "neutral", {
    t: 0, blink: input.blink, mouse: null, energy: input.energy, speaking: false,
  }), hm, 1, coat, input.u, { base: p.eyeIris, light: p.eyeIrisLight }));

  // —— 小虎牙：嘴左角一颗，压在嘴线上（原型图里「猫」的那一笔）。
  //    画在五官之后，绝不参与表情差分（16 档靠嘴曲率分辨，虎牙只是加一笔）。 ——
  out.push(poly(hc, "mouth", p.fang, [[57.9, 54.2], [59.3, 54.4], [58.3, 55.9]] as Point2[]));

  return out;
}

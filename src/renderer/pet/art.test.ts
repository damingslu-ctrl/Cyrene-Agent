import { describe, expect, it } from "vitest";
import {
  buildBubbleOps, buildCapsuleOps, buildCatOps, bubbleBoxRect, layerKinds,
  fmtSpeed, fmtSpeedOpt, SPOKEN_CAP, wrapBubbleText,
} from "./art";
import { opsBounds, type DrawOp } from "./ops";
import { INK, INK_SOFT, PAPER, PET_PRIVATE, parse, withAlpha } from "../../shared/pet-tokens";
import { CAT_COATS } from "../../shared/cat-coats";

const S = (37 * 2) / 120; // u=37 档的 s（art.ts 的 `s = u*2/VB`）

const base = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle" as const, t: 0, energy: 1,
  mouse: null, blink: 0, jumpY: 0, pet: 0,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 }, quiet: false,
};

type Ellipse = Extract<DrawOp, { kind: "fillEllipse" }>;
type StrokeEllipse = Extract<DrawOp, { kind: "strokeEllipse" }>;
type RoundRect = Extract<DrawOp, { kind: "fillRoundRect" }>;
type StrokeRect = Extract<DrawOp, { kind: "strokeRoundRect" }>;
type TextOp = Extract<DrawOp, { kind: "text" }>;
type PathOp = Extract<DrawOp, { kind: "fillPath" }>;
type CrescentOp = Extract<DrawOp, { kind: "crescent" }>;

const isEllipse = (op: DrawOp): op is Ellipse => op.kind === "fillEllipse";
const isText = (op: DrawOp): op is TextOp => op.kind === "text";
const pointsOf = (op: DrawOp) => ("points" in op ? op.points : []);

/** 解析 `withAlpha` 产出的 rgba 串。 */
function rgba(op: { fill?: string; stroke?: string; color?: string }): { r: number; g: number; b: number; a: number } {
  const raw = op.fill ?? op.stroke ?? op.color ?? "";
  const m = /^rgba\((\d+), (\d+), (\d+), ([^)]+)\)$/.exec(raw);
  if (!m) throw new Error(`不是 rgba 串，读不了 alpha：${raw}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
}
const lum = (c: { r: number; g: number; b: number }) => (c.r + c.g + c.b) / 3;
const of = (ops: DrawOp[], layer: string) => ops.filter((op) => op.layer === layer);
const eyeWhites = (ops: DrawOp[]) => of(ops, "eyes").filter(isEllipse).filter((e) => e.fill === PAPER);

describe("buildCatOps 层序", () => {
  const ORDER = [
    "ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke",
    "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush",
  ];

  it("绘制顺序照抄 ui.rs::draw_cat：影子→尾→耳→身→围兜→爪→眼→鼻嘴→腮红", () => {
    expect(layerKinds(buildCatOps(base))).toEqual(ORDER);
  });

  it("洗脸爪是独立一层，排在整张脸（眼/鼻/嘴/腮红）之后（ui.rs:1027-1064）", () => {
    const ops = buildCatOps({ ...base, pose: { ...base.pose, paw: 1 } });
    expect(layerKinds(ops)).toEqual([...ORDER, "paws_up"]);
    // 墨袖 → 白手套 → 手套下缘：抬起的手臂必须先被自己的爪子盖住。
    expect(of(ops, "paws_up").map((op) => op.kind)).toEqual(["strokePath", "fillEllipse", "strokePath"]);
    // 抬起时常驻的左爪不再画，否则脸上叠两只同色手套。
    expect(of(ops, "paws")).toHaveLength(2);
  });

  it("免打扰时月牙必须两层（墨 + PAPER 反咬），外层半径是内层的 1.28 倍", () => {
    const crescents = of(buildCatOps({ ...base, quiet: true }), "quiet_mark") as CrescentOp[];
    expect(crescents).toHaveLength(2);
    const [outer, inner] = crescents;
    expect(outer.fill).toBe(INK);
    expect(inner.fill).toBe(PAPER);
    expect(outer.r).toBeCloseTo(1.28 * 9 * S, 6);
    expect(inner.r).toBeCloseTo(9 * S, 6);
    expect(outer.dx / outer.r).toBeCloseTo(0.42, 6);
    expect(outer.dy / outer.r).toBeCloseTo(-0.3, 6);
    expect(outer.cut / outer.r).toBeCloseTo(0.92, 6);
    // 两层同心，锚在 `center + (6.5s, −51.5s)`；月牙顶不许被 108 高的窗裁掉上角。
    expect(inner.cx).toBe(outer.cx);
    expect(inner.cy).toBe(outer.cy);
    expect(outer.cx).toBeCloseTo(41 + 6.5 * S, 6);
    expect(outer.cy).toBeCloseTo(43 - 51.5 * S, 6);
    expect(outer.cy - outer.r).toBeGreaterThanOrEqual(0);
  });

  it("正对照：安静期间不许出现 Zzz（月牙与 Zzz 屏幕互斥）", () => {
    expect(of(buildCatOps({ ...base, quiet: true }), "zzz")).toHaveLength(0);
    expect(of(buildCatOps({ ...base, mood: "sleep" }), "zzz")).not.toHaveLength(0);
  });

  it("Zzz 必须双色：每枚「Z」先四向压一圈奶油光边，再叠软墨（native #69）", () => {
    const zzz = of(buildCatOps({ ...base, mood: "sleep" }), "zzz") as TextOp[];
    expect(zzz).toHaveLength(15); // 3 枚 ×（4 光边 + 1 墨字）
    for (let i = 0; i < 3; i++) {
      const group = zzz.slice(i * 5, i * 5 + 5);
      const core = group[4];
      expect(core.align).toBe("center");
      expect(rgba(core)).toMatchObject({ r: 74, g: 81, b: 98 }); // INK_SOFT
      for (const halo of group.slice(0, 4)) {
        expect(halo.align).toBe("center");
        expect(rgba(halo)).toMatchObject({ r: 247, g: 244, b: 236 }); // PAPER
        expect(Math.abs(halo.x - core.x)).toBeCloseTo(core.size * 0.13, 6);
        expect(Math.abs(halo.y - core.y)).toBeCloseTo(core.size * 0.13, 6);
      }
      expect(lum(rgba(core))).toBeLessThan(lum(rgba(group[0])));
    }
    // 三枚错相：越晚的越靠上、越大、越淡
    const cores = [0, 1, 2].map((i) => zzz[i * 5 + 4]);
    expect(cores[0].size).toBeLessThan(cores[1].size);
    expect(cores[1].size).toBeLessThan(cores[2].size);
    expect(cores[0].y).toBeGreaterThan(cores[1].y);
    expect(cores[1].y).toBeGreaterThan(cores[2].y);
    expect(rgba(cores[0]).a).toBeGreaterThan(rgba(cores[2]).a);
  });

  it("猫身包围盒在收起档必须落进窗口（不出 82 宽、不越过 y=0）", () => {
    const box = opsBounds(buildCatOps(base));
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(82);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  it("采样密度是数值：身 4 段 ×12 + 锚 = 49 点，尾脊 25 点 → 丝带 53 点，尾尖截 6 点 → 15 点", () => {
    const ops = buildCatOps(base);
    expect(pointsOf(of(ops, "body")[0])).toHaveLength(49);
    expect(pointsOf(of(ops, "tail")[0])).toHaveLength(53);
    expect(pointsOf(of(ops, "tail_tip")[0])).toHaveLength(15);
    // 尾尖是实色奶油：半透压在渐变尾上会读出一圈灰边。
    expect((of(ops, "tail_tip")[0] as PathOp).fill).toBe(PAPER);
  });

  it("椭圆半径要吃 xf.sx/sy：伸懒腰时眼睛被横向撑、纵向压（不是屏幕空间画个圆）", () => {
    const ops = buildCatOps({ ...base, pose: { ...base.pose, stretch: 1 } });
    const eye = of(ops, "eyes").filter(isEllipse)[0];
    expect(eye.rx).toBeCloseTo(5.9 * S * 1.055, 6);
    expect(eye.ry).toBeCloseTo(6.6 * S * 0.925, 6);
  });

  it("眼睛跟脸一起歪：歪头档两眼不再同高，直头档必须同高", () => {
    const level = eyeWhites(buildCatOps(base));
    expect(level).toHaveLength(2);
    expect(level[0].cy).toBeCloseTo(level[1].cy, 9);
    const tilted = eyeWhites(buildCatOps({ ...base, pose: { ...base.pose, tilt: 13 } }));
    expect(Math.abs(tilted[0].cy - tilted[1].cy)).toBeGreaterThan(1);
  });

  it("眼内两枚高光在 native 是 circle：输入只有一个半径，但输出仍要吃 sx/sy", () => {
    const ops = buildCatOps({ ...base, pose: { ...base.pose, stretch: 1 } });
    const [white] = eyeWhites(ops);
    const gloss = of(ops, "eyes").filter(isEllipse).filter((e) => e.fill.startsWith("rgba(247, 244, 236"));
    expect(gloss).toHaveLength(4);
    for (const g of gloss) expect(g.rx / 1.055).toBeCloseTo(g.ry / 0.925, 9);
    // 高光半径取自横向 rx（ui.rs 的 `circle(..., rx*0.30)`），不是各自轴的半径
    expect(gloss[0].rx).toBeCloseTo(white.rx * 0.30, 9);
    expect(gloss[1].rx).toBeCloseTo(white.rx * 0.15, 9);
    expect(gloss[0].ry).not.toBeCloseTo(white.ry * 0.30, 9);
  });

  it("爱心整段行程连半径都留在窗内（旧的 44+26ph 会被拦腰裁掉）", () => {
    const lobes = of(buildCatOps({ ...base, pet: 1 }), "heart").filter(isEllipse);
    expect(lobes.length).toBeGreaterThan(0);
    for (const lobe of lobes) {
      expect(lobe.ry).toBeLessThan(lobe.cy);
      expect(lobe.cy + lobe.ry).toBeLessThanOrEqual(108);
      expect(lobe.rx).toBe(lobe.ry);
    }
    // 第一枚 ph=0：锚点与半径就是 ui.rs:1116-1133 的原式
    expect(lobes[0].cy).toBeCloseTo(43 - 41 * S - 0.42 * (3 * S * 1.7), 6);
    expect(lobes[0].rx).toBeCloseTo(0.56 * 3 * S * 1.7, 6);
  });
});

describe("comanion 姿态：朝向 / 走路 / 落地压扁", () => {
  it("facing=-1 把整只猫镜像到中心左侧，且所有椭圆半径仍为正（负 rx 会让 ctx.ellipse 抛错）", () => {
    const right = opsBounds(of(buildCatOps({ ...base, facing: 1 }), "tail"))!;
    const left = opsBounds(of(buildCatOps({ ...base, facing: -1 }), "tail"))!;
    expect(right.x).toBeGreaterThan(base.center.x);
    expect(left.x + left.width).toBeLessThan(base.center.x);
    for (const op of buildCatOps({ ...base, facing: -1 })) {
      if (op.kind === "fillEllipse" || op.kind === "strokeEllipse") {
        expect(op.rx).toBeGreaterThan(0);
        expect(op.ry).toBeGreaterThan(0);
      }
    }
  });

  it("走路：两只前爪交替抬起，身体整体起伏（影子留在原地）", () => {
    const still = of(buildCatOps(base), "paws").filter(isEllipse);
    expect(still[0].cy).toBeCloseTo(still[1].cy, 6);
    const walking = of(buildCatOps({ ...base, pose: { ...base.pose, walk: Math.PI / 2 } }), "paws").filter(isEllipse);
    expect(Math.abs(walking[0].cy - walking[1].cy)).toBeGreaterThan(0.5);
    const bodyStill = opsBounds(of(buildCatOps(base), "body"))!;
    const bodyWalk = opsBounds(of(buildCatOps({ ...base, pose: { ...base.pose, walk: Math.PI / 2 } }), "body"))!;
    expect(bodyWalk.y).toBeLessThan(bodyStill.y);
    // 影子不吃走路起伏：lift 只看跳跃，走路时脚没离地。
    const shStill = opsBounds(of(buildCatOps(base), "ground_shadow"))!;
    const shWalk = opsBounds(of(buildCatOps({ ...base, pose: { ...base.pose, walk: Math.PI / 2 } }), "ground_shadow"))!;
    expect(shWalk).toEqual(shStill);
  });

  it("落地压扁绕脚部支点：眼睛向下、身体变矮", () => {
    const upright = eyeWhites(buildCatOps(base));
    const squashed = eyeWhites(buildCatOps({ ...base, pose: { ...base.pose, squash: 1 } }));
    expect(squashed[0].cy).toBeGreaterThan(upright[0].cy + 0.5);
    const hUp = opsBounds(of(buildCatOps(base), "body"))!.height;
    const hDown = opsBounds(of(buildCatOps({ ...base, pose: { ...base.pose, squash: 1 } }), "body"))!.height;
    expect(hDown).toBeLessThan(hUp);
  });
});

describe("buildBubbleOps 对话气泡", () => {
  const input = (over: Partial<Parameters<typeof buildBubbleOps>[0]> = {}) => ({
    rectWidth: 172, rectHeight: 108, growLeft: false, text: "我在这儿呢", be: 1, ...over,
  });

  it("盒子贴着猫的对侧、整只落进 172×108，且近猫一侧有一个小尖角", () => {
    const right = bubbleBoxRect(172, false, "我在这儿呢");
    expect(right.x).toBeGreaterThan(60); // 猫在左半边，气泡在右
    expect(right.x + right.w).toBeLessThanOrEqual(172);
    expect(right.y).toBeGreaterThanOrEqual(0);
    expect(right.y + right.h).toBeLessThanOrEqual(108);
    const left = bubbleBoxRect(172, true, "我在这儿呢");
    expect(left.x).toBeLessThan(40);
    expect(left.x + left.w).toBeLessThan(90); // 不压到右移后的猫身
    const ops = buildBubbleOps(input());
    expect(of(ops, "bubble").map((op) => op.kind)).toEqual(["fillRoundRect", "fillPath", "text"]);
  });

  it("底是实色墨盒、字是墨白：气泡画在用户桌布上，半透底会读不出字", () => {
    const ops = of(buildBubbleOps(input()), "bubble");
    const box = ops[0] as RoundRect;
    expect(box.fill).toBe(PET_PRIVATE.HUD_BOX);
    const text = ops.filter(isText)[0];
    expect(text.color).toBe(PET_PRIVATE.HUD_INK);
    expect(text.text).toBe("我在这儿呢");
    // 展开中淡入：be<1 时整块带 alpha，be=1 时是实色。
    const half = of(buildBubbleOps(input({ be: 0.5 })), "bubble")[0] as RoundRect;
    expect(half.fill).not.toBe(PET_PRIVATE.HUD_BOX);
    expect(rgba(half).a).toBeCloseTo(0.5, 6);
  });

  it("长句按可用宽度换行：状态三件套至少两行，每一行都不超宽", () => {
    const text = "亲密度 80% · 饱腹 90% · 精力 70%";
    const lines = wrapBubbleText(text, 78, 9);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // 9px sans-serif 在 Chromium/Win 下的**实测**字宽（v1.8 尺 #62）：
    // CJK/`·`/`…` 9.00、`%` 8.29、`—` 8.05、空格 2.02、数字 4.99。
    // 旧表把 `·` 当 5.2 估，状态句算出 74.5 而真宽 78.3，最后两个字切在盒外。
    const width = (line: string) => [...line].reduce((sum, ch) => {
      if (ch === " ") return sum + 2.02;
      if (ch === "%") return sum + 8.29;
      if (ch === "—") return sum + 8.05;
      const cp = ch.codePointAt(0)!;
      return sum + (cp > 0x2e80 || ch === "·" || ch === "…" ? 9 : 5.2);
    }, 0);
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(78 + 1e-6);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text);
    const ops = buildBubbleOps(input({ text }));
    expect(of(ops, "bubble").filter(isText)).toHaveLength(lines.length);
  });

  it("`\\n` 是硬换行：状态卡片四行各放得下，文字带 maxWidth 硬边界", () => {
    const text = "亲密度 80%\n饱腹 90%\n精力 70%\n依赖 · 第 3 天";
    const lines = wrapBubbleText(text, 78, 9);
    expect(lines).toEqual(["亲密度 80%", "饱腹 90%", "精力 70%", "依赖 · 第 3 天"]);
    const ops = of(buildBubbleOps(input({ text })), "bubble").filter(isText);
    expect(ops).toHaveLength(4);
    for (const op of ops) expect(op.maxWidth).toBe(78);
    const box = bubbleBoxRect(172, false, text);
    expect(box.h).toBe(6 * 2 + 12 * 4);
    expect(box.y + box.h).toBeLessThanOrEqual(108);
  });

  it("断行不留孤字：末行 1–2 个字时从上一行匀（标点连前一个字一起搬）", () => {
    const lines = wrapBubbleText("今天也想多黏你—会儿", 78, 9);
    expect(lines).toEqual(["今天也想多黏", "你—会儿"]);
    expect([...lines[lines.length - 1]].length).toBeGreaterThanOrEqual(3);
  });

  it("收尾标点不落行首：宁可前一行少一格，也不让「，」开头", () => {
    const lines = wrapBubbleText("一二三四五六七八，九十", 78, 9);
    expect(lines).toEqual(["一二三四五六七", "八，九十"]);
    expect(lines.some((line) => line.startsWith("，"))).toBe(false);
    expect(lines.join("")).toBe("一二三四五六七八，九十");
  });

  it("be=0 一个字节都不画：窗口还没长开时气泡不许先出屏", () => {
    expect(buildBubbleOps(input({ be: 0 }))).toHaveLength(0);
  });
});

describe("buildCapsuleOps", () => {
  const CAP_W = 70, CAP_H = 32, CAP_R = 9;
  const input = (over: Partial<Parameters<typeof buildCapsuleOps>[0]> = {}) => ({
    rectWidth: 82, rectHeight: 108, e: 0, growLeft: false, up: 0, down: 0,
    unreadCount: 0, bubbleVisible: false, ...over,
  });
  const collapsed = (over: Partial<Parameters<typeof buildCapsuleOps>[0]> = {}) =>
    buildCapsuleOps(input(over));

  it("默认档是 70×32 圆角 9 的胶囊，贴在窗口底部（cy = 高 − 16 − 4）", () => {
    const ops = collapsed();
    const body = ops[0] as RoundRect;
    const edge = ops[1] as StrokeRect;
    expect(body.kind).toBe("fillRoundRect");
    expect(edge.kind).toBe("strokeRoundRect");
    expect(body.w).toBe(CAP_W);
    expect(body.h).toBe(CAP_H);
    expect(body.r).toBe(CAP_R);
    expect(edge.w).toBe(CAP_W);
    expect(edge.x).toBe(body.x);
    expect(edge.width).toBe(1);
    expect(body.x + CAP_W / 2).toBeCloseTo(41, 6);
    expect(body.y + CAP_H / 2).toBeCloseTo(108 - CAP_H / 2 - 4, 6);
  });

  it("四段读数：箭头贴左缘 +7、数值右对齐到 −8、两行各 ±8", () => {
    const ops = collapsed({ up: 2048, down: 1048576 });
    const body = ops[0] as RoundRect;
    const texts = ops.filter(isText);
    expect(texts.map((t) => t.text)).toEqual(["↑", "2 KB/s", "↓", "1.0 MB/s"]);
    for (const t of texts) expect(t.size).toBe(8);
    expect(texts[0].x).toBeCloseTo(body.x + 7, 6);
    expect(texts[0].align).toBe("left");
    expect(texts[1].x).toBeCloseTo(body.x + CAP_W - 8, 6);
    expect(texts[1].align).toBe("right");
    expect(texts[0].y).toBeCloseTo(body.y + CAP_H / 2 - 8, 6);
    expect(texts[3].y).toBeCloseTo(body.y + CAP_H / 2 + 8, 6);
  });

  it("growLeft 时胶囊贴右缘（cx = max.x − PIN.x）", () => {
    const right = collapsed({ rectWidth: 172, growLeft: true })[0] as RoundRect;
    expect(right.x + CAP_W / 2).toBeCloseTo(172 - 41, 6);
  });

  it("静默时降的是 RGB 亮度（换色表）而不是把 alpha 压低，且描边比填充亮一档", () => {
    const silent = collapsed();
    const active = collapsed({ up: 1024 });
    for (const ops of [silent, active]) {
      expect(rgba(ops[1]).r).toBeGreaterThan(rgba(ops[0]).r); // 描边比填充亮
      expect(lum(rgba(ops[1]))).toBeGreaterThan(lum(rgba(ops[0])));
    }
    expect(lum(rgba(silent[0]))).toBeLessThan(lum(rgba(active[0]))); // 墨底
    expect(lum(rgba(silent[2]))).toBeLessThan(lum(rgba(active[2]))); // ↑ 绿
    expect(lum(rgba(silent[4]))).toBeLessThan(lum(rgba(active[4]))); // ↓ 蓝
    expect(rgba(silent[0]).a).toBeCloseTo(190 / 255, 6);
    expect(rgba(active[0]).a).toBeCloseTo(205 / 255, 6);
    expect(rgba(active[3]).a).toBe(1); // 读数与箭头不吃静默的那一档退让
  });

  it("展开动画期间随 e 线性淡出，alpha 走 native 的截断口径（不是四舍五入）", () => {
    const mid = collapsed({ up: 1024, e: 0.25 })[0] as RoundRect;
    // al(205) 在 capOp=0.5 时是 trunc(102.5)=102；四舍五入会给出 103。
    expect(rgba(mid).a * 255).toBeCloseTo(102, 6);
    expect(collapsed({ rectWidth: 248, rectHeight: 482, e: 0.5, up: 1, down: 1 })).toEqual([]);
    expect(collapsed({ rectWidth: 248, rectHeight: 482, e: 0.6, up: 1, down: 1 })).toEqual([]);
  });

  it("没连上内核显示 -- 而不是 0 B/s", () => {
    const texts = collapsed({ up: null, down: null }).filter(isText);
    expect(texts[1].text).toBe("--");
    expect(texts[3].text).toBe("--");
  });

  it("未读记号：只在有未读且没有气泡时出现，钉在猫轴 +30 / y=26", () => {
    const [disc, ring, digit] = of(collapsed({ unreadCount: 3 }), "unread");
    expect(of(collapsed({ unreadCount: 3 }), "unread")).toHaveLength(3);
    expect(isEllipse(disc)).toBe(true);
    expect((disc as Ellipse).cx).toBeCloseTo(41 + 30, 6);
    expect((disc as Ellipse).cy).toBe(26);
    expect((disc as Ellipse).rx).toBe(6);
    expect((disc as Ellipse).ry).toBe(6);
    expect((ring as StrokeEllipse).rx).toBe(6);
    expect((digit as TextOp).text).toBe("3");
    expect((digit as TextOp).align).toBe("center");
    // 气泡占话筒时牌子让位；没欠账时不画
    expect(of(collapsed({ unreadCount: 3, bubbleVisible: true }), "unread")).toHaveLength(0);
    expect(of(collapsed({ unreadCount: 0 }), "unread")).toHaveLength(0);
  });

  it("牌子跟着猫轴走：growLeft 时方向翻成 −1", () => {
    const left = of(collapsed({ rectWidth: 172, growLeft: true, unreadCount: 2 }), "unread")[0] as Ellipse;
    expect(left.cx).toBeCloseTo(172 - 41 - 30, 6);
  });

  it("hover 只把描边从 95 提到 165，墨底不动", () => {
    const cold = of(collapsed({ unreadCount: 1 }), "unread")[1] as StrokeEllipse;
    const hot = of(collapsed({ unreadCount: 1, badgeHot: true }), "unread")[1] as StrokeEllipse;
    expect(rgba(cold).a).toBeCloseTo(95 / 255, 6);
    expect(rgba(hot).a).toBeCloseTo(165 / 255, 6);
    expect(rgba(hot).r).toBe(rgba(cold).r);
  });

  it("SPOKEN_CAP 之内永远是一位数——r=6 的墨底塞得下（结构性上限）", () => {
    expect(SPOKEN_CAP).toBe(7);
    for (let n = 1; n <= SPOKEN_CAP; n++) {
      const digit = of(collapsed({ unreadCount: n }), "unread")[2] as TextOp;
      expect(digit.text).toBe(String(n));
      expect(digit.text).toHaveLength(1);
    }
  });
});

describe("读数格式化", () => {
  it("≥1MB 一位小数，≥1KB 取整，其余按字节", () => {
    expect(fmtSpeed(1_048_576)).toBe("1.0 MB/s");
    expect(fmtSpeed(2_500_000)).toBe("2.4 MB/s");
    expect(fmtSpeed(1500)).toBe("1 KB/s");
    expect(fmtSpeed(1024)).toBe("1 KB/s");
    expect(fmtSpeed(512)).toBe("512 B/s");
    expect(fmtSpeed(0)).toBe("0 B/s");
    expect(fmtSpeedOpt(null)).toBe("--");
    expect(fmtSpeedOpt(512)).toBe("512 B/s");
  });

  it("月牙与软墨用的都是 withAlpha 的 0..1 口径", () => {
    expect(withAlpha(INK, 0.5)).toBe("rgba(43, 47, 58, 0.5)");
    expect(parse(PAPER)).toEqual({ r: 247, g: 244, b: 236 });
    expect(INK_SOFT).toBe("#4a5162");
  });
});

describe("花色轴接进 buildCatOps", () => {
  const bodyGrad = (ops: DrawOp[]) => of(ops, "body")[0] as Extract<DrawOp, { kind: "gradPath" }>;
  const pawFill = (ops: DrawOp[]) => of(ops, "paws")[0] as Ellipse;

  it("带花色时同一层换的是对应槽，不是随机换色", () => {
    const none = buildCatOps(base);
    const paper = buildCatOps({ ...base, coat: CAT_COATS.paper });
    expect(bodyGrad(none).stops[0].color).toBe(INK);
    expect(bodyGrad(paper).stops[0].color).toBe(CAT_COATS.paper.furTop);
    expect(bodyGrad(paper).stops[0].color).not.toBe(INK);   // 正对照：真换了
  });

  it("白爪读 light 槽——用蓝猫验，奶油猫的 light 本来就是 PAPER", () => {
    expect(pawFill(buildCatOps(base)).fill).toBe(PAPER);
    const azure = buildCatOps({ ...base, coat: CAT_COATS.azure });
    expect(pawFill(azure).fill).toBe(CAT_COATS.azure.light);
    expect(CAT_COATS.azure.light).not.toBe(PAPER);         // 正对照：槽值不与默认撞色
  });
});

describe("agent 工作状态的粒子记号", () => {
  /** stars 层里除了 mood 星光之外的那几笔（工作粒子也走这一层）。 */
  const starOps = (ops: DrawOp[]): DrawOp[] => ops.filter((op) => op.layer === "stars");

  it("workParticle 缺省/ none 时一笔都不多画（老图零差异）", () => {
    const without = starOps(buildCatOps({ ...base, mood: "idle" }));
    expect(without).toHaveLength(0);
    // 显式 none 与不传等价：不能因为多了个字段就冒出粒子。
    expect(starOps(buildCatOps({ ...base, mood: "idle", workParticle: "none" }))).toHaveLength(0);
  });

  it("三种记号各自画得出东西（sweat=2 组、point=1 点、star=2 组）", () => {
    const sweat = starOps(buildCatOps({ ...base, mood: "idle", workParticle: "sweat" }));
    expect(sweat.length).toBeGreaterThan(0);
    expect(sweat.every((op) => op.kind === "fillEllipse")).toBe(true);

    const point = starOps(buildCatOps({ ...base, mood: "idle", workParticle: "point" }));
    expect(point.some((op) => op.kind === "strokePath")).toBe(true);
    expect(point.some((op) => op.kind === "fillEllipse")).toBe(true);

    const star = starOps(buildCatOps({ ...base, mood: "idle", workParticle: "star" }));
    expect(star.length).toBeGreaterThan(0);
    expect(star.every((op) => op.kind === "strokePath")).toBe(true);
  });

  it("粒子只往 stars 层加笔，不改身体层序（overlay 永远排在身体之后）", () => {
    const BODY_ORDER = [
      "ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke",
      "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush",
    ];
    for (const workParticle of ["none", "sweat", "point", "star"] as const) {
      const kinds = layerKinds(buildCatOps({ ...base, mood: "idle", workParticle }));
      // 身体层必须逐字保持原序（多一个 stars 只能是追加在尾部）。
      expect(kinds.slice(0, BODY_ORDER.length), workParticle).toEqual(BODY_ORDER);
      const extra = kinds.slice(BODY_ORDER.length);
      expect(extra.every((k) => k === "stars"), workParticle).toBe(true);
    }
  });

  it("粒子的相位从 workSince 起算：档位刚切时不会突然跳到动画中段", () => {
    // 同一 workSince、不同 t：画出来的笔数与位置应当连续变化，而不是整段消失。
    const at = (t: number) => starOps(buildCatOps({ ...base, mood: "idle", t, workParticle: "star", workSince: 0 }));
    expect(at(0).length).toBeGreaterThan(0);
    expect(at(0.2).length).toBeGreaterThan(0);
    // 正对照：给一个完全不同的 workSince，同一 t 下的画面必须不同（说明相位真读了它）。
    const shifted = starOps(buildCatOps({ ...base, mood: "idle", t: 0.2, workParticle: "star", workSince: 5 }));
    expect(shifted).not.toEqual(at(0.2));
  });
});

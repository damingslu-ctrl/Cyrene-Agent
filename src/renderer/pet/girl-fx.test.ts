import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import { girlAnimBodyFor, girlFaceBox, girlInkBox, type GirlFaceBox } from "./girl-sprite";
import { NOTICE_FX_MS, buildGirlFxOps, type GirlFxInput } from "./girl-fx";
import { restingPresence } from "./girl-presence";
import { BOND_UP_MS } from "./girl-bond";
import { STARTLE_MS } from "./companion";

function mkCat(over: Partial<CatInput> = {}): CatInput {
  return {
    center: { x: 41, y: 88 },
    u: 37,
    mood: "idle",
    t: 0,
    energy: 1,
    mouse: null,
    blink: 0,
    jumpY: 0,
    pet: 0,
    quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
    ...over,
  };
}

function mkFx(over: Partial<GirlFxInput> = {}): GirlFxInput {
  const cat = mkCat(over.mood ? { mood: over.mood } : {});
  const body = girlAnimBodyFor(cat);
  return {
    body,
    frame: 0,
    nowSec: 1.2,
    nowMs: 1_200,
    mood: "idle",
    pet: 0,
    presence: restingPresence(1),
    blush: 0,
    noticeAgeMs: -1,
    dizzyLeft: 0,
    squash: 0,
    activity: "idle",
    step: 0,
    lift: 0,
    groundY: 88,
    notes: false,
    quiet: false,
    cushion: 0,
    bondUpLeft: 0,
    patCombo: 0,
    startleLeft: 0,
    milestoneLeft: 0,
    milestoneDays: 0,
    ...over,
  };
}

describe("猫娘地面投影", () => {
  it("影子在脚线上、人物之前绘制，跳起来会缩小变淡", () => {
    const flat = buildGirlFxOps(mkFx());
    expect(flat.below.length).toBeGreaterThanOrEqual(6);
    for (const op of flat.below) {
      expect(op.layer).toBe("ground_shadow");
      expect(op.kind).toBe("fillEllipse");
      if (op.kind === "fillEllipse") {
        expect(op.cy).toBeGreaterThanOrEqual(88);
        expect(op.cy).toBeLessThanOrEqual(90.5);
      }
    }
    // 最外圈亮底 + 五环暗影 = 6；所有记号层都不许混进 below。
    expect(flat.above.some((o) => o.layer === "ground_shadow")).toBe(false);

    const aired = buildGirlFxOps(mkFx({ lift: 1 }));
    const widest = (ops: typeof flat.below) =>
      Math.max(...ops.filter((o) => o.kind === "fillEllipse").map((o) => (o.kind === "fillEllipse" ? o.rx : 0)));
    expect(widest(aired.below)).toBeLessThan(widest(flat.below));
  });

  it("影子有奶油底光：深色桌布上不是「她浮在空中」", () => {
    const ops = buildGirlFxOps(mkFx()).below;
    const fills = ops.map((o) => (o.kind === "fillEllipse" ? o.fill : ""));
    expect(fills[0]).toMatch(/^rgba\(247, 244, 236/); // PAPER @ 3.5%
    expect(fills.some((f) => f.includes("0, 0, 0"))).toBe(true);
  });
});

describe("猫娘脸部记号", () => {
  it("脸红落在两颊上、不落在头发或空气里", () => {
    const fx = mkFx({ blush: 1 });
    const face = girlFaceBox(fx.body, fx.frame);
    const ops = buildGirlFxOps(fx).above.filter((o) => o.layer === "blush");
    expect(ops).toHaveLength(4);
    for (const op of ops) {
      if (op.kind !== "fillEllipse") throw new Error("腮红应为椭圆");
      expect(op.cx).toBeGreaterThan(face.left);
      expect(op.cx).toBeLessThan(face.right);
      expect(op.cy).toBeGreaterThan(face.top);
      expect(op.cy).toBeLessThan(face.bottom);
      expect(op.rx).toBeLessThan(face.w * 0.35);
    }
    expect(buildGirlFxOps(mkFx({ blush: 0 })).above.some((o) => o.layer === "blush")).toBe(false);
    expect(buildGirlFxOps(mkFx({ blush: 1, mood: "sleep" })).above.some((o) => o.layer === "blush")).toBe(false);
  });

  it("「!」是双色的、在头顶上方、有寿命", () => {
    const fx = mkFx({ noticeAgeMs: 400 });
    const ops = buildGirlFxOps(fx).above.filter((o) => o.layer === "stars");
    expect(ops.length).toBeGreaterThan(0);
    const face = girlFaceBox(fx.body, fx.frame);
    for (const op of ops) {
      const y = op.kind === "fillEllipse" ? op.cy : op.kind === "fillRoundRect" ? op.y : null;
      if (y !== null) expect(y).toBeLessThan(face.top + 1);
    }
    const colors = ops.map((o) => (o.kind === "fillEllipse" ? o.fill : o.kind === "fillRoundRect" ? o.fill : ""));
    expect(colors[0]).toMatch(/^rgba\(247, 244, 236/); // 奶油光边先画
    expect(colors.some((c) => c.includes("91, 141, 239"))).toBe(true); // 强调色内芯

    expect(buildGirlFxOps(mkFx({ noticeAgeMs: -1 })).above.some((o) => o.layer === "stars")).toBe(false);
    expect(buildGirlFxOps(mkFx({ noticeAgeMs: NOTICE_FX_MS + 1 })).above.some((o) => o.layer === "stars")).toBe(false);
    // 眩晕时「!」让位：两个记号叠在同一个位置会糊成一团。
    expect(buildGirlFxOps(mkFx({ noticeAgeMs: 400, dizzyLeft: 1 })).above.some((o) => o.layer === "stars")).toBe(true);
  });

  it("连点晕圈：三颗双色星绕头顶，结束即消失", () => {
    const fx = mkFx({ dizzyLeft: 1, nowSec: 0.3 });
    const ops = buildGirlFxOps(fx).above.filter((o) => o.layer === "stars");
    expect(ops).toHaveLength(12);
    const face = girlFaceBox(fx.body, fx.frame);
    const centers = ops.filter((o) => o.kind === "strokePath" && o.width === 1.3);
    expect(centers.length).toBe(6);
    for (const op of ops) {
      if (op.kind !== "strokePath") continue;
      const xs = op.points.map((p) => p[0]);
      const ys = op.points.map((p) => p[1]);
      expect(Math.min(...ys)).toBeLessThan(face.cy);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(face.w);
    }
    expect(buildGirlFxOps(mkFx({ dizzyLeft: 0 })).above.some((o) => o.layer === "stars")).toBe(false);
  });

  it("开心音符只在开心档出现，免打扰时不吵", () => {
    const happy = buildGirlFxOps(mkFx({ notes: true })).above.filter((o) => o.layer === "stars");
    expect(happy.length).toBeGreaterThan(0);
    expect(buildGirlFxOps(mkFx({ notes: false })).above.some((o) => o.layer === "stars")).toBe(false);
    expect(buildGirlFxOps(mkFx({ notes: true, quiet: true })).above.some((o) => o.layer === "stars")).toBe(false);
  });

  it("生气蒸汽只属于 grumpy，且是双色", () => {
    const ops = buildGirlFxOps(mkFx({ mood: "grumpy" })).above.filter((o) => o.layer === "stars");
    expect(ops.length).toBeGreaterThan(0);
    const colors = ops.map((o) => (o.kind === "fillEllipse" ? o.fill : ""));
    expect(colors.some((c) => c.includes("247, 244, 236"))).toBe(true);
    expect(colors.some((c) => c.includes("217, 119, 87"))).toBe(true);
    expect(buildGirlFxOps(mkFx({ mood: "idle" })).above.some((o) => o.layer === "stars")).toBe(false);
  });

  it("落地与走路在脚边扬尘：两档桌布都看得见（亮底 + 灰芯）", () => {
    const landing = buildGirlFxOps(mkFx({ squash: 0.8 })).above.filter((o) => o.layer === "stars");
    expect(landing.length).toBeGreaterThanOrEqual(6);
    const colors = landing.map((o) => (o.kind === "fillEllipse" ? o.fill : ""));
    expect(colors.some((c) => c.includes("247, 244, 236"))).toBe(true);
    expect(colors.some((c) => c.includes("74, 81, 98"))).toBe(true);
    for (const op of landing) {
      // 扬尘贴着脚线（上下 3px 内），不是飘到人身上。
      if (op.kind === "fillEllipse") expect(Math.abs(op.cy - 88)).toBeLessThanOrEqual(3);
    }

    const walking = buildGirlFxOps(mkFx({ activity: "walk", step: Math.PI / 2 })).above;
    expect(walking.some((o) => o.layer === "stars")).toBe(true);
    expect(buildGirlFxOps(mkFx({ activity: "idle", step: Math.PI / 2 })).above.some((o) => o.layer === "stars")).toBe(false);
  });
});

describe("猫娘 II 的新记号", () => {
  it("坐垫画在人物之前、压在投影下面；收起时一个像素都不留", () => {
    const ops = buildGirlFxOps(mkFx({ cushion: 1 })).below;
    const cushion = ops.filter((o) => o.layer === "stars");
    expect(cushion.length).toBeGreaterThanOrEqual(6);
    // 坐垫先铺，地面投影后压：影子必须在坐垫之上，否则她像悬在垫子上。
    expect(ops[0].layer).toBe("stars");
    expect(ops.findIndex((o) => o.layer === "ground_shadow")).toBeGreaterThan(cushion.length - 1);
    for (const op of cushion) {
      if (op.kind !== "fillEllipse") continue;
      expect(op.cy).toBeGreaterThanOrEqual(87);
      expect(op.cy).toBeLessThanOrEqual(93);
      expect(op.rx).toBeLessThanOrEqual(40);
    }
    expect(buildGirlFxOps(mkFx({ cushion: 0 })).below.some((o) => o.layer === "stars")).toBe(false);
  });

  it("升档爆发有时限、双色，且只出现在升档窗口里", () => {
    const fx = mkFx({ bondUpLeft: BOND_UP_MS * 0.8 });
    const ops = buildGirlFxOps(fx).above.filter((o) => o.layer === "stars");
    expect(ops.length).toBeGreaterThanOrEqual(6);
    const colors = ops.map((o) => (o.kind === "fillEllipse" || o.kind === "fillPath" || o.kind === "strokeEllipse" ? (o.kind === "strokeEllipse" ? o.stroke : o.fill) : ""));
    expect(colors.some((c) => c.includes("247, 244, 236"))).toBe(true);
    expect(colors.some((c) => c.includes("221, 106, 127"))).toBe(true);
    expect(buildGirlFxOps(mkFx({ bondUpLeft: 0 })).above.some((o) => o.layer === "stars")).toBe(false);
  });

  it("摸头连击按次数长爱心并写 xN；受惊/睡着时不叠", () => {
    const two = buildGirlFxOps(mkFx({ patCombo: 2 })).above.filter((o) => o.layer === "stars");
    const four = buildGirlFxOps(mkFx({ patCombo: 4 })).above.filter((o) => o.layer === "stars");
    expect(four.length).toBeGreaterThan(two.length);
    const labels = four.filter((o) => o.kind === "text").map((o) => (o.kind === "text" ? o.text : ""));
    expect(labels).toContain("x4");
    // 「xN」是双色的：奶油底字先画、强调色再压。
    expect(labels).toHaveLength(2);
    expect(buildGirlFxOps(mkFx({ patCombo: 1 })).above.some((o) => o.layer === "stars")).toBe(false);
    expect(buildGirlFxOps(mkFx({ patCombo: 4, startleLeft: STARTLE_MS })).above.some((o) => o.kind === "text")).toBe(false);
    expect(buildGirlFxOps(mkFx({ patCombo: 4, mood: "sleep" })).above.some((o) => o.kind === "text")).toBe(false);
  });

  it("惊醒：更大的「!」+ 惊跳线 + 冷汗，寿命结束即清空", () => {
    const ops = buildGirlFxOps(mkFx({ startleLeft: STARTLE_MS * 0.5 })).above.filter((o) => o.layer === "stars");
    expect(ops.length).toBeGreaterThanOrEqual(8);
    const strokes = ops.filter((o) => o.kind === "strokePath");
    expect(strokes.length).toBeGreaterThanOrEqual(4);
    const colors = ops.map((o) => (o.kind === "fillEllipse" ? o.fill : o.kind === "strokePath" ? o.stroke : ""));
    expect(colors.some((c) => c.includes("91, 141, 239"))).toBe(true);
    expect(buildGirlFxOps(mkFx({ startleLeft: 0 })).above.some((o) => o.layer === "stars")).toBe(false);
    // 受惊期间「注意到你」的「!」让位给更大的这支：同一位置不许叠两支。
    const both = buildGirlFxOps(mkFx({ startleLeft: STARTLE_MS * 0.5, noticeAgeMs: 300 })).above.filter((o) => o.layer === "stars");
    expect(both.length).toBe(ops.length);
  });
});

describe("睡毯与纪念日彩带", () => {
  it("睡毯只在她真的睡着、且不在免打扰时铺开；醒来就收", () => {
    const asleep = buildGirlFxOps(mkFx({ mood: "sleep" })).above;
    expect(asleep.length).toBeGreaterThan(0);
    const first = asleep[0];
    const fill = first.kind === "fillEllipse" ? first.fill : first.kind === "fillPath" || first.kind === "fillRoundRect" ? first.fill : "";
    expect(fill).toMatch(/^rgba\(247, 244, 236/); // 奶油光边打底
    expect(buildGirlFxOps(mkFx({ mood: "idle" })).above).toHaveLength(0);
    // 免打扰时她是「安静」不是「睡着」：不铺毯子（native #67 同一规矩）。
    expect(buildGirlFxOps(mkFx({ mood: "sleep", quiet: true })).above).toHaveLength(0);

    const ink = girlInkBox(girlAnimBodyFor(mkCat()), 0);
    const bounds = buildGirlFxOps(mkFx({ mood: "sleep" })).above;
    for (const op of bounds) {
      const y = op.kind === "fillEllipse" ? op.cy : op.kind === "fillRoundRect" ? op.y + op.h / 2 : op.kind === "fillPath" ? op.points[0][1] : null;
      if (y !== null) {
        expect(y).toBeGreaterThan(ink.top);
        expect(y).toBeLessThan(ink.bottom + 3);
      }
    }
  });

  it("纪念日彩带有时限、双色，并绕着头部飘落", () => {
    const fx = mkFx({ milestoneLeft: 3_000, milestoneDays: 7 });
    const ops = buildGirlFxOps(fx).above.filter((o) => o.layer === "stars");
    expect(ops.length).toBeGreaterThanOrEqual(8);
    const colors = ops.map((o) => (o.kind === "fillEllipse" || o.kind === "fillPath" ? o.fill : ""));
    expect(colors.some((c) => c.includes("247, 244, 236"))).toBe(true);
    expect(colors.some((c) => c.includes("221, 106, 127") || c.includes("91, 141, 239"))).toBe(true);
    expect(buildGirlFxOps(mkFx({ milestoneLeft: 0, milestoneDays: 7 })).above).toHaveLength(0);
  });
});

describe("姿态图的脸框/墨框覆盖", () => {
  const movedBox = (b: GirlFaceBox, dx: number, dy: number): GirlFaceBox => ({
    ...b,
    cx: b.cx + dx,
    cy: b.cy + dy,
    left: b.left + dx,
    right: b.right + dx,
    top: b.top + dy,
    bottom: b.bottom + dy,
  });

  it("给了姿态脸框就用它：腮红与「!」跟着新脸走，不再按帧号猜", () => {
    const body = girlAnimBodyFor(mkCat());
    const real = girlFaceBox(body, 0);
    const face = movedBox(real, 40, 30);

    const blushCx = (input: GirlFxInput) => {
      const blush = buildGirlFxOps(input).above.filter((o) => o.layer === "blush");
      const xs = blush.map((o) => (o.kind === "fillEllipse" ? o.cx : Number.NaN));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(blushCx(mkFx({ body, blush: 1, face })) - blushCx(mkFx({ body, blush: 1 }))).toBeGreaterThan(35);

    const starMinY = (input: GirlFxInput) => Math.min(
      ...buildGirlFxOps(input).above
        .filter((o) => o.layer === "stars")
        .map((o) => (o.kind === "fillRoundRect" ? o.y : o.kind === "fillEllipse" ? o.cy : Number.POSITIVE_INFINITY)),
    );
    const shifted = starMinY(mkFx({ body, noticeAgeMs: 400, face })) - starMinY(mkFx({ body, noticeAgeMs: 400 }));
    expect(shifted).toBeGreaterThan(20);
  });

  it("给了姿态墨框就用它：影子宽度跟着真姿态的实际占位", () => {
    const body = girlAnimBodyFor(mkCat());
    const real = girlInkBox(body, 0);
    const ink = { ...real, cx: real.cx + 10, w: 200 };
    const widest = (input: GirlFxInput) => Math.max(
      ...buildGirlFxOps(input).below
        .filter((o) => o.kind === "fillEllipse")
        .map((o) => (o.kind === "fillEllipse" ? o.rx : 0)),
    );
    expect(widest(mkFx({ body, ink }))).toBeGreaterThan(widest(mkFx({ body })) + 20);
  });
});

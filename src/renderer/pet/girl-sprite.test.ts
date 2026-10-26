import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOverlayOps, type CatInput } from "./art";
import { computeCatRect } from "../../shared/pet-geometry";
import { formGeometry, profileFor, type SizeTier } from "../../shared/pet-profile";
import {
  GIRL_INK_VB_HEIGHT,
  GIRL_OVERLAY_LIFT_VB,
  buildGirlOverlayOps,
  girlAnimBodyFor,
  girlBadgeMap,
  girlBodyFor,
  girlCellPoint,
  girlFaceBox,
  girlInkBox,
  girlOverlayCenter,
  girlSpriteRect,
} from "./girl-sprite";
import { GIRL_SPRITE } from "./girl-sprite-meta";
import { GIRL_ANIM } from "./girl-anim-meta";

const SIZE_TIERS: SizeTier[] = ["small", "standard", "large"];

function mk(overrides: Partial<CatInput> = {}): CatInput {
  return {
    center: { x: 100, y: 200 },
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
    ...overrides,
  };
}

const sFor = (u: number) => (u * 2) / 120;

function inside(outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }, slack = 1) {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack
    && inner.x + inner.w <= outer.x + outer.w + slack
    && inner.y + inner.h <= outer.y + outer.h + slack;
}

describe("猫娘立绘几何", () => {
  it("墨框以脚心对齐：底边 = center.y，左右按 anchorX 分", () => {
    const s = 0.6167;
    const c = { x: 41, y: 87.7 };
    const r = girlSpriteRect(c, s);
    expect(r.y + r.h).toBeCloseTo(c.y, 6);
    expect(c.x - r.x).toBeCloseTo(GIRL_SPRITE.anchorX * r.w, 6);
    expect(r.w / r.h).toBeCloseTo(GIRL_SPRITE.aspect, 6);
    expect(r.h).toBeCloseTo(GIRL_INK_VB_HEIGHT * s, 6);
  });

  it("三档的立绘墨框与头部 35% 都在命中框内", () => {
    for (const tier of SIZE_TIERS) {
      const prof = profileFor("girl", tier);
      const g = formGeometry("girl");
      const s = prof.catScale(0).s;
      const center = { x: 100, y: 200 + g.centerOffset.dy * s };
      const ink = girlSpriteRect(center, s);
      const pinInWin = { x: center.x - g.centerOffset.dx * s, y: center.y - g.centerOffset.dy * s };
      const r = computeCatRect({ pinInWin, e: 0, profile: prof });
      const hit = { x: r.x, y: r.y, w: r.width, h: r.height };
      expect(inside(hit, ink), `${tier}: 墨 ${JSON.stringify(ink)} / 框 ${JSON.stringify(hit)}`).toBe(true);
      const top = { ...ink, h: ink.h * 0.35 };
      expect(inside(hit, top), `${tier}: 头部超出命中框`).toBe(true);
    }
  });

  it("动作是绕脚心的刚体变换：待机 = 原样，落地压扁/睡觉倾斜/跳起都作用在支点上", () => {
    const idle = girlBodyFor(mk());
    expect(idle.pivot).toEqual({ x: 100, y: 200 });
    expect(idle.rot).toBeCloseTo(0, 6);
    expect(idle.sx).toBeCloseTo(1, 6);
    expect(idle.sy).toBeCloseTo(1, 6);
    expect(idle.w / idle.h).toBeCloseTo(GIRL_SPRITE.aspect, 6);

    const squash = girlBodyFor(mk({ pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0, squash: 1 } }));
    expect(squash.sy).toBeLessThan(0.9);
    expect(squash.sx).toBeGreaterThan(1.1);

    const sleep = girlBodyFor(mk({ mood: "sleep", t: 0 }));
    expect(sleep.rot).toBeGreaterThan(0.03);

    const jump = girlBodyFor(mk({ jumpY: -10 }));
    expect(jump.pivot.y).toBe(190);
  });

  it("朝向 −1 进变换，立绘与徽章一起翻身", () => {
    const left = girlBodyFor(mk({ facing: -1 }));
    expect(left.facing).toBe(-1);
    const right = girlBadgeMap(mk());
    const mirrored = girlBadgeMap(mk({ facing: -1 }));
    const [rx] = right.map([103, 28]);
    const [mx] = mirrored.map([103, 28]);
    expect(rx).toBeGreaterThan(100);
    expect(mx).toBeLessThan(100);
  });
});

describe("猫娘屏幕记号", () => {
  const top = (input: CatInput) => girlSpriteRect(input.center, sFor(input.u)).y;

  it("Zzz 落在头顶之上；免打扰时只有月牙、没有 Zzz", () => {
    const sleepy = buildGirlOverlayOps(mk({ mood: "sleep", t: 0 }));
    const zzz = sleepy.filter((o) => o.layer === "zzz");
    expect(zzz.length).toBeGreaterThan(0);
    for (const o of zzz) {
      expect(o.kind).toBe("text");
      if (o.kind === "text") expect(o.y).toBeLessThan(top(mk({ mood: "sleep" })));
    }

    const quiet = buildGirlOverlayOps(mk({ mood: "sleep", quiet: true, t: 0 }));
    expect(quiet.some((o) => o.layer === "zzz")).toBe(false);
    const crescent = quiet.filter((o) => o.layer === "quiet_mark");
    expect(crescent.length).toBe(2);
    for (const o of crescent) {
      if (o.kind === "crescent") expect(o.cy).toBeLessThan(top(mk({ quiet: true })));
    }
  });

  it("摸头爱心出现、徽章钉在头右侧；位置与四足的同一批记号口径一致", () => {
    const pet = buildGirlOverlayOps(mk({ pet: 1, t: 0 }));
    expect(pet.some((o) => o.layer === "heart")).toBe(true);
    for (const o of pet.filter((x) => x.layer === "heart")) {
      if (o.kind === "fillEllipse") expect(o.cy).toBeLessThan(top(mk({})));
    }

    const happy = buildGirlOverlayOps(mk({ mood: "happy", t: 0 }));
    const badge = happy.filter((o) => o.layer === "badge");
    expect(badge.length).toBeGreaterThan(0);
    const disc = badge.find((o) => o.kind === "fillEllipse")!;
    if (disc.kind === "fillEllipse") {
      expect(disc.cx).toBeGreaterThan(mk().center.x);
      expect(disc.cy).toBeLessThan(top(mk({})));
    }
  });

  it("记号钉位比四足高 GIRL_OVERLAY_LIFT_VB：脚底系与身子中心系的换算只有这一处", () => {
    const input = mk();
    const lifted = girlOverlayCenter(input);
    const s = sFor(input.u);
    expect(lifted.y).toBeCloseTo(input.center.y - GIRL_OVERLAY_LIFT_VB * s, 6);
    // 同一份输入，四足记号的月牙在身子中心上方 51.5s，猫娘的月牙必须还在头顶上方。
    const cat = buildOverlayOps({ ...input, quiet: true }, { map: (p) => p, scaleX: () => s, scaleY: () => s, k: () => s });
    const girl = buildGirlOverlayOps({ ...input, quiet: true });
    const catCrescent = cat.find((o) => o.layer === "quiet_mark")!;
    const girlCrescent = girl.find((o) => o.layer === "quiet_mark")!;
    if (catCrescent.kind === "crescent" && girlCrescent.kind === "crescent") {
      expect(girlCrescent.cy).toBeLessThan(catCrescent.cy);
    }
  });
});

describe("猫娘帧动画的位姿与落点", () => {
  const bodyAt = (over: Partial<CatInput> = {}, presence?: Parameters<typeof girlAnimBodyFor>[1]) =>
    girlAnimBodyFor(mk(over), presence);

  it("没有存在感时与旧刚体逐字相同；有存在感才加上倾斜/侧移/朝向", () => {
    const plain = bodyAt();
    expect(plain.pivot).toEqual({ x: 100, y: 200 });
    // 旧口径：走路摆动的 1° 是帧动画唯一的外加旋转。
    expect(plain.rot).toBeCloseTo(0, 6);

    const leaning = bodyAt({}, { leanDeg: 4.2, shiftX: 2.2, facing: -1 });
    expect(leaning.pivot.x).toBeCloseTo(102.2, 6);
    expect(leaning.rot).toBeCloseTo((4.2 * Math.PI) / 180, 6);
    expect(leaning.facing).toBe(-1);
  });

  it("连点眩晕只加抖动，不挪脚", () => {
    const calm = bodyAt({ t: 0.35 });
    const dizzy = bodyAt({ t: 0.35 }, { dizzy: 1 });
    expect(dizzy.pivot).toEqual(calm.pivot);
    expect(Math.abs(dizzy.rot - calm.rot)).toBeGreaterThan(0.005);
    expect(dizzy.sy).toBeLessThan(calm.sy);
  });

  it("格子锚点正好落在支点上（贴图与记号共用同一套变换）", () => {
    const body = bodyAt({}, { leanDeg: 3, shiftX: 1.5 });
    const anchor = girlCellPoint(body, GIRL_ANIM.anchorX, GIRL_ANIM.anchorY);
    expect(anchor.x).toBeCloseTo(body.pivot.x, 6);
    expect(anchor.y).toBeCloseTo(body.pivot.y, 6);
  });

  it("翻身时脸跟着挪到另一侧，且脸框永远在墨框里", () => {
    const right = bodyAt({ facing: 1 });
    const left = bodyAt({ facing: -1 });
    const frame = 72;
    const faceR = girlFaceBox(right, frame);
    const faceL = girlFaceBox(left, frame);
    const offR = faceR.cx - right.pivot.x;
    const offL = faceL.cx - left.pivot.x;
    expect(Math.abs(offR)).toBeGreaterThan(1);
    expect(Math.sign(offR)).toBe(-Math.sign(offL));

    for (let f = 0; f < GIRL_ANIM.count; f += 1) {
      for (const body of [right, left]) {
        const face = girlFaceBox(body, f);
        const ink = girlInkBox(body, f);
        expect(face.left, `frame ${f} 左缘`).toBeGreaterThanOrEqual(ink.left - 0.5);
        expect(face.right, `frame ${f} 右缘`).toBeLessThanOrEqual(ink.right + 0.5);
        expect(face.top, `frame ${f} 上缘`).toBeGreaterThanOrEqual(ink.top - 0.5);
        expect(face.bottom, `frame ${f} 下缘`).toBeLessThanOrEqual(ink.bottom + 0.5);
      }
    }
  });

  it("帧 0 的脸心落在角色上半身，而不是头顶之外的空气里", () => {
    const body = bodyAt();
    const face = girlFaceBox(body, 0);
    const ink = girlInkBox(body, 0);
    expect(face.cy).toBeGreaterThan(ink.top);
    expect(face.cy).toBeLessThan(ink.top + ink.h * 0.45);
    // 82px 宽的窗口里，站立帧的墨宽应占 35px 以上，不然桌宠太小。
    expect(ink.w).toBeGreaterThan(35);
  });

  it("趴伏（sprawl）绕脚心压扁：脚不动、头降下来、脸框跟着降", () => {
    const base = mk().pose;
    const up = bodyAt();
    const sit = bodyAt({ pose: { ...base, sprawl: 0.42 } });
    const lie = bodyAt({ pose: { ...base, sprawl: 0.92 } });
    expect(sit.pivot).toEqual(up.pivot);
    expect(lie.pivot.y).toBeCloseTo(up.pivot.y, 6);
    expect(sit.sy).toBeLessThan(up.sy);
    expect(lie.sy).toBeLessThan(sit.sy);
    expect(lie.sx).toBeGreaterThan(sit.sx);

    const upFace = girlFaceBox(up, 0);
    const sitFace = girlFaceBox(sit, 0);
    const lieFace = girlFaceBox(lie, 0);
    expect(sitFace.cy).toBeGreaterThan(upFace.cy);
    expect(lieFace.cy).toBeGreaterThan(sitFace.cy);
    // 压得再低也不能把脸压到脚线以下（窗底会切掉半张脸）。
    expect(lieFace.bottom).toBeLessThan(lie.pivot.y);
    // 墨框同理：趴下是「矮而宽」，不是整体缩小。
    const upInk = girlInkBox(up, 0);
    const lieInk = girlInkBox(lie, 0);
    expect(lieInk.h).toBeLessThan(upInk.h);
    expect(lieInk.w).toBeGreaterThan(upInk.w);
  });

  it("趴下时记号跟着降（Zzz/爱心不许飘在原来的头顶高度）", () => {
    const base = mk().pose;
    const up = girlOverlayCenter(mk());
    const lie = girlOverlayCenter({ ...mk(), pose: { ...base, sprawl: 0.92 } });
    expect(lie.x).toBe(up.x);
    expect(lie.y - up.y).toBeGreaterThan(5);
  });
});

describe("立绘资产", () => {
  const asset = (rel: string) => readFileSync(new URL(rel, import.meta.url));

  it("girl.webp 真在盘上且是 WebP；尺寸够降到桌宠大小仍清晰", () => {
    const girl = asset("../public/pet/girl.webp");
    expect(girl.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(girl.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // 512 高的立绘：压得太狠会在 56px 的桌宠上糊掉。
    expect(girl.byteLength).toBeGreaterThan(20_000);
  });

  it("Loading 窗用整身立绘，不许退回头部方裁", () => {
    const splash = asset("../public/splash.html").toString("utf8");
    expect(splash).toContain('src="./pet/girl.webp"');
    expect(splash).not.toMatch(/loading\.(webp|png)/);
  });

  it("生成元数据与资产对得上（aspect/anchorX 是几何唯一的来源）", () => {
    expect(GIRL_SPRITE.src).toBe("./pet/girl.webp");
    expect(GIRL_SPRITE.aspect).toBeGreaterThan(0.55);
    expect(GIRL_SPRITE.aspect).toBeLessThan(0.7);
    expect(GIRL_SPRITE.anchorX).toBeGreaterThan(0.35);
    expect(GIRL_SPRITE.anchorX).toBeLessThan(0.6);
    // 墨高必须小于命中框高（1.71u = 102.6vb），否则一呼吸就顶出框。
    expect(GIRL_INK_VB_HEIGHT).toBeLessThan(1.71 * 60);
  });
});

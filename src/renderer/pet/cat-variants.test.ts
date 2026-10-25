import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds } from "./ops";
import { CAT_COATS } from "../../shared/cat-coats";
import { decodePng } from "../../shared/png-encode";
import { renderOps, type Raster } from "../../shared/sprite-raster";
import { pixelDiffRatio } from "../../shared/min-pixel-diff";
import { GIRL_MASTER, GIRL_STILLS, GIRL_STILL_FRAMES } from "./girl-stills-meta";
import { GIRL_HIRES, GIRL_POSE_CELLS, GIRL_POSE_FROM_HIRES } from "./girl-poses-meta";
import { CAT_CROPS, CAT_POSES, SPRITE_DROPPED_LAYERS, buildSpriteOps, placeCrop, type CropName, type PoseName, type SpriteSpec, GIRL_CROPS, GIRL_POSES, cropsForForm } from "./cat-variants";

/** 与 `cat-sprite-manifest.test.ts` 同一条解码通路：静帧表 + 参考图母版 + 高清姿态表。 */
const IMAGES = {
  [GIRL_STILLS.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-stills.png", import.meta.url))),
  [GIRL_MASTER.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-master.png", import.meta.url))),
  [GIRL_HIRES.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-poses.png", import.meta.url))),
};

function inkBox(r: Raster) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      if (r.rgba[(y * r.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x0 === Infinity) throw new Error("渲染结果全透明");
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const POSES: PoseName[] = ["sit", "lie", "prone", "peek", "stretch", "wash", "yawn", "tilt",
  "sleep", "puff", "pout", "happy", "run"];
const CROPS: CropName[] = ["full", "bust", "square", "round", "wide"];

/** CatInput 的中性档；Task 24 的生成器也拿它当基准。 */
const NEUTRAL: CatInput = {
  center: { x: 128, y: 128 }, u: 120, mood: "idle", t: 0, energy: 0.3,
  mouse: null, blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};

describe("姿态与取景轴", () => {
  it("13 姿态 4 取景 5 花色，名字与 spec §3-D D1 逐一对得上（run 为 v1.6.1 新增）", () => {
    expect(Object.keys(CAT_POSES).sort()).toEqual([...POSES].sort());
    expect(Object.keys(CAT_CROPS).sort()).toEqual([...CROPS].sort());
    expect(Object.keys(CAT_COATS).length).toBe(5);
  });

  it("每个姿态都是纯函数：连调两次逐字段相等（R-D9 的 t=0 静帧）", () => {
    for (const p of POSES) {
      expect(CAT_POSES[p](), p).toEqual(CAT_POSES[p]());
      expect(CAT_POSES[p]().t ?? 0, p).toBe(0);
    }
  });

  it("13 姿态画出来是 13 张不同的图：几何签名两两不等", () => {
    // 判据用「整串 op 相等」而不是 plan 里的「op 数取值 ≥9」：多数姿态改的是同一批图元的
    // 坐标/形变（op 数不动），实测只有 5 种取值；几何签名严格更强——连一个 0.001 的差异都分得出。
    const seen = new Set<string>();
    for (const p of POSES) {
      const ops = buildSpriteOps({ coat: "ink", pose: p, crop: "full" }, { w: 256, h: 256 });
      const b = opsBounds(ops)!;
      expect(ops.length, p).toBeGreaterThan(20);
      expect(b.width * b.height, p).toBeGreaterThan(8000);
      seen.add(JSON.stringify(ops));
    }
    expect(seen.size, "有姿态画出来一模一样＝姿态没差别").toBe(POSES.length);
  });

  it("取景算式：越紧的框，映射比例 s 越大；full 把尾巴装进来后身体轴左移", () => {
    const size = { w: 512, h: 512 };
    const s = CROPS.map((c) => placeCrop(CAT_CROPS[c], size).u);
    expect(s[1]).toBeGreaterThan(s[0]);   // bust 比 full 紧
    expect(s[2]).toBeGreaterThan(s[1]);   // square 更紧
    // Task 24 实测：墨迹横跨 x 16.5..137.5，尾巴把包围盒中点推到 77，于是 `full` 的锚点从身体轴 60
    // 挪到 77 —— 否则 240px 的欢迎页上尾巴在右缘被平切。旧断言「center 距画布中心 <40px」是
    // 尾巴被切掉时才成立的构图；现在身体轴按设计左移半个尾宽（实测 65.6px @512），仍要落在带内。
    const dx = 256 - placeCrop(CAT_CROPS.full, size).center.x;
    expect(dx).toBeGreaterThan(40);
    expect(dx).toBeLessThan(90);
  });

  it("wide 档确实是 16:9，且横向不夹回 viewBox（欢迎海报唯一非方图，R-D1）", () => {
    const w = CAT_CROPS.wide.window;
    expect((w[2] - w[0]) / (w[3] - w[1])).toBeCloseTo(16 / 9, 2);
    expect(w[0]).toBeLessThan(0);   // 越界是透明边；被夹回 0 就成了 4:3
    const p = placeCrop(CAT_CROPS.wide, { w: 1280, h: 720 });
    expect(Math.abs(p.center.x - 640)).toBeLessThan(40);
  });

  it("位图管线里没有 text 图元（R-D10），且正对照证明过滤器不是空转", () => {
    for (const p of POSES) {
      for (const o of buildSpriteOps({ coat: "ink", pose: p, crop: "square" }, { w: 256, h: 256 })) {
        expect(o.kind).not.toBe("text");
      }
    }
    const input = { ...NEUTRAL, mood: "sleep" as const };
    const raw = buildCatOps(input);
    expect(raw.some((o) => o.kind === "text"), "raw 里没有 Z，正对照失效").toBe(true);
    const viaSprite = buildSpriteOps({ coat: "ink", pose: "sleep", crop: "full" }, { w: 256, h: 256 });
    expect(viaSprite.some((o) => o.layer === "zzz")).toBe(false);
    // `badge` 是 Task 24 全表实测后补进名单的：同一枚徽章在五个取景里落成四种下场
    // （全身刚好装下 / 半身切一半 / 方图整个出画 / 圆图在盘沿刮出月牙），静帧情绪图不要它。
    expect(SPRITE_DROPPED_LAYERS).toEqual(["zzz", "capsule", "unread", "badge"]);
    expect(viaSprite.some((o) => o.layer === "badge")).toBe(false);
    // 正对照：badge 在原始图层里确实存在（`happy` 必画绿勾），过滤器不是空转。
    expect(buildCatOps({ ...NEUTRAL, mood: "happy" }).some((o) => o.layer === "badge")).toBe(true);
  });

  it("不带 coat、不带两轴时逐 op 与默认花色等价（运行时那只猫逐像素不变）", () => {
    const a = buildCatOps(NEUTRAL);
    const b = buildCatOps({ ...NEUTRAL, coat: CAT_COATS.ink, pose: { ...NEUTRAL.pose, sprawl: 0, puff: 0 } });
    expect(b).toEqual(a);
    // 正对照：加了 sprawl 就必须不等
    const c = buildCatOps({ ...NEUTRAL, pose: { ...NEUTRAL.pose, sprawl: 0.6 } });
    expect(c).not.toEqual(a);
  });
});

// ===========================================================================
// Task 24：资产管线的 form 轴
// ===========================================================================
describe("girl 资产轴 (Task 24)", () => {
  const GIRL_SPEC = (pose: PoseName): SpriteSpec => ({ coat: "ink", pose, crop: "full", form: "girl" });
  const renderGirl = (spec: SpriteSpec, size: { w: number; h: number }) => {
    const ops = buildSpriteOps(spec, size);
    const mask = GIRL_CROPS[spec.crop].mask === "disc" ? "disc" : "none";
    return { ops, raster: renderOps(ops, size.w, size.h, { mask, images: IMAGES }) };
  };

  it("GIRL_POSES 恰好覆盖 12 个 PoseName（与 CAT_POSES 同一个联合）", () => {
    expect(Object.keys(GIRL_POSES).sort()).toEqual(Object.keys(CAT_POSES).sort());
  });

  it("12 个 girl 姿态各贴一张相异静帧，渲染出来也两两可分辨", () => {
    const poses = Object.keys(GIRL_POSES) as PoseName[];
    const cells = new Set<string>();
    const rasters: Raster[] = [];
    for (const pose of poses) {
      const { ops, raster } = renderGirl(GIRL_SPEC(pose), { w: 256, h: 256 });
      expect(ops, pose).toHaveLength(1);
      const op = ops[0];
      expect(op.kind, pose).toBe("image");
      if (op.kind !== "image") throw new Error("unreachable");
      // 姿态优先取高清参考图集，没覆盖的仍取 30 格静帧表——两边都要按实际图集验。
      const hires = GIRL_POSE_FROM_HIRES[pose];
      const atlas = hires ? GIRL_HIRES : GIRL_STILLS;
      const cell = hires ? GIRL_POSE_CELLS[hires] : GIRL_STILL_FRAMES.pose[pose];
      expect(op.src, pose).toBe(atlas.src);
      // 源矩形必须落在**本格**里：越到邻格就会把隔壁动作的裙摆/发梢带进来。
      const cellX = (cell % atlas.cols) * atlas.cellW;
      const cellY = Math.floor(cell / atlas.cols) * atlas.cellH;
      expect(op.sx, pose).toBeGreaterThanOrEqual(cellX);
      expect(op.sy, pose).toBeGreaterThanOrEqual(cellY);
      expect(op.sx + op.sw, pose).toBeLessThanOrEqual(cellX + atlas.cellW);
      expect(op.sy + op.sh, pose).toBeLessThanOrEqual(cellY + atlas.cellH);
      cells.add(`${atlas.src}#${cell}`);
      rasters.push(raster);
    }
    expect(cells.size, "有两个人形立绘其实是同一格").toBe(poses.length);
    // 判据是像素：48.4% 是实测最小的一对（prone ↔ peek），门槛只要证明「不是同一张」。
    for (let i = 0; i < rasters.length; i += 1) {
      for (let j = i + 1; j < rasters.length; j += 1) {
        expect(pixelDiffRatio(rasters[i], rasters[j]), `${poses[i]} ↔ ${poses[j]}`).toBeGreaterThan(0.02);
      }
    }
  });

  it("25 档情绪各贴一张相异静帧，且与 12 姿态合起来刚好 30 格（没有回落成 sit）", () => {
    const moods = Object.values(GIRL_STILL_FRAMES.mood);
    const gesture = Object.values(GIRL_STILL_FRAMES.pose);
    expect(moods).toHaveLength(25);
    expect(new Set(moods).size, "两档情绪指向同一格").toBe(25);
    expect(new Set([...moods, ...gesture]).size, "静帧表应刚好 30 格").toBe(30);
    const rasters = Object.keys(GIRL_STILL_FRAMES.mood).map((mood) =>
      renderGirl({ coat: "ink", pose: "sit", crop: "square", form: "girl", frame: { mood: mood as never } }, { w: 256, h: 256 }).raster);
    // 实测最小 43.0%（平静 ↔ 陪伴中）；门槛只抓「退回同一张」。
    for (let i = 0; i < rasters.length; i += 1) {
      for (let j = i + 1; j < rasters.length; j += 1) {
        expect(pixelDiffRatio(rasters[i], rasters[j]), `${i} ↔ ${j}`).toBeGreaterThan(0.02);
      }
    }
  });

  it("语义重写三处硬钉换成新的帧表口径：趴/炸毛各归其位，卧≠睡", () => {
    expect(GIRL_POSES.prone).toEqual({ pose: "prone" });
    expect(GIRL_POSES.puff).toEqual({ pose: "puff" });
    expect(GIRL_STILL_FRAMES.pose.prone).not.toBe(GIRL_STILL_FRAMES.pose.sit);
    expect(GIRL_STILL_FRAMES.pose.puff).not.toBe(GIRL_STILL_FRAMES.pose.happy);
    expect(GIRL_POSES.lie).not.toEqual(GIRL_POSES.sleep);
    expect(GIRL_STILL_FRAMES.pose.lie).not.toBe(GIRL_STILL_FRAMES.pose.sleep);
  });

  it("R-D10 两形态同锁：girl 位图无 text 层、无 SPRITE_DROPPED_LAYERS 成员", () => {
    const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
    for (const pose of Object.keys(GIRL_POSES) as PoseName[]) {
      for (const op of buildSpriteOps(GIRL_SPEC(pose), { w: 256, h: 256 })) {
        expect(op.kind, `${pose} 出了文本图元`).not.toBe("text");
        if (op.layer) expect(dropped.has(op.layer), `${pose} 画了 ${op.layer}`).toBe(false);
      }
    }
  });

  it("form 缺省＝cat 且 cat 路径逐 op 不变（R-D2 正对照）", () => {
    const base: SpriteSpec = { coat: "ink", pose: "sit", crop: "square" };
    expect(buildSpriteOps({ ...base, form: "cat" }, { w: 256, h: 256 }))
      .toEqual(buildSpriteOps(base, { w: 256, h: 256 }));
  });

  it("cropsForForm 两表分列：cat 拿到 CAT_CROPS 本体", () => {
    expect(cropsForForm("cat")).toBe(CAT_CROPS);
    expect(cropsForForm("girl")).toBe(GIRL_CROPS);
  });

  it("girl 五档取景：发顶永远在框内，非圆图不压边，full/横幅不裁脚", () => {
    // Task 25 起猫娘是位图，`opsBounds` 只报取景窗口（整块矩形），量不到墨在哪。
    // 判据改成**栅格化后的 alpha 包围盒**：发顶不许贴 0，左右留白，full 与横幅四边都在画布内。
    for (const crop of ["full", "bust", "square", "round"] as const) {
      const size = { w: 256, h: 256 };
      for (const pose of Object.keys(GIRL_POSES) as PoseName[]) {
        const { raster } = renderGirl({ coat: "paper", pose, crop, form: "girl" }, size);
        const b = inkBox(raster);
        const where = `${crop}/${pose}`;
        expect(b.y0, `${where}: 发顶被切`).toBeGreaterThan(0);
        if (crop !== "round") {
          expect(b.x0, `${where}: 压到左边`).toBeGreaterThan(0);
          expect(b.x1, `${where}: 压到右边`).toBeLessThan(size.w - 1);
        }
        if (crop === "full") {
          expect(b.y1, `${where}: 全身档不许裁脚`).toBeLessThan(size.h);
          expect(b.y0, `${where}: 全身档留白太少`).toBeGreaterThan(4);
        }
      }
    }
    // 半身/圆图的语义是「下沿被裁」：用站姿那格验（`lie` 这类横躺的帧本来就矮，
    // 要求它们顶到下沿等于逼画面出框）。
    for (const crop of ["bust", "round"] as const) {
      const b = inkBox(renderGirl({ coat: "paper", pose: "sit", crop, form: "girl" }, { w: 256, h: 256 }).raster);
      expect(b.y1, `${crop}/sit: 下沿没被裁（取景没起作用）`).toBeGreaterThan(256 - 12);
    }
    // wide 只服务横幅，而横幅用参考图母版（frame: "master"），所以拿母版量。
    const banner = inkBox(renderGirl({ coat: "paper", pose: "happy", crop: "wide", form: "girl", frame: "master" }, { w: 1280, h: 720 }).raster);
    expect(banner.x0).toBeGreaterThan(12);
    expect(banner.x1).toBeLessThan(1280 - 12);
    expect(banner.y0).toBeGreaterThan(12);
    expect(banner.y1).toBeLessThan(720 - 12);
    expect(banner.h).toBeGreaterThan(720 * 0.6);
  });

  it("正对照：把 full 往上推 60px 会判「发顶被切」（alpha 尺真的在量，不是恒真）", () => {
    const size = { w: 256, h: 256 };
    const { ops } = renderGirl(GIRL_SPEC("sit"), size);
    const shifted = ops.map((op) => (op.kind === "image" ? { ...op, y: op.y - 60 } : op));
    const b = inkBox(renderOps(shifted, size.w, size.h, { mask: "none", images: IMAGES }));
    expect(b.y0).toBeLessThan(1);
  });
});

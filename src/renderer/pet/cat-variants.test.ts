import { describe, expect, it } from "vitest";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds } from "./ops";
import { CAT_COATS } from "../../shared/cat-coats";
import { CAT_CROPS, CAT_POSES, SPRITE_DROPPED_LAYERS, buildSpriteOps, placeCrop, type CropName, type PoseName, GIRL_CROPS, GIRL_POSES, cropsForForm } from "./cat-variants";

const POSES: PoseName[] = ["sit", "lie", "prone", "peek", "stretch", "wash", "yawn", "tilt",
  "sleep", "puff", "pout", "happy"];
const CROPS: CropName[] = ["full", "bust", "square", "round", "wide"];

/** CatInput 的中性档；Task 24 的生成器也拿它当基准。 */
const NEUTRAL: CatInput = {
  center: { x: 128, y: 128 }, u: 120, mood: "idle", t: 0, energy: 0.3,
  mouse: null, blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};

describe("姿态与取景轴", () => {
  it("12 姿态 4 取景 5 花色，名字与 spec §3-D D1 逐一对得上", () => {
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

  it("12 姿态画出来是 12 张不同的图：几何签名两两不等", () => {
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
  const hash = (ops: unknown) => JSON.stringify(ops);

  it("GIRL_POSES 恰好覆盖 12 个 PoseName（与 CAT_POSES 同一个联合）", () => {
    expect(Object.keys(GIRL_POSES).sort()).toEqual(Object.keys(CAT_POSES).sort());
  });

  it("12 个 girl 姿态两两 ops 互异（spec §10 对 12 姿态哈希锁的重钉对象）", () => {
    const hashes = (Object.keys(GIRL_POSES) as PoseName[]).map((pose) => hash(buildSpriteOps(GIRL_SPEC(pose), { w: 256, h: 256 })));
    expect(new Set(hashes).size, "有两个人形立绘其实是同一张").toBe(12);
  });

  it("语义重写三处硬钉：趴→伏案、炸毛→生气、卧≠睡", () => {
    expect(GIRL_POSES.prone().gesture, "趴→伏案：typeCode 的持片").toBe("typeCode");
    expect(GIRL_POSES.puff().gesture, "炸毛→发蓬（shiver 的抖）").toBe("shiver");
    expect(GIRL_POSES.lie().blink).not.toBe(GIRL_POSES.sleep().blink);
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

  it("girl 五档取景都装得下（暂行 GIRL_CROPS 的最低门槛）", () => {
    for (const crop of ["full", "bust", "square", "round", "wide"] as const) {
      const size = crop === "wide" ? { w: 1280, h: 720 } : { w: 256, h: 256 };
      const b = opsBounds(buildSpriteOps({ coat: "paper", pose: "sit", crop, form: "girl" }, size))!;
      expect(b.x, crop).toBeGreaterThanOrEqual(-0.5);
      expect(b.y, crop).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width, crop).toBeLessThanOrEqual(size.w + 0.5);
      expect(b.y + b.height, crop).toBeLessThanOrEqual(size.h + 0.5);
    }
  });
});

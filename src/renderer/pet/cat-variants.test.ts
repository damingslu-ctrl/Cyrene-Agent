import { describe, expect, it } from "vitest";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds } from "./ops";
import { CAT_COATS } from "../../shared/cat-coats";
import {
  CAT_CROPS, CAT_POSES, SPRITE_DROPPED_LAYERS, buildSpriteOps, placeCrop, type CropName, type PoseName,
} from "./cat-variants";

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

  it("取景算式：越紧的框，映射比例 s 越大，且猫心落在画布中心", () => {
    const size = { w: 512, h: 512 };
    const s = CROPS.map((c) => placeCrop(CAT_CROPS[c], size).u);
    expect(s[1]).toBeGreaterThan(s[0]);   // bust 比 full 紧
    expect(s[2]).toBeGreaterThan(s[1]);   // square 更紧
    expect(Math.abs(placeCrop(CAT_CROPS.full, size).center.x - 256)).toBeLessThan(40);
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
    expect(SPRITE_DROPPED_LAYERS).toEqual(["zzz", "capsule", "unread"]);
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

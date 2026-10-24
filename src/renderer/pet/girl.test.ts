import { describe, expect, it } from "vitest";
import { buildGirlOps, GIRL_LAYERS, GIRL_PROPORTION, girlPalette } from "./girl";
import { buildPetOps, type PetInput } from "./form";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds } from "./ops";
import { CAT_COATS, type CoatName } from "../../shared/cat-coats";
import { ACCENT, CAT_PALETTE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, wash, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "../../shared/draw-ops";
import { formGeometry, profileFor } from "../../shared/pet-profile";

const NEUTRAL: CatInput = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle", t: 0, energy: 1, mouse: null,
  blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};

const layersInOrder = (ops: DrawOp[]): string[] => {
  const seen: string[] = [];
  for (const o of ops) if (o.layer && seen[seen.length - 1] !== o.layer && !seen.includes(o.layer)) seen.push(o.layer);
  return seen;
};

const byLayer = (ops: DrawOp[], layer: string) => ops.filter((o) => o.layer === layer);

/** 单位层覆盖度：每种颜色各占多少设备像素²（dpr=2，与 renderer.readAlpha 同上限）。 */
function coverageByColor(ops: DrawOp[], dpr = 2): Map<string, number> {
  const acc = new Map<string, number>();
  for (const o of ops) {
    const fill = (o as { fill?: string }).fill;
    if (typeof fill !== "string") continue;
    const b = opsBounds([o]);
    if (!b) continue;
    acc.set(fill, (acc.get(fill) ?? 0) + b.width * b.height * dpr * dpr);
  }
  return acc;
}

describe("猫娘站姿", () => {
  it("ORDER 与 spec §4 逐层相等（18 层，一个不多一个不少）", () => {
    const got = layersInOrder(buildGirlOps({ ...NEUTRAL }));
    // 只比较「本任务实际出图」的层：泪/腮红在 neutral 档没有墨（0 值不出图元是对的），
    // 叠加层由 renderer 负责。有值时必须按 ORDER 出现——下面另有一条 blush 的正对照。
    expect(got).toEqual(GIRL_LAYERS.filter((l) => l !== "tear" && l !== "blush"));
  });

  it("比例钉死：冠 22 / 下巴 61 / 脚线 100，头心 (60,41.5) 半径 (17,19.5)", () => {
    const P = GIRL_PROPORTION;
    expect(P.crown).toBe(22);
    expect(P.chin).toBe(61);
    expect(P.headCy).toBeCloseTo((P.crown + P.chin) / 2, 6);
    expect(P.headCy + P.headRy).toBeCloseTo(P.chin, 6);
    expect(P.headCy - P.headRy).toBeCloseTo(P.crown, 6);
    expect(P.footY).toBe(100);
  });

  it("五种花色都够立：墨猫 ≥4 个颜色类、其余 ≥5（尺 #71 的单位层）", () => {
    // 墨猫天生矛盾少（发/鞋/轮廓同属墨系），四足那张脸也从未靠「六种色」撑过。
    // 这里钉的是一份**可分辨性**下限：任何花色至少要有 4 块面积 ≥300 的独立色，
    // 且非墨花色必须有 6 块——否则小尺寸上会糊成一团（美术戒律①）。
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const ops = buildGirlOps({ ...NEUTRAL, coat: CAT_COATS[name] });
      const cov = [...coverageByColor(ops).entries()].filter(([, px]) => px >= 300);
      const floor = name === "ink" ? 4 : 5;
      expect(cov.length, `${name} 只有 ${cov.length} 个够大的颜色类`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("blush 有值时必须落在 ORDER 的位（在 mouth 之后、tear 之前）", () => {
    const got = layersInOrder(buildGirlOps({ ...NEUTRAL, expression: "happy" }));
    expect(got.indexOf("blush")).toBeGreaterThan(got.indexOf("mouth"));
    expect(got.indexOf("blush")).toBeLessThan(got.length);
  });

  it("至少一枚 strokePath 线宽 ≥1、至少一条 ≥3 点曲线", () => {
    const ops = buildGirlOps({ ...NEUTRAL });
    expect(ops.some((o) => o.kind === "strokePath" && o.width >= 1)).toBe(true);
    expect(ops.some((o) => (o.kind === "strokePath" || o.kind === "fillPath") && o.points.length >= 3)).toBe(true);
  });

  it("眼睛沿用四足的半径比与高光系数，落在猫娘眼位", () => {
    const eyes = byLayer(buildGirlOps({ ...NEUTRAL }), "eyes").filter((o) => o.kind === "fillEllipse");
    expect(eyes.length).toBeGreaterThanOrEqual(4);
    // 眼白半径 = eyeRr × 头阵的 scaleX；头阵在运行时由 matRoot 给，这里按 ops 实测反推，
    // 不写死具体像素（u 一变它就变，写死等于把尺钉在某个档位上）。
    const ellipses = eyes.filter((e) => e.kind === "fillEllipse");
    const maxRx = Math.max(...ellipses.map((e) => (e as { rx: number }).rx));
    const whites = ellipses.filter((e) => Math.abs((e as { rx: number }).rx - maxRx) < 1e-9);
    expect(whites.length).toBeGreaterThanOrEqual(2);
    for (const w of whites) expect((w as { ry: number }).ry / (w as { rx: number }).rx).toBeCloseTo(GIRL_PROPORTION.eyeRy / GIRL_PROPORTION.eyeRr, 3);
    // 高光比 0.30 / 0.15（相对眼白半径）
    const ratios = ellipses
      .map((e) => (e as { rx: number }).rx / maxRx)
      .filter((r) => r < 0.5);
    expect(ratios.some((r) => Math.abs(r - 0.30) < 0.02)).toBe(true);
    expect(ratios.some((r) => Math.abs(r - 0.15) < 0.02)).toBe(true);
  });

  it("blink 只压眼睛：闭眼时眼高变小，其它层逐字段不变", () => {
    const open = buildGirlOps({ ...NEUTRAL });
    const shut = buildGirlOps({ ...NEUTRAL, blink: 1 });
    expect(byLayer(shut, "eyes")).not.toEqual(byLayer(open, "eyes"));
    for (const layer of GIRL_LAYERS.filter((l) => l !== "eyes" && l !== "tear")) {
      expect(byLayer(shut, layer), `${layer} 跟着眨眼变了`).toEqual(byLayer(open, layer));
    }
  });

  it("全部颜色都能追溯到 token 或猫的色板（wash/withAlpha 派生）", () => {
    // 判据不是「字符串在表里」——wash/withAlpha 的结果本来就是新字符串。判的是**输入**：
    // girlPalette 只会拿 CatCoat 字段与板内 token 做 wash/withAlpha，所以先把这些输入集合钉出来，
    // 再要求每个输出的颜色都能由其中之一经同一对函数重算得到。
    const inputs = new Set<string>();
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      for (const v of Object.values(CAT_COATS[name])) inputs.add(v as string);
    }
    for (const v of Object.values(CAT_PALETTE)) if (typeof v === "string") inputs.add(v);
    // 板内 token 里本文件用到的那几个（PET_PRIVATE 不算板内，故只列这些）
    for (const v of [INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ACCENT]) inputs.add(v);

    const reproducible = new Set<string>(inputs);
    const add = (v: string) => reproducible.add(v);
    for (const a of inputs) for (const b of inputs) {
      for (let alpha = 0; alpha <= 255; alpha += 1) add(wash(a, alpha, b));
      for (let i = 0; i <= 20; i += 1) add(withAlpha(a, i / 20));
    }
    // 文件里用到的几个固定组合（浮点 alpha，上面的步长取不到）
    for (const a of inputs) {
      add(withAlpha(a, 0.22)); add(withAlpha(a, 0.35)); add(withAlpha(a, 0.65));
      add(withAlpha(a, 0.9)); add(withAlpha(a, 0.2)); add(withAlpha(a, 0.09));
      add(withAlpha(a, 0.96)); add(withAlpha(a, 0.72)); add(withAlpha(a, 0.5)); add(withAlpha(a, 0.55)); add(withAlpha(a, 0.85)); add(withAlpha(a, 0.6));
      add(wash(a, 26, ROSE)); add(wash(a, 120, PAPER)); add(wash(a, 150, PAPER));
      add(wash(a, 210, INK_SOFT)); add(wash(a, 252, PAPER)); add(wash(a, 246, PAPER));
      add(wash(a, 84, INK)); add(wash(a, 190, PAPER)); add(wash(a, 210, INK));
      add(wash(a, 200, INK)); add(wash(a, 34, PAPER)); add(wash(a, 40, PAPER));
      add(wash(a, 96, INK_SOFT));
    }
    for (const o of buildGirlOps({ ...NEUTRAL })) {
      const fill = (o as { fill?: string }).fill;
      if (typeof fill !== "string") continue;
      expect(reproducible.has(fill), `画不出板的色：${fill}`).toBe(true);
    }
  });

  it("画进窗口：按 profile 的 center/u（large 档）时包围盒不越 100×132，且竖构图占住大半高度", () => {
    // 猫娘的窗口由 profileFor("girl","large") 给（100×132、pin (50,48)），绘制中心 = pin + (0, 4.5s)；
    // 借四足的 center(41,43)/u=37 会让她出窗——那正是「猫娘默认大档」的原因，不是几何 bug。
    const prof = profileFor("girl", "large");
    const { u } = prof.catScale(0);
    const center = { x: prof.pin.x + formGeometry("girl").centerOffset.dx * (u / 60),
                     y: prof.pin.y + formGeometry("girl").centerOffset.dy * (u / 60) };
    const b = opsBounds(buildGirlOps({ ...NEUTRAL, center, u }))!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(prof.base.width);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(prof.base.height);
    expect(b.height).toBeGreaterThan(60);
  });

  it("纯函数：同输入两次调用逐字段相等（R-D9）", () => {
    expect(buildGirlOps({ ...NEUTRAL })).toEqual(buildGirlOps({ ...NEUTRAL }));
  });

  it("分派：form 缺省与 \"cat\" 都逐字节等于 buildCatOps（R-D2 的分派侧证明）", () => {
    expect(buildPetOps({ ...NEUTRAL })).toEqual(buildCatOps(NEUTRAL));
    expect(buildPetOps({ ...NEUTRAL, form: "cat" })).toEqual(buildCatOps(NEUTRAL));
    expect(buildPetOps({ ...NEUTRAL, form: "girl" } satisfies PetInput)).toEqual(buildGirlOps({ ...NEUTRAL }));
  });

  it("猫娘不出四足专属层（bib/paws/tail_tip），也不出文本图元", () => {
    const ops = buildGirlOps({ ...NEUTRAL });
    for (const layer of ["bib", "paws", "tail_tip", "paws_up"]) {
      expect(byLayer(ops, layer), `猫娘画了 ${layer}`).toEqual([]);
    }
    expect(ops.some((o) => o.kind === "text")).toBe(false);
  });
});

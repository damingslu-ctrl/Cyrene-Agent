import { describe, expect, it } from "vitest";
import { BUB_W, OPEN_H, OPEN_W, PET_H, PET_W, PIN, scaleFor } from "./pet-geometry";
import {
  FORM_GEOMETRY, PET_FORMS, PIN_Y_RATIO, SIZE_TIERS, TIER_SCALE,
  formGeometry, profileFor, type PetForm,
} from "./pet-profile";

describe("身形档位", () => {
  it("三档 k 与 spec §8 逐字相等", () => {
    expect(SIZE_TIERS).toEqual(["small", "standard", "large"]);
    expect(TIER_SCALE).toEqual({ small: 0.85, standard: 1.0, large: 1.22 });
  });

  it("standard 档就是今天的常量，一个像素都不许动（R-D2 的结构理由）", () => {
    const p = profileFor("cat", "standard");
    expect(p.k).toBe(1);
    expect(p.base).toEqual({ width: PET_W, height: PET_H });
    expect(p.pin).toEqual({ x: PIN.x, y: PIN.y });
  });

  it("小档 70×92 / 大档 100×132；钉位 y = round(h × 0.3611)、x = 窗宽中线", () => {
    expect(profileFor("cat", "small").base).toEqual({ width: 70, height: 92 });
    expect(profileFor("cat", "large").base).toEqual({ width: 100, height: 132 });
    expect(profileFor("cat", "small").pin).toEqual({ x: 35, y: 33 });
    expect(profileFor("cat", "large").pin).toEqual({ x: 50, y: 48 });
    for (const tier of SIZE_TIERS) {
      const { base, pin } = profileFor("cat", tier);
      expect(pin.y).toBe(Math.round(base.height * PIN_Y_RATIO));
      expect(pin.x).toBe(Math.round(base.width / 2));
    }
  });

  it("面板/气泡底数也按 k 取整；standard 还原 OPEN_* 与 BUB_W", () => {
    expect(profileFor("cat", "standard").panel).toEqual({ width: OPEN_W, height: OPEN_H });
    expect(profileFor("cat", "large").panel).toEqual({
      width: Math.round(OPEN_W * 1.22), height: Math.round(OPEN_H * 1.22),
    });
    expect(profileFor("cat", "small").bubbleWidth).toBe(Math.round(BUB_W * 0.85));
  });

  it("`u` 乘 k、`s` 随之而来；k=1 时与 scaleFor 逐字节相等", () => {
    for (const e of [0, 0.5, 1]) {
      const { u, s } = scaleFor(e);
      expect(profileFor("cat", "standard").catScale(e)).toEqual({ u, s });
    }
    const large = profileFor("cat", "large").catScale(0);
    expect(large.u).toBeCloseTo(37 * 1.22, 10);
    expect(large.s).toBeCloseTo(large.u / 60, 10);
  });
});

describe("形态几何轴", () => {
  it("两形态枚举顺序即菜单顺序，猫在前（默认档）", () => {
    expect(PET_FORMS).toEqual(["cat", "girl"]);
  });

  it("猫的几何就是 computeCatRect 今天用的那四个系数", () => {
    expect(FORM_GEOMETRY.cat).toEqual({
      centerOffset: { dx: -17.0, dy: 4.5 },
      hitAspect: { width: 2.0, height: 1.85 },
      hitCenter: { dx: 0.0, dy: -1.5 },
    });
  });

  it("猫娘是竖的、猫是横的；命中框整体上移到身体中线", () => {
    const g = formGeometry("girl");
    // 判「横/竖」看宽高比而不是绝对高：猫 1.85/2.0 ≈ 0.93（横），猫娘 1.71/1.24 ≈ 1.38（竖）。
    // 绝对高由 Task 26 的尺 #71 实测反钉，这里只钉方向，不钉数值。
    expect(g.hitAspect.width).toBeLessThan(FORM_GEOMETRY.cat.hitAspect.width);
    expect(g.hitAspect.height / g.hitAspect.width)
      .toBeGreaterThan(FORM_GEOMETRY.cat.hitAspect.height / FORM_GEOMETRY.cat.hitAspect.width);
    expect(g.hitAspect.height).toBeGreaterThan(g.hitAspect.width);
    // 实测反钉（2026-10-25 重画后）：猫娘的墨中心在**钉位下方** 37.0s（约 0.62u）——
    // 钉位在脚线上，头在它上面，但墨的**面积重心**被裙摆与大头发拽到了脚下半程，
    // 所以框心相对钉位是正的。这与暂行值「整体上移 45.75s」方向相反，实测推翻了它。
    expect(g.hitCenter.dy).toBeGreaterThan(0);
    expect(g.hitCenter.dy / (60 / 45)).toBeLessThan(40);
    // 身体轴回窗口中线：猫娘的 dx 必须是 0，猫是 -17（给尾巴让位）
    expect(g.centerOffset).toEqual({ dx: 0.0, dy: 79.0 });
  });

  it("未知形态名退回猫，不许抛错把猫清空", () => {
    expect(formGeometry("goldfish" as PetForm)).toEqual(FORM_GEOMETRY.cat);
    expect(profileFor("goldfish" as PetForm, "tiny" as never).tier).toBe("standard");
  });
});

// src/shared/pet-geometry.test.ts
import { describe, expect, it } from "vitest";
import {
  BUB_W, EDGE_MARGIN, OPEN_H, OPEN_W, PET_H, PET_W, PIN,
  computeCatRect, computePetLayout, resolveGrowthDirection, scaleFor,
} from "./pet-geometry";

const wa = { x: 0, y: 0, width: 1920, height: 1040 };

describe("pet-geometry 常量", () => {
  it("钉位点与四档尺寸照抄 native", () => {
    expect({ PET_W, PET_H, OPEN_W, OPEN_H, BUB_W, PIN }).toEqual({
      PET_W: 82, PET_H: 108, OPEN_W: 248, OPEN_H: 482, BUB_W: 172, PIN: { x: 41, y: 39 },
    });
    expect(EDGE_MARGIN).toBe(4);
  });

  it("u 在收起/展开两档分别是 37 / 32，s = u/60", () => {
    expect(scaleFor(0)).toEqual({ u: 37, s: 37 / 60 });
    expect(scaleFor(1)).toEqual({ u: 32, s: 32 / 60 });
  });
});

describe("computePetLayout", () => {
  it("g=0 时窗口精确回到 82×108、原点即猫位（native 注释的同一条要求）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1800, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 82, height: 108 });
    expect(layout.pos).toEqual({ x: 1800, y: 900 });
  });

  it("面板向下向右展开：原点按 pin - anchor，尺寸线性插值", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1000, y: 400 }, e: 1, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 248, height: 482 });
    expect(layout.pos).toEqual({ x: 1000 + 41 - 41, y: 400 + 39 - 39 });
    expect(layout.anchor).toEqual({ x: 41, y: 39 });
  });

  it("growUp 时锚点 y = OPEN_H - 4 - 51.5*(29/60)（影子离窗口底 4px）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 100, y: 500 }, e: 1, be: 0, growLeft: false, growUp: true,
      workArea: { x: 0, y: 0, width: 1920, height: 1200 }, peekDx: 0,
    });
    expect(layout.anchor.y).toBeCloseTo(482 - 4 - 51.5 * (29 / 60), 6);
  });

  it("growLeft 时锚点 x = OPEN_W - PIN.x，右缘成为不动边", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1700, y: 400 }, e: 1, be: 0, growLeft: true, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.anchor.x).toBe(248 - 41);
    expect(layout.pos.x).toBeCloseTo(1700 + 41 - 207, 6);
  });

  it("夹紧只按 g 生效：g=0 的收起态 clampDelta 记录夹了多少，但 pos 不因夹紧而搬（cat 原地钉在 catOrigin）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1878, y: 1000 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    // 窗右缘 1878+82=1960>1920（x夹-40）；底边 1000+108=1108>1040（y夹-68）；cat 钉在 catOrigin
    // clampDelta 用 targetW（BUB_W=172）算 overflow，故 x = 1920-172-1878 = -130；y = 1040-108-1000 = -68
    expect(layout.pos).toEqual({ x: 1878, y: 1000 });
    expect(layout.clampDelta).toEqual({ x: -130, y: -68 });
  });

  it("气泡档：g=be，尺寸只撑到 172 宽、108 高", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1700, y: 900 }, e: 0, be: 1, growLeft: true, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 172, height: 108 });
    expect(layout.anchor.x).toBe(172 - 41);
  });

  it("peekDx 只进绘制偏移，不进窗口原点（native 的「猫直接消失」教训）", () => {
    const withPeek = computePetLayout({
      catOrigin: { x: 1836, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 40,
    });
    expect(withPeek.pos.x).toBe(1876);
    expect(withPeek.pinInWin.x).toBeCloseTo(1, 6);
  });
});

describe("computeCatRect", () => {
  it("收起态包围盒落在 82×108 窗口内，底部 32px 留给胶囊", () => {
    const rect = computeCatRect({ pinInWin: { x: 41, y: 39 }, e: 0 });
    expect(rect.x).toBeCloseTo(41 - 37 - 17 * (37 / 60) + 17 * (37 / 60), 6);
    expect(rect.width).toBeCloseTo(74, 6);
    expect(rect.height).toBeCloseTo(68.45, 2);
    expect(rect.y + rect.height).toBeLessThanOrEqual(108 - 32 + 0.5);
  });
});

describe("resolveGrowthDirection", () => {
  it("向下放得下就向下（默认方向不许变）", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 100, y: 100 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: false, growLeft: false });
  });

  it("底部不够、顶部够 → 翻向上", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 100, y: 600 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: true, growLeft: false });
  });

  it("右边不够、左边够 → 翻向左", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 1700, y: 100 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: false, growLeft: true });
  });

  it("两头都放不下 → 选空间大的一侧（顶部578px > 底部90px → growUp=true）", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 470 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: false, growLeft: false },
      }).growUp,
    ).toBe(true);
  });
});

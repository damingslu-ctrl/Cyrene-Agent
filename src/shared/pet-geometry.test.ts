// src/shared/pet-geometry.test.ts
import { describe, expect, it } from "vitest";
import {
  BUB_W, EDGE_MARGIN, OPEN_H, OPEN_W, PET_H, PET_W, PIN,
  clampRestoreOrigin, computeCatRect, computePetLayout, resolveGrowthDirection, scaleFor,
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

  it("g=0 时展开夹紧不搬窗（只记 clampDelta），但 peek 分支按 native :4299 自己夹 x", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1878, y: 1000 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    // clampDelta 用 targetW（BUB_W=172）算 overflow：x = 1920-172-1878 = -130；y = 1040-108-1000 = -68
    expect(layout.clampDelta).toEqual({ x: -130, y: -68 });
    // native 的 peek 夹紧只管 x、只管「窗口自己的边贴住屏幕边」；y 出屏由 :4171 的
    // 每帧基准位兜底（Task 12）负责，所以这里 1000 原样透传。
    expect(layout.pos).toEqual({ x: 1838, y: 1000 });
  });

  it("夹紧随 g=1 全额生效：pos 就是夹后的 clamped 位（正对照，钉住 Task 7/12 消费的正向语义）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1800, y: 900 }, e: 1, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    // 目标档 248×482：x 上界 1920-248=1672、y 上界 1040-482=558
    expect(layout.clampDelta).toEqual({ x: -128, y: -342 });
    expect(layout.pos).toEqual({ x: 1672, y: 558 });
    expect(layout.pinInWin).toEqual({ x: 41, y: 39 });
  });

  it("夹紧随 0<g<1 按 g 生效：位移 = clampDelta × g", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1800, y: 900 }, e: 0.5, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.pos).toEqual({ x: 1800 + -128 * 0.5, y: 900 + -342 * 0.5 });
    expect(layout.size).toEqual({ width: 165, height: 295 });
  });

  it("气泡档：g=be，尺寸只撑到 172 宽、108 高", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1700, y: 900 }, e: 0, be: 1, growLeft: true, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 172, height: 108 });
    expect(layout.anchor.x).toBe(172 - 41);
  });

  it("peek 藏身：窗口只滑到自己的边贴住屏幕边（绝不出屏），多出来的位移进 pinInWin", () => {
    const withPeek = computePetLayout({
      catOrigin: { x: 1836, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 40,
    });
    // native :4299：x 上界 = 1920 - 当前窗宽 82 = 1838（旧版放到 1876 会把底部胶囊切一半，见 #38）
    expect(withPeek.pos.x).toBe(1838);
    expect(withPeek.pos.y).toBe(900);
    // pin_in_win 含 peek_off（native :4379）：猫在窗口内再走 40，靠窗口裁掉右半身
    expect(withPeek.pinInWin.x).toBeCloseTo(1836 + 41 + 40 - 1838, 6);
    // 反对照：左缘藏身同样不许把窗口推离工作区
    const leftPeek = computePetLayout({
      catOrigin: { x: 20, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: -40,
    });
    expect(leftPeek.pos.x).toBe(0);
    expect(leftPeek.pinInWin.x).toBeCloseTo(20 + 41 - 40 - 0, 6);
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

  it("向下放不下、向上放得下 → 翻向上（走 fitsUp&&!fitsDown 分支，不是 fallback）", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 470 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: false, growLeft: false },
      }).growUp,
    ).toBe(true);
  });

  // fallback 分支（native :4199/:4211/:4229 的 `>`）此前零覆盖，比较符被反转也没被抓到。
  // 屏高 560 < OPEN_H 482 + 余量：y=200 与 y=300 两档都上下放不下，只能比空间。
  it("两头都放不下 → 向上空间大则向上（native 用 >，选空间大的一侧）", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 300 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: false, growLeft: false },
      }).growUp,
    ).toBe(true);
  });

  it("两头都放不下 → 向下空间大则向下", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 200 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: false, growLeft: false },
      }).growUp,
    ).toBe(false);
  });

  it("当前方向放不下且两头都放不下时仍按空间选边（粘性不许吞掉 fallback）", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 300 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: true, growLeft: false },
      }).growUp,
    ).toBe(true);
  });

  it("水平 fallback：屏窄到两向都放不下 → 左侧空间大则向左长", () => {
    const narrow = { x: 0, y: 0, width: 200, height: 1040 };
    expect(
      resolveGrowthDirection({ catOrigin: { x: 100, y: 100 }, workArea: narrow, current: { growUp: false, growLeft: false } })
        .growLeft,
    ).toBe(true);
    expect(
      resolveGrowthDirection({ catOrigin: { x: 40, y: 100 }, workArea: narrow, current: { growUp: false, growLeft: true } })
        .growLeft,
    ).toBe(false);
  });
});

describe("clampRestoreOrigin", () => {
  it("全离屏的保存点被夹回边界内（整只猫可见）", () => {
    expect(
      clampRestoreOrigin({ saved: { x: 2400, y: -300 }, workArea: wa, size: { width: PET_W, height: PET_H } }),
    ).toEqual({ x: 1920 - PET_W, y: 0 });
  });

  it("工作区内的合法保存点一字不动（副屏位置不许被拽回主屏）", () => {
    const secondary = { x: 1920, y: 0, width: 1280, height: 1024 };
    expect(
      clampRestoreOrigin({ saved: { x: 2000, y: 500 }, workArea: secondary, size: { width: PET_W, height: PET_H } }),
    ).toEqual({ x: 2000, y: 500 });
  });

  it("按 zoom 放大后的尺寸夹，而不是按基址", () => {
    const size = { width: Math.round(PET_W * 1.5), height: Math.round(PET_H * 1.5) };
    expect(
      clampRestoreOrigin({ saved: { x: 1900, y: 1000 }, workArea: wa, size }),
    ).toEqual({ x: 1920 - size.width, y: 1040 - size.height });
  });
});

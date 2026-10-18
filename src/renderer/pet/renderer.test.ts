// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PixelPetRenderer } from "./renderer";
import { computeCatRect } from "../../shared/pet-geometry";

// vitest 全局是 node 环境，jsdom 里也没有 Path2D（未装 canvas 包）；
// 按 ops.test.ts 的做法 stub 掉，保证 ticker 真跳到 draw 时不炸。
if (!globalThis.Path2D) {
  (globalThis as unknown as { Path2D: unknown }).Path2D = class FakePath2D {
    moveTo(): void {}
    lineTo(): void {}
    arcTo(): void {}
    closePath(): void {}
  };
}

function makeCanvas() {
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ({
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
    })),
  };
  return canvas as unknown as HTMLCanvasElement & { getContext: ReturnType<typeof vi.fn> };
}

describe("PixelPetRenderer", () => {
  it("替换面全齐：Live2DManager 用到的每个方法都得有", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    for (const method of ["init", "applyZoom", "resize", "pause", "resume", "dispose", "getHitAreaDefs", "readAlpha"] as const) {
      expect(typeof r[method]).toBe("function");
    }
    r.dispose();
  });

  it("hit area 就是 native 的 cat_rect（82×108 收起档），不再是整窗矩形", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    const [area] = r.getHitAreaDefs();
    const expected = computeCatRect({ pinInWin: { x: 41, y: 39 }, e: 0 });
    expect(area.rect).toMatchObject({ x: expect.closeTo(expected.x, 3), y: expect.closeTo(expected.y, 3) });
    r.dispose();
  });

  it("pause 停 ticker、resume 重启（拖窗时的 DWM 残影抑制靠这一条）", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    r.pause();
    expect(r.isPaused()).toBe(true);
    r.resume();
    expect(r.isPaused()).toBe(false);
    r.dispose();
  });
});

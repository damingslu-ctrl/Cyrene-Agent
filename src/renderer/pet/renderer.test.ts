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
  // getContext 每次都要返回同一张 ctx：测试要拿到渲染器真用着的那只来记账。
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
  };
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ctx),
  };
  return canvas as unknown as HTMLCanvasElement & {
    getContext: ReturnType<typeof vi.fn> & { (): typeof ctx };
  };
}

describe("PixelPetRenderer", () => {
  it("替换面全齐：Live2DManager 用到的每个方法都得有", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    for (const method of ["init", "applyZoom", "resize", "pause", "resume", "dispose", "getCanvas", "getHitAreaDefs", "readAlpha"] as const) {
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
    // 构造后从未 start：isPaused 必须是 false——没有这行，pause 测试断的只是
    // 「ticker===0」这个 resume/pause 都会经过的中间态，分不出 paused 语义。
    expect(r.isPaused()).toBe(false);
    r.pause();
    expect(r.isPaused()).toBe(true);
    r.resume();
    expect(r.isPaused()).toBe(false);
    r.dispose();
  });

  it("applyZoom 把 zoom 折进 setTransform：窗口是基址×zoom，绘制空间回基址（petZoom≠1 时猫不许画小）", () => {
    const canvas = makeCanvas();
    Object.defineProperty(canvas, "clientWidth", { value: 123, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 162, configurable: true });
    const r = new PixelPetRenderer({ canvas, width: 123, height: 162, onLoad: vi.fn(), onError: vi.fn() });
    r.applyZoom(1.5);
    const ctx = canvas.getContext();
    expect(ctx.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0); // dpr=1（jsdom）
    expect(canvas.width).toBe(123);
    // 正对照：zoom=1 时同一窗口尺寸不得再带 1.5 系数
    r.applyZoom(1);
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    r.dispose();
  });

  it("循环走 rAF + fps 闸：4fps 档 250ms 内只重绘一次，闸挡重绘不挡时钟", () => {
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const rafCbs: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return 42;
    });
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const canvas = makeCanvas();
    const r = new PixelPetRenderer({ canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    return r.init().then(() => {
      expect(rafCbs.length).toBeGreaterThan(0);
      const step = rafCbs.shift()!;
      step(10_250); // → past 250ms gate → draws
      step(10_400); // → 150ms after → gated, no second draw but loop re-arms
      const ctx = canvas.getContext();
      expect(ctx.clearRect).toHaveBeenCalledTimes(1);
      // 两帧都在闸后重挂了下一次回调（帧1过闸重绘、帧2被闸吞掉也重挂）；
      // 「吞掉≠停表」正是这条与 setInterval 时代的分界。
      expect(rafCbs.length).toBe(2);
      expect(cancelSpy).not.toHaveBeenCalled();
      r.dispose();
      expect(cancelSpy).toHaveBeenCalled();
      // cancelAnimationFrame 不会动我们的数组；数「rAF 总挂载次数」证明停表后不再重挂。
      expect(rafSpy.mock.calls.length).toBe(3); // init + 过闸帧 + 被闸帧
    });
  });
});

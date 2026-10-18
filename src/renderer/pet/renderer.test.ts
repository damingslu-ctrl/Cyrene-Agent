// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PixelPetRenderer } from "./renderer";
import type { CatInput, Mood } from "./art";
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
    // ops.ts 里只有 crescent 原语走 clip（差集要剪域），quiet_mark 又是 art.ts 里唯一
    // 产出 crescent 的层 —— 所以 clip 次数就是「月牙这一帧真画上了屏」的可观察面。
    clip: vi.fn(),
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

/**
 * 把渲染循环的 rAF 攥在手里：pending 中永远只有一支待执行回调。
 * cancelAnimationFrame 必须真从 pending 里摘掉，否则 pause/resume 之后
 * fire() 会拿到上一代的陈旧回调，fps 闸的判据就不干净了。
 */
function makeLoopDriver() {
  const pending = new Map<number, FrameRequestCallback>();
  let handle = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    handle += 1;
    pending.set(handle, cb);
    return handle;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    pending.delete(id);
  });
  return {
    /** 喂一帧给循环；过没过 fps 闸只看这个时间戳。 */
    fire(now: number): void {
      const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error("no pending requestAnimationFrame callback");
      pending.delete(next[0]);
      next[1](now);
    },
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

  it("setQuiet 当场补画一帧并把月牙真画上屏：crescent 是 ops.ts 里唯一走 clip 的原语", () => {
    // 免打扰的月牙唯一数据源是 cat.quiet（art.ts:415 `if (quiet)`），而 cat.quiet 只在
    // draw() 里由 this.quiet 回写 —— 漏了那行回写，下面每一笔 clip 都不会发生。
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const loop = makeLoopDriver();
    const canvas = makeCanvas();
    const ctx = canvas.getContext();
    const r = new PixelPetRenderer({ canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    return r.init().then(() => {
      // 4fps 档下 100ms 那一帧被闸吞掉，一笔未画：月牙若只能靠循环出屏，右键后最坏要等 250ms。
      loop.fire(10_100);
      expect(ctx.clearRect).not.toHaveBeenCalled();
      expect(ctx.clip).not.toHaveBeenCalled();   // 正对照：不安静时月牙一笔都没有
      // 安静状态下行的唯一入口（右键菜单写盘 / toggle / 到点自醒都从这条广播下来）。
      r.setQuiet(true);
      expect(ctx.clearRect).toHaveBeenCalledTimes(1);   // 不等闸，状态一变就重绘
      expect(ctx.clip).toHaveBeenCalledTimes(2);        // 双层月牙：墨垫底 + 奶油压上（native #69 双色）
      expect(ctx.fill.mock.calls.filter((args) => args[0] === "evenodd")).toHaveLength(2); // 差集填充是月牙签名
      r.setQuiet(false);
      expect(ctx.clearRect).toHaveBeenCalledTimes(2);   // 撤月牙同样是当场一帧
      expect(ctx.clip).toHaveBeenCalledTimes(2);        // 不再产生新的月牙笔
      r.setQuiet(false);
      expect(ctx.clearRect).toHaveBeenCalledTimes(2);   // 同值早退：不许白画一帧
      r.dispose();
    });
  });

  it("免打扰不许睡脸冒充（native #67）：mood=sleep + quiet 的那一帧必须逐笔等于 idle + quiet", () => {
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const loop = makeLoopDriver();
    const canvas = makeCanvas();
    const ctx = canvas.getContext();
    const r = new PixelPetRenderer({ canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    // 渲染器没有 mood setter（猫相位由调度器在 P2 才接），这里只能白盒摆 input。
    const cat = (r as unknown as { cat: CatInput }).cat;
    return r.init().then(() => {
      /**
       * 采一帧：先切状态（那次即时重绘不进样本），再把 mood 摆好、借渲染循环用
       * **同一个**时间戳画 —— t 相同帧与帧才可比。mood 必须在切状态之后摆：
       * 切状态那次重绘里的睡眠闸会把 sleep 改写成 idle，先摆就被它吃掉了。
       */
      const sample = (mood: Mood, quiet: boolean) => {
        if (r.isQuiet() !== quiet) r.setQuiet(quiet);
        cat.mood = mood;
        ctx.ellipse.mockClear();
        ctx.fillText.mockClear();
        ctx.clip.mockClear();
        r.pause();
        r.resume();
        loop.fire(11_000);   // 11_000 − 10_000 = 1000ms > 250ms 闸 → 必画
        return {
          // 睡脸独有的笔：眼睁开度（art.ts:301 blinkEff 吃 sleep）与小圆嘴（:358 sleep > 0.35）。
          ellipses: ctx.ellipse.mock.calls.map((args) => [...args]),
          // 胶囊的 ↑/↓/数值也走 fillText，样本只认 Zzz 那几笔"Z"。
          zzz: ctx.fillText.mock.calls.filter((args) => args[0] === "Z").map((args) => [...args]),
          crescents: ctx.clip.mock.calls.length,
        };
      };

      const idleQuiet = sample("idle", true);
      const sleepQuiet = sample("sleep", true);
      // 安静期间想睡也只能画成 idle：这一条若被去掉（draw 里的睡眠闸失效），
      // sleepQuiet 会多出小圆嘴那一笔、眼睛也会闭成 sleep 的半径 → 立刻变红。
      expect(sleepQuiet).toEqual(idleQuiet);
      // 正对照一：不安静时睡脸是真在画的（三枚 Z × 四向光边 + 一枚墨字 = 15 笔），
      // 证明上面那条「逐笔相同」不是因为压根画不出差别。
      const sleepAwake = sample("sleep", false);
      expect(sleepAwake.zzz).toHaveLength(15);
      expect(sleepAwake.ellipses).not.toEqual(idleQuiet.ellipses);
      // 正对照二：月牙是唯一的安静记号 —— 三帧里只有挂着 quiet 的那两帧有它。
      expect(idleQuiet.crescents).toBe(2);
      expect(sleepQuiet.crescents).toBe(2);
      expect(sleepAwake.crescents).toBe(0);
      r.dispose();
    });
  });
});

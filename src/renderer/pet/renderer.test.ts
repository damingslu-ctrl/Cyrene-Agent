// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Task 12 贴边藏身状态机（渲染端）。时间体系：
 * - performance.now 由可推进的 clock 驱动（外部方法触发的即时补画与循环帧同一条秒表）；
 * - rAF 时间戳按 250ms/帧喂（4fps 档全过闸）；dtRaw 恰为 0.25s/帧，闲置计时可精确排帧。
 */
describe("PixelPetRenderer tuck (Task 12)", () => {
  afterEach(() => {
    delete (window as unknown as { verge?: unknown }).verge;
  });

  function makeVergeStub() {
    const stub = { resizePetWindow: vi.fn(), tuckHinted: vi.fn() };
    (window as unknown as { verge: unknown }).verge = stub;
    return stub;
  }

  const waMain = { x: 0, y: 0, width: 1920, height: 1040 };
  // 右缘贴边位：1920 − 82 = 1838（rightGap = 0，EDGE_NEAR 内）。
  const edgeBounds = { x: 1838, y: 400, width: 82, height: 108 };

  function makeTuckedRenderer(clockRef: { ms: number }) {
    const loop = makeLoopDriver();
    const verge = makeVergeStub();
    vi.spyOn(performance, "now").mockImplementation(() => clockRef.ms);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const canvas = makeCanvas();
    const r = new PixelPetRenderer({ canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    return { loop, verge, logSpy, canvas, r, cat: (r as unknown as { cat: CatInput }).cat };
  }

  /** 每帧 250ms 推进（4fps 档全过闸），返回帧数。 */
  function advance(loop: { fire(now: number): void }, clockRef: { ms: number }, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      clockRef.ms += 250;
      loop.fire(clockRef.ms);
    }
  }

  it("闲置 6s 闸、首滑先解释、peek 只进绘制偏移与探针列（#38 反向补偿回归闸）", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, logSpy, r, cat } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: false, tuckLimit: 6 });
    verge.resizePetWindow.mockClear(); // 基线那发不算藏身证据
    const centerHome = { ...cat.center };

    // 23 帧 = 5.75s：闸在 `> limit`（main.rs:4928），一条都不许多发。
    advance(loop, clock, 23);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();
    expect(verge.tuckHinted).not.toHaveBeenCalled();

    // 第 24 帧 idle=6.0，不严格大于 → 还不滑。
    advance(loop, clock, 1);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();

    // 第 25 帧 idle=6.25：过闸。首滑先解释、这一帧按住不动（main.rs:4947-4961）。
    advance(loop, clock, 1);
    expect(verge.tuckHinted).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.map((args) => String(args[0])).join("\n")).toContain("放着不动");
    expect(verge.resizePetWindow).not.toHaveBeenCalled(); // 解释帧零位移：几何一字未变

    // 第 26 帧真起步：窗口已贴右缘（1838 = 1920−82），pos 被夹得一动不动，
    // peek 只进 center/pinInWin/探针列——把 peek 挪进窗口位置的实现从这行就红。
    advance(loop, clock, 1);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    const slide = verge.resizePetWindow.mock.calls[0]![0] as Record<string, never>;
    expect(slide.x).toBe(1838);
    expect(slide.width).toBe(82);
    expect(slide.peekDx as number).toBeGreaterThan(0);
    expect(slide.peekDx as number).toBeLessThan(40);
    expect(cat.center.x).toBeGreaterThan(centerHome.x);
    // center = pinInWin + (−17s, +4.5s)（main.rs:4380-4383），s = scaleFor(0).s = 37/60。
    expect(slide.pinInWin.x - (slide.center.x as number)).toBeCloseTo(17 * (37 / 60), 6);

    // 缓动走到吸附（tuckStep 残余 <0.5 直接落 40）。
    advance(loop, clock, 40);
    const last = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>;
    expect(last.peekDx).toBe(40);
    expect(last.x).toBe(1838); // 窗口绝不出屏：底部胶囊完整（#38 的另一半）
    expect(cat.center.x).toBeCloseTo(centerHome.x + 40, 6);
    // 解释只说一次：tuckHinted 的凭据闸门（main.rs:4958）。
    expect(verge.tuckHinted).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it("user_active 闸门：光标进窗立刻退回、期间绝不重新起步", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r, cat } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();
    const centerHome = { ...cat.center };
    advance(loop, clock, 70); // 藏满 40px（tuckHinted 预置真：不掺解释帧）
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 40, x: 1838 });

    r.setUserActive(true);
    advance(loop, clock, 40); // 退回 + 再闲置 10s：user_active 清账 + 六闸断粮（main.rs:4902/4927）
    const end = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>;
    expect(end.peekDx).toBe(0);
    expect(cat.center.x).toBeCloseTo(centerHome.x, 6);
    const sendCount = verge.resizePetWindow.mock.calls.length;
    advance(loop, clock, 40);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(sendCount); // 正对照：静置 0 流量
    r.dispose();
  });

  it("取消勾选：立刻回位且从此不再藏（屏幕验收判据 3 的进程内对位）", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });
    advance(loop, clock, 70);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 40 });

    r.setTuckEnabled(false);
    advance(loop, clock, 40);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 0, x: 1838 });
    const sendCount = verge.resizePetWindow.mock.calls.length;
    advance(loop, clock, 80); // 再闲置 20s：tuck=false 后闸门永久断粮（main.rs:4926 ⚠️ 条）
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(sendCount);
    r.dispose();
  });

  it("拖拽：起点吸收 peek 时窗口一步不动（applied 可证不变），收尾按落位补发几何", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r, cat } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();
    advance(loop, clock, 70);
    const sendsDuringTuck = verge.resizePetWindow.mock.calls.length;
    const centerTucked = { ...cat.center };

    // beginDrag：吸收进基准位、peek 归零——pos = clamp(catOrigin+peek) 数学上同一点，
    // 窗口不许动（main.rs:4804「applied_pos 不变」）。载荷可以重发一条（bounds 逐字不变，
    // 主端两闸自然吞掉）；被吞的是移动指令，不是消息本身。
    r.beginDrag();
    const onGrab = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>;
    expect(onGrab).toMatchObject({ x: 1838, y: 400, width: 82, height: 108, peekDx: 0 });
    expect(cat.center.x).toBeCloseTo(centerTucked.x, 6); // 绘制中心逐位不变：拖起来不跳

    // endDrag 必须发生在 setDragging(false) 之后（main.ts 的收口顺序）：按落位补发。
    r.endDrag({ x: 500, y: 300 });
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(sendsDuringTuck + 2); // 吸收一条 + 落位一条
    const afterDrag = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>;
    expect(afterDrag).toMatchObject({ x: 500, y: 300, peekDx: 0 });

    // 拖到屏中央后不再自滑（EDGE_NEAR 外）：正对照是上面那条补发确实通了。
    advance(loop, clock, 80);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(sendsDuringTuck + 2);
    r.dispose();
  });

  it("渲染端每帧夹取：几何基线落在消失的副屏坐标上时夹回主屏（main.rs:4171-4184 的消费端）", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({
      bounds: { x: 2400, y: 400, width: 82, height: 108 },
      workArea: waMain,
      tuckEnabled: false, tuckHinted: true, tuckLimit: 6,
    });
    // 两条 1838：基线那发连窗口位置都被 computePetLayout 的 peek 分支夹在 workArea 内
    // （渲染端从不请求 2400 的落位），但模型还站在 2400——每帧夹取（:4171-4184）把
    // catOrigin 拽回 1838、补发修正 pinInWin。第三帧起死区到顶，不许再来一条。
    const sentX = verge.resizePetWindow.mock.calls.map((args) => (args[0] as Record<string, never>).x);
    expect(sentX).toEqual([1838, 1838]);
    const second = verge.resizePetWindow.mock.calls[1]![0] as Record<string, never>;
    expect(second.y).toBe(400);
    expect(second.pinInWin.x).toBeCloseTo(41, 6); // 修正后猫回到窗口内正常钉位（第一条是 603）
    advance(loop, clock, 1);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(2);

    // 正对照：已在 workArea 内的推送一字不动（不发第三条）。
    r.syncWindowBounds(edgeBounds, waMain);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it("user_active 离场边沿：账清到 0 重新攒满 6s，离场瞬间不许接着藏", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeTuckedRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });

    // 藏满（tuckHinted 预置真：不掺解释帧）。
    advance(loop, clock, 70);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 40, x: 1838 });

    // 进场回位：user_active 每帧清账（renderer.ts:344-346，native main.rs:4902-4905）。
    r.setUserActive(true);
    advance(loop, clock, 40);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 0 });

    // 回位的那些发不算新证据：取证面从离场边沿起算。
    verge.resizePetWindow.mockClear();

    // 边沿后 3 帧：账必须从 0 重新攒。变异 m21（清零支路改成 if (false)）下账上还留着
    // 进场期间累计的 10s 旧余额，闸门当场重开、peek 立刻起步——这一句就红。
    r.setUserActive(false);
    advance(loop, clock, 3);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();

    // 边沿后第 24 帧：idleSecs=24×0.25=6.0，`> limit` 是严格大于（main.rs:4928）→ 仍不许发。
    advance(loop, clock, 21);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();

    // 第 25 帧（6.25s）：恰好发 1 条，且是真起步（0 < peekDx < 40）。
    advance(loop, clock, 1);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    const slide = verge.resizePetWindow.mock.calls[0]![0] as Record<string, never>;
    expect(slide.peekDx as number).toBeGreaterThan(0);
    expect(slide.peekDx as number).toBeLessThan(40);
    r.dispose();
  });

  it("安静期照滑但不解释，凭据只在真说出口那帧落账（native :4955-4956）", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, logSpy, r } = makeTuckedRenderer(clock);
    await r.init();
    // 先挂安静：此刻 catOrigin 还是 null，tickTuck 首行直接 bail（renderer.ts:340），
    // 既不多烧一帧闲置账，也不多一发载荷。
    r.setQuiet(true);
    r.syncGeometry({ bounds: edgeBounds, workArea: waMain, tuckEnabled: true, tuckHinted: false, tuckLimit: 6 });
    verge.resizePetWindow.mockClear(); // 基线那发不算证据

    // 第 25 帧过闸：安静期「该滑还是滑」（行为不是话），但解释被 engaging && !quiet 压住
    // （renderer.ts:385-397，native main.rs:4952-4961）。变异 m14（删掉 && !this.quiet）下
    // 这一帧就当场解释——前两条断言立刻红。
    advance(loop, clock, 25);
    expect(verge.tuckHinted).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.map((args) => String(args[0])).join("\n")).not.toContain("放着不动");
    // 24 帧内闸门未开、载荷逐字不变（死区吞掉），过闸这帧是唯一一发：起步位移照发。
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    expect((verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).peekDx as number).toBeGreaterThan(0);

    // 藏满：全程 tuckHinted 仍 0 次——安静期一句解释都不许说出口。
    advance(loop, clock, 40);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 40 });
    expect(verge.tuckHinted).not.toHaveBeenCalled();

    // native 语义边界：过闸同帧就起步，下一帧 |peekDx| ≥ 0.5 → engaging 从此为假，
    // 「安静结束第一帧补解释」不成立。唯一能补的话路：先回原位（peek 归零）复位 engaging。
    r.setUserActive(true);
    advance(loop, clock, 40);
    expect(verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).toMatchObject({ peekDx: 0 });

    r.setUserActive(false);
    r.setQuiet(false); // 解释的闸门开回来（这次即时补画 dtRaw=0，不多烧账）
    verge.resizePetWindow.mockClear(); // 取证面从安静结束起算

    // 边沿后 24 帧 = 6.0s：严格大于未成立 + 账已在进场期清零 → 一帧都不许多发。
    advance(loop, clock, 24);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();

    // 第 25 帧：过闸 + 重新 engaging + 安静已解 → 解释说出、凭据此刻落账：
    // tuckHinted 恰好 1 次；shout !== null 时 peekTarget=0 → 这一帧零位移、不发载荷。
    advance(loop, clock, 1);
    expect(verge.tuckHinted).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.map((args) => String(args[0])).join("\n")).toContain("放着不动");
    expect(verge.resizePetWindow).not.toHaveBeenCalled();

    // 说完再滑：下一帧才出现真位移的那一发。
    advance(loop, clock, 1);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    const slide = verge.resizePetWindow.mock.calls[0]![0] as Record<string, never>;
    expect(slide.peekDx as number).toBeGreaterThan(0);
    expect(slide.peekDx as number).toBeLessThan(40);
    r.dispose();
  });
});

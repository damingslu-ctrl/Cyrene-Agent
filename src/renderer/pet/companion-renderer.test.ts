// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PixelPetRenderer } from "./renderer";

// jsdom 没有 Path2D / canvas 实现：ops.ts 只要方法在就行（同 renderer.test.ts）。
if (!globalThis.Path2D) {
  (globalThis as unknown as { Path2D: unknown }).Path2D = class FakePath2D {
    moveTo(): void {}
    lineTo(): void {}
    arcTo(): void {}
    closePath(): void {}
  };
}

function makeCanvas() {
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    clip: vi.fn(),
    globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
  };
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ctx),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: canvas.width, bottom: canvas.height, width: canvas.width, height: canvas.height }),
  };
  return canvas as unknown as HTMLCanvasElement & { getContext: () => typeof ctx };
}

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
    fire(now: number): void {
      const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error("no pending requestAnimationFrame callback");
      pending.delete(next[0]);
      next[1](now);
    },
  };
}

const waMain = { x: 0, y: 0, width: 1920, height: 1040 };
const home = { x: 900, y: 400 };

function makeCompanionRenderer(
  clock: { ms: number },
  extra: { onWindowGeometry?: () => void } = {},
) {
  const loop = makeLoopDriver();
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  vi.spyOn(console, "log").mockImplementation(() => {});
  // 引擎的 vitals 存在 localStorage：同文件多个实例之间必须清干净。
  window.localStorage.clear();
  const canvas = makeCanvas();
  const r = new PixelPetRenderer({
    canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
    ...extra,
  });
  return { loop, verge: (window as unknown as { verge: { resizePetWindow: ReturnType<typeof vi.fn>; settlePetPosition: ReturnType<typeof vi.fn> } }).verge, canvas, r };
}

function advance(loop: { fire(now: number): void }, clock: { ms: number }, frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    clock.ms += 250;
    loop.fire(clock.ms);
  }
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
});

describe("PixelPetRenderer × CompanionEngine", () => {
  it("漫游：窗口边界跟着引擎走，到点停稳只落盘一次", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();

    r.roamTo({ x: 1200, y: 400 });
    advance(loop, clock, 10);
    const xs = verge.resizePetWindow.mock.calls.map((args) => (args[0] as { x: number }).x);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.at(-1)).toBeGreaterThan(home.x);
    expect(verge.settlePetPosition).not.toHaveBeenCalled();

    advance(loop, clock, 30);
    expect(r.getCompanionSnapshot()?.pos).toEqual({ x: 1200, y: 400 });
    expect(verge.settlePetPosition).toHaveBeenCalledTimes(1);
    expect(verge.settlePetPosition).toHaveBeenCalledWith({ x: 1200, y: 400 });
    // 到达后不再逐帧发位置：窗口静止。
    const settledCount = verge.resizePetWindow.mock.calls.length;
    advance(loop, clock, 4);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(settledCount);
    r.dispose();
  });

  it("PET_RESIZE 真发一次就报一次窗口几何；去重不发的帧不报", async () => {
    const clock = { ms: 10_000 };
    const onWindowGeometry = vi.fn();
    const { loop, verge, r } = makeCompanionRenderer(clock, { onWindowGeometry });
    await r.init();
    onWindowGeometry.mockClear();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    expect(onWindowGeometry).toHaveBeenCalledTimes(1);

    // 同一几何再来一次：requestBounds 去重，没发就不许报。
    r.syncWindowBounds({ ...home, width: 82, height: 108 }, waMain);
    expect(verge.resizePetWindow).toHaveBeenCalledTimes(1);
    expect(onWindowGeometry).toHaveBeenCalledTimes(1);

    // 窗口真动起来：发送与回调始终 1:1。
    r.roamTo({ x: 1200, y: 400 });
    advance(loop, clock, 5);
    expect(verge.resizePetWindow.mock.calls.length).toBeGreaterThan(1);
    expect(onWindowGeometry).toHaveBeenCalledTimes(verge.resizePetWindow.mock.calls.length);
    r.dispose();
  });

  it("摸摸：爱心状态 + 一句话气泡，窗口横向长到 172 又把猫钉回原地", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();

    r.handleCommand("pet");
    const snapshot = r.getCompanionSnapshot();
    expect(snapshot?.bubble).not.toBeNull();
    expect(snapshot?.activity).toBe("pet");

    advance(loop, clock, 8); // 气泡展开动画 180ms，8×250ms 足够
    const last = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>;
    expect(last.width).toBe(172);
    expect(last.height).toBe(108);
    // 猫的屏幕钉位不变：窗口长宽变化不许把猫拽走。
    expect((last.x as number) + (last.pinInWin.x as number)).toBeCloseTo(home.x + 41, 6);
    // 气泡不压猫：气泡在猫的另一侧（growRight → 窗口右半）。
    expect(r.isPointOnBubble(140, 30)).toBe(true);
    expect(r.isPointOnBubble(20, 90)).toBe(false);

    // 气泡 6s 后自己收，窗口缩回 82。
    advance(loop, clock, 26);
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    advance(loop, clock, 4);
    expect((verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, never>).width).toBe(82);
    r.dispose();
  });

  it("计时动作按 30fps 重绘（4fps 会把洗脸/伸懒腰切成一秒四格）", async () => {
    const clock = { ms: 10_000 };
    const { loop, r, canvas } = makeCompanionRenderer(clock);
    const ctx = canvas.getContext();
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });

    r.handleCommand("play"); // 2s 的计时动作
    r.dismissBubble();
    advance(loop, clock, 3); // 气泡收完（展开动画 180ms），动作还剩 1.25s
    expect(r.getCompanionSnapshot()?.activity).toBe("play");

    ctx.clearRect.mockClear();
    for (let i = 0; i < 8; i += 1) {
      clock.ms += 33;
      loop.fire(clock.ms);
    }
    // 30fps 档：33ms 一帧全过闸；4fps 档只会在 250ms 边界画一次。
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThanOrEqual(6);
    r.dispose();
  });

  it("互动后的数值立刻落盘（不必等到下一次漫游停稳）", async () => {
    const clock = { ms: 10_000 };
    const { r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    expect(window.localStorage.getItem("cyrene.pet.vitals.v1")).toBeNull();

    r.handleCommand("pet");
    const raw = window.localStorage.getItem("cyrene.pet.vitals.v1");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as { vitals: { affinity: number } };
    expect(saved.vitals.affinity).toBeGreaterThan(0.5);
    r.dispose();
  });

  it("问候只在非安静时说一句", async () => {
    const clock = { ms: 10_000 };
    const { r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });

    r.setQuiet(true);
    expect(r.greet()).toBe(false);
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();

    r.setQuiet(false);
    expect(r.greet()).toBe(true);
    expect(r.getCompanionSnapshot()?.bubble?.text.length).toBeGreaterThan(0);
    r.dispose();
  });

  it("投掷：松手后走物理，落地停稳才落盘一次；拖拽期间窗口指令一条不发", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();

    r.beginDrag();
    r.endDrag({ x: 900, y: 300 }, { x: 800, y: -600 });
    expect(r.getCompanionSnapshot()?.activity).toBe("thrown");
    // 落地时长取决于弹跳次数：逐帧跑到第一次 idle 为止（跑过头就进入下一轮自主动作）。
    let frames = 0;
    while (r.getCompanionSnapshot()?.activity !== "idle" && frames < 200) {
      advance(loop, clock, 1);
      frames += 1;
    }
    const snapshot = r.getCompanionSnapshot()!;
    expect(frames).toBeLessThan(200);
    expect(snapshot.activity).toBe("idle");
    expect(snapshot.pos.y).toBeCloseTo(1040 - 108, 6);
    expect(verge.settlePetPosition).toHaveBeenCalledTimes(1);
    expect(verge.settlePetPosition).toHaveBeenCalledWith(snapshot.pos);
    r.dispose();
  });

  it("拖拽中 tickTuck 不跑（窗口由主端手势搬，不许和漫游抢位置）", async () => {
    const clock = { ms: 10_000 };
    const { loop, verge, r } = makeCompanionRenderer(clock);
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();
    r.beginDrag();
    advance(loop, clock, 60);
    expect(verge.resizePetWindow).not.toHaveBeenCalled();
    expect(verge.settlePetPosition).not.toHaveBeenCalled();
    r.dispose();
  });
});

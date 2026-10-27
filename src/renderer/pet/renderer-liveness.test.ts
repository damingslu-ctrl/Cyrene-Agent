// @vitest-environment jsdom
// 卡死（画面永久停住）的三条入口：
// 1) draw 抛一次错 → rAF 链断掉，再也不重挂；
// 2) 链条断过之后 ticker 留着旧 handle → resume() 被守卫挡住，自救不了；
// 3) 拖拽起手 pause() 了，但收口不保证恢复 → 松手后停在原地。
import { afterEach, describe, expect, it, vi } from "vitest";
import { PixelPetRenderer } from "./renderer";

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
    translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
    clip: vi.fn(),
    drawImage: vi.fn(),
    globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    textAlign: "", textBaseline: "", globalAlpha: 1,
  };
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ctx),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 82, bottom: 108, width: 82, height: 108 }),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
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
    pending,
    fire(now: number): void {
      const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error("no pending requestAnimationFrame callback");
      pending.delete(next[0]);
      next[1](now);
    },
  };
}

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const home = { x: 900, y: 400 };

async function makeGirl() {
  const clock = { ms: 10_000 };
  const loop = makeLoopDriver();
  const { canvas, ctx } = makeCanvas();
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  window.localStorage.clear();
  const r = new PixelPetRenderer({
    canvas, width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
  });
  await r.init();
  const raw = r as unknown as {
    girlSpriteFailed: boolean;
    girlAnimReady: boolean;
    girlPosesReady: boolean;
    girlPoses2Ready: boolean;
    engine: { idleUntil: number; lastUserAt: number };
  };
  raw.girlSpriteFailed = true;
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.girlPoses2Ready = true;
  raw.engine.idleUntil = Number.MAX_SAFE_INTEGER;
  raw.engine.lastUserAt = Number.MAX_SAFE_INTEGER;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock, loop, ctx, errorLog };
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.16 渲染循环不许停摆", () => {
  it("draw 抛一次错，循环必须自己重挂下一帧（不是安静地死掉）", async () => {
    const { clock, loop, ctx } = await makeGirl();
    // init() 已经画过帧；从这一帧起让绘制炸一次，之后恢复正常。
    let blown = false;
    ctx.drawImage.mockImplementation(() => {
      if (!blown) {
        blown = true;
        throw new Error("InvalidStateError: image not ready");
      }
    });

    // 推进时钟越过 fps 闸（4fps → 250ms），否则这一帧根本不画，测不到抛错。
    loop.fire(clock.ms + 1_000);
    expect(blown).toBe(true);
    // 抛错之后仍然有下一帧在排队：这一条就是「猫娘不会永久卡住」。
    expect(loop.pending.size).toBe(1);
  });

  it("链条断过留下的旧 ticker 不许挡住 resume()", async () => {
    const { r, clock, loop, ctx } = await makeGirl();
    const raw = r as unknown as { ticker: number };
    // 伪造一次「断链」现场：ticker 还留着旧 handle，但队列里没有任何帧。
    loop.pending.clear();
    raw.ticker = 999;

    r.resume();
    expect(loop.pending.size).toBe(1);

    // 而且恢复之后真的会画：一帧画下去，drawImage 有调用。
    ctx.drawImage.mockClear();
    loop.fire(clock.ms + 1_000);
    expect(ctx.drawImage).toHaveBeenCalled();
    r.dispose();
  });

  it("拖拽收口必须保证继续画：起手 pause、松手 endDrag 之后帧要回来", async () => {
    const { r, clock, loop, ctx } = await makeGirl();
    r.pause();
    expect(loop.pending.size).toBe(0);

    r.beginDrag();
    r.endDrag({ x: home.x + 40, y: home.y }, { x: 0, y: 0 });
    // 收口自带恢复：不许指望 main 再补一次 resume（那条路会因窗口可见性被跳过）。
    expect(loop.pending.size).toBe(1);

    ctx.drawImage.mockClear();
    loop.fire(clock.ms + 1_000);
    expect(ctx.drawImage).toHaveBeenCalled();
    r.dispose();
  });
});

describe("v1.16 循环的生命周期", () => {
  it("dispose() 之后不许被 finally 再挂活一帧", async () => {
    const { r, clock, loop } = await makeGirl();
    expect(loop.pending.size).toBe(1);

    // 模拟「正在回调里时被 dispose」：回调取出后先 dispose，再执行它。
    const next = loop.pending.entries().next().value as [number, FrameRequestCallback];
    loop.pending.delete(next[0]);
    r.dispose();
    next[1](clock.ms + 1_000);

    expect(loop.pending.size).toBe(0);
  });
});

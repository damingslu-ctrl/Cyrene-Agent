// @vitest-environment jsdom
// v1.22.0：吃饭/拍打/蹦跳/打字不再借 happy/wave/stretch/wink 的帧——
// 四个动作各播自己那一行（图集 III 第 3–6 行）。这里只验接缝：
// 活动与手势都能把诊断读到的那一行推上台，播完回到站姿，图集缺席时退回原帧段。
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
    clip: vi.fn(), drawImage: vi.fn(),
    globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    textAlign: "", textBaseline: "", globalAlpha: 1,
  };
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ctx),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: canvas.width, bottom: canvas.height, width: canvas.width, height: canvas.height }),
  };
  return canvas as unknown as HTMLCanvasElement;
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
}

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const home = { x: 900, y: 400 };
const at = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(y, m - 1, d, h, mi, 0, 0).getTime();

interface Harness {
  r: PixelPetRenderer;
  clock: { ms: number };
}

async function makeGirl(wallMs: number, actionsReady = true): Promise<Harness> {
  const clock = { ms: 10_000 };
  makeLoopDriver();
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  vi.spyOn(Date, "now").mockImplementation(() => wallMs);
  vi.spyOn(console, "log").mockImplementation(() => {});
  window.localStorage.clear();
  const r = new PixelPetRenderer({
    canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
  });
  await r.init();
  const raw = r as unknown as {
    girlSpriteFailed: boolean; girlAnimReady: boolean; girlPosesReady: boolean;
    girlPoses2Ready: boolean; girlActionsReady: boolean;
  };
  raw.girlSpriteFailed = true;
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.girlPoses2Ready = true;
  raw.girlActionsReady = actionsReady;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock };
}

const view = (r: PixelPetRenderer) => r as unknown as { draw: (now: number) => void };

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.22.0 吃/拍/跳/打字各播自己那一行", () => {
  it("喂食：打底换成吃饭那一行，帧号按 9fps 自己走，吃完回站姿", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.handleCommand("feed");
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("eat");
    expect(d.pose).toBeNull();
    expect(d.clip).toBeNull();
    const first = d.actionFrame;
    expect(first).toBeGreaterThanOrEqual(0);

    // 9fps：一格 111ms；120ms 后必须真的换了一格，不是冻在同一张画上。
    clock.ms += 120;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("eat");
    expect(d.actionFrame).not.toBe(first);
    expect(d.face.w).toBeGreaterThan(10);

    // 喂食 1600ms 结束就回站姿，不许把吃饭那行留在屏上。
    clock.ms += 1_600;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("玩耍：打底换成拍打那一行（11fps），玩完回站姿", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.handleCommand("play");
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("bat");
    const first = d.actionFrame;
    clock.ms += 100;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("bat");
    expect(d.actionFrame).not.toBe(first);

    clock.ms += 2_000;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("蹦跳手势：动作图在就播 hop 那一行，600ms 演完立刻让位（不借 stretch）", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("hop", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("hop");
    expect(d.gestureId).toBe("hop");
    expect(d.pose).toBeNull();
    expect(d.clip).toBeNull();

    clock.ms += 120;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("hop");
    expect(d.actionFrame).toBeGreaterThanOrEqual(1);

    // 6 帧 @10fps = 600ms 一次性：过了就回站姿。
    clock.ms += 700;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("打字手势：循环行靠手势时长收口——900ms 到点必须谢幕，不许卡在打字行上", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("typeCode", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("type");
    expect(d.gestureId).toBe("typeCode");

    // 8fps：150ms 已经进了第 1 格；600ms 时还在循环（没提前谢幕）。
    clock.ms += 150;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("type");
    expect(d.actionFrame).toBeGreaterThanOrEqual(1);
    clock.ms += 450;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("type");

    // typeCode 的时长 900ms：过了那一拍必须回站姿。
    clock.ms += 400;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("动作图缺席：喂食退回 happy、蹦跳退回 stretch，诊断 action 恒为 null", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0), false);
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).atlases.actions).toBe(false);

    r.handleCommand("feed");
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.clip).toBe("happy");

    clock.ms += 1_600;
    view(r).draw(clock.ms);
    r.playGesture("hop", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.clip).toBe("stretch");
    r.dispose();
  });
});

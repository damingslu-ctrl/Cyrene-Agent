// @vitest-environment jsdom
// v1.21.0：野性三式不再借姿态图当舞台——冲刺/潜行/扑击各播自己的那一行动作帧。
// 这里只验接缝：图集在位时诊断读数是 action（不是 pose），帧号按自己的时钟往前走；
// 图集缺席时退回 v1.20 的姿态兜底（v120 那条用例继续锁着）。
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

describe("v1.21.0 每个动作一条独立动画", () => {
  it("动作图集接上以后，冲刺播的是冲刺那一行：诊断读 action，帧号自己往前走", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).atlases.actions).toBe(true);

    r.handleCommand("wild");
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("zoom");
    expect(d.pose).toBeNull();
    expect(d.clip).toBeNull();
    const first = d.actionFrame;
    expect(first).toBeGreaterThanOrEqual(0);

    // 冲刺 12fps：再过两格的时间必须真的换了一格（不是冻在同一张画上）。
    clock.ms += 180;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("zoom");
    expect(d.actionFrame).not.toBe(first);
    // 脸框跟着这一格的实测元数据走：是个有面积的框，不是零。
    expect(d.face.w).toBeGreaterThan(10);
    expect(d.face.h).toBeGreaterThan(10);
    r.dispose();
  });

  it("动作图集缺席：诊断里 action 恒为 null，野性照旧退回姿态兜底", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0), false);
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).atlases.actions).toBe(false);

    r.handleCommand("wild");
    clock.ms += 16;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.actionFrame).toBeNull();
    expect(d.pose).toBe("run");
    r.dispose();
  });
});

// @vitest-environment jsdom
// v1.25.0：被摸/梳毛/发抖/扭头/喝一口不再借 happy/wink/peek/yawn 的帧，也不停在一张静帧上——
// 五件事各播自己那一行（图集第 11–15 行）。这里只验接缝：
// 谁把手推上台、帧号按本行的 fps 走、一次性行按自己的帧数谢幕、动作图缺席时退回原主。
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
// 挂钟钉在下午三点：天色/节日记号不进这五行的接缝，别让它们占了头顶那格。
const WALL = at(2026, 10, 30, 15, 0);

interface Harness {
  r: PixelPetRenderer;
  clock: { ms: number };
}

async function makeGirl(actionsReady = true): Promise<Harness> {
  const clock = { ms: 10_000 };
  makeLoopDriver();
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  vi.spyOn(Date, "now").mockImplementation(() => WALL);
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

describe("v1.25.0 五件「被对待」的事各播自己那一行", () => {
  it("长按摸头：演的是 pet 那一行，且当场起播（不等下一帧）", async () => {
    const { r, clock } = await makeGirl();
    view(r).draw(clock.ms);
    const rect = r.getHitRect();
    r.tapAt(rect.x + rect.width / 2, rect.y + rect.height * 0.2, 600, clock.ms);
    // 这里不调 draw：长按回馈若还停在「等下一帧」，4fps 档最坏 250ms 后才有画面。
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("pet");
    expect(d.pose).toBeNull();
    expect(d.clip).toBeNull();
    // 8fps：一格 125ms。
    clock.ms += 140;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).actionFrame).toBeGreaterThanOrEqual(1);
    // 摸头活动只有 900ms（pet() 那一步），到点必须让回待机姿态。
    clock.ms += 900;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBeNull();
    r.dispose();
  });

  it("梳毛手势：从一张 wash 静帧升格成 7fps 的动画，2400ms 到点让位", async () => {
    const { r, clock } = await makeGirl();
    view(r).draw(clock.ms);
    r.playGesture("groom", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("groom");
    expect(d.pose).toBeNull();
    expect(d.gestureId).toBe("groom");

    clock.ms += 160;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("groom");
    expect(d.actionFrame).not.toBe(0);

    clock.ms += 2_100;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBe("groom");

    clock.ms += 300;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    r.dispose();
  });

  it("发抖：12fps 抖得急（100ms 就换格），靠手势 1800ms 收口", async () => {
    const { r, clock } = await makeGirl();
    view(r).draw(clock.ms);
    r.playGesture("shiver", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("shiver");

    clock.ms += 100;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("shiver");
    expect(d.actionFrame).toBeGreaterThanOrEqual(1);

    clock.ms += 1_600;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBe("shiver");

    clock.ms += 200;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBeNull();
    r.dispose();
  });

  it("扭头：6fps 一次性，1000ms 扭过去就背对着不动——等不到手势那 2000ms", async () => {
    const { r, clock } = await makeGirl();
    view(r).draw(clock.ms);
    r.playGesture("turnAway", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBe("turnAway");

    clock.ms += 200;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).actionFrame).toBeGreaterThanOrEqual(1);

    // 6 帧 @6fps = 1000ms：末格（背对着的那一格）停住并报 done，由 isDone 谢幕。
    clock.ms += 900;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("喝一口：8fps 循环行，2400ms 里一直在喝，2600ms 必须放下杯子", async () => {
    const { r, clock } = await makeGirl();
    view(r).draw(clock.ms);
    r.playGesture("sip", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBe("sip");

    clock.ms += 130;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).actionFrame).toBeGreaterThanOrEqual(1);

    clock.ms += 1_700;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBe("sip");

    clock.ms += 700;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).action).toBeNull();
    r.dispose();
  });

  it("动作图缺席：四件退回原来的帧段，梳毛退回那张 wash 静帧——降档不许空窗", async () => {
    const { r, clock } = await makeGirl(false);
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).atlases.actions).toBe(false);

    const fallback: Array<[string, string]> = [
      ["shiver", "wink"], ["sip", "yawn"], ["turnAway", "peek"],
    ];
    for (const [gesture, clip] of fallback) {
      r.playGesture(gesture, clock.ms);
      clock.ms += 16;
      view(r).draw(clock.ms);
      const d = r.getGirlDiagnostics(clock.ms);
      expect(d.action, gesture).toBeNull();
      expect(d.clip, gesture).toBe(clip);
      clock.ms += 2_600;
      view(r).draw(clock.ms);
    }
    r.playGesture("groom", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    const wash = r.getGirlDiagnostics(clock.ms);
    expect(wash.action).toBeNull();
    expect(wash.clip).toBeNull();
    expect(wash.pose).toBe("wash");
    r.dispose();
  });
});

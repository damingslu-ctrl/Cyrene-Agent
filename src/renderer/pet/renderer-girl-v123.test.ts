// @vitest-environment jsdom
// v1.23.0：点头/摇头/拍手/捂脸不再借 peek/happy/shy 的帧——
// 四个手势各播自己那一行（图集第 7–10 行）。这里只验接缝：
// 手势能把那一行推上台、帧号按本行的 fps 走、到点让位回站姿；动作图缺席时退回原帧段。
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

describe("v1.23.0 点头/摇头/拍手/捂脸各播自己那一行", () => {
  it("点头：7fps 一次性——点完 857ms 自己谢幕，不许停在那行更不许重播", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("nod", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("nod");
    expect(d.gestureId).toBe("nod");
    expect(d.pose).toBeNull();
    expect(d.clip).toBeNull();

    // 7fps：一格 143ms；160ms 后必须真的换了一格。
    const first = d.actionFrame;
    clock.ms += 160;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("nod");
    expect(d.actionFrame).not.toBe(first);

    // 6 帧 @7fps = 857ms 一次性：末格停住即谢幕，手势那 1800ms 的时长不拿来硬撑。
    clock.ms += 750;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("摇头：9fps 循环行，靠手势时长 1800ms 收口，不许卡在摇头行上", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("shake", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("shake");
    expect(d.gestureId).toBe("shake");

    const first = d.actionFrame;
    clock.ms += 120;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("shake");
    expect(d.actionFrame).not.toBe(first);

    // 打到 1700ms 还在摇（循环行没提前谢幕）。
    clock.ms += 1_600;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("shake");

    clock.ms += 200;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("拍手：10fps 循环行，1800ms 到点谢幕", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("clap", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("clap");
    expect(d.gestureId).toBe("clap");

    const first = d.actionFrame;
    clock.ms += 110;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("clap");
    expect(d.actionFrame).not.toBe(first);

    clock.ms += 1_700;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("捂脸：8fps 循环行，时长 2000ms——1900ms 还在捂，2100ms 必须放下手", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    r.playGesture("coverFace", clock.ms);
    clock.ms += 16;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("coverFace");
    expect(d.gestureId).toBe("coverFace");

    clock.ms += 130;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("coverFace");
    expect(d.actionFrame).toBeGreaterThanOrEqual(1);

    clock.ms += 1_190;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBe("coverFace");

    clock.ms += 700;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.action).toBeNull();
    expect(d.gestureId).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("分区回馈当场重画：摸头/点脚不许等下一帧（4fps 档最坏 250ms，探针窗只有 200ms）", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0));
    view(r).draw(clock.ms);
    const rect = r.getHitRect();
    const cx = rect.x + rect.width / 2;
    r.tapAt(cx, rect.y + rect.height * 0.2, 20, clock.ms);
    const head = r.getGirlDiagnostics(clock.ms);
    expect(head.action).toBe("coverFace");
    expect(head.gestureId).toBe("coverFace");

    // 点脚回的 shiver 在 v1.25 有了自己那一行（原先借 wink 帧段）；同样必须当场起播。
    r.tapAt(cx, rect.y + rect.height * 0.85, 20, clock.ms);
    const feet = r.getGirlDiagnostics(clock.ms);
    expect(feet.gestureId).toBe("shiver");
    expect(feet.clip).toBeNull();
    expect(feet.action).toBe("shiver");
    r.dispose();
  });

  it("动作图缺席：退回各自原来的帧段（点头摇头=peek、拍手=happy、捂脸=shy）", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 15, 0), false);
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).atlases.actions).toBe(false);

    const fallback: Array<[string, string]> = [
      ["nod", "peek"], ["shake", "peek"], ["clap", "happy"], ["coverFace", "shy"],
    ];
    for (const [gesture, clip] of fallback) {
      r.playGesture(gesture, clock.ms);
      clock.ms += 16;
      view(r).draw(clock.ms);
      const d = r.getGirlDiagnostics(clock.ms);
      expect(d.action, gesture).toBeNull();
      expect(d.clip, gesture).toBe(clip);
      clock.ms += 2_100;
      view(r).draw(clock.ms);
    }
    r.dispose();
  });
});

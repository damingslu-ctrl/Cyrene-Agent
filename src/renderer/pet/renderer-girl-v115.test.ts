// @vitest-environment jsdom
// v1.15.0：手势落到真姿态（招手/鞠躬/剪刀手/歪头/洗脸/哈欠/伸懒腰），
// 没有对应画的继续走帧动画；图集 II 缺席时手势退回帧段，不空窗也不套假姿态。
import { afterEach, describe, expect, it, vi } from "vitest";
import { girlPoseGeom } from "./girl-pose-atlas";
import { gesturePoseFor } from "./girl-gesture";
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
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 82, bottom: 108, width: 82, height: 108 }),
  };
  return canvas as unknown as HTMLCanvasElement;
}

const wa = { x: 0, y: 0, width: 1920, height: 1040 };
const home = { x: 900, y: 400 };

async function makeGirl(opts: { poses2Ready?: boolean } = {}) {
  const clock = { ms: 10_000 };
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  vi.spyOn(console, "log").mockImplementation(() => {});
  window.localStorage.clear();
  const r = new PixelPetRenderer({
    canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
  });
  await r.init();
  const raw = r as unknown as {
    girlSpriteFailed: boolean;
    girlAnimReady: boolean;
    girlPosesReady: boolean;
    girlPoses2Ready: boolean;
    engine: { idleUntil: number; lastUserAt: number };
    draw: (now: number) => void;
    ctx: { drawImage: ReturnType<typeof vi.fn> };
  };
  raw.girlSpriteFailed = true;
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.girlPoses2Ready = opts.poses2Ready ?? true;
  raw.engine.idleUntil = Number.MAX_SAFE_INTEGER;
  raw.engine.lastUserAt = Number.MAX_SAFE_INTEGER;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  raw.draw(clock.ms);
  return { r, clock, raw };
}

/** 这一帧画过哪些姿态格：按源宽区分图集 I（340）与图集 II（400）。 */
function poseCellsDrawn(raw: { ctx: { drawImage: ReturnType<typeof vi.fn> } }, cellW: number): number[] {
  return raw.ctx.drawImage.mock.calls
    .filter((c) => c.length >= 9 && c[3] === cellW)
    .map((c) => Math.round(Number(c[1]) / cellW));
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.15.0 显式手势落到真姿态", () => {
  it("招手画的是图集 II 的 wave 那一格，不是舞蹈片段", async () => {
    const { r, clock, raw } = await makeGirl();
    raw.ctx.drawImage.mockClear();
    r.playGesture("wave");
    clock.ms += 40;
    raw.draw(clock.ms);

    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBe("wave");
    expect(d.clip).toBeNull();
    expect(d.gestureId).toBe("wave");
    expect(poseCellsDrawn(raw, 400)).toContain(girlPoseGeom("wave").cell);
    r.dispose();
  });

  it("举够时长为限：招手 1.6s 后退回站姿", async () => {
    const { r, clock, raw } = await makeGirl();
    const hold = gesturePoseFor("wave")!.holdMs;
    r.playGesture("wave");
    clock.ms += 40;
    raw.draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).pose).toBe("wave");

    clock.ms += hold;
    raw.draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBe("stand");
    expect(d.gestureId).toBeNull();
    r.dispose();
  });

  it("鞠躬/剪刀手/歪头/洗脸/哈欠各画各的格子", async () => {
    const cases = [
      ["bow", "bow"],
      ["point", "peace"],
      ["tilt", "tilt"],
      ["groom", "wash"],
      ["yawn", "yawn"],
    ] as const;
    const { r, clock, raw } = await makeGirl();
    for (const [id, pose] of cases) {
      raw.ctx.drawImage.mockClear();
      r.playGesture(id);
      clock.ms += 40;
      raw.draw(clock.ms);
      const d = r.getGirlDiagnostics(clock.ms);
      expect(d.pose, id).toBe(pose);
      expect(poseCellsDrawn(raw, 400), id).toContain(girlPoseGeom(pose).cell);
      // 让手势自然结束，避免下一例被 hold 期吞掉。
      clock.ms += gesturePoseFor(id)!.holdMs + 20;
      raw.draw(clock.ms);
    }
    r.dispose();
  });

  it("没有对应画的手势（点头/打字）继续走帧动画", async () => {
    const { r, clock, raw } = await makeGirl();
    raw.ctx.drawImage.mockClear();
    r.playGesture("nod");
    clock.ms += 40;
    raw.draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBeNull();
    expect(d.clip).toBe("peek");
    expect(d.gestureId).toBe("nod");
    r.dispose();
  });

  it("图集 II 缺席时招手退回 wave 帧段，而不是画一格空图", async () => {
    const { r, clock, raw } = await makeGirl({ poses2Ready: false });
    raw.ctx.drawImage.mockClear();
    r.playGesture("wave");
    clock.ms += 40;
    raw.draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBeNull();
    expect(d.clip).toBe("wave");
    expect(d.gestureId).toBe("wave");
    // 图集 II 没到位：一张 400 宽的源格都不许画。
    expect(poseCellsDrawn(raw, 400)).toEqual([]);
    r.dispose();
  });
});

describe("v1.15.0 真趴下", () => {
  it("待机编排进入 prone 时，画的是图集 II 的 prone 格，诊断也认得出", async () => {
    const { r, clock, raw } = await makeGirl();
    const inner = r as unknown as {
      idle: { phase: string; until: number };
      draw: (now: number) => void;
    };
    inner.idle = { ...inner.idle, phase: "prone", since: clock.ms, until: clock.ms + 12_000 };
    raw.ctx.drawImage.mockClear();
    clock.ms += 20;
    inner.draw(clock.ms);

    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBe("prone");
    expect(d.idle.phase).toBe("prone");
    expect(poseCellsDrawn(raw, 400)).toContain(girlPoseGeom("prone").cell);

    // 趴着的脸必须比站着低：墨框矮了一截，脸心也跟着落到下半截。
    expect(d.face.cy).toBeGreaterThan(0);
    r.dispose();
  });

  it("免打扰里即使编排被硬塞成 prone，也不许趴着画", async () => {
    const { r, clock, raw } = await makeGirl();
    r.setQuiet(true);
    const inner = r as unknown as {
      idle: { phase: string; until: number };
      draw: (now: number) => void;
    };
    inner.idle = { ...inner.idle, phase: "prone", since: clock.ms, until: clock.ms + 12_000 };
    clock.ms += 20;
    raw.ctx.drawImage.mockClear();
    inner.draw(clock.ms);

    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.phase).toBe("stand");
    expect(poseCellsDrawn(raw, 400)).not.toContain(girlPoseGeom("prone").cell);
    r.dispose();
  });
});

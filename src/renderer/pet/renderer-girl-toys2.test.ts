// @vitest-environment jsdom
// v1.11.0：纸箱/激光/梳毛/薄荷/纸飞机/小鸟接到 renderer 与引擎的缝上（纯函数各自有单测）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GIRL_BIRD_AWAY_LINES,
  GIRL_BIRD_LINES,
  GIRL_BOX_KNOCK_LINES,
  GIRL_BOX_START_LINES,
  GIRL_BRUSH_LINES,
  GIRL_CATNIP_LINES,
  GIRL_LASER_MISS_LINES,
  GIRL_PLANE_MISS_LINES,
} from "./companion";
import { BIRD_MS } from "./girl-bird";
import { BOX_MS } from "./girl-box";
import { BRUSH_MS } from "./girl-brush";
import { CATNIP_MS } from "./girl-catnip";
import { LASER_MS } from "./girl-laser";
import { PLANE_MS } from "./girl-plane";
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
  return {
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

const ZERO_STATS = {
  pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0,
  boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
};

async function makeGirl() {
  const clock = { ms: 10_000 };
  const loop = makeLoopDriver();
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
  // jsdom 不会真的加载立绘：走矢量兜底支路（同样会推进头顶道具与箱子的绘制）。
  (r as unknown as { girlSpriteFailed: boolean }).girlSpriteFailed = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock, loop };
}

function view(r: PixelPetRenderer) {
  return r as unknown as {
    draw: (now: number) => void;
    collectGirlAboveOps: (now: number, face: unknown, snapshot: unknown) => Array<{ kind: string }>;
    girlFaceAt: (now: number) => unknown;
    box: unknown;
    laser: unknown;
    brush: unknown;
    catnip: unknown;
    plane: unknown;
    bird: unknown;
  };
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
});

describe("v1.11.0 纸箱躲猫猫接缝", () => {
  it("敲门有回执；探头的脑袋点中＝抓住，箱子翻倒并落盘计数", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("box");
    expect(r.getGirlDiagnostics(clock.ms).box?.phase).toBe("enter");
    expect(GIRL_BOX_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);

    // 隐藏段：箱身盖过发顶，点箱面＝敲门。
    clock.ms += 1_000;
    view(r).draw(clock.ms);
    const hidden = r.getGirlDiagnostics(clock.ms).box!;
    expect(hidden.phase).toBe("hidden");
    r.tapAt(hidden.x, hidden.y, 20, clock.ms);
    const knocked = r.getGirlDiagnostics(clock.ms).box!;
    expect(knocked.knocks).toBe(1);
    expect(GIRL_BOX_KNOCK_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);

    // 探头段：脑袋露出来，点中就算抓住。
    clock.ms += 800;
    view(r).draw(clock.ms);
    const peek = r.getGirlDiagnostics(clock.ms).box!;
    expect(peek.phase).toBe("peek");
    expect(peek.head).not.toBeNull();
    r.tapAt(peek.head!.x, peek.head!.y, 20, clock.ms);
    const caught = r.getGirlDiagnostics(clock.ms);
    expect(caught.box?.caught).toBe(true);
    expect(caught.box?.phase).toBe("pop");
    expect(caught.stats.boxes).toBe(1);
    expect(JSON.parse(window.localStorage.getItem("cyrene.pet.bond.v1") ?? "{}").stats?.boxes).toBe(1);

    clock.ms += BOX_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).box).toBeNull();
    r.dispose();
  });

  it("箱子盖住脚边的球时，点箱面先敲箱，不被球偷走", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("box");
    clock.ms += 1_000;
    view(r).draw(clock.ms);
    const hidden = r.getGirlDiagnostics(clock.ms).box!;
    const center = { x: hidden.x + hidden.w / 2, y: hidden.y + hidden.h / 2 };
    // 球在视觉上已经被箱身盖住；把球摆到箱面正中，这一下必须归箱子。
    const toy = (view(r) as unknown as { toyState: { x: number; y: number; vx: number; vy: number; rest: boolean } }).toyState;
    toy.x = center.x;
    toy.y = center.y;
    toy.vx = 0;
    toy.vy = 0;
    toy.rest = true;

    r.tapAt(center.x, center.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).box?.knocks).toBe(1);
    expect(GIRL_BOX_KNOCK_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    r.dispose();
  });
});

describe("v1.11.0 激光/梳毛/薄荷接缝", () => {
  it("点中红点算扑到；空手一局到点自嘲并收起", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("laser");
    expect(r.getGirlDiagnostics(clock.ms).laser).not.toBeNull();
    clock.ms += 2_000;
    view(r).draw(clock.ms);
    const dot = r.getGirlDiagnostics(clock.ms).laser!;
    expect(dot.caught).toBe(false);
    r.tapAt(dot.x, dot.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).stats.lasers).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).laser?.caught).toBe(true);

    clock.ms += 1_000;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).laser).toBeNull();

    r.handleCommand("laser");
    clock.ms += LASER_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).laser).toBeNull();
    expect(GIRL_LASER_MISS_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    expect(r.getGirlDiagnostics(clock.ms).stats.lasers).toBe(1);
    r.dispose();
  });

  it("梳子每趟推到下一格；点梳子加一下顺毛；整轮走完才计数", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("brush");
    expect(r.getGirlDiagnostics(clock.ms).brush?.strokes).toBe(0);
    clock.ms += 1_300;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms).brush!;
    expect(d.strokes).toBe(1);
    r.tapAt(d.x, d.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).brush?.boosts).toBe(1);

    clock.ms += BRUSH_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).brush).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.brushes).toBe(1);
    expect(GIRL_BRUSH_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    r.dispose();
  });

  it("点薄荷枝只多喷一口；整轮结束记一次，数值不重复计", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("catnip");
    expect(r.getGirlDiagnostics(clock.ms).catnip?.phase).toBe("sniff");
    const sprig = r.getGirlDiagnostics(clock.ms).catnip!;
    r.tapAt(sprig.x, sprig.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).catnip?.puffs).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.catnips).toBe(0);

    clock.ms += CATNIP_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).catnip).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.catnips).toBe(1);
    expect(GIRL_CATNIP_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    r.dispose();
  });
});

describe("v1.11.0 纸飞机/小鸟接缝", () => {
  it("点中飞机算接住；不点就飞过去，收尾自嘲", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("plane");
    clock.ms += 2_000;
    view(r).draw(clock.ms);
    const plane = r.getGirlDiagnostics(clock.ms).plane!;
    expect(plane.caught).toBe(false);
    r.tapAt(plane.x, plane.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).stats.planes).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).plane?.caught).toBe(true);

    clock.ms += 1_000;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).plane).toBeNull();

    r.handleCommand("plane");
    clock.ms += PLANE_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).plane).toBeNull();
    expect(GIRL_PLANE_MISS_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    expect(r.getGirlDiagnostics(clock.ms).stats.planes).toBe(1);
    r.dispose();
  });

  it("小鸟只在停稳后可点；点走它只有一句话，不产出数值", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("bird");
    expect(GIRL_BIRD_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    // 飞入段点不到。
    const flying = r.getGirlDiagnostics(clock.ms).bird!;
    expect(flying.pose).toBe("in");
    expect(flying.clickable).toBe(false);

    clock.ms += 1_000;
    view(r).draw(clock.ms);
    const perched = r.getGirlDiagnostics(clock.ms).bird!;
    expect(perched.pose).toBe("perch");
    expect(perched.clickable).toBe(true);
    const before = { ...r.getCompanionSnapshot()!.stats };
    r.tapAt(perched.x, perched.y, 20, clock.ms);
    const after = r.getGirlDiagnostics(clock.ms);
    expect(after.bird?.pose).toBe("away");
    expect(GIRL_BIRD_AWAY_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    expect(after.stats).toEqual(before);

    clock.ms += BIRD_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bird).toBeNull();
    r.dispose();
  });
});

describe("v1.11.0 玩具互斥 / 成长记录 / 闸门", () => {
  it("同一时刻只留一件独演玩具：新玩具把上一件静默顶掉", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("wand");
    expect(r.getGirlDiagnostics(clock.ms).wand).not.toBeNull();
    r.handleCommand("box");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.wand).toBeNull();
    expect(d.box).not.toBeNull();

    r.handleCommand("laser");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.box).toBeNull();
    expect(d.laser).not.toBeNull();

    r.handleCommand("bird");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.laser).toBeNull();
    expect(d.bird).not.toBeNull();
    r.dispose();
  });

  it("成长记录：档位/天数/徽章/互动次数一行不差", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("growth");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("亲近 · 第 1 天\n徽章 0/10 · 互动 0 次");
    r.handleCommand("wand");
    const d = r.getGirlDiagnostics(clock.ms);
    r.tapAt(d.wand!.x, d.wand!.y, 20, clock.ms);
    r.handleCommand("growth");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("亲近 · 第 1 天\n徽章 1/10 · 互动 1 次");
    r.dispose();
  });

  it("四足形态一律不接；安静期一律不接", async () => {
    const { r, clock } = await makeGirl();
    r.setForm("cat");
    for (const cmd of ["box", "laser", "brush", "catnip", "plane", "bird", "growth"]) {
      r.handleCommand(cmd as never);
    }
    let d = r.getGirlDiagnostics(clock.ms);
    expect([d.box, d.laser, d.brush, d.catnip, d.plane, d.bird]).toEqual([null, null, null, null, null, null]);
    expect(d.stats).toEqual(ZERO_STATS);

    r.setForm("girl");
    r.setQuiet(true);
    for (const cmd of ["box", "laser", "brush", "catnip", "plane", "bird", "growth"]) {
      r.handleCommand(cmd as never);
    }
    d = r.getGirlDiagnostics(clock.ms);
    expect([d.box, d.laser, d.brush, d.catnip, d.plane, d.bird]).toEqual([null, null, null, null, null, null]);
    expect(d.stats).toEqual(ZERO_STATS);
    r.dispose();
  });

  it("睡着时不接地面玩具，但小鸟可以落在窗框上（正对照）", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("toggle-sleep");
    for (const cmd of ["box", "laser", "brush", "catnip", "plane"]) {
      r.handleCommand(cmd as never);
    }
    let d = r.getGirlDiagnostics(clock.ms);
    expect([d.box, d.laser, d.brush, d.catnip, d.plane]).toEqual([null, null, null, null, null]);
    expect(d.stats).toEqual(ZERO_STATS);

    r.handleCommand("bird");
    expect(r.getGirlDiagnostics(clock.ms).bird).not.toBeNull();
    expect(r.getCompanionSnapshot()?.activity).toBe("sleep");
    r.dispose();
  });
});

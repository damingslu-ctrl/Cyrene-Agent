// @vitest-environment jsdom
// v1.17.0：心情/本命/小把戏/拾荒/躲猫猫/薄荷盆接到 renderer 与引擎的缝上（纯函数各自有单测）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIDE_COVER_MS, HIDE_FOUND_MS, HIDE_PEEK_MS } from "./girl-hide";
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

async function makeGirl() {
  const clock = { ms: 10_000 };
  makeLoopDriver();
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
  (r as unknown as { girlSpriteFailed: boolean }).girlSpriteFailed = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock };
}

function view(r: PixelPetRenderer) {
  return r as unknown as {
    draw: (now: number) => void;
    collectGirlAboveOps: (now: number, face: unknown, snapshot: unknown) => Array<{ kind: string }>;
    girlFaceAt: (now: number) => unknown;
    hide: unknown;
    garden: unknown;
  };
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.17.0 躲猫猫接缝", () => {
  it("数三下→探头：探头里点一下就找到她，落盘 hides+1，收尾后清场", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("hide-seek");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("你来找我呀，数到三就探头");
    expect(r.getGirlDiagnostics(clock.ms).hide?.phase).toBe("cover");
    // 捂眼阶段点她＝太早，不算数。
    const face = r.getGirlDiagnostics(clock.ms).face;
    r.tapAt(face.cx, face.top + face.h / 2, 20, clock.ms);
    expect(r.getCompanionSnapshot()?.hides).toBe(0);
    expect(r.getGirlDiagnostics(clock.ms).hide?.phase).toBe("cover");

    clock.ms += HIDE_COVER_MS + 120;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hide?.phase).toBe("peek");
    r.tapAt(face.cx, face.top + face.h / 2, 20, clock.ms);
    expect(r.getCompanionSnapshot()?.hides).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("被找到啦！");
    expect(r.getGirlDiagnostics(clock.ms).hide?.phase).toBe("found");
    expect(JSON.parse(window.localStorage.getItem("cyrene.pet.bond.v1") ?? "{}").hides).toBe(1);

    clock.ms += HIDE_FOUND_MS + 40;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hide).toBeNull();
    r.dispose();
  });

  it("探头窗口没人点：由渲染端报一次「没找到」，不涨 hides，也不再重复报", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("hide-seek");
    clock.ms += HIDE_COVER_MS + HIDE_PEEK_MS + 30;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hide?.phase).toBe("miss");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("没找到我，我在这里呢");
    expect(r.getCompanionSnapshot()?.hides).toBe(0);
    view(r).draw(clock.ms + 100);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("没找到我，我在这里呢");
    clock.ms += 1_000;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hide).toBeNull();
    r.dispose();
  });

  it("睡着/免打扰时不接躲猫猫（engine 的闸门优先）", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("toggle-sleep");
    r.handleCommand("hide-seek");
    expect(r.getGirlDiagnostics(clock.ms).hide).toBeNull();
    r.dispose();
  });
});

describe("v1.17.0 薄荷盆接缝", () => {
  it("种下后脚边有盆；空盆/未熟两条回执走引擎；成熟前收不了", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("garden");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("薄荷盆 空着\n种一颗吧，很快会发芽");
    expect(r.getGirlDiagnostics(clock.ms).garden.stage).toBe("empty");

    // 报告是 2 级、动作回执是 1 级：单槽契约下报告没走完就不接同级以下（companion.test 锁着）。
    // 用户点了气泡（或等它过期）之后，种下的回执才说得出来。
    r.dismissBubble();
    r.handleCommand("garden-plant");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("种下啦，等它发芽");
    const d = r.getGirlDiagnostics(clock.ms).garden;
    expect(d.stage).toBe("seed");
    expect(d.ageMs).toBeGreaterThanOrEqual(0);

    // 盆真的画出来了：种下前后同一层多出至少三笔（盆底/描边/盆沿）。
    const face = view(r).girlFaceAt(clock.ms);
    const snapshot = r.getCompanionSnapshot();
    const before = view(r).collectGirlAboveOps(clock.ms, face, { ...snapshot!, gardenAge: -1 }).length;
    const after = view(r).collectGirlAboveOps(clock.ms, face, snapshot).length;
    expect(after - before).toBeGreaterThanOrEqual(3);

    r.handleCommand("garden-plant");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("盆里还种着东西呢");
    r.handleCommand("garden-harvest");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("还没长好，再等等");
    r.dispose();
  });
});

describe("v1.17.0 小把戏与三本账的命令接缝", () => {
  it("trick:<id> 教一次记一次，学会那下说台词；报告跟账本走", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("trick:high-five");
    expect(r.getCompanionSnapshot()?.tricks.counts["high-five"]).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("击掌 · 还差 2 次");
    r.handleCommand("trick:high-five");
    r.handleCommand("trick:high-five");
    expect(r.getCompanionSnapshot()?.tricks.counts["high-five"]).toBe(3);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("把手举高一点…啪！");

    r.handleCommand("tricks");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("小把戏 1/4");
    r.handleCommand("mood");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("今天的心情");
    r.handleCommand("favorite");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("本命玩具");
    r.handleCommand("treasures");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("小口袋 还没捡到过什么\n带我到处转转吧");
    clock.ms += 1;
    r.dispose();
  });

  it("闻一闻：捡到一件就进小口袋，气泡点名；报告能列出来", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("treasure");
    const snap = r.getCompanionSnapshot();
    expect(snap?.bubble?.text?.startsWith("捡到")).toBe(true);
    expect(Object.values(snap!.treasures.counts).reduce((a, b) => a + b, 0)).toBe(1);
    r.handleCommand("treasures");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("小口袋 1 件");
    r.dispose();
  });

  it("诊断口有 v1.17 六列，且都来自引擎快照（不另算一份）", async () => {
    const { r, clock } = await makeGirl();
    const d = r.getGirlDiagnostics(clock.ms) as unknown as {
      mood: string;
      favorite: unknown;
      tricks: number;
      treasures: number;
      garden: { stage: string; ageMs: number; harvests: number };
      hides: number;
      hide: unknown;
    };
    expect(d.mood).toBe("lively");
    expect(d.favorite).toBeNull();
    expect(d.tricks).toBe(0);
    expect(d.treasures).toBe(0);
    expect(d.garden).toEqual({ stage: "empty", ageMs: -1, harvests: 0 });
    expect(d.hides).toBe(0);
    expect(d.hide).toBeNull();
    r.dispose();
  });
});

// @vitest-environment jsdom
// v1.20.0「野性觉醒」接缝：两条菜单命令、野性姿态、诊断列与「没收尾不记账」。
// 纯模块与引擎各自有单测；这里验渲染端真的把野性接到命令、姿态与快照上。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WILD_COOLDOWN_MS,
  wildReport,
  emptyWild,
} from "./girl-wild";
import type { CompanionSnapshot } from "./companion";
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

async function makeGirl(wallMs: number): Promise<Harness> {
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
  const raw = r as unknown as { girlSpriteFailed: boolean; girlAnimReady: boolean; girlPosesReady: boolean; girlPoses2Ready: boolean };
  raw.girlSpriteFailed = true;
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.girlPoses2Ready = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock };
}

function view(r: PixelPetRenderer) {
  return r as unknown as { draw: (now: number) => void };
}

type Diag = ReturnType<PixelPetRenderer["getGirlDiagnostics"]> & {
  wild: CompanionSnapshot["wild"];
};

const diag = (r: PixelPetRenderer, now: number): Diag =>
  r.getGirlDiagnostics(now) as unknown as Diag;

/** 推着时钟画：一步 250ms，直到 `done` 为真或超时。 */
function drawUntil(
  h: Harness,
  done: () => boolean,
  stepMs = 250,
  maxSteps = 30,
): void {
  for (let i = 0; i < maxSteps; i += 1) {
    if (done()) return;
    h.clock.ms += stepMs;
    view(h.r).draw(h.clock.ms);
  }
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.20.0 野性账与诊断", () => {
  it("开局是家猫：0 点、只会冲刺、冷却满格", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    const wild = diag(r, clock.ms).wild!;
    expect(wild).toMatchObject({
      points: 0, level: "home", label: "家猫", act: null,
      zooms: 0, stalks: 0, hunts: 0, next: 3,
      unlocked: { zoom: true, stalk: false, hunt: false },
    });
    expect(wild.cooldownLeft).toBe(WILD_COOLDOWN_MS);
    r.dispose();
  });

  it("「野性到哪了」念三行账，一个字不差；不替她重来一发", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    r.handleCommand("wild-report");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(wildReport(emptyWild()).join("\n"));
    expect(diag(r, clock.ms).wild!.points).toBe(0);
    expect(diag(r, clock.ms).wild!.act).toBeNull();
    r.dispose();
  });
});

describe("v1.20.0 让她野一下", () => {
  it("当场冲刺：先收掉旧气泡，姿态换成奔跑，走完才记 1 点", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    r.handleCommand("clock");
    expect(r.getCompanionSnapshot()?.bubble).not.toBeNull();

    r.handleCommand("wild");
    const snap = r.getCompanionSnapshot()!;
    expect(snap.bubble).toBeNull();
    expect(snap.wild!.act).toBe("zoom");
    expect(snap.activity).toBe("walk");

    clock.ms += 16;
    view(r).draw(clock.ms);
    expect(diag(r, clock.ms).pose).toBe("run");
    // 跑起来还没到：账上仍是一张白纸。
    expect(diag(r, clock.ms).wild!.points).toBe(0);

    drawUntil({ r, clock }, () => diag(r, clock.ms).wild!.act === null);
    const done = diag(r, clock.ms).wild!;
    expect(done.act).toBeNull();
    expect(done.points).toBe(1);
    expect(done.zooms).toBe(1);
    expect(done.stalks).toBe(0);
    expect(done.hunts).toBe(0);
    expect(done.label).toBe("家猫");
    expect(diag(r, clock.ms).pose).not.toBe("run");
    r.dispose();
  });

  it("半路叫停「野性到哪了」：这一冲不算数，之后慢慢走完也不记账", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    r.handleCommand("wild");
    clock.ms += 250;
    view(r).draw(clock.ms);
    expect(diag(r, clock.ms).wild!.act).toBe("zoom");

    r.handleCommand("wild-report");
    expect(diag(r, clock.ms).wild!.act).toBeNull();
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(wildReport(emptyWild()).join("\n"));

    drawUntil({ r, clock }, () => diag(r, clock.ms).wild!.act === null && r.getCompanionSnapshot()?.activity !== "walk");
    const after = diag(r, clock.ms).wild!;
    expect(after.points).toBe(0);
    expect(after.zooms).toBe(0);
    r.dispose();
  });

  it("四足与安静里两条命令都不吭声", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 29, 14, 0));
    view(r).draw(clock.ms);
    r.setForm("cat");
    r.handleCommand("wild");
    r.handleCommand("wild-report");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    expect(diag(r, clock.ms).wild).toBeNull();

    r.setForm("girl");
    r.setQuiet(true);
    r.handleCommand("wild");
    r.handleCommand("wild-report");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    expect(diag(r, clock.ms).wild!.act).toBeNull();
    r.dispose();
  });
});

describe("v1.20.0 贴边藏身 × 移动令（命令不是锁）", () => {
  const edge = { x: wa.width - 82, y: 400 };
  const edgeBounds = { ...edge, width: 82, height: 108 };

  /**
   * 贴右边停着、藏身开关打开。Math.random 钉 0.9：猫娘的待机四档只会抽到
   * 「小动作」（gesture 权重 80，落点在 80–100），既不迈步、也高于野性的
   * 0.12 自主概率——6s 闲置计时才不会被一场自主漫游清零。
   */
  async function makeEdgeGirl() {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const h = await makeGirl(at(2026, 10, 29, 14, 0));
    h.r.syncGeometry({ bounds: edgeBounds, workArea: wa, tuckEnabled: true, tuckHinted: true, tuckLimit: 6 });
    const verge = (window as unknown as { verge: { resizePetWindow: ReturnType<typeof vi.fn> } }).verge;
    verge.resizePetWindow.mockClear();
    return { ...h, verge };
  }

  const xsOf = (verge: { resizePetWindow: ReturnType<typeof vi.fn> }) =>
    verge.resizePetWindow.mock.calls.map((args) => (args[0] as { x: number }).x);
  /**
   * 藏身的可观察量是 peekDx 不是窗口 x：computePetLayout 会把窗口钳在工作区边上
   * （#38 事故的修复——窗口永不出屏），位移折进 pinInWin，猫在窗内滑。
   */
  const peekOf = (verge: { resizePetWindow: ReturnType<typeof vi.fn> }) =>
    verge.resizePetWindow.mock.calls.map((args) => (args[0] as { peekDx: number }).peekDx);

  const step = (h: { r: PixelPetRenderer; clock: { ms: number } }, frames: number, done?: () => boolean) => {
    for (let i = 0; i < frames; i += 1) {
      if (done?.()) return;
      h.clock.ms += 250;
      view(h.r).draw(h.clock.ms);
    }
  };

  it("贴着右边还没藏：野性令只管跑，不许被「离边 60px」判死", async () => {
    const h = await makeEdgeGirl();
    step(h, 2); // 0.5s：离 6s 藏身门槛还远，只是「人在边上」
    h.r.handleCommand("wild");
    expect(h.r.getCompanionSnapshot()?.wild!.act).toBe("zoom");

    step(h, 10, () => h.r.getCompanionSnapshot()?.wild!.act === null);
    const done = h.r.getCompanionSnapshot()!.wild!;
    expect(done.act).toBeNull();
    expect(done.zooms).toBe(1);
    // 真的跑出去过（不是原地起跑又原地结算）
    expect(Math.min(...xsOf(h.verge))).toBeLessThan(edge.x - 100);
    h.r.dispose();
  });

  it("贴着右边已经藏起来：野性令先退藏身（窗口回基准位），这一趟照样记账", async () => {
    const h = await makeEdgeGirl();
    step(h, 60); // 15s：6s 后开始外滑，指数缓动够她滑到 40px
    expect(peekOf(h.verge).at(-1)).toBeGreaterThan(20);
    h.verge.resizePetWindow.mockClear();

    h.r.handleCommand("wild");
    step(h, 10, () => h.r.getCompanionSnapshot()?.wild!.act === null);
    // 第一拍就把 peek 归零（下一条几何载荷），不必等下一帧 tickTuck 慢慢滑回来
    expect(peekOf(h.verge)[0]).toBe(0);
    expect(h.r.getCompanionSnapshot()!.wild!.zooms).toBe(1);
    h.r.dispose();
  });

  it("贴着右边已经藏起来：散步令也先把她叫出来", async () => {
    const h = await makeEdgeGirl();
    step(h, 60);
    expect(peekOf(h.verge).at(-1)).toBeGreaterThan(20);
    h.verge.resizePetWindow.mockClear();

    h.r.handleCommand("wander");
    step(h, 10);
    expect(peekOf(h.verge)[0]).toBe(0);
    expect(h.r.getCompanionSnapshot()!.pos.x).toBeLessThan(edge.x - 50);
    h.r.dispose();
  });
});

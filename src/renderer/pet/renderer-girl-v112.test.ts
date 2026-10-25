// @vitest-environment jsdom
// v1.12.0：抓板/铃铛球/发条鼠/地鼠/抱抱/雨天/两本账接到 renderer 与引擎的缝上。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GIRL_BELL_START_LINES,
  GIRL_HUG_START_LINES,
  GIRL_MOLE_START_LINES,
  GIRL_MOUSE_START_LINES,
  GIRL_RAIN_START_LINES,
  GIRL_SCRATCH_START_LINES,
} from "./companion";
import { BELL_MS, BELL_RING_COOLDOWN_MS } from "./girl-bell";
import { HUG_MS, HUG_TAP_COOLDOWN_MS } from "./girl-hug";
import { MOLE_MS } from "./girl-mole";
import { MOUSE_MS, MOUSE_CATCH_MS } from "./girl-mouse";
import { RAIN_MS } from "./girl-rain";
import { SCRATCH_MS } from "./girl-scratch";
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
  scratches: 0, bells: 0, mice: 0, moles: 0, hugs: 0, purrs: 0, rains: 0, quests: 0,
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
  // jsdom 不会真的加载立绘：走矢量兜底支路（同样会推进道具层）。
  (r as unknown as { girlSpriteFailed: boolean }).girlSpriteFailed = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock, loop };
}

function view(r: PixelPetRenderer) {
  return r as unknown as {
    draw: (now: number) => void;
    collectGirlAboveOps: (now: number, face: unknown, snapshot: unknown) => Array<{ kind: string }>;
  };
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
});

describe("v1.12.0 抓板 / 铃铛球 / 发条鼠 / 地鼠", () => {
  it("抓板：板面点一下补一道痕；整轮走完才记一次磨爪", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("scratch");
    expect(r.getGirlDiagnostics(clock.ms).scratch?.phase).toBe("enter");
    expect(GIRL_SCRATCH_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);

    clock.ms += 700;
    view(r).draw(clock.ms);
    const board = r.getGirlDiagnostics(clock.ms).scratch!;
    expect(board.phase).toBe("scratch");
    expect(board.marks).toBe(0);
    r.tapAt(board.x, board.y, 20, clock.ms);
    const boosted = r.getGirlDiagnostics(clock.ms).scratch!;
    expect(boosted.marks).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.scratches).toBe(0);

    clock.ms += SCRATCH_MS;
    view(r).draw(clock.ms);
    const done = r.getGirlDiagnostics(clock.ms);
    expect(done.scratch).toBeNull();
    expect(done.stats.scratches).toBe(1);
    r.dispose();
  });

  it("铃铛球：点中球就响一声并计数；冷却内的第二下只被吞掉，不重复计", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("bell");
    expect(GIRL_BELL_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    const ball = r.getGirlDiagnostics(clock.ms).bell!;
    r.tapAt(ball.x, ball.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bell?.rings).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.bells).toBe(1);

    clock.ms += BELL_RING_COOLDOWN_MS - 40;
    const same = r.getGirlDiagnostics(clock.ms).bell!;
    r.tapAt(same.x, same.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bell?.rings).toBe(1);

    clock.ms += 100;
    const later = r.getGirlDiagnostics(clock.ms).bell!;
    r.tapAt(later.x, later.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bell?.rings).toBe(2);

    clock.ms += BELL_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bell).toBeNull();
    // 一轮摇过就在「陪它玩」目标上记一笔，但单件玩具不会直接算完成。
    expect(r.getGirlDiagnostics(clock.ms).stats.quests).toBe(0);
    r.dispose();
  });

  it("发条鼠：点中算抓住并计数；自己跑完只自嘲，不产出数值", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("mouse");
    expect(GIRL_MOUSE_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    clock.ms += 400;
    view(r).draw(clock.ms);
    const rat = r.getGirlDiagnostics(clock.ms).mouse!;
    expect(rat.caught).toBe(false);
    r.tapAt(rat.x, rat.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).mouse?.caught).toBe(true);
    expect(r.getGirlDiagnostics(clock.ms).stats.mice).toBe(1);

    clock.ms += MOUSE_CATCH_MS + 200;
    view(r).draw(clock.ms);
    const caught = r.getGirlDiagnostics(clock.ms);
    expect(caught.mouse).toBeNull();
    expect(caught.stats.mice).toBe(1);

    r.handleCommand("mouse");
    clock.ms += MOUSE_MS;
    view(r).draw(clock.ms);
    const missed = r.getGirlDiagnostics(clock.ms);
    expect(missed.mouse).toBeNull();
    expect(missed.stats.mice).toBe(1);
    r.dispose();
  });

  it("地鼠：只认冒头的那一只，同一只点两次不重复计；整轮收尾再记陪玩", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("mole");
    expect(GIRL_MOLE_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    clock.ms += 600;
    view(r).draw(clock.ms);
    const head = r.getGirlDiagnostics(clock.ms).mole!;
    expect(head.activeSlot).toBe(0);
    r.tapAt(head.x, head.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).mole?.hits).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.moles).toBe(1);

    // 同一只再点：模块不认，引擎也不该再记。
    r.tapAt(head.x, head.y, 20, clock.ms + 60);
    expect(r.getGirlDiagnostics(clock.ms).mole?.hits).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.moles).toBe(1);

    clock.ms += MOLE_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).mole).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.moles).toBe(1);
    r.dispose();
  });
});

describe("v1.12.0 抱抱 / 呼噜 / 雨天", () => {
  it("抱抱：一开场就计数并起呼噜；点上身＝再抱紧一点", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("hug");
    expect(GIRL_HUG_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.stats.hugs).toBe(1);
    expect(d.purrLeft).toBeGreaterThan(0);
    expect(d.hug?.taps).toBe(0);

    clock.ms += HUG_TAP_COOLDOWN_MS + 50;
    const hug = r.getGirlDiagnostics(clock.ms).hug!;
    r.tapAt(hug.x, hug.y, 20, clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.hug?.taps).toBe(1);
    expect(d.stats.hugs).toBe(1);

    clock.ms += HUG_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hug).toBeNull();
    r.dispose();
  });

  it("下雨：氛围层不占玩具槽，雨里还能照常玩；到点自己收", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("rain");
    expect(GIRL_RAIN_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    clock.ms += 700;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).rain?.amount).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.rains).toBe(1);

    // 雨不打断地面玩具：两件同时在。
    r.handleCommand("bell");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.bell).not.toBeNull();
    expect(d.rain).not.toBeNull();

    clock.ms += RAIN_MS;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.rain).toBeNull();
    expect(d.stats.rains).toBe(1);
    r.dispose();
  });
});

describe("v1.12.0 散步", () => {
  it("她正说着话时点散步：先收掉气泡再起步，不许被 canRoam 掰回 idle", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("pet");
    expect(r.getCompanionSnapshot()?.bubble).not.toBeNull();

    r.handleCommand("wander");
    clock.ms += 120;
    view(r).draw(clock.ms);
    const snap = r.getCompanionSnapshot()!;
    expect(snap.bubble).toBeNull();
    expect(snap.activity).toBe("walk");
    r.dispose();
  });
});

describe("v1.12.0 两本账 / 玩具互斥 / 闸门", () => {
  it("今日小目标与猫咪日记都由引擎开口", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("quests");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("今日小目标");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("摸摸头 0/5");
    r.handleCommand("diary");
    expect(r.getCompanionSnapshot()?.bubble?.text).toContain("猫咪日记");
    r.dispose();
  });

  it("同一时刻只留一件独演玩具：新玩具把上一件静默顶掉，且不结算", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("bell");
    r.handleCommand("scratch");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.bell).toBeNull();
    expect(d.scratch).not.toBeNull();

    r.handleCommand("mole");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.scratch).toBeNull();
    expect(d.mole).not.toBeNull();
    expect(d.stats.scratches).toBe(0);

    r.handleCommand("hug");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.mole).toBeNull();
    expect(d.hug).not.toBeNull();
    r.dispose();
  });

  it("四足形态与安静期一律不接；切回猫娘后恢复", async () => {
    const { r, clock } = await makeGirl();
    r.setForm("cat");
    for (const cmd of ["scratch", "bell", "mouse", "mole", "hug", "rain", "quests", "diary"]) {
      r.handleCommand(cmd as never);
    }
    let d = r.getGirlDiagnostics(clock.ms);
    expect([d.scratch, d.bell, d.mouse, d.mole, d.hug, d.rain]).toEqual([null, null, null, null, null, null]);
    expect(d.stats).toEqual(ZERO_STATS);

    r.setForm("girl");
    r.setQuiet(true);
    for (const cmd of ["scratch", "bell", "mouse", "mole", "hug", "rain", "quests", "diary"]) {
      r.handleCommand(cmd as never);
    }
    d = r.getGirlDiagnostics(clock.ms);
    expect([d.scratch, d.bell, d.mouse, d.mole, d.hug, d.rain]).toEqual([null, null, null, null, null, null]);
    expect(d.stats).toEqual(ZERO_STATS);

    r.setQuiet(false);
    r.handleCommand("scratch");
    expect(r.getGirlDiagnostics(clock.ms).scratch).not.toBeNull();
    r.dispose();
  });
});

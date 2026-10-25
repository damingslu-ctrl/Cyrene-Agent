// @vitest-environment jsdom
// v1.10.0：玩具箱/跟随/爪印/梦话云/成就接到 renderer 与引擎的缝上（纯函数各自有单测）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeRps } from "../../shared/pet-rps";
import { BUBBLES_MS } from "./girl-bubbles";
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

interface Probe {
  r: PixelPetRenderer;
  clock: { ms: number };
  loop: ReturnType<typeof makeLoopDriver>;
}

async function makeGirl(): Promise<Probe> {
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
  // jsdom 不会真的加载立绘：走矢量兜底支路（同样会推进头顶道具与爪印）。
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
    cat: { center: { x: number; y: number }; mood: string };
    wand: unknown;
    prints: unknown[];
  };
}

function advance(probe: Probe, frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    probe.clock.ms += 250;
    probe.loop.fire(probe.clock.ms);
  }
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
});

describe("v1.10.0 玩具箱接缝", () => {
  it("逗猫棒：命令建道具，点中兑现成 stats/成就并跟着羁绊落盘", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("wand");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.wand).not.toBeNull();
    expect(d.wand?.caught).toBe(false);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("羽毛在这儿——");

    r.tapAt(d.wand!.x, d.wand!.y, 20, clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.wand?.caught).toBe(true);
    expect(d.stats.wand).toBe(1);
    expect(d.achievements).toContain("first-wand");
    expect(d.achievement?.id).toBe("first-wand");
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("羽毛…还想再玩一次");

    const saved = JSON.parse(window.localStorage.getItem("cyrene.pet.bond.v1") ?? "{}");
    expect(saved.stats?.wand).toBe(1);
    expect(saved.achievements).toContain("first-wand");
    r.dispose();
  });

  it("泡泡：点破一只少一只，整组过寿命后读数归 null", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("bubbles");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.bubbles).toMatchObject({ live: 6, left: BUBBLES_MS });
    expect(d.bubbles?.spots).toHaveLength(6);

    const pos = d.bubbles!.spots[0];
    r.tapAt(pos.x, pos.y, 20, clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.bubbles?.live).toBe(5);
    expect(d.stats.bubbles).toBe(1);

    clock.ms += BUBBLES_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).bubbles).toBeNull();
    r.dispose();
  });

  it("落叶 / 猜拳 / 跟随：三条命令各就各位，猜拳读数与判词同源", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("leaves");
    expect(r.getGirlDiagnostics(clock.ms).leaves).not.toBeNull();

    r.handleCommand("rps:scissors");
    const rps = r.getGirlDiagnostics(clock.ms).rps;
    expect(rps?.player).toBe("scissors");
    expect(rps?.her).toMatch(/^(rock|scissors|paper)$/);
    expect(rps?.outcome).toBe(judgeRps("scissors", rps!.her as never));

    r.handleCommand("follow");
    const follow = r.getGirlDiagnostics(clock.ms).follow;
    expect(follow).not.toBeNull();
    expect(follow?.lastTargetX).toBe(home.x);
    r.setGazeTarget([200, 50]);
    const stepped = r.getGirlDiagnostics(clock.ms).follow;
    expect(stepped!.lastTargetX).toBeGreaterThan(home.x + 100);
    expect(stepped?.arrived).toBe(false);
    r.dispose();
  });

  it("四足形态一律不接玩具：命令不建道具也不记 stats", async () => {
    const { r, clock } = await makeGirl();
    r.setForm("cat");
    for (const cmd of ["wand", "bubbles", "leaves", "rps:rock", "follow"]) {
      r.handleCommand(cmd as never);
    }
    const d = r.getGirlDiagnostics(clock.ms);
    expect([d.wand, d.bubbles, d.leaves, d.rps, d.follow]).toEqual([null, null, null, null, null]);
    expect(d.stats).toEqual({
      pats: 0, catches: 0, wand: 0, bubbles: 0, pounces: 0,
      boxes: 0, lasers: 0, brushes: 0, catnips: 0, planes: 0,
      scratches: 0, bells: 0, mice: 0, moles: 0, hugs: 0, purrs: 0, rains: 0, quests: 0,
    });
    r.dispose();
  });

  it("安静期与睡着都不接玩具；睡着读的是引擎当下状态而不是上一帧表情", async () => {
    const { r, clock } = await makeGirl();
    r.setQuiet(true);
    r.handleCommand("wand");
    expect(r.getGirlDiagnostics(clock.ms).wand).toBeNull();
    r.setQuiet(false);

    r.handleCommand("toggle-sleep");
    // 不推帧：cat.mood 还停在 idle，闸门必须靠引擎 activity 当场拦下。
    r.handleCommand("wand");
    r.handleCommand("bubbles");
    expect(r.getGirlDiagnostics(clock.ms).wand).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).bubbles).toBeNull();
    r.dispose();
  });
});

describe("v1.10.0 跟随与地面记号接缝", () => {
  it("走路时脚边落爪印，切回四足就抹干净", async () => {
    const probe = await makeGirl();
    probe.r.roamTo({ x: home.x + 120, y: home.y });
    advance(probe, 8);
    expect(probe.r.getGirlDiagnostics(probe.clock.ms).prints).toBeGreaterThan(0);
    expect(view(probe.r).prints.length).toBeGreaterThan(0);
    probe.r.setForm("cat");
    expect(probe.r.getGirlDiagnostics(probe.clock.ms).prints).toBe(0);
    probe.r.dispose();
  });

  it("睡熟 1.8s 后头顶起梦话云；安静期一笔都不画", async () => {
    const probe = await makeGirl();
    probe.r.handleCommand("toggle-sleep");
    advance(probe, 10);
    const d = probe.r.getGirlDiagnostics(probe.clock.ms);
    expect(d.sleepSince).toBeGreaterThanOrEqual(0);
    const snapshot = probe.r.getCompanionSnapshot();
    expect(snapshot?.activity).toBe("sleep");
    const ops = view(probe.r).collectGirlAboveOps(probe.clock.ms, view(probe.r).girlFaceAt(probe.clock.ms), snapshot);
    expect(ops.length).toBeGreaterThan(0);
    probe.r.setQuiet(true);
    // draw 会把 quiet 期的 sleep 表情改写成 idle（月牙唯一记号），这本身就会让云消失；
    // 把 mood 掰回 sleep 再量一次，单验 buildDreamOps 自己的 quiet 闸也有牙。
    view(probe.r).cat.mood = "sleep";
    expect(view(probe.r).collectGirlAboveOps(probe.clock.ms, view(probe.r).girlFaceAt(probe.clock.ms), snapshot)).toEqual([]);
    probe.r.dispose();
  });

  it("成就徽章只弹 3.6s：解锁当场有笔，过期后头顶归零", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("wand");
    const d = r.getGirlDiagnostics(clock.ms);
    r.tapAt(d.wand!.x, d.wand!.y, 20, clock.ms);
    // 逗猫棒本体还在头顶，先摘掉，单独看徽章那一层。
    view(r).wand = null;
    const live = view(r).collectGirlAboveOps(clock.ms, view(r).girlFaceAt(clock.ms), r.getCompanionSnapshot());
    expect(live.length).toBeGreaterThan(0);
    clock.ms += 3_600;
    const expired = view(r).collectGirlAboveOps(clock.ms, view(r).girlFaceAt(clock.ms), r.getCompanionSnapshot());
    expect(expired).toEqual([]);
    r.dispose();
  });
});

// @vitest-environment jsdom
// v1.18.0：自娱五件玩具 + 声音输出接到 renderer 与引擎的缝上（纯函数各自有单测）。
// 声音不出声也能验：渲染端把「该响什么」交给一个可注入的 sink，测试拿到的就是发声台账。
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSoloReport, soloEndLine, soloStartLine } from "../../shared/pet-solo";
import { BALL_MS, BALL_PERIOD_MS } from "./girl-ball";
import { COMBO_MS, COMBO_STEPS } from "./girl-combo";
import { FISH_BITE_MS, FISH_BITS, FISH_CAST_MS, FISH_COOLDOWN_MS, FISH_MS } from "./girl-fishing";
import { LANTERN_MS } from "./girl-lantern";
import { MIRROR_CYCLE_MS, MIRROR_FACES, MIRROR_FACE_MS, MIRROR_MS } from "./girl-mirror";
import type { SfxEvent } from "./girl-sfx";
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
const FISH_LATE = FISH_BITS[3].at + FISH_BITE_MS;

interface Harness {
  r: PixelPetRenderer;
  clock: { ms: number };
  /** sink 台账：渲染端真交给发声层的那些事件，按先后排。 */
  calls: SfxEvent[];
}

async function makeGirl(opts: { sfx?: boolean } = {}): Promise<Harness> {
  const clock = { ms: 10_000 };
  const calls: SfxEvent[] = [];
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
  // 图集当作都在屏上：combo 那一格的节目手势要走真姿态路径，
  // 否则 startGirlGesture 没有兜底片段，诊断里的 gestureId 永远是 null。
  const raw = r as unknown as { girlAnimReady: boolean; girlPosesReady: boolean; girlPoses2Ready: boolean };
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.girlPoses2Ready = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  r.setSfxSink({ play: (event) => void calls.push(event) });
  if (opts.sfx === false) r.setSfxEnabled(false);
  return { r, clock, calls };
}

/** 一帧一帧推：玩具的时间线只由 draw 推进，真窗探针也是这么走的。 */
function run(h: Harness, from: number, to: number, step = 60): void {
  for (let t = from; t <= to; t += step) {
    h.clock.ms = t;
    view(h.r).draw(t);
  }
  h.clock.ms = to;
  view(h.r).draw(to);
}

function view(r: PixelPetRenderer) {
  return r as unknown as {
    draw: (now: number) => void;
    collectGirlAboveOps: (now: number, face: unknown, snapshot: unknown) => Array<{ kind: string }>;
    girlFaceAt: (now: number) => unknown;
    ball: unknown;
  };
}

type GirlDiag = ReturnType<PixelPetRenderer["getGirlDiagnostics"]> & {
  ball: { x: number; y: number; r: number; bounces: number; drops: number; streak: number; best: number; left: number } | null;
  combo: { step: number; steps: number; claps: number; streak: number; best: number; left: number } | null;
  lantern: { x: number; y: number; glow: number; moth: { x: number; y: number }; flares: number; scares: number; left: number } | null;
  fishing: { x: number; y: number; r: number; phase: string; catches: number; misses: number; escaped: number; left: number } | null;
  mirror: { x: number; y: number; w: number; h: number; expression: string | null; matched: number; streak: number; best: number; left: number } | null;
  solo: { ballBest: number; comboBest: number; flares: number; moths: number; fish: number; mirror: number; seen: string[] };
  sfx: { enabled: boolean; played: number; blocked: number };
};

const diag = (r: PixelPetRenderer, at: number): GirlDiag => r.getGirlDiagnostics(at) as unknown as GirlDiag;

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.18.0 拍皮球接缝", () => {
  it("命令起球→脚边有墨→踩点拍到记连击：一轮走完按峰值收进账本并落盘", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("ball");
    const born = clock.ms;
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloStartLine("ball"));
    const first = diag(r, born).ball;
    expect(first).not.toBeNull();
    expect(first!.left).toBe(BALL_MS);

    // 球真的画出来了：把这一件从渲染端摘掉，同一拍的墨就少了几笔。
    const face = view(r).girlFaceAt(born);
    const snapshot = r.getCompanionSnapshot();
    const withBall = view(r).collectGirlAboveOps(born, face, snapshot).length;
    view(r).ball = null;
    const without = view(r).collectGirlAboveOps(born, face, snapshot).length;
    view(r).ball = first && { bornAt: born, seed: 0.5, bounces: 0, drops: 0, streak: 0, best: 0, lastPatAt: -1 };
    expect(withBall - without).toBeGreaterThanOrEqual(2);

    // 落地那一拍点下去＝踩中：读数口给的坐标就是命中靶。
    r.tapAt(first!.x, first!.y, 20, born);
    expect(diag(r, born).ball!.bounces).toBe(1);
    expect(diag(r, born).ball!.streak).toBe(1);
    // 半空中抓＝掉球，连击清零。
    const mid = born + Math.round(BALL_PERIOD_MS / 2);
    const air = diag(r, mid).ball!;
    r.tapAt(air.x, air.y, 20, mid);
    expect(diag(r, mid).ball!.drops).toBe(1);
    expect(diag(r, mid).ball!.streak).toBe(0);
    // 下一拍再踩两下：峰值留 2。
    for (const t of [born + BALL_PERIOD_MS, born + BALL_PERIOD_MS * 2]) {
      const beat = diag(r, t).ball!;
      r.tapAt(beat.x, beat.y, 20, t);
    }
    expect(diag(r, born + BALL_PERIOD_MS * 2).ball!.best).toBe(2);

    run(h, born + BALL_PERIOD_MS * 2 + 10, born + BALL_MS + 40);
    expect(diag(r, clock.ms).ball).toBeNull();
    expect(r.getCompanionSnapshot()?.solo.ballBest).toBe(2);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloEndLine("ball", 2));
    expect(r.getCompanionSnapshot()?.stats.selfPlay).toBe(1);
    expect(JSON.parse(window.localStorage.getItem("cyrene.pet.bond.v1") ?? "{}").solo.ballBest).toBe(2);
    r.dispose();
  });

  it("每一拍落地自己响一声：同一拍重画不许叠声，也不许按帧数烧声", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("ball");
    const born = clock.ms;
    expect(diag(r, born).sfx.played).toBe(0);
    view(r).draw(born + BALL_PERIOD_MS);
    view(r).draw(born + BALL_PERIOD_MS);
    expect(diag(r, born + BALL_PERIOD_MS).sfx.played).toBe(1);
    expect(h.calls).toEqual(["bounce"]);
    run(h, born + BALL_PERIOD_MS + 20, born + BALL_PERIOD_MS * 3, 20);
    expect(diag(r, clock.ms).sfx.played).toBe(3);
    r.dispose();
  });

  it("免打扰里不接自娱；正演着时切进安静，声音当场停、账也不结", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.setQuiet(true);
    r.handleCommand("ball");
    expect(diag(r, clock.ms).ball).toBeNull();
    r.setQuiet(false);
    r.handleCommand("ball");
    const born = clock.ms;
    expect(diag(r, born).ball).not.toBeNull();
    run(h, born + 20, born + BALL_PERIOD_MS, 20);
    expect(diag(r, born + BALL_PERIOD_MS).sfx.played).toBe(1);
    // 中途进安静：她还在演，但不许再出一声（玩具的声也归免打扰管）。
    r.setQuiet(true);
    run(h, born + BALL_PERIOD_MS + 20, born + BALL_PERIOD_MS * 3, 20);
    expect(diag(r, clock.ms).sfx.played).toBe(1);
    expect(h.calls.filter((e) => e === "bounce")).toHaveLength(1);
    r.dispose();
  });

  it("菜单取消勾选＝一声不出；重新勾上下一拍就响（不等重启）", async () => {
    const h = await makeGirl({ sfx: false });
    const { r, clock } = h;
    expect(diag(r, clock.ms).sfx.enabled).toBe(false);
    r.handleCommand("ball");
    const born = clock.ms;
    run(h, born + 20, born + BALL_PERIOD_MS * 2, 20);
    expect(diag(r, clock.ms).sfx.played).toBe(0);
    expect(h.calls).toEqual([]);
    r.setSfxEnabled(true);
    r.handleCommand("ball");
    run(h, clock.ms + 20, clock.ms + BALL_PERIOD_MS, 20);
    expect(diag(r, clock.ms).sfx.played).toBe(1);
    r.dispose();
  });
});

describe("v1.18.0 节目单连招接缝", () => {
  it("台本一步一步演：换段真的换手势，拍点上鼓掌算跟上，谢幕自动响一遍", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("combo");
    const born = clock.ms;
    expect(diag(r, born).combo!.steps).toBe(COMBO_STEPS.length);
    expect(diag(r, born).combo!.step).toBe(0);
    expect(diag(r, born).combo!.left).toBe(COMBO_MS);

    // 走进第二步：那一拍她的肢体得换成那一步的手势（显式片下一帧才起，多画一帧）。
    const step1 = born + COMBO_STEPS[0].holdMs + 20;
    run(h, born + 10, step1, 10);
    view(r).draw(step1);
    expect(diag(r, step1).combo!.step).toBe(1);
    expect(diag(r, step1).gestureId).toBe(COMBO_STEPS[1].gesture);

    // 拍点＝每步最后 400ms：早拍只算催她，不算跟上。
    r.tapAt(41, 60, 20, born + COMBO_STEPS[0].holdMs - 500);
    expect(diag(r, born + COMBO_STEPS[0].holdMs - 500).combo!.claps).toBe(0);
    const onBeat = born + COMBO_STEPS[0].holdMs + COMBO_STEPS[1].holdMs - 50;
    r.tapAt(41, 60, 20, onBeat);
    expect(diag(r, onBeat).combo!.claps).toBe(1);
    expect(h.calls).toContain("combo-step");

    run(h, onBeat + 10, born + COMBO_MS + 40);
    expect(diag(r, clock.ms).combo).toBeNull();
    expect(h.calls).toContain("combo-final");
    expect(r.getCompanionSnapshot()?.solo.comboBest).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloEndLine("combo", 1));
    r.dispose();
  });

  it("空手演完只补一句：账本不动，也不记「自娱一次」", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("combo");
    const born = clock.ms;
    run(h, born + 10, born + COMBO_MS + 40);
    expect(diag(r, clock.ms).combo).toBeNull();
    expect(r.getCompanionSnapshot()?.solo.comboBest).toBe(0);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe("这次没玩出名堂");
    expect(r.getCompanionSnapshot()?.stats.selfPlay).toBe(0);
    r.dispose();
  });
});

describe("v1.18.0 夜灯与钓鱼接缝", () => {
  it("点灯记一次亮、点蛾单独一笔；走完一轮只把灯数入账", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("lantern");
    const born = clock.ms;
    expect(diag(r, born).lantern!.left).toBe(LANTERN_MS);
    const flame = diag(r, born).lantern!;
    r.tapAt(flame.x, flame.y, 20, born);
    expect(diag(r, born).lantern!.flares).toBe(1);
    expect(h.calls).toContain("flare");
    // 冷却内的第二下不许白点：灯数不涨，也不许穿过去摸到她。
    r.tapAt(flame.x, flame.y, 20, born + 40);
    expect(diag(r, born + 40).lantern!.flares).toBe(1);
    // 蛾子：只进 moths，不给灯数添彩。
    run(h, born + 60, born + 400, 20);
    const moth = diag(r, born + 400).lantern!.moth;
    r.tapAt(moth.x, moth.y, 20, born + 400);
    expect(diag(r, born + 400).lantern!.scares).toBe(1);
    expect(r.getCompanionSnapshot()?.solo.moths).toBe(1);
    expect(h.calls).toContain("moth");

    run(h, born + 460, born + LANTERN_MS + 40);
    expect(diag(r, clock.ms).lantern).toBeNull();
    expect(r.getCompanionSnapshot()?.solo.flares).toBe(1);
    expect(r.getCompanionSnapshot()?.solo.moths).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloEndLine("lantern", 1));
    r.dispose();
  });

  it("甩线一声、咬钩点中上鱼、平静时点算空竿、错过的口报跑鱼", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("fishing");
    const born = clock.ms;
    expect(h.calls).toContain("cast");
    expect(diag(r, born).fishing!.phase).toBe("cast");
    run(h, born + 20, born + FISH_CAST_MS + 10, 10);
    expect(diag(r, born + FISH_CAST_MS + 10).fishing!.phase).toBe("wait");

    // 平静时点浮标＝空竿（有声，但不上鱼）。
    const calm = diag(r, born + FISH_CAST_MS + 10).fishing!;
    r.tapAt(calm.x, calm.y, 20, born + FISH_CAST_MS + 10);
    expect(diag(r, born + FISH_CAST_MS + 10).fishing!.misses).toBe(1);
    expect(h.calls).toContain("empty");

    // 第一口咬钩：窗口内点中才算上鱼。
    const bite = born + FISH_BITS[0].at + 100;
    run(h, born + FISH_CAST_MS + 20, bite, 50);
    expect(diag(r, bite).fishing!.phase).toBe("bite");
    const bob = diag(r, bite).fishing!;
    r.tapAt(bob.x, bob.y, 20, bite);
    expect(diag(r, bite).fishing!.catches).toBe(1);
    expect(h.calls).toContain("catch");
    // 同一口过了冷却再点＝只算蹭一下。
    const nibbleAt = born + FISH_BITS[0].at + 200 + FISH_COOLDOWN_MS;
    const nibble = diag(r, nibbleAt).fishing!;
    r.tapAt(nibble.x, nibble.y, 20, nibbleAt);
    expect(diag(r, nibbleAt).fishing!.catches).toBe(1);
    expect(h.calls).toContain("nibble");

    // 剩下三口没人管：跑鱼要有声音，收账只按渔获。
    run(h, nibbleAt + 20, born + FISH_LATE + 200, 50);
    expect(diag(r, clock.ms).fishing!.escaped).toBe(3);
    expect(h.calls).toContain("escape");
    run(h, clock.ms + 10, born + FISH_MS + 40);
    expect(diag(r, clock.ms).fishing).toBeNull();
    expect(r.getCompanionSnapshot()?.solo.fish).toBe(1);
    r.dispose();
  });
});

describe("v1.18.0 照镜子接缝", () => {
  it("做脸那 1.4 秒点镜子＝接住，换脸当口点＝没接上（连击清零）；一轮按接住数入账", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("mirror");
    const born = clock.ms;
    expect(diag(r, born).mirror!.expression).toBe(MIRROR_FACES[0]);
    expect(diag(r, born).mirror!.left).toBe(MIRROR_MS);
    const glass = diag(r, born).mirror!;
    r.tapAt(glass.x, glass.y, 20, born);
    expect(diag(r, born).mirror!.matched).toBe(1);
    expect(h.calls).toContain("match");
    // 第二张脸再接住：连击往上走，音也一档比一档亮。
    const second = born + MIRROR_CYCLE_MS + 200;
    run(h, born + 60, second);
    expect(diag(r, second).mirror!.expression).toBe(MIRROR_FACES[1]);
    const glass2 = diag(r, second).mirror!;
    r.tapAt(glass2.x, glass2.y, 20, second);
    expect(diag(r, second).mirror!.streak).toBe(2);
    // 换脸的当口（做脸窗口之后）点＝没接上，连击清零。
    const gap = born + MIRROR_CYCLE_MS * 2 + MIRROR_FACE_MS + 100;
    run(h, second + 60, gap);
    expect(diag(r, gap).mirror!.expression).toBeNull();
    const glass3 = diag(r, gap).mirror!;
    r.tapAt(glass3.x, glass3.y, 20, gap);
    expect(diag(r, gap).mirror!.streak).toBe(0);
    expect(h.calls).toContain("wrong");

    run(h, gap + 60, born + MIRROR_MS + 40);
    expect(diag(r, clock.ms).mirror).toBeNull();
    expect(r.getCompanionSnapshot()?.solo.mirror).toBe(2);
    r.dispose();
  });
});

describe("v1.18.0 汇报、互斥与四足闸门", () => {
  it("「她自娱到哪了」只念账：三行封顶，不动她一根毛", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("solo");
    const text = r.getCompanionSnapshot()?.bubble?.text ?? "";
    expect(text).toBe(buildSoloReport(r.getCompanionSnapshot()!.solo).join("\n"));
    expect(text.split("\n").length).toBeLessThanOrEqual(3);
    const before = clock.ms;
    r.handleCommand("ball");
    expect(diag(r, clock.ms).ball).not.toBeNull();
    r.handleCommand("solo");
    expect(diag(r, before).ball).not.toBeNull();
    r.dispose();
  });

  it("五件互斥：起后一件顶掉前一件，顶掉的那一轮静默作废（不结算也不说话）", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.handleCommand("ball");
    const beat = diag(r, clock.ms).ball!;
    r.tapAt(beat.x, beat.y, 20, clock.ms);
    expect(diag(r, clock.ms).ball!.bounces).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloStartLine("ball"));
    r.handleCommand("mirror");
    expect(diag(r, clock.ms).ball).toBeNull();
    expect(diag(r, clock.ms).mirror).not.toBeNull();
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(soloStartLine("mirror"));
    expect(r.getCompanionSnapshot()?.solo.ballBest).toBe(0);
    expect(r.getCompanionSnapshot()?.stats.selfPlay).toBe(0);
    r.dispose();
  });

  it("四足形态不接自娱：菜单置灰之外，命令直接进来也不演、不记账、不念账", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    r.setForm("cat");
    const t = clock.ms;
    for (const cmd of ["ball", "combo", "lantern", "fishing", "mirror"] as const) {
      r.handleCommand(cmd);
    }
    expect(diag(r, t).ball).toBeNull();
    expect(diag(r, t).solo.seen).toEqual([]);
    r.handleCommand("solo");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    r.dispose();
  });
});

describe("v1.18.0 诊断台新列", () => {
  it("七列都在且初值干净；v1.17 那七列一个不删（只增不改）", async () => {
    const h = await makeGirl();
    const { r, clock } = h;
    const d = diag(r, clock.ms);
    expect(d.ball).toBeNull();
    expect(d.combo).toBeNull();
    expect(d.lantern).toBeNull();
    expect(d.fishing).toBeNull();
    expect(d.mirror).toBeNull();
    expect(d.solo).toEqual({ ballBest: 0, comboBest: 0, flares: 0, moths: 0, fish: 0, mirror: 0, seen: [] });
    expect(d.sfx).toEqual({ enabled: true, played: 0, blocked: 0 });
    for (const key of ["mood", "favorite", "tricks", "treasures", "garden", "hides", "hide"] as const) {
      expect(d, key).toHaveProperty(key);
    }
    r.dispose();
  });
});

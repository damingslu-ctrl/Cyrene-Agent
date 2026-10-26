// @vitest-environment jsdom
// v1.13.0：追尾巴/踩奶/翻跟头/看书/礼物/许愿/跳格子/下雪/抽签接到 renderer 与引擎的缝上。
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIRL_TAIL_DIZZY_LINES, GIRL_TAIL_START_LINES, GIRL_SNOW_START_LINES } from "./companion";
import { clipDurationMs } from "./girl-anim";
import { BOOK_MS } from "./girl-book";
import { FORTUNE_MS } from "./girl-fortune";
import { GIFT_MS } from "./girl-gift";
import { HOP_MS } from "./girl-hopscotch";
import { girlIdlePose } from "./girl-idle";
import { KNEAD_MS } from "./girl-knead";
import { ROLL_MS } from "./girl-roll";
import { SNOW_MS, SNOW_PACK_COOLDOWN_MS } from "./girl-snow";
import { TAIL_MS } from "./girl-tail";
import { WISH_MS } from "./girl-wish";
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
    clip: vi.fn(),
    drawImage: vi.fn(),
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
  (r as unknown as { girlSpriteFailed: boolean }).girlSpriteFailed = true;
  r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
  r.setForm("girl");
  return { r, clock, loop };
}

function view(r: PixelPetRenderer) {
  return r as unknown as {
    draw: (now: number) => void;
  };
}

/**
 * 图集就绪的猫娘：draw 走 tickGirlScene 与位图绘制（jsdom 没有真图，手动置 ready）。
 * 引擎的自主抽签钉死（idleUntil 推到很远），只剩待机编排在动，测试才能按 until 精确等段。
 */
async function makeAnimGirl() {
  const made = await makeGirl();
  const raw = made.r as unknown as {
    girlAnimReady: boolean;
    girlPosesReady: boolean;
    engine: { idleUntil: number; lastUserAt: number };
  };
  raw.girlAnimReady = true;
  raw.girlPosesReady = true;
  raw.engine.idleUntil = Number.MAX_SAFE_INTEGER;
  // 引擎的静息周期会在 40s 不互动后开坐垫：它会把 activity 掰成 rest，打断编排断言。
  raw.engine.lastUserAt = Number.MAX_SAFE_INTEGER;
  return made;
}

function ctxOf(r: PixelPetRenderer) {
  return (r as unknown as { ctx: { drawImage: ReturnType<typeof vi.fn> } }).ctx;
}

/** 这一帧画过哪些姿态格（姿态图集的格子宽 340，帧动画是 170，靠源宽区分）。 */
function poseCellsDrawn(r: PixelPetRenderer): number[] {
  return ctxOf(r).drawImage.mock.calls
    .filter((c) => c.length >= 9 && c[3] === 340)
    .map((c) => Math.round(Number(c[1]) / 340));
}

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
});

describe("v1.13.0 追尾巴 / 踩奶 / 翻跟头", () => {
  it("追尾巴：尾巴尖可点三次，第四下把自己晃晕；整轮走完才记一次", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("tail");
    expect(GIRL_TAIL_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);

    clock.ms += 700;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.tail?.phase).toBe("chase");
    expect(d.tail?.hits).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      d = r.getGirlDiagnostics(clock.ms);
      r.tapAt(d.tail!.x, d.tail!.y, 20, clock.ms);
      expect(r.getGirlDiagnostics(clock.ms).tail?.hits).toBe(i + 1);
      clock.ms += 400;
      view(r).draw(clock.ms);
    }
    expect(r.getGirlDiagnostics(clock.ms).stats.tails).toBe(0);

    const tip = r.getGirlDiagnostics(clock.ms).tail!;
    r.tapAt(tip.x, tip.y, 20, clock.ms);
    expect(GIRL_TAIL_DIZZY_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);

    clock.ms += TAIL_MS;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.tail).toBeNull();
    expect(d.stats.tails).toBe(1);
    r.dispose();
  });

  it("踩奶：点中软垫一下一下踩；整轮踩完记一次并起呼噜", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("knead");
    expect(r.getGirlDiagnostics(clock.ms).knead?.phase).toBe("settle");

    clock.ms += 600;
    view(r).draw(clock.ms);
    const pad = r.getGirlDiagnostics(clock.ms).knead!;
    expect(pad.phase).toBe("knead");
    r.tapAt(pad.x, pad.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).knead?.beats).toBe(1);
    expect(r.getGirlDiagnostics(clock.ms).stats.kneads).toBe(0);

    clock.ms += KNEAD_MS;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.knead).toBeNull();
    expect(d.stats.kneads).toBe(1);
    expect(d.purrLeft).toBeGreaterThan(0);
    r.dispose();
  });

  it("翻跟头：在翻滚区点一下翻一圈；没翻完不计数，整轮结束才记", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("roll");
    clock.ms += 600;
    view(r).draw(clock.ms);
    const spin = r.getGirlDiagnostics(clock.ms).roll!;
    expect(spin.phase).toBe("spin");
    r.tapAt(spin.x, spin.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).roll?.flips).toBe(1);

    clock.ms += ROLL_MS;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.roll).toBeNull();
    expect(d.stats.rolls).toBe(1);
    r.dispose();
  });
});

describe("v1.13.0 看书 / 礼物 / 许愿", () => {
  it("看书：点书页翻页；整本读完记一次，没读完被顶掉不结算", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("book");
    clock.ms += 600;
    view(r).draw(clock.ms);
    const book = r.getGirlDiagnostics(clock.ms).book!;
    expect(book.phase).toBe("read");
    r.tapAt(book.x, book.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).book?.pages).toBe(1);

    clock.ms += BOOK_MS;
    view(r).draw(clock.ms);
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.book).toBeNull();
    expect(d.stats.books).toBe(1);

    r.handleCommand("book");
    clock.ms += 600;
    view(r).draw(clock.ms);
    const next = r.getGirlDiagnostics(clock.ms).book!;
    r.handleCommand("gift");
    expect(r.getGirlDiagnostics(clock.ms).book).toBeNull();
    expect(next.pages).toBe(0);
    expect(r.getGirlDiagnostics(clock.ms).stats.books).toBe(1);
    r.dispose();
  });

  it("礼物盒：点开才计数；不拆就等它收走，什么都不记", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("gift");
    clock.ms += 400;
    view(r).draw(clock.ms);
    const box = r.getGirlDiagnostics(clock.ms).gift!;
    expect(box.opened).toBe(false);
    r.tapAt(box.x, box.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).gift?.opened).toBe(true);
    expect(r.getGirlDiagnostics(clock.ms).stats.gifts).toBe(1);

    clock.ms += GIFT_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).gift).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.gifts).toBe(1);

    r.handleCommand("gift");
    clock.ms += GIFT_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).gift).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.gifts).toBe(1);
    r.dispose();
  });

  it("许愿星：星子飘到头顶再许愿；只认一次，收起后不补记", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("wish");
    clock.ms += 1_000;
    view(r).draw(clock.ms);
    const star = r.getGirlDiagnostics(clock.ms).wish!;
    expect(star.phase).toBe("hover");
    r.tapAt(star.x, star.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).wish?.wished).toBe(true);
    expect(r.getGirlDiagnostics(clock.ms).stats.wishes).toBe(1);

    r.tapAt(star.x, star.y, 20, clock.ms + 50);
    expect(r.getGirlDiagnostics(clock.ms + 50).stats.wishes).toBe(1);

    clock.ms += WISH_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).wish).toBeNull();
    expect(r.getGirlDiagnostics(clock.ms).stats.wishes).toBe(1);
    r.dispose();
  });
});

describe("v1.13.0 跳格子 / 下雪 / 每日抽签", () => {
  it("跳格子：按顺序踩满三格才计数；踩错从头来", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("hopscotch");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.hopscotch?.squares).toHaveLength(3);
    expect(d.hopscotch?.next).toBe(0);

    // 先踩错一格：不计数、进度归零。
    const second = d.hopscotch!.squares[1];
    r.tapAt(second.x, second.y, 20, clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hopscotch?.next).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      clock.ms += 300;
      view(r).draw(clock.ms);
      d = r.getGirlDiagnostics(clock.ms);
      const sq = d.hopscotch!.squares[i];
      r.tapAt(sq.x, sq.y, 20, clock.ms);
    }
    expect(r.getGirlDiagnostics(clock.ms).stats.hopscotch).toBe(1);

    clock.ms += HOP_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).hopscotch).toBeNull();
    r.dispose();
  });

  it("下雪：三堆都能拍，拍成雪人记一次；雪是氛围层，不顶掉地上玩具", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("bell");
    r.handleCommand("snow");
    expect(GIRL_SNOW_START_LINES).toContain(r.getCompanionSnapshot()?.bubble?.text);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.bell).not.toBeNull();
    expect(d.snow).not.toBeNull();
    expect(d.snow?.built).toBe(false);
    expect(d.stats.snowmen).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      clock.ms += SNOW_PACK_COOLDOWN_MS + 60;
      view(r).draw(clock.ms);
      d = r.getGirlDiagnostics(clock.ms);
      const pile = d.snow!.piles[i];
      r.tapAt(pile.x + pile.w / 2, pile.y + pile.h / 2, 20, clock.ms);
    }
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.snow?.built).toBe(true);
    expect(d.stats.snowmen).toBe(1);

    r.handleCommand("rain");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.snow).toBeNull();
    expect(d.rain).not.toBeNull();
    r.handleCommand("snow");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.rain).toBeNull();
    expect(d.snow).not.toBeNull();

    clock.ms += SNOW_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).snow).toBeNull();
    r.dispose();
  });

  it("每日抽签：签纸可揭一次；同一天再抽照旧那张，也不重复记", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("fortune");
    clock.ms += 700;
    view(r).draw(clock.ms);
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.fortune?.phase).toBe("ready");
    expect(d.fortune?.revealed).toBe(false);
    const tier = d.fortune!.tier;
    r.tapAt(d.fortune!.x, d.fortune!.y, 20, clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.fortune?.revealed).toBe(true);
    expect(d.stats.fortunes).toBe(1);

    clock.ms += FORTUNE_MS;
    view(r).draw(clock.ms);
    expect(r.getGirlDiagnostics(clock.ms).fortune).toBeNull();

    r.handleCommand("fortune");
    clock.ms += 700;
    view(r).draw(clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.fortune?.tier).toBe(tier);
    expect(d.fortune?.revealed).toBe(false);
    r.tapAt(d.fortune!.x, d.fortune!.y, 20, clock.ms);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.stats.fortunes).toBe(1);
    r.dispose();
  });
});

describe("v1.13.0 闸门与互斥", () => {
  it("四足形态与安静期一律不接；切回猫娘后恢复", async () => {
    const { r, clock } = await makeGirl();
    const commands = ["tail", "knead", "roll", "book", "gift", "wish", "hopscotch", "snow", "fortune"];
    r.setForm("cat");
    for (const cmd of commands) r.handleCommand(cmd as never);
    let d = r.getGirlDiagnostics(clock.ms);
    expect([d.tail, d.knead, d.roll, d.book, d.gift, d.wish, d.hopscotch, d.snow, d.fortune])
      .toEqual([null, null, null, null, null, null, null, null, null]);
    expect(d.stats.snowmen).toBe(0);

    r.setForm("girl");
    r.setQuiet(true);
    for (const cmd of commands) r.handleCommand(cmd as never);
    d = r.getGirlDiagnostics(clock.ms);
    expect([d.tail, d.knead, d.roll, d.book, d.gift, d.wish, d.hopscotch, d.snow, d.fortune])
      .toEqual([null, null, null, null, null, null, null, null, null]);

    r.setQuiet(false);
    r.handleCommand("tail");
    expect(r.getGirlDiagnostics(clock.ms).tail).not.toBeNull();
    r.dispose();
  });

  it("新玩具也吃独演槽：下一件上来，上一件静默作废且不结算", async () => {
    const { r, clock } = await makeGirl();
    r.handleCommand("tail");
    r.handleCommand("book");
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.tail).toBeNull();
    expect(d.book).not.toBeNull();

    r.handleCommand("hopscotch");
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.book).toBeNull();
    expect(d.hopscotch).not.toBeNull();
    expect(d.stats.books).toBe(0);
    r.dispose();
  });
});

describe("v1.14.0 真姿态待机（站立 → 回头 → 坐 → 蜷 → 起身）", () => {
  it("待机画的是真姿态格，不再拿跳舞帧压扁装坐", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    ctxOf(r).drawImage.mockClear();
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.phase).toBe("stand");
    expect(d.idle.pose).toBe(girlIdlePose("stand"));
    expect(d.pose).toBe("stand");
    expect(d.clip).toBeNull();
    expect(d.gesture).toBeNull();
    expect(poseCellsDrawn(r)).toContain(0);

    // 一路等到她坐下；每次换段前清一次绘制记录，最后一笔就是坐姿那一帧。
    let sawSit = false;
    for (let i = 0; i < 16; i += 1) {
      ctxOf(r).drawImage.mockClear();
      clock.ms = d.idle.until + 1;
      draw();
      d = r.getGirlDiagnostics(clock.ms);
      expect(d.idle.pose).toBe(girlIdlePose(d.idle.phase as never));
      expect(d.clip).toBeNull();
      if (d.idle.phase === "sit") {
        sawSit = true;
        expect(d.pose).toBe("sit");
        expect(poseCellsDrawn(r)).toContain(1);
        break;
      }
    }
    expect(sawSit).toBe(true);
    r.dispose();
  });

  it("手势演完回到当前姿态：坐着挥手，挥完还是坐着", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    for (let i = 0; i < 16 && d.idle.phase !== "sit"; i += 1) {
      clock.ms = d.idle.until + 1;
      draw();
      d = r.getGirlDiagnostics(clock.ms);
    }
    expect(d.idle.phase).toBe("sit");

    r.playGesture("wave", clock.ms);
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.gesture).toBe("wave");
    expect(d.clip).toBe("wave");
    expect(d.pose).toBeNull();

    clock.ms += clipDurationMs("wave") + 16;
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.gesture).toBeNull();
    expect(d.pose).toBe("sit");
    expect(d.clip).toBeNull();
    expect(d.idle.phase).toBe("sit");
    r.dispose();
  });

  it("玩玩具时编排挂起；玩完回来站定，不再给一整支舞", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    for (let i = 0; i < 16 && d.idle.phase !== "sit"; i += 1) {
      clock.ms = d.idle.until + 1;
      draw();
      d = r.getGirlDiagnostics(clock.ms);
    }
    expect(d.idle.phase).toBe("sit");

    r.handleCommand("tail");
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.tail).not.toBeNull();
    expect(d.idle.suspended).toBe(true);
    expect(d.idle.phase).toBe("stand");
    expect(d.pose).toBe("stand");
    for (let k = 0; k < 8; k += 1) {
      clock.ms += 100;
      draw();
    }
    expect(r.getGirlDiagnostics(clock.ms).idle.phase).toBe("stand");

    clock.ms += TAIL_MS;
    draw();
    // 玩具结算挂在同一帧的 tickTail 里，而编排在它之前推：断言的这一帧编排还看得见玩具。
    // 下一帧才解除挂起——真机上就是 8~33ms，探针也按重绘等。
    clock.ms += 16;
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.tail).toBeNull();
    expect(d.idle.suspended).toBe(false);
    expect(d.idle.phase).toBe("stand");
    expect(d.pose).toBe("stand");
    expect(d.idle.until - clock.ms).toBeGreaterThan(2_000);
    r.dispose();
  });

  it("站定一段只接一条自主小动作，其余时间画真站姿", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    const engine = (r as unknown as {
      engine: { ambientGesture: string | null; gestureUntil: number };
    }).engine;
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.phase).toBe("stand");

    // 700ms 后的站定：第一条引擎小动作可以演。
    clock.ms += 700;
    engine.ambientGesture = "wave";
    engine.gestureUntil = clock.ms + 2_000;
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.gesture).toBe("wave");
    expect(d.clip).toBe("wave");
    expect(d.pose).toBeNull();

    // 同一段站定里再来一条：让位给站姿——一站起来就开始连续跳舞，
    // 待机就还是「只会跳舞」，只是换了个底子。
    clock.ms += clipDurationMs("wave") + 100;
    engine.ambientGesture = "nod";
    engine.gestureUntil = clock.ms + 1_500;
    draw();
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.phase).toBe("stand");
    expect(engine.ambientGesture).toBe("nod");
    expect(d.gesture).toBeNull();
    expect(d.clip).toBeNull();
    expect(d.pose).toBe("stand");
    r.dispose();
  });

  it("摸头这类回馈手势在活动态里照演：站姿闸门只关待机编排", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    draw();
    clock.ms += 700;
    draw();
    expect(r.getGirlDiagnostics(clock.ms).idle.phase).toBe("stand");

    r.touch("head");
    clock.ms += 40;
    draw();
    const d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.suspended).toBe(true);
    expect(d.gesture).toBe("shy");
    expect(d.clip).toBe("shy");
    r.dispose();
  });

  it("安静期只站/看/坐，绝不蜷、绝不庆祝", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    r.setQuiet(true);
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.idle.phase).toBe("stand");
    expect(d.pose).toBe("stand");

    const phases: string[] = [];
    // 安静档的 sit 只从 stand 以 24% 权重进（look→stand 固定），固定种子的头一串
    // 十几段里才第一次坐下；步数要够跨过那串 look/stand，否则测的是抖动运气。
    for (let i = 0; i < 24; i += 1) {
      clock.ms = d.idle.until + 1;
      draw();
      d = r.getGirlDiagnostics(clock.ms);
      phases.push(d.idle.phase);
      expect(d.idle.pose).toBe(girlIdlePose(d.idle.phase as never));
    }
    expect(phases).toContain("sit");
    expect(phases).not.toContain("curl");
    expect(phases).not.toContain("joy");
    r.dispose();
  });

  it("睡着画蜷；打开安静立刻站起来，月牙与睡脸不同屏", async () => {
    const { r, clock } = await makeAnimGirl();
    const draw = () => view(r).draw(clock.ms);
    draw();
    const standFace = r.getGirlDiagnostics(clock.ms).face;

    r.handleCommand("toggle-sleep");
    ctxOf(r).drawImage.mockClear();
    draw();
    let d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBe("curl");
    expect(d.clip).toBeNull();
    expect(d.idle.suspended).toBe(true);
    expect(d.face.cy).toBeGreaterThan(standFace.cy + 2);
    expect(poseCellsDrawn(r)).toContain(2);
    const curlFace = d.face;

    r.setQuiet(true);
    d = r.getGirlDiagnostics(clock.ms);
    expect(d.pose).toBe("stand");
    expect(d.clip).toBeNull();
    expect(d.face.cy).toBeLessThan(curlFace.cy);
    r.dispose();
  });
});

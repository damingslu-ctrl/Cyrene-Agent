// @vitest-environment jsdom
// v1.19.0「她的一天」接缝：两只汇报嘴、30s 时辰拍、深夜自动睡醒与诊断列。
// 纯函数与引擎各自有单测；这里验的是渲染端真的把这几条接到命令、每帧拍与快照上。
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockLine, phaseLine, skyLine } from "./girl-clock";
import { festivalOn, nextFestival } from "./girl-festival";
import { SKY_MARK } from "./girl-day-art";
import { opsBounds, type DrawOp } from "./ops";
import type { GirlFaceBox } from "./girl-sprite";
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
  wall: { ms: number };
}

/** 墙上时钟可拨（只拨 Date.now），行为秒表从 10s 起。 */
async function makeGirl(wallMs: number): Promise<Harness> {
  const clock = { ms: 10_000 };
  const wall = { ms: wallMs };
  makeLoopDriver();
  (window as unknown as { verge: unknown }).verge = {
    resizePetWindow: vi.fn(),
    tuckHinted: vi.fn(),
    settlePetPosition: vi.fn(),
  };
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
  vi.spyOn(Date, "now").mockImplementation(() => wall.ms);
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
  return { r, clock, wall };
}

function view(r: PixelPetRenderer) {
  return r as unknown as { draw: (now: number) => void };
}

type Diag = ReturnType<PixelPetRenderer["getGirlDiagnostics"]> & {
  clock: {
    phase: string;
    sky: { kind: string; watched: boolean } | null;
    skies: { sunrise: number; sunset: number; moon: number };
    festival: { id: string; label: string; ornament: string } | null;
    festivals: number;
    autoSleep: boolean;
  } | null;
  clockCheckInMs: number;
};

const diag = (r: PixelPetRenderer, now: number): Diag =>
  r.getGirlDiagnostics(now) as unknown as Diag;

afterEach(() => {
  delete (window as unknown as { verge?: unknown }).verge;
  vi.restoreAllMocks();
});

describe("v1.19.0 两只汇报嘴", () => {
  it("「看看现在几点」三行：此刻几点、下一个节日、还有几天", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    r.handleCommand("clock");
    const wall = Date.now();
    const next = nextFestival(wall);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(
      [clockLine(wall), `下一个 ${next.def.label}`, `还有 ${next.days} 天`].join("\n"),
    );
    r.dispose();
  });

  it("「今天是节日吗」：平时老实说不是；节日当天报当天那句", async () => {
    const plain = await makeGirl(at(2026, 10, 28, 18, 20));
    plain.r.handleCommand("festival");
    const plainText = plain.r.getCompanionSnapshot()?.bubble?.text ?? "";
    expect(plainText.split("\n")).toHaveLength(3);
    expect(plainText).toContain("今天不是节日");
    plain.r.dispose();

    const xmas = await makeGirl(at(2026, 12, 25, 10, 0));
    xmas.r.handleCommand("festival");
    const today = festivalOn(Date.now())!;
    expect(xmas.r.getCompanionSnapshot()?.bubble?.text).toBe(
      `今天是 ${today.label}\n${today.line}`,
    );
    xmas.r.dispose();
  });

  it("四足与安静里都不吭声：命令进得去也不开口", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    r.setForm("cat");
    r.handleCommand("clock");
    r.handleCommand("festival");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    expect(diag(r, clock.ms).clock).toBeNull();

    r.setForm("girl");
    r.setQuiet(true);
    r.handleCommand("clock");
    r.handleCommand("festival");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();
    r.dispose();
  });
});

describe("v1.19.0 时辰拍", () => {
  it("开机第一拍只记账不出声；换段要等到下一拍才开口", async () => {
    const { r, clock, wall } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    expect(diag(r, clock.ms).clock?.phase).toBe("dusk");
    expect(diag(r, clock.ms).clockCheckInMs).toBe(30_000);
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();

    wall.ms = at(2026, 10, 28, 19, 10);
    view(r).draw(clock.ms + 29_999);
    expect(diag(r, clock.ms).clock?.phase).toBe("evening");
    expect(r.getCompanionSnapshot()?.bubble).toBeNull();

    view(r).draw(clock.ms + 30_000);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(phaseLine("evening"));
    r.dispose();
  });

  it("深夜闲着三分钟自己睡，早上五点自己醒；人一动就不睡", async () => {
    const { r, clock, wall } = await makeGirl(at(2026, 10, 28, 23, 35));
    view(r).draw(clock.ms);

    // 光标还在动：活动标记压住自动睡。
    r.setUserActive(true);
    wall.ms = at(2026, 10, 28, 23, 38, 30);
    view(r).draw(clock.ms + 30_000);
    expect(r.getCompanionSnapshot()?.activity).not.toBe("sleep");
    expect(diag(r, clock.ms).clock?.autoSleep).toBe(false);

    // 人离开满 3 分钟：下一拍照睡，读数口承认是自动睡。
    r.setUserActive(false);
    wall.ms = at(2026, 10, 28, 23, 41, 30);
    view(r).draw(clock.ms + 60_000);
    expect(r.getCompanionSnapshot()?.activity).toBe("sleep");
    expect(diag(r, clock.ms).clock?.autoSleep).toBe(true);

    // 05:00 自己伸个懒腰醒来。
    wall.ms = at(2026, 10, 29, 5, 0, 10);
    view(r).draw(clock.ms + 90_000);
    expect(r.getCompanionSnapshot()?.activity).toBe("stretch");
    expect(diag(r, clock.ms).clock?.autoSleep).toBe(false);
    r.dispose();
  });
});

describe("v1.19.0 天色记号与节日挂饰", () => {
  const face = (): GirlFaceBox => ({
    cx: 41, cy: 18, w: 20, h: 14, left: 31, right: 51, top: 11, bottom: 25,
  });
  const above = (r: PixelPetRenderer, now: number, snap: CompanionSnapshot | null) =>
    (r as unknown as {
      collectGirlAboveOps: (n: number, f: GirlFaceBox, s: CompanionSnapshot | null) => DrawOp[];
    }).collectGirlAboveOps(now, face(), snap);

  it("日落记号画在窗角，看过/安静就不画；点它她抬头看天，点别处不算", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    const snap = r.getCompanionSnapshot()!;
    expect(snap.clock!.sky).toEqual({ kind: "sunset", watched: false });

    const withMark = above(r, clock.ms, snap);
    const watchedSnap: CompanionSnapshot = {
      ...snap, clock: { ...snap.clock!, sky: { kind: "sunset", watched: true } },
    };
    const watchedOps = above(r, clock.ms, watchedSnap);
    const delta = withMark.length - watchedOps.length;
    expect(delta).toBeGreaterThanOrEqual(3);
    // 记号是一整块插在最前面的：整枚落在左上角，不压猫身。
    const markBox = opsBounds(withMark.slice(0, delta))!;
    expect(markBox.x).toBeGreaterThanOrEqual(0);
    expect(markBox.y).toBeGreaterThanOrEqual(0);
    expect(markBox.x + markBox.width).toBeLessThan(30);
    expect(markBox.y + markBox.height).toBeLessThan(30);

    // 安静期不画：月牙是安静唯一的记号，天上那枚不许跟着亮。
    r.setQuiet(true);
    const quietSnap = r.getCompanionSnapshot()!;
    expect(quietSnap.clock!.sky).toEqual({ kind: "sunset", watched: false });
    expect(above(r, clock.ms, quietSnap).length).toBe(above(r, clock.ms, {
      ...quietSnap, clock: { ...quietSnap.clock!, sky: { kind: "sunset", watched: true } },
    }).length);
    r.setQuiet(false);

    // 点别处（脚边）不算看天。
    r.tapAt(41, 95, 0, clock.ms);
    expect(diag(r, clock.ms).clock!.skies).toEqual({ sunrise: 0, sunset: 0, moon: 0 });

    // 点记号：记一场、说一句、记号收掉。
    r.tapAt(SKY_MARK.x, SKY_MARK.y, 0, clock.ms);
    const after = diag(r, clock.ms).clock!;
    expect(after.sky).toEqual({ kind: "sunset", watched: true });
    expect(after.skies.sunset).toBe(1);
    expect(r.getCompanionSnapshot()?.bubble?.text).toBe(skyLine("sunset"));
    const afterSnap = r.getCompanionSnapshot()!;
    expect(above(r, clock.ms + 16, afterSnap).length).toBe(
      above(r, clock.ms + 16, {
        ...afterSnap, clock: { ...afterSnap.clock!, sky: { kind: "sunset", watched: false } },
      }).length - (withMark.length - watchedOps.length),
    );
    r.dispose();
  });

  it("节日挂饰由快照驱动：有节日就挂头发另一侧，平日一件不挂", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    const snap = r.getCompanionSnapshot()!;
    expect(snap.clock!.festival).toBeNull();
    const plain = above(r, clock.ms, snap);

    const sig = (op: DrawOp) => JSON.stringify(op);
    const plainSet = new Set(plain.map(sig));
    const withFest = above(r, clock.ms, {
      ...snap,
      clock: { ...snap.clock!, festival: { id: "christmas", label: "圣诞节", ornament: "star" } },
    });
    const extra = withFest.filter((op) => !plainSet.has(sig(op)));
    expect(extra.length).toBeGreaterThanOrEqual(3);
    const box = opsBounds(extra)!;
    // 米色描边/光边与墨色都在（挂饰也画在桌布上）。
    const colors = extra.flatMap((op) => ("fill" in op ? [op.fill] : "stroke" in op ? [op.stroke] : []));
    expect(colors.some((c) => c.includes("247, 244, 236"))).toBe(true);
    expect(colors.some((c) => !c.includes("247, 244, 236"))).toBe(true);
    // facing 1 时装扮槽在右侧，挂饰挂左侧；整枚在头顶附近、不出窗。
    expect(box.x + box.width / 2).toBeLessThan(face().cx);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeLessThan(face().bottom + 6);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(82);
    r.dispose();
  });
});

describe("v1.19.0 诊断台新列", () => {
  it("clock 与 clockCheckInMs 都在：girl 有读数（天色/节日/自动睡），cat 恒 null", async () => {
    const { r, clock } = await makeGirl(at(2026, 10, 28, 18, 20));
    view(r).draw(clock.ms);
    const d = diag(r, clock.ms);
    expect(d.clock).toMatchObject({
      phase: "dusk",
      sky: { kind: "sunset", watched: false },
      skies: { sunrise: 0, sunset: 0, moon: 0 },
      festival: null,
      festivals: 0,
      autoSleep: false,
    });
    expect(d.clockCheckInMs).toBeGreaterThanOrEqual(0);
    expect(d.clockCheckInMs).toBeLessThanOrEqual(30_000);
    r.setForm("cat");
    expect(diag(r, clock.ms).clock).toBeNull();
    r.dispose();
  });
});

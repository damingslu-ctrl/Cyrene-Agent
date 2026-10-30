import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import {
  GIRL_ACTIONS,
  GIRL_ACTION_FACE,
  GIRL_ACTION_INK,
  GIRL_ACTION_ROWS,
  type GirlActionId,
} from "./girl-actions-meta";
import {
  girlActionDurationMs,
  girlActionFrameAt,
  girlActionFrameCount,
  girlActionRedrawFloor,
} from "./girl-action";
import {
  girlActionBodyFor,
  girlActionCellPoint,
  girlActionFaceBox,
  girlActionInkBox,
} from "./girl-sprite";

const SIZE_U = 37;
const S = (SIZE_U * 2) / 120;
const IDS = Object.keys(GIRL_ACTION_ROWS) as GirlActionId[];

function mk(overrides: Partial<CatInput> = {}): CatInput {
  return {
    center: { x: 100, y: 200 },
    u: SIZE_U,
    mood: "idle",
    t: 0,
    energy: 1,
    mouse: null,
    blink: 0,
    jumpY: 0,
    pet: 0,
    quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
    ...overrides,
  };
}

describe("动作图集：一式一条动画", () => {
  it("每式各占一行、各有自己的帧表与节拍（不是同一段动画换皮）", () => {
    expect(GIRL_ACTIONS.cols * GIRL_ACTIONS.rows).toBe(GIRL_ACTIONS.count);
    expect(new Set(IDS.map((id) => GIRL_ACTION_ROWS[id].row)).size).toBe(IDS.length);
    // v1.23 起 11 行分 6–12fps，节拍不再逐行唯一；改钉「每行的画各不相同」——
    // 帧率撞车无所谓，墨表撞车才是同一段动画换皮。
    expect(new Set(IDS.map((id) => JSON.stringify(GIRL_ACTION_INK[id]))).size).toBe(IDS.length);
    expect(new Set(IDS.map((id) => JSON.stringify(GIRL_ACTION_FACE[id]))).size).toBe(IDS.length);
    expect(IDS).toEqual([
      "zoom", "stalk", "hunt", "eat", "bat", "hop", "type", "nod", "shake", "clap", "coverFace",
    ]);
    for (const id of IDS) {
      const row = GIRL_ACTION_ROWS[id];
      expect(row.frames, id).toBe(GIRL_ACTIONS.cols);
      expect(girlActionFrameCount(id)).toBe(row.frames);
      expect(GIRL_ACTION_INK[id]).toHaveLength(row.frames);
      expect(GIRL_ACTION_FACE[id]).toHaveLength(row.frames);
      // 同一行的尺：k 与躯干轴逐行给，否则换行画出来会换身高。
      expect(row.inkRefPx).toBeGreaterThan(0);
      expect(row.anchorX).toBeGreaterThan(0.2);
      expect(row.anchorX).toBeLessThan(0.8);
    }
    // 任意两式的首帧墨框都不是同一张画。
    expect(GIRL_ACTION_INK.zoom[0]).not.toEqual(GIRL_ACTION_INK.stalk[0]);
    expect(GIRL_ACTION_INK.stalk[0]).not.toEqual(GIRL_ACTION_INK.hunt[0]);
    expect(GIRL_ACTION_FACE.zoom[0]).not.toEqual(GIRL_ACTION_FACE.hunt[0]);
    expect(GIRL_ACTION_INK.eat[0]).not.toEqual(GIRL_ACTION_INK.bat[0]);
    expect(GIRL_ACTION_INK.bat[0]).not.toEqual(GIRL_ACTION_INK.type[0]);
    expect(GIRL_ACTION_FACE.eat[0]).not.toEqual(GIRL_ACTION_FACE.type[0]);
    expect(GIRL_ACTION_INK.nod[0]).not.toEqual(GIRL_ACTION_INK.shake[0]);
    expect(GIRL_ACTION_FACE.clap[0]).not.toEqual(GIRL_ACTION_FACE.coverFace[0]);
  });

  it("运行时图集真在盘上且是 WebP（行数×列数就是画得出来的格子数）", () => {
    expect(GIRL_ACTIONS.src).toBe("./pet/girl-actions.webp");
    expect(GIRL_ACTIONS.rows).toBe(IDS.length);
    const buf = readFileSync(new URL("../public/pet/girl-actions.webp", import.meta.url));
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(buf.byteLength).toBeGreaterThan(200_000);
  });

  it("循环的往复播、一次性的停末格：扑击与蹦跳、点头各按自己的帧数谢幕", () => {
    expect(GIRL_ACTION_ROWS.zoom.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.stalk.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.hunt.loop).toBe(false);
    expect(GIRL_ACTION_ROWS.eat.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.bat.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.hop.loop).toBe(false);
    expect(GIRL_ACTION_ROWS.type.loop).toBe(true);
    // 点头只点一次（末格≈首格，停住不出戏）；摇头/拍手/捂脸都是循环。
    expect(GIRL_ACTION_ROWS.nod.loop).toBe(false);
    expect(GIRL_ACTION_ROWS.shake.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.clap.loop).toBe(true);
    expect(GIRL_ACTION_ROWS.coverFace.loop).toBe(true);
  });
});

describe("动作播放器（时间 → 帧号）", () => {
  it("冲刺 12fps：每格 1/12 秒，走满一圈回到第 0 帧且永不结束", () => {
    expect(girlActionFrameAt("zoom", 0)).toEqual({ index: 0, done: false });
    expect(girlActionFrameAt("zoom", 90).index).toBe(1);
    expect(girlActionFrameAt("zoom", 170).index).toBe(2);
    expect(girlActionFrameAt("zoom", girlActionDurationMs("zoom") + 0.01).index).toBe(0);
    expect(girlActionFrameAt("zoom", girlActionDurationMs("zoom") - 1).index).toBe(5);
    expect(girlActionFrameAt("zoom", 60_000).done).toBe(false);
  });

  it("潜行 6fps：一格 167ms，节拍比冲刺慢一半", () => {
    expect(girlActionFrameAt("stalk", 0).index).toBe(0);
    expect(girlActionFrameAt("stalk", 170).index).toBe(1);
    expect(girlActionFrameAt("stalk", 1_000).index).toBe(0);
    expect(girlActionDurationMs("stalk")).toBeCloseTo(1_000, 6);
  });

  it("扑击 7fps：最后一格停住并报 done，之后不再往后跑", () => {
    expect(girlActionFrameAt("hunt", 0)).toEqual({ index: 0, done: false });
    expect(girlActionFrameAt("hunt", 500).index).toBe(3);
    const end = girlActionDurationMs("hunt");
    expect(end).toBeCloseTo((6 * 1000) / 7, 6);
    expect(girlActionFrameAt("hunt", end + 0.01)).toEqual({ index: 5, done: true });
    expect(girlActionFrameAt("hunt", end + 5_000)).toEqual({ index: 5, done: true });
  });

  it("v1.22 四行各按自己的节拍：吃 9 / 拍 11 / 跳 10 / 打字 8", () => {
    expect(girlActionDurationMs("eat")).toBeCloseTo(6_000 / 9, 6);
    expect(girlActionDurationMs("bat")).toBeCloseTo(6_000 / 11, 6);
    expect(girlActionDurationMs("hop")).toBeCloseTo(6_000 / 10, 6);
    expect(girlActionDurationMs("type")).toBeCloseTo(6_000 / 8, 6);
    // 蹦跳是一次性：600ms 演完停在落地格并报 done，不许自己重播。
    expect(girlActionFrameAt("hop", 0).index).toBe(0);
    expect(girlActionFrameAt("hop", 250).index).toBe(2);
    expect(girlActionFrameAt("hop", girlActionDurationMs("hop") + 1))
      .toEqual({ index: 5, done: true });
    // 吃东西、拍打、打字都是循环：走满一圈回第 0 帧、永不报 done。
    for (const id of ["eat", "bat", "type"] as const) {
      expect(girlActionFrameAt(id, girlActionDurationMs(id) + 1).index, id).toBe(0);
      expect(girlActionFrameAt(id, 60_000).done, id).toBe(false);
    }
  });

  it("v1.23 四行各按自己的节拍：点头 7 / 摇头 9 / 拍手 10 / 捂脸 8", () => {
    expect(girlActionDurationMs("nod")).toBeCloseTo(6_000 / 7, 6);
    expect(girlActionDurationMs("shake")).toBeCloseTo(6_000 / 9, 6);
    expect(girlActionDurationMs("clap")).toBeCloseTo(6_000 / 10, 6);
    expect(girlActionDurationMs("coverFace")).toBeCloseTo(6_000 / 8, 6);
    // 点头是一次性：点完停在末格报 done，不许自己重播成「一直点头」。
    expect(girlActionFrameAt("nod", 0).index).toBe(0);
    expect(girlActionFrameAt("nod", 160).index).toBe(1);
    expect(girlActionFrameAt("nod", girlActionDurationMs("nod") + 1))
      .toEqual({ index: 5, done: true });
    // 摇头、拍手、捂脸是循环：走满一圈回第 0 帧、永不报 done。
    for (const id of ["shake", "clap", "coverFace"] as const) {
      expect(girlActionFrameAt(id, girlActionDurationMs(id) + 1).index, id).toBe(0);
      expect(girlActionFrameAt(id, 60_000).done, id).toBe(false);
    }
  });

  it("站桩四行按鞋底对地线：每一格的墨底都在地线附近，飞跳行才许离地", () => {
    // SHOE_GROUND 的整件事就是「脚不动、身体动」。换个对齐口径，点头会整只抬高 50px，
    // 墨底也跟着飘；墨底一旦跑出这条窄带就说明有人退回按墨底对齐了。
    for (const id of ["nod", "shake", "clap", "coverFace"] as const) {
      const bottoms = GIRL_ACTION_INK[id].map((k) => k[3]);
      expect(Math.min(...bottoms), `${id} 最低一格`).toBeGreaterThanOrEqual(366);
      expect(Math.max(...bottoms) - Math.min(...bottoms), `${id} 墨底跨度`).toBeLessThanOrEqual(4);
      for (const b of bottoms) expect(b, id).toBeLessThanOrEqual(372);
    }
    // 对照组：真腾空的行墨底差着一大截，窄带不是谁都能进的。
    expect(Math.max(...GIRL_ACTION_INK.zoom.map((k) => k[3])))
      .toBeGreaterThan(Math.min(...GIRL_ACTION_INK.zoom.map((k) => k[3])) + 20);
    expect(Math.max(...GIRL_ACTION_INK.hop.map((k) => k[3])))
      .toBeGreaterThan(Math.min(...GIRL_ACTION_INK.hop.map((k) => k[3])) + 20);
  });

  it("重绘下限跟着这一式的帧率走，且不低于 24fps（淡化期不许一格一格地淡）", () => {
    for (const id of IDS) {
      const need = girlActionRedrawFloor(id);
      expect(need, id).toBeGreaterThanOrEqual(GIRL_ACTION_ROWS[id].fps * 2);
      expect(need, id).toBeGreaterThanOrEqual(24);
      expect(need, id).toBeLessThanOrEqual(30);
    }
  });
});

describe("动作刚体与锚点", () => {
  it("静止时刻脚心对齐；k 用的是本行自己的尺", () => {
    const body = girlActionBodyFor(mk(), "zoom");
    expect(body.pivot).toEqual({ x: 100, y: 200 });
    expect(body.rot).toBeCloseTo(0, 6);
    expect(body.sx).toBeCloseTo(1, 6);
    expect(body.sy).toBeCloseTo(1, 6);
    for (const id of IDS) {
      expect(girlActionBodyFor(mk(), id).k, id)
        .toBeCloseTo((S * GIRL_ACTIONS.inkVb) / GIRL_ACTION_ROWS[id].inkRefPx, 9);
    }
  });

  it("每行的躯干轴都把锚点送回支点（逐行 anchorX 不是摆设）", () => {
    for (const id of IDS) {
      const body = girlActionBodyFor(mk({ facing: 1 }), id, { leanDeg: 3, shiftX: 1.5 });
      const anchor = girlActionCellPoint(body, id, GIRL_ACTION_ROWS[id].anchorX, GIRL_ACTIONS.anchorY);
      expect(anchor.x, id).toBeCloseTo(body.pivot.x, 6);
      expect(anchor.y, id).toBeCloseTo(body.pivot.y, 6);
    }
  });

  it("动作里没有 sprawl：趴伏压扁不许叠在画好的动作上", () => {
    const base = girlActionBodyFor(mk(), "hunt");
    const sprawled = girlActionBodyFor(mk({ pose: { ...mk().pose, sprawl: 0.92 } }), "hunt");
    expect(sprawled.sy).toBeCloseTo(base.sy, 9);
    expect(sprawled.sx).toBeCloseTo(base.sx, 9);
    expect(sprawled.pivot).toEqual(base.pivot);
  });

  it("落地压扁、歪头、朝向、存在感照旧生效", () => {
    const squash = girlActionBodyFor(mk({ pose: { ...mk().pose, squash: 1 } }), "zoom");
    expect(squash.sy).toBeLessThan(0.9);
    expect(squash.sx).toBeGreaterThan(1.05);
    const lean = girlActionBodyFor(mk({ pose: { ...mk().pose, tilt: 5 } }), "zoom");
    expect(lean.rot).toBeCloseTo((3.5 * Math.PI) / 180, 6);
    expect(girlActionBodyFor(mk({ jumpY: -10 }), "zoom").pivot.y).toBe(190);
    expect(girlActionBodyFor(mk({ facing: -1 }), "zoom").facing).toBe(-1);
    const presence = girlActionBodyFor(mk(), "zoom", { leanDeg: 4.2, shiftX: 2.2, facing: -1 });
    expect(presence.pivot.x).toBeCloseTo(102.2, 6);
    expect(presence.facing).toBe(-1);
  });
});

describe("动作的脸框与墨框", () => {
  it("每格全在墨框里：脸不越界、脚不穿地线，每组至少一格踩在地线上", () => {
    const slack = 1.5;
    for (const id of IDS) {
      let lowest = Number.NEGATIVE_INFINITY;
      for (let frame = 0; frame < GIRL_ACTION_ROWS[id].frames; frame += 1) {
        for (const facing of [1, -1] as const) {
          const body = girlActionBodyFor(mk({ facing }), id);
          const face = girlActionFaceBox(body, id, frame);
          const ink = girlActionInkBox(body, id, frame);
          const tag = `${id}#${frame}/${facing}`;
          expect(face.left, `${tag} 左`).toBeGreaterThanOrEqual(ink.left - slack);
          expect(face.right, `${tag} 右`).toBeLessThanOrEqual(ink.right + slack);
          expect(face.top, `${tag} 上`).toBeGreaterThanOrEqual(ink.top - slack);
          expect(face.bottom, `${tag} 下`).toBeLessThanOrEqual(ink.bottom + slack);
          expect(ink.bottom, `${tag} 不穿地线`).toBeLessThanOrEqual(body.pivot.y + 0.5);
          expect(face.cy, `${tag} 脸心在上半身`).toBeLessThan(ink.top + ink.h * 0.6);
          lowest = Math.max(lowest, ink.bottom);
        }
      }
      expect(lowest, `${id} 踩地`).toBeGreaterThan(200 - 0.5);
    }
  });

  it("十一行共用一个头围：脸宽 91vb 的尺差不到 2%（眼距定尺的全部意义）", () => {
    const widths = IDS.map((id) => {
      const face = girlActionFaceBox(girlActionBodyFor(mk(), id), id, 0);
      return face.w / S;
    });
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    expect(min).toBeGreaterThan(37);
    expect(max / min).toBeLessThan(1.02);
  });

  it("翻身后脸跟着挪到另一侧", () => {
    const right = girlActionFaceBox(girlActionBodyFor(mk({ facing: 1 }), "stalk"), "stalk", 0);
    const left = girlActionFaceBox(girlActionBodyFor(mk({ facing: -1 }), "stalk"), "stalk", 0);
    expect(Math.abs(right.cx - 100)).toBeGreaterThan(1);
    expect(Math.sign(right.cx - 100)).toBe(-Math.sign(left.cx - 100));
  });
});

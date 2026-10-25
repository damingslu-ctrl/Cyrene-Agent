import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatInput } from "./art";
import { GIRL_ANIM, GIRL_ANIM_RANGES } from "./girl-anim-meta";
import {
  ACTIVITY_CLIP,
  GESTURE_CLIP,
  GIRL_ANIM_FADE_MS,
  GIRL_CLIP_PLAY,
  GirlClipPlayer,
  baseClipFor,
  clipDurationMs,
  frameAt,
  frameCount,
  frameSourceRect,
  gestureClipFor,
  redrawFloorFor,
  type GirlActivity,
  type GirlClipId,
} from "./girl-anim";
import { GESTURE_IDS } from "./motion";
import { GIRL_INK_VB_HEIGHT, girlAnimBodyFor } from "./girl-sprite";

const ASSET = new URL("../public/pet/girl-anim.webp", import.meta.url);

/** 只认 RIFF/VP8X 容器头（不引第三方图片解码器）。 */
function readWebpHeader(buffer: Buffer): { width: number; height: number; hasAlpha: boolean } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("不是 WebP（RIFF/WEBP 头不对）");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (tag === "VP8X") {
      const flags = buffer[offset + 8];
      const width = 1 + (buffer[offset + 12] | (buffer[offset + 13] << 8) | (buffer[offset + 14] << 16));
      const height = 1 + (buffer[offset + 15] | (buffer[offset + 16] << 8) | (buffer[offset + 17] << 16));
      return { width, height, hasAlpha: (flags & 0x10) !== 0 };
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error("WebP 里没有 VP8X 块（带 alpha 的图必须有）");
}

const CLIP_IDS = Object.keys(GIRL_ANIM_RANGES) as GirlClipId[];
const ACTIVITIES: GirlActivity[] = [
  "idle", "walk", "groom", "yawn", "stretch", "tilt",
  "sleep", "pet", "eat", "play", "rest", "drag", "thrown",
];

function mk(overrides: Partial<CatInput> = {}): CatInput {
  return {
    center: { x: 41, y: 87.7 },
    u: 37,
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

describe("猫娘帧图集", () => {
  const buffer = readFileSync(ASSET);
  const header = readWebpHeader(buffer);

  it("画布 = cols×cellW × rows×cellH，并且带 alpha", () => {
    expect(header.width).toBe(GIRL_ANIM.cellW * GIRL_ANIM.cols);
    expect(header.height).toBe(GIRL_ANIM.cellH * GIRL_ANIM.rows);
    expect(header.hasAlpha).toBe(true);
    expect(GIRL_ANIM.rows * GIRL_ANIM.cols).toBeGreaterThanOrEqual(GIRL_ANIM.count);
  });

  it("体积守在 1.5MB 内（构造时就进渲染进程内存）", () => {
    expect(statSync(ASSET).size).toBeLessThan(1.5 * 1024 * 1024);
    expect(statSync(ASSET).size).toBeGreaterThan(100_000);
  });

  it("16 段铺满 0..145，首尾相接、不重叠、不越界", () => {
    const spans = Object.values(GIRL_ANIM_RANGES).slice().sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBe(0);
    expect(spans[spans.length - 1][1]).toBe(GIRL_ANIM.count - 1);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i][0], `第 ${i} 段与上一段不相接`).toBe(spans[i - 1][1] + 1);
    }
    // 146 帧 = 源片 6.08s × 24fps（mp4 stts: 145×25/600s）；旧图集只抽 15fps 的 91 帧，
    // 与「每 2 帧换一张画」的原节拍错位，动作看起来一顿一顿。
    expect(GIRL_ANIM.count).toBe(146);
    expect(GIRL_ANIM.cellW / GIRL_ANIM.cellH).toBeCloseTo(170 / 124, 6);
  });

  it("脚心钉在格子横向中心，脚底之下留了一点余量", () => {
    expect(GIRL_ANIM.anchorX * GIRL_ANIM.cellW).toBe(GIRL_ANIM.cellW / 2);
    expect(GIRL_ANIM.anchorY).toBeGreaterThan(0.9);
    expect(GIRL_ANIM.anchorY).toBeLessThan(1);
  });

  it("帧号映射到 10 列图集格子；末帧（145）在最后一行", () => {
    const last = frameSourceRect(GIRL_ANIM.count - 1);
    expect(last.sx).toBe((GIRL_ANIM.count - 1) % GIRL_ANIM.cols * GIRL_ANIM.cellW);
    expect(last.sy).toBe(Math.floor((GIRL_ANIM.count - 1) / GIRL_ANIM.cols) * GIRL_ANIM.cellH);
    expect(last.sy + last.sh).toBeLessThanOrEqual(GIRL_ANIM.cellH * GIRL_ANIM.rows);
    const mid = 13;
    expect(frameSourceRect(mid).sx).toBe((mid % GIRL_ANIM.cols) * GIRL_ANIM.cellW);
    expect(frameSourceRect(mid).sy).toBe(Math.floor(mid / GIRL_ANIM.cols) * GIRL_ANIM.cellH);
    expect(frameSourceRect(-5)).toEqual(frameSourceRect(0));
    expect(frameSourceRect(999)).toEqual(frameSourceRect(GIRL_ANIM.count - 1));
  });
});

describe("帧段表", () => {
  it("播放表与图集区间一一对应（换图不换表会当场红）", () => {
    expect(Object.keys(GIRL_CLIP_PLAY).sort()).toEqual(Object.keys(GIRL_ANIM_RANGES).sort());
    for (const id of CLIP_IDS) {
      expect(GIRL_CLIP_PLAY[id].fps).toBeGreaterThan(0);
      expect(frameCount(id)).toBeGreaterThan(0);
    }
  });

  it("13 种活动都有基础段；免打扰时睡觉段被替换（月牙与 Zzz 互斥）", () => {
    for (const activity of ACTIVITIES) {
      expect(ACTIVITY_CLIP[activity], activity).toBeTruthy();
      expect(GIRL_ANIM_RANGES[ACTIVITY_CLIP[activity]], activity).toBeTruthy();
    }
    expect(baseClipFor("sleep", false)).toBe("sleep");
    expect(baseClipFor("sleep", true)).toBe("idle");
    expect(baseClipFor("walk", false)).toBe("walk");
    expect(baseClipFor("rest", false)).toBe("sit");
  });

  it("18 个手势全部有帧段可播，且没有映射到不存在的段", () => {
    for (const id of GESTURE_IDS) {
      const clip = gestureClipFor(id);
      expect(clip, id).not.toBeNull();
      expect(GIRL_ANIM_RANGES[clip!], id).toBeTruthy();
    }
    expect(Object.keys(GESTURE_CLIP).sort()).toEqual([...GESTURE_IDS].sort());
    expect(gestureClipFor("no-such-gesture")).toBeNull();
  });

  it("一次性段越过末帧就 done 并停在末帧", () => {
    const wavePer = 1000 / GIRL_CLIP_PLAY.wave.fps;
    const n = frameCount("wave");
    expect(frameAt("wave", wavePer * (n - 1) + 1)).toEqual({ index: n - 1, done: false });
    expect(frameAt("wave", clipDurationMs("wave") + 1)).toEqual({ index: n - 1, done: true });
    expect(frameAt("wave", 0, true).done).toBe(false);
  });

  it("循环段往返播放：走到末帧后原路返回，不从头硬跳（接缝实测差 2–4 倍）", () => {
    const id = "idle";
    const n = frameCount(id);
    const per = 1000 / GIRL_CLIP_PLAY[id].fps;
    expect(frameAt(id, 0, true)).toEqual({ index: 0, done: false });
    expect(frameAt(id, per * 1.5, true).index).toBe(1);
    // 去程最后一帧
    expect(frameAt(id, per * (n - 1) + 1, true).index).toBe(n - 1);
    // 回程：再走一帧回到 n-2，而不是回到 0
    expect(frameAt(id, per * n + 1, true).index).toBe(n - 2);
    // 一个完整来回（2(n−1) 帧）后回到第一帧
    expect(frameAt(id, per * 2 * (n - 1) + 1, true).index).toBe(0);
    // wrap 模式仍可显式选用：正放一圈后直接回首帧
    expect(frameAt(id, per * n + 1, true, "wrap").index).toBe(0);
  });

  it("播放帧率按原片节拍：静息循环 12fps、动作与走路 24fps", () => {
    expect(GIRL_CLIP_PLAY.idle.fps).toBe(12);
    expect(GIRL_CLIP_PLAY.walk.fps).toBe(24);
    for (const id of CLIP_IDS) {
      // 低于 12 就是把每张画撑过 83ms，逐帧动画会看成幻灯片
      expect(GIRL_CLIP_PLAY[id].fps, id).toBeGreaterThanOrEqual(12);
      // 重绘下限要盖住片段帧率（不丢帧），且不超过产品档位 30（常驻窗口不烧 CPU）
      const floor = redrawFloorFor(id);
      expect(floor, id).toBeGreaterThanOrEqual(GIRL_CLIP_PLAY[id].fps);
      expect(floor, id).toBeLessThanOrEqual(30);
    }
  });
});

describe("GirlClipPlayer", () => {
  it("切段冻住上一段当前帧当淡化底板，整段不重播", () => {
    const player = new GirlClipPlayer("idle", 0);
    expect(player.sample(500).prev).toBeNull();
    const before = frameAt("idle", 5000).index;

    expect(player.setClip("wave", 5000)).toBe(true);
    const during = player.sample(5080);
    expect(during.clipId).toBe("wave");
    // 80ms 在 24fps 下已经走过近两帧，帧号要按片段时钟算，不能钉死成 0
    expect(during.index).toBe(frameAt("wave", 80).index);
    expect(during.prev).toEqual({ clipId: "idle", index: before });
    expect(during.fade).toBeCloseTo(80 / GIRL_ANIM_FADE_MS, 6);
    expect(player.isFading(5080)).toBe(true);

    const after = player.sample(5000 + GIRL_ANIM_FADE_MS);
    expect(after.prev).toBeNull();
    expect(after.fade).toBe(1);
    expect(player.isFading(5000 + GIRL_ANIM_FADE_MS)).toBe(false);
  });

  it("同段重复调用是空操作；一次性段播完 isDone，reset 不淡入", () => {
    const player = new GirlClipPlayer("idle", 0);
    expect(player.setClip("idle", 100)).toBe(false);
    player.setClip("wave", 1000);
    expect(player.isDone(1000)).toBe(false);
    expect(player.isDone(1000 + clipDurationMs("wave") + 1)).toBe(true);

    player.reset("idle", 9000);
    const fresh = player.sample(9000);
    expect(fresh).toEqual({ clipId: "idle", index: 0, fade: 0, prev: null });
    expect(player.clipId).toBe("idle");
    expect(player.looping).toBe(true);
  });

  it("一次性段以 loop=false 起播（手势演完让位，不会自己绕回第一帧）", () => {
    const player = new GirlClipPlayer("idle", 0);
    player.setClip("wave", 0, false);
    expect(player.looping).toBe(false);
    expect(player.isDone(clipDurationMs("wave") + 1)).toBe(true);
  });
});

describe("帧图集与静态立绘同尺", () => {
  it("k × inkRefPx = 91vb × s：两套图切换时身高/脚线都不跳", () => {
    const input = mk();
    const body = girlAnimBodyFor(input);
    const s = (input.u * 2) / 120;
    expect(body.k * GIRL_ANIM.inkRefPx).toBeCloseTo(GIRL_INK_VB_HEIGHT * s, 6);
    expect(body.pivot).toEqual({ x: input.center.x, y: input.center.y });
    expect(body.sx).toBeCloseTo(1, 6);
    expect(body.sy).toBeCloseTo(1, 6);
  });

  it("刚体动作只做加法：落地压扁/跳起/朝向仍作用在同一个脚心支点上", () => {
    const squash = girlAnimBodyFor(mk({ pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0, squash: 1 } }));
    expect(squash.sy).toBeLessThan(0.9);
    expect(squash.sx).toBeGreaterThan(1.1);

    const jump = girlAnimBodyFor(mk({ jumpY: -10 }));
    expect(jump.pivot.y).toBeCloseTo(77.7, 6);

    const left = girlAnimBodyFor(mk({ facing: -1 }));
    expect(left.facing).toBe(-1);
  });
});

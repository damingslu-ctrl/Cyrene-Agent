import { describe, expect, it } from "vitest";
import { CHANNELS, CLIPS, GESTURE_IDS, bodyClip, gestureClip, sampleClip } from "./motion";

/**
 * 尺 #73（spec §10）：每个 clip 在 p=0 与 p=1 都必须落回 rest。
 * 违反＝「演完留在人身上」：手挥在半空、身子歪着不回正。
 *
 * 比较取 1e−12 四舍五入，**不是**严格相等：`Math.sin(2π)` 的真值是 −2.4e−16，
 * 按 1e−12 归零是对的，严格相等会把每一条用 sin 的轨道都误判成红（假红同样是坏尺）。
 */
const round = (v: number) => Number(v.toFixed(12));
const roundMap = (c: Record<string, number | undefined>) => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(c).sort()) out[k] = round(c[k] as number);
  return out;
};

describe("尺 #73：clip 归零", () => {
  it("CLIPS 恰好 30 条（12 body + 18 gesture）且 id 唯一", () => {
    expect(CLIPS.length).toBe(30);
    expect(new Set(CLIPS.map((c) => c.id)).size).toBe(CLIPS.length);
  });

  it("18 个 GESTURE_IDS 全部注册（spec §5 :225-226 的清单一条不缺）", () => {
    const byId = new Map(CLIPS.filter((c) => c.layer === "gesture").map((c) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual([...GESTURE_IDS].sort());
    expect(byId.size).toBe(18);
    // 这两条 lasting 是 Task 18 演出表的依赖；shiver 是一次性片。
    expect(byId.get("typeCode")?.lasting).toBe(true);
    expect(byId.get("peek")?.lasting).toBe(true);
    expect(byId.get("shiver")?.lasting).toBeUndefined();
  });

  it("每条 clip 的 rest 键集 == tracks 键集，且 p=0 / p=1 都等于 rest", () => {
    for (const clip of CLIPS) {
      const trackKeys = CHANNELS.filter((ch) => clip.tracks[ch]).sort();
      const restKeys = Object.keys(clip.rest).sort();
      expect(restKeys, `${clip.id} 的 rest 与 tracks 键集不等`).toEqual(trackKeys);
      for (const p of [0, 1]) {
        const got = sampleClip(clip, p);
        for (const key of Object.keys(clip.rest) as Array<keyof typeof clip.rest>) {
          // 用 toBeCloseTo 而不是 toEqual：Math.sin(π) 的 1.2e-16 会被 round 成 −0，
          // 而 Object.is(−0, 0) 是 false——那是浮点符号的假红，不是「没归零」。
          expect(got[key] ?? Number.NaN, `${clip.id}.${key} 在 p=${p} 没归零`).toBeCloseTo(clip.rest[key] as number, 12);
        }
      }
    }
  });

  it("21 点采样全部有限，且弧度通道 |v| ≤ 2、像素通道 |v| ≤ 16、无量纲通道 |v| ≤ 1.2", () => {
    const RAD = new Set(["armL", "armR", "legL", "legR", "headYaw", "headPitch", "lean", "earL", "earR", "tail"]);
    const PX = new Set(["headBob", "hop"]);
    for (const clip of CLIPS) {
      for (let i = 0; i <= 20; i++) {
        for (const [ch, v] of Object.entries(sampleClip(clip, i / 20))) {
          expect(Number.isFinite(v), `${clip.id}.${ch} @p=${i / 20} 非有限`).toBe(true);
          const cap = RAD.has(ch) ? 2 : PX.has(ch) ? 16 : 1.2;
          expect(Math.abs(v as number), `${clip.id}.${ch} 振幅越界（单位读错了？）`).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it("gesture 非 lasting 片的 ms 落在 ACTION_MS 量级 1800..2400", () => {
    expect(GESTURE_IDS.length).toBe(18);
    const seeds = CLIPS.filter((c) => c.layer === "gesture" && !c.lasting);
    expect(seeds.length).toBe(16);
    for (const clip of seeds) {
      expect(clip.ms, `${clip.id} 的 ms 跳出 ACTION_MS 量级`).toBeGreaterThanOrEqual(1800);
      expect(clip.ms, `${clip.id} 的 ms 跳出 ACTION_MS 量级`).toBeLessThanOrEqual(2400);
    }
  });

  it("物理三兄弟（drag/thrown/air/land）priority 必须是 3", () => {
    for (const id of ["drag", "thrown", "air", "land"]) {
      expect(CLIPS.find((c) => c.id === id)?.priority, `${id} 缺行或不是物理档`).toBe(3);
    }
  });

  it("spec §5 的 body 档名一条不缺", () => {
    const names = ["stand", "walk", "run", "sit", "kneel", "drowse", "sleep", "crouch", "drag", "thrown", "air", "land"];
    for (const id of names) expect(() => bodyClip(id)).not.toThrow();
  });

  it("bodyClip/gestureClip 查不到或层不对都抛错", () => {
    expect(bodyClip("stand").layer).toBe("body");
    expect(gestureClip("wave").layer).toBe("gesture");
    expect(() => bodyClip("fly")).toThrow(/fly/);
    expect(() => bodyClip("wave")).toThrow(/gesture/);
  });
});

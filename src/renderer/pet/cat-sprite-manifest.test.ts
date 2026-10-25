import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderOps, alphaCoverage, inkCentroid } from "../../shared/sprite-raster";
import { decodePng } from "../../shared/png-encode";
import { CAT_CROPS, buildSpriteOps } from "./cat-variants";
import { GIRL_MASTER, GIRL_STILLS, GIRL_STILL_FRAMES } from "./girl-stills-meta";
import { GIRL_HIRES } from "./girl-poses-meta";
import {
  MOOD_TO_VARIANT, NON_CHARACTER_TARGETS, SPRITE_TARGETS, checkTarget,
  GIRL_CROPS, GIRL_POSES, cropsForForm,
} from "./cat-sprite-manifest";

/** 与构建脚本同一份源图：30 格静帧表 + 参考图母版（构建期资产，不进渲染器包）。 */
const IMAGES = {
  [GIRL_STILLS.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-stills.png", import.meta.url))),
  [GIRL_MASTER.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-master.png", import.meta.url))),
  [GIRL_HIRES.src]: decodePng(readFileSync(new URL("../../../scripts/assets/generated/girl-poses.png", import.meta.url))),
};

describe("位图资产清单", () => {
  it("清单里每个 out 都是当前真实被读的键（R-D2：25 张散点状态图文件名冻结）", () => {
    const float = SPRITE_TARGETS.filter((t) => t.out.includes("status-float/")).map((t) => t.out.split("/").pop());
    expect([...float].sort()).toEqual(["提醒.png", "离线.png", "聆听中.png", "陪伴中.png"].sort());
    const loose = SPRITE_TARGETS.filter((t) => /assets\/status-moods\//.test(t.out));
    expect(loose).toHaveLength(25);
    const moods = SPRITE_TARGETS.filter((t) => /characters\/[^/]+\/status-moods\//.test(t.out));
    expect(moods).toHaveLength(72);                 // 12 只 × 6 档 CharacterStatusMood
  });

  it("25 档散点情绪全部有落点，不许出现「同两张图」的偷懒映射", () => {
    expect(Object.keys(MOOD_TO_VARIANT)).toHaveLength(25);
    // 情绪名就是静帧表里的键，且每条 variant 都自带 `frame: { mood }`——
    // 少了这层显式传递，25 档会静默退回姿态帧（`sit` 一样），像素尺也量不出「哪一档没落点」。
    expect(Object.keys(MOOD_TO_VARIANT).sort()).toEqual(Object.keys(GIRL_STILL_FRAMES.mood).sort());
    for (const [name, v] of Object.entries(MOOD_TO_VARIANT)) expect(v.frame, name).toEqual({ mood: name });
    const sig = Object.values(MOOD_TO_VARIANT).map((v) => `${v.mood}/${v.pose}/${v.blink}/${v.pet}/${v.energy}`);
    expect(new Set(sig).size).toBeGreaterThanOrEqual(20);   // 25 档至少 20 种不同签名
  });

  it("抽样的每条目标都过像素尺（全表由 Step 5 的 --check 兜底）", () => {
    for (const t of SPRITE_TARGETS.slice(0, 6)) {          // 前 6 条做代表，全表跑在 Step 5 的 --check
      const crop = cropsForForm(t.form ?? "cat")[t.crop];
      const size = { w: t.size, h: t.height ?? t.size };
      const ops = buildSpriteOps(
        { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy, form: t.form, frame: t.frame },
        size,
      );
      const r = renderOps(ops, size.w, size.h, { mask: crop.mask === "disc" ? "disc" : "none", images: IMAGES });
      const bad = checkTarget(r, t);
      expect(bad, `${t.out}: ${bad.join("; ")}`).toEqual([]);
    }
  });

  it("正对照：把预算改成 0 会判红（证明尺真的在量，不是恒真）", () => {
    const t = SPRITE_TARGETS[0];
    const size = { w: t.size, h: t.height ?? t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop, form: t.form, frame: t.frame }, size), size.w, size.h, { images: IMAGES });
    expect(checkTarget(r, { ...t, maxKb: 0 })).not.toEqual([]);
  });

  it("正对照：拿 `full` 的图去量 `bust` 档会判红（证明带宽按取景查表，不是一条通用带）", () => {
    // 位图时代 full 的全身覆盖率（约 0.22）远低于 bust 的带；换错取景当场出界。
    const t = NON_CHARACTER_TARGETS[0];
    const size = { w: t.size, h: t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: "full", form: t.form, frame: t.frame }, size), size.w, size.h, { images: IMAGES });
    expect(checkTarget(r, t).some((line) => line.startsWith("覆盖度"))).toBe(true);
  });

  it("非角色资产 16 条：只有一张非方图（欢迎横幅），抽样同一把尺", () => {
    expect(NON_CHARACTER_TARGETS).toHaveLength(16);
    const banner = NON_CHARACTER_TARGETS.filter((t) => t.height !== undefined);
    expect(banner.map((t) => `${t.size}×${t.height}`)).toEqual(["1280×720"]);
    const picks = [
      "src/renderer/public/cyrene-welcome.png",
      "src/renderer/public/avatars/cyrene-avatar.png",
      "src/renderer/react/assets/moments.png",
    ];
    for (const out of picks) {
      const t = NON_CHARACTER_TARGETS.find((x) => x.out === out)!;
      const crop = cropsForForm(t.form ?? "cat")[t.crop];
      const size = { w: t.size, h: t.height ?? t.size };
      const ops = buildSpriteOps(
        { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy, form: t.form, frame: t.frame },
        size,
      );
      const r = renderOps(ops, size.w, size.h, { mask: crop.mask === "disc" ? "disc" : "none", images: IMAGES });
      const bad = checkTarget(r, t);
      expect(bad, `${t.out}: ${bad.join("; ")}`).toEqual([]);
    }
  });

  it("正对照：横幅档没给 height 会判红（方形档不许借用更松的横幅带宽）", () => {
    const t = NON_CHARACTER_TARGETS.find((x) => x.height !== undefined)!;
    const size = { w: t.size, h: t.height! };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop, form: t.form, frame: t.frame }, size), size.w, size.h, { images: IMAGES });
    expect(checkTarget(r, { ...t, height: undefined })).toContain("wide 取景只服务横幅档（缺 height）");
  });
});

describe("form 轴 (Task 24-25)", () => {
  it("145 张派生资产全部翻 girl；贴纸与图标支路不在清单里", () => {
    for (const t of SPRITE_TARGETS) expect(t.form, t.out).toBe("girl");
    for (const t of NON_CHARACTER_TARGETS) expect(t.form, t.out).toBe("girl");
    expect(SPRITE_TARGETS.length + NON_CHARACTER_TARGETS.length).toBe(145);
  });

  it("清单导出 girl 侧三件套（构建脚本只靠这一个入口拿符号）", () => {
    expect(typeof cropsForForm).toBe("function");
    expect(Object.keys(GIRL_POSES)).toHaveLength(13);
    expect(Object.keys(GIRL_CROPS)).toHaveLength(5);
  });

  it("正对照：把预算改成 0 仍然判红（带重标之后尺还有牙）", () => {
    const t = SPRITE_TARGETS[0];
    const size = { w: t.size, h: t.height ?? t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop, form: t.form, frame: t.frame }, size), size.w, size.h, { images: IMAGES });
    expect(checkTarget(r, { ...t, maxKb: 0 }).length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { renderOps, alphaCoverage, inkCentroid } from "../../shared/sprite-raster";
import { CAT_CROPS, buildSpriteOps } from "./cat-variants";
import { MOOD_TO_VARIANT, NON_CHARACTER_TARGETS, SPRITE_TARGETS, checkTarget } from "./cat-sprite-manifest";

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
    const sig = Object.values(MOOD_TO_VARIANT).map((v) => `${v.mood}/${v.pose}/${v.blink}/${v.pet}/${v.energy}`);
    expect(new Set(sig).size).toBeGreaterThanOrEqual(20);   // 25 档至少 20 种不同签名
  });

  it("抽样的每条目标都过像素尺（全表由 Step 5 的 --check 兜底）", () => {
    for (const t of SPRITE_TARGETS.slice(0, 6)) {          // 前 6 条做代表，全表跑在 Step 5 的 --check
      const crop = CAT_CROPS[t.crop];
      const size = { w: t.size, h: t.height ?? t.size };
      const ops = buildSpriteOps(
        { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy },
        size,
      );
      const r = renderOps(ops, size.w, size.h, { mask: crop.mask === "disc" ? "disc" : "none" });
      const bad = checkTarget(r, t);
      expect(bad, `${t.out}: ${bad.join("; ")}`).toEqual([]);
    }
  });

  it("正对照：把预算改成 0 会判红（证明尺真的在量，不是恒真）", () => {
    const t = SPRITE_TARGETS[0];
    const size = { w: t.size, h: t.height ?? t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop }, size), size.w, size.h);
    expect(checkTarget(r, { ...t, maxKb: 0 })).not.toEqual([]);
  });

  it("正对照：拿 `full` 的图去量 `square` 档会判红（证明带宽按取景查表，不是一条通用带）", () => {
    const t = SPRITE_TARGETS[0];                        // 首条是 characters/* 的 square 档
    expect(t.crop).toBe("square");
    const size = { w: t.size, h: t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: "full" }, size), size.w, size.h);
    expect(checkTarget(r, t).some((line) => line.startsWith("覆盖度"))).toBe(true);
  });

  it("非角色资产 17 条：只有一张非方图（欢迎横幅），抽样同一把尺", () => {
    expect(NON_CHARACTER_TARGETS).toHaveLength(17);
    const banner = NON_CHARACTER_TARGETS.filter((t) => t.height !== undefined);
    expect(banner.map((t) => `${t.size}×${t.height}`)).toEqual(["1280×720"]);
    const picks = [
      "src/renderer/public/cyrene-welcome.png",
      "src/renderer/public/loading.png",
      "src/renderer/react/assets/moments.png",
    ];
    for (const out of picks) {
      const t = NON_CHARACTER_TARGETS.find((x) => x.out === out)!;
      const crop = CAT_CROPS[t.crop];
      const size = { w: t.size, h: t.height ?? t.size };
      const ops = buildSpriteOps(
        { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy },
        size,
      );
      const r = renderOps(ops, size.w, size.h, { mask: crop.mask === "disc" ? "disc" : "none" });
      const bad = checkTarget(r, t);
      expect(bad, `${t.out}: ${bad.join("; ")}`).toEqual([]);
    }
  });

  it("正对照：横幅档没给 height 会判红（方形档不许借用更松的横幅带宽）", () => {
    const t = NON_CHARACTER_TARGETS.find((x) => x.height !== undefined)!;
    const size = { w: t.size, h: t.height! };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop }, size), size.w, size.h);
    expect(checkTarget(r, { ...t, height: undefined })).toContain("wide 取景只服务横幅档（缺 height）");
  });
});

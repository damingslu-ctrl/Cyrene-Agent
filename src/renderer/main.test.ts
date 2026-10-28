import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * main.ts 是入口文件（副作用满天），跑不了单测；这里锁的是**接线的形状**——
 * 读到文件变了就红，红的含义是「回去重看这段接线，不是无脑改锁」。
 */
const src = readFileSync(join(__dirname, "main.ts"), "utf8");

describe("main.ts 触摸接线（Task 22）", () => {
  it("双击定时器整套退役：定时器三件套一个都不许剩", () => {
    for (const gone of ["petClickTimer", "clearPetClickTimer", "DOUBLE_CLICK_MS"]) {
      expect(src.includes(gone), `${gone} 还在 main.ts 里`).toBe(false);
    }
  });

  it("老的 onCatClick 名字也退役（换成 reportTouch，语义不再叫「点击」）", () => {
    expect(src.includes("onCatClick")).toBe(false);
  });

  it("pointerup 按按住时长分档：renderer.tapAt 接住落点，分区判定在渲染端", () => {
    expect(src).toMatch(/pressPending[\s\S]{0,400}reportTouch\(/);
    expect(src).toMatch(/renderer\.tapAt\(/);
    expect(src).toMatch(/event\.clientX\s*-\s*rect\.left/);
    expect(src).toMatch(/event\.clientY\s*-\s*rect\.top/);
  });

  it("pointerdown 记录按下时刻", () => {
    expect(src).toMatch(/pressAtMs\s*=\s*performance\.now\(\)/);
  });

  it("右键菜单的「陪它玩」通道不动（退役的只是双击升级）", () => {
    expect(src).toContain("handleCommand");
    expect(src).toContain("onPetCommand");
  });
});

describe("v1.18.0 声音接线", () => {
  const preload = readFileSync(join(__dirname, "../preload/index.ts"), "utf8");
  const bridge = readFileSync(join(__dirname, "types/cyrene.d.ts"), "utf8");
  const mainApp = readFileSync(join(__dirname, "../main/application/default-dependencies.ts"), "utf8");

  it("渲染端把 WebAudio 出口注入渲染器，并在第一次真手势上解锁", () => {
    expect(src).toMatch(/createSfxAudioOutput\(\s*browserAudioContext\s*\)/);
    expect(src).toMatch(/renderer\.setSfxSink\(\s*sfxOutput\s*\)/);
    expect(src).toMatch(/addTrackedEventListener\(canvas, "pointerdown"[\s\S]{0,320}sfxOutput\.unlock\(\)/);
  });

  it("菜单那一勾走同一条路：boot 随几何读一次，下行订阅再读一次", () => {
    expect(src).toMatch(/renderer\.setSfxEnabled\(geo\.sfxEnabled\)/);
    expect(src).toMatch(/onSfxChanged\(\(\{ sfxEnabled \}\) => \{\s*\n\s*renderer\.setSfxEnabled\(sfxEnabled\);/);
  });

  it("主端把开关混进几何基线一次回给渲染端；preload 与桥接类型两边都收下这条通道", () => {
    expect(mainApp).toMatch(/VERGE_GET_PET_GEOMETRY[\s\S]{0,700}sfxEnabled: state\.sfxEnabled/);
    expect(preload).toMatch(/onSfxChanged:[\s\S]{0,260}VERGE_SFX_CHANGED/);
    expect(preload).toMatch(/getPetGeometry[\s\S]{0,420}sfxEnabled: boolean/);
    expect(bridge).toMatch(/sfxEnabled: boolean/);
    expect(bridge).toMatch(/onSfxChanged/);
  });

  it("退出时把话筒摘了：不给下一次启动留一个哑 sink", () => {
    expect(src).toMatch(/renderer\.setSfxSink\(null\)/);
  });
});

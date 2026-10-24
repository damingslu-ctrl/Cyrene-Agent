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

  it("pointerup 按按住时长分档，走 clickKindFor → renderer.touch", () => {
    expect(src).toMatch(/pressPending[\s\S]{0,400}clickKindFor\(/);
    expect(src).toMatch(/renderer\.touch\(clickKindFor\(/);
  });

  it("pointerdown 记录按下时刻", () => {
    expect(src).toMatch(/pressAtMs\s*=\s*performance\.now\(\)/);
  });

  it("右键菜单的「陪它玩」通道不动（退役的只是双击升级）", () => {
    expect(src).toContain("handleCommand");
    expect(src).toContain("onPetCommand");
  });
});

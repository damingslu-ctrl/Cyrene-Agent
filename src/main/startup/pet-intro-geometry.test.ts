import { describe, expect, it } from "vitest";
import {
  computePetIntroBounds,
  PET_INTRO_WINDOW_HEIGHT,
  PET_INTRO_WINDOW_WIDTH,
} from "./pet-intro-geometry";

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const PET_SIZE = { width: 100, height: 132 };

function boundsFor(petX: number, petY: number) {
  return computePetIntroBounds({ x: petX, y: petY, ...PET_SIZE }, WORK_AREA);
}

describe("pet intro window bounds", () => {
  it("脚底与桌宠窗底对齐、水平居中", () => {
    const b = boundsFor(1200, 800);
    expect(b.width).toBe(PET_INTRO_WINDOW_WIDTH);
    expect(b.height).toBe(PET_INTRO_WINDOW_HEIGHT);
    expect(b.y + b.height).toBe(800 + PET_SIZE.height);
    expect(b.x + b.width / 2).toBe(Math.round(1200 + PET_SIZE.width / 2));
  });

  it("贴右边缘时整窗夹回工作区（角色会偏到桌宠左边，但绝不越界）", () => {
    const b = boundsFor(1820, 900);
    expect(b.x).toBe(WORK_AREA.width - PET_INTRO_WINDOW_WIDTH);
    expect(b.x + b.width).toBeLessThanOrEqual(WORK_AREA.width);
  });

  it("桌宠在屏幕上半部时，窗口顶不到负坐标", () => {
    const b = boundsFor(300, 40);
    expect(b.y).toBe(0);
  });

  it("副屏工作区带偏移时按副屏夹（不是按主屏）", () => {
    const secondary = { x: -1920, y: -200, width: 1920, height: 1040 };
    const b = computePetIntroBounds({ x: -1800, y: 700, ...PET_SIZE }, secondary);
    expect(b.x).toBeGreaterThanOrEqual(secondary.x);
    expect(b.x + b.width).toBeLessThanOrEqual(secondary.x + secondary.width);
    expect(b.y + b.height).toBeLessThanOrEqual(secondary.y + secondary.height);
  });

  it("工作区比动画窗还小：钉在工作区左上角而不是算出一个更小的窗", () => {
    const tiny = { x: 10, y: 20, width: 320, height: 200 };
    const b = computePetIntroBounds({ x: 0, y: 0, ...PET_SIZE }, tiny);
    expect(b).toEqual({ x: 10, y: 20, width: PET_INTRO_WINDOW_WIDTH, height: PET_INTRO_WINDOW_HEIGHT });
  });
});

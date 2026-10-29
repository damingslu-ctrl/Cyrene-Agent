// v1.19：天色记号与节日挂饰——都画在「桌布」上，所以每一笔都要双色。
import { describe, expect, it } from "vitest";
import { opsBounds, type DrawOp } from "./ops";
import {
  FESTIVAL_ORNAMENTS,
  type FestivalOrnament,
} from "./girl-festival";
import { SKY_KINDS } from "./girl-clock";
import { PET_H, PET_W } from "../../shared/pet-geometry";
import type { GirlFaceBox } from "./girl-sprite";
import {
  SKY_MARK,
  buildFestivalOrnamentOps,
  buildSkyMarkOps,
  skyMarkHit,
} from "./girl-day-art";

const ops = (list: DrawOp[]) => list;
const colorsOf = (list: DrawOp[]): string[] =>
  list.flatMap((op) => ("fill" in op ? [op.fill] : "stroke" in op ? [op.stroke] : []));
/** 把 alpha 抹掉只留 RGB：同一色的不同透明度算一种色。 */
const hues = (list: DrawOp[]) =>
  new Set(colorsOf(list).map((color) => color.replace(/[\d.]+\)$/, ")")));
const hasPaper = (list: DrawOp[]) => colorsOf(list).some((color) => color.includes("247, 244, 236"));
const hasInk = (list: DrawOp[]) =>
  colorsOf(list).some((color) => !color.includes("247, 244, 236"));

const face = (): GirlFaceBox => ({
  cx: 41, cy: 18, w: 20, h: 14, left: 31, right: 51, top: 11, bottom: 25,
});

describe("天色记号", () => {
  it("三种天色都在窗口左上角、双色可读，且整枚记号不出 82×108 的窗", () => {
    for (const kind of SKY_KINDS) {
      const list = ops(buildSkyMarkOps(kind, 1.2));
      expect(list.length, kind).toBeGreaterThanOrEqual(3);
      // 画在桌布上：奶油光边 + 强调色，缺一色在某一类桌布上就看不见。
      expect(hasPaper(list), kind).toBe(true);
      expect(hasInk(list), kind).toBe(true);
      expect(hues(list).size, kind).toBeGreaterThanOrEqual(2);
      const box = opsBounds(list)!;
      expect(box.x, kind).toBeGreaterThanOrEqual(0);
      expect(box.y, kind).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, kind).toBeLessThanOrEqual(PET_W);
      expect(box.y + box.height, kind).toBeLessThanOrEqual(PET_H);
    }
  });

  it("日出有射线、日落压着地平线、月亮是月牙——三种不是同一个圆", () => {
    const sunrise = ops(buildSkyMarkOps("sunrise", 0));
    const rays = sunrise.filter((op) => op.kind === "strokePath");
    expect(rays.length).toBeGreaterThanOrEqual(3);

    const sunset = ops(buildSkyMarkOps("sunset", 0));
    const horizons = sunset.filter((op) => op.kind === "strokePath"
      && op.points.length === 2
      && Math.abs(op.points[0][1] - op.points[1][1]) < 0.5
      && op.points[0][1] > SKY_MARK.y);
    expect(horizons.length).toBeGreaterThanOrEqual(1);

    const moon = ops(buildSkyMarkOps("moon", 0));
    expect(moon.some((op) => op.kind === "crescent")).toBe(true);
    expect(moon.some((op) => op.kind === "fillEllipse" && op.rx >= SKY_MARK.r * 1.2)).toBe(true);
  });

  it("命中圈盖住整枚记号，也不挤进猫脸的摸头区", () => {
    expect(skyMarkHit(SKY_MARK.x, SKY_MARK.y)).toBe(true);
    expect(skyMarkHit(SKY_MARK.x + SKY_MARK.hit - 1, SKY_MARK.y)).toBe(true);
    expect(skyMarkHit(SKY_MARK.x + SKY_MARK.hit + 1, SKY_MARK.y)).toBe(false);
    // 画布坐标 → CSS 坐标要乘 zoom：真窗缩到 1.5 倍时点显示器上的那一格仍算点中。
    expect(skyMarkHit(SKY_MARK.x * 1.5, SKY_MARK.y * 1.5, 1.5)).toBe(true);
    const f = face();
    expect(skyMarkHit(f.cx, f.cy)).toBe(false);
    // 记号连同命中圈都留在窗里：点不到就等于没画。
    expect(SKY_MARK.x - SKY_MARK.hit).toBeGreaterThanOrEqual(0);
    expect(SKY_MARK.y - SKY_MARK.hit).toBeGreaterThanOrEqual(0);
    expect(SKY_MARK.x + SKY_MARK.hit).toBeLessThanOrEqual(PET_W);
    expect(SKY_MARK.y + SKY_MARK.hit).toBeLessThanOrEqual(PET_H);
  });
});

describe("节日挂饰", () => {
  it("五件挂饰都有形、都双色，且不越出窗口", () => {
    for (const ornament of FESTIVAL_ORNAMENTS) {
      const list = ops(buildFestivalOrnamentOps(ornament, face(), 1, 0.4));
      expect(list.length, ornament).toBeGreaterThanOrEqual(3);
      expect(hasPaper(list), ornament).toBe(true);
      expect(hasInk(list), ornament).toBe(true);
      const box = opsBounds(list)!;
      expect(box.x, ornament).toBeGreaterThanOrEqual(0);
      expect(box.y, ornament).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, ornament).toBeLessThanOrEqual(PET_W);
      expect(box.y + box.height, ornament).toBeLessThanOrEqual(PET_H);
    }
  });

  it("挂饰永远在头发另一侧：与既有的发顶装扮槽相反，转身也跟着换边", () => {
    const f = face();
    for (const ornament of FESTIVAL_ORNAMENTS) {
      const right = opsBounds(buildFestivalOrnamentOps(ornament, f, 1, 0))!;
      const left = opsBounds(buildFestivalOrnamentOps(ornament, f, -1, 0))!;
      expect(right.x + right.width / 2, ornament).toBeLessThan(f.cx);
      expect(left.x + left.width / 2, ornament).toBeGreaterThan(f.cx);
    }
  });

  it("五件各有各的形，不靠换色冒充", () => {
    const kinds = new Map<FestivalOrnament, string>();
    for (const ornament of FESTIVAL_ORNAMENTS) {
      const list = ops(buildFestivalOrnamentOps(ornament, face(), 1, 0));
      const signature = list.map((op) => op.kind).join(",");
      kinds.set(ornament, signature);
    }
    expect(new Set(kinds.values()).size).toBe(FESTIVAL_ORNAMENTS.length);
  });
});

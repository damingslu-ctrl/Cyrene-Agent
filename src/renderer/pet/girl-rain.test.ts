import { describe, expect, it } from "vitest";
import {
  RAIN_DROPS,
  RAIN_MS,
  buildRainOps,
  createRain,
  rainAlive,
  rainAmount,
  rainDropAt,
} from "./girl-rain";

const W = 82;
const H = 108;

describe("雨天", () => {
  it("寿命 20 秒；窗外的时刻一律不画", () => {
    const rain = createRain(5_000, 0.4);
    expect(rainAlive(rain, 5_000)).toBe(true);
    expect(rainAlive(rain, 5_000 + RAIN_MS - 1)).toBe(true);
    expect(rainAlive(rain, 5_000 + RAIN_MS)).toBe(false);
    expect(buildRainOps(rain, 5_000 + RAIN_MS, W, H)).toEqual([]);
    expect(buildRainOps(rain, 4_999, W, H)).toEqual([]);
  });

  it("收放包络：600ms 涨满，最后 900ms 渐隐", () => {
    const rain = createRain(0, 0.5);
    expect(rainAmount(rain, 0)).toBe(0);
    expect(rainAmount(rain, 300)).toBeCloseTo(0.5, 5);
    expect(rainAmount(rain, 600)).toBe(1);
    expect(rainAmount(rain, RAIN_MS - 900)).toBe(1);
    expect(rainAmount(rain, RAIN_MS - 450)).toBeCloseTo(0.5, 5);
    expect(rainAmount(rain, RAIN_MS)).toBe(0);
  });

  it("雨滴位置由哈希解析：同一时刻可复现，落点在窗口内，随时间下落", () => {
    const rain = createRain(0, 0.7);
    const a = rainDropAt(rain, 3, 1_500, W, H);
    const b = rainDropAt(rain, 3, 1_500, W, H);
    expect(a).toEqual(b);
    expect(a.x).toBeGreaterThanOrEqual(-2);
    expect(a.x).toBeLessThanOrEqual(W + 2);
    expect(a.y).toBeGreaterThanOrEqual(-15);
    expect(a.y).toBeLessThanOrEqual(H + 14);
    expect(a.len).toBeGreaterThanOrEqual(3.2);
    expect(a.len).toBeLessThanOrEqual(7.6);
    const later = rainDropAt(rain, 3, 1_700, W, H);
    expect(later.y).not.toBe(a.y);
  });

  it("画法：每颗雨滴奶油粗底 + 蓝色细线（双色），贴地有水花，顶上有一层雾", () => {
    const rain = createRain(0, 0.2);
    const now = 4_000;
    const ops = buildRainOps(rain, now, W, H);
    expect(ops.length).toBeGreaterThanOrEqual(RAIN_DROPS * 2 + 1);
    const inkOf = (op: (typeof ops)[number]) =>
      "stroke" in op ? op.stroke : "fill" in op ? op.fill : "";
    expect(ops.filter((op) => inkOf(op).startsWith("rgba(247, 244, 236")).length).toBeGreaterThanOrEqual(RAIN_DROPS);
    expect(ops.filter((op) => inkOf(op).startsWith("rgba(91, 141, 239")).length).toBeGreaterThanOrEqual(RAIN_DROPS);
    let splashy = 0;
    for (let i = 0; i < RAIN_DROPS; i += 1) if (rainDropAt(rain, i, now, W, H).splash > 0) splashy += 1;
    expect(splashy).toBeGreaterThan(0);
    expect(ops.filter((op) => op.kind === "strokeEllipse").length).toBe(splashy);
    expect(ops[ops.length - 1].kind).toBe("fillPath");
  });
});

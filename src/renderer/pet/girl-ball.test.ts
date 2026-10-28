import { describe, expect, it } from "vitest";
import {
  BALL_COOLDOWN_MS,
  BALL_MS,
  BALL_PERIOD_MS,
  BALL_WINDOW_MS,
  buildBallOps,
  createBall,
  patBall,
  ballAge,
  ballAt,
  ballAtPoint,
  ballLift,
  ballToFloorMs,
} from "./girl-ball";

const FACE = { cx: 41, top: 20, bottom: 54, w: 44, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildBallOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("拍皮球", () => {
  it("帧时间戳早于出生那一拍时只当刚出生，不许判死", () => {
    const s = createBall(1_000, 0.25);
    expect(ballAge(s, 984)).toBe(0);
    expect(ballLift(s, 984, FACE)).toBeGreaterThanOrEqual(0);
    expect(buildBallOps(s, 984, FACE, FLOOR).length).toBeGreaterThan(0);
    expect(ballAge(s, 1_000 + BALL_MS - 1)).toBe(BALL_MS - 1);
    expect(buildBallOps(s, 1_000 + BALL_MS, FACE, FLOOR)).toEqual([]);
  });

  it("弹跳是解析量：落地那一下高度为 0，半周期最高，且永不穿地", () => {
    const s = createBall(0, 0.4);
    for (let k = 0; k < 5; k += 1) {
      const land = k * BALL_PERIOD_MS;
      expect(ballLift(s, land, FACE)).toBeCloseTo(0, 6);
      expect(ballToFloorMs(s, land)).toBe(0);
      expect(ballLift(s, land + BALL_PERIOD_MS / 2, FACE)).toBeGreaterThan(
        ballLift(s, land + 60, FACE),
      );
    }
    for (let t = 0; t < BALL_MS; t += 37) {
      expect(ballLift(s, t, FACE)).toBeGreaterThanOrEqual(0);
      expect(ballAt(s, t, FACE, FLOOR).y).toBeLessThanOrEqual(FLOOR);
    }
  });

  it("越拍越低：同一颗球第 0 拍比第 4 拍弹得高", () => {
    const s = createBall(0, 0.6);
    const first = ballLift(s, BALL_PERIOD_MS / 2, FACE);
    const later = ballLift(s, 4 * BALL_PERIOD_MS + BALL_PERIOD_MS / 2, FACE);
    expect(first).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0);
  });

  it("踩点拍中记数，慢拍吞掉；点歪了算掉球并把连击清零", () => {
    const s = createBall(0, 0.1);
    const land = BALL_PERIOD_MS;
    const ball = ballAt(s, land + 40, FACE, FLOOR);
    expect(patBall(s, land + 40, FACE, FLOOR, ball.x, ball.y)).toBe("hit");
    expect(s.bounces).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.best).toBe(1);
    // 同一拍连点被冷却吞掉。
    expect(patBall(s, land + 40 + BALL_COOLDOWN_MS - 20, FACE, FLOOR, ball.x, ball.y)).toBe("miss");
    expect(s.bounces).toBe(1);
    // 半空中抓住：算掉球，连击归零，但不加拍数。
    const high = ballAt(s, land + BALL_PERIOD_MS / 2, FACE, FLOOR);
    expect(patBall(s, land + BALL_PERIOD_MS / 2, FACE, FLOOR, high.x, high.y)).toBe("off");
    expect(s.streak).toBe(0);
    expect(s.drops).toBe(1);
    expect(s.bounces).toBe(1);
    // 点到球外面：什么都没发生。
    expect(patBall(s, land * 2 + 40, FACE, FLOOR, high.x - 24, high.y - 20)).toBe("miss");
    expect(patBall(s, BALL_MS, FACE, FLOOR, ball.x, ball.y)).toBe("miss");
  });

  it("踩点窗口是落地前后各这么久：窗口内 hit，窗口外 off", () => {
    const s = createBall(0, 0.3);
    const land = 2 * BALL_PERIOD_MS;
    for (const at of [land - BALL_WINDOW_MS, land + BALL_WINDOW_MS]) {
      const b = ballAt(s, at, FACE, FLOOR);
      expect(patBall(s, at, FACE, FLOOR, b.x, b.y)).toBe("hit");
    }
    // 窗口外的那一下挪到下一拍半空：同拍连点会被冷却吞掉，那是另一条规矩。
    const late = 3 * BALL_PERIOD_MS + BALL_PERIOD_MS / 2;
    const b = ballAt(s, late, FACE, FLOOR);
    expect(patBall(s, late, FACE, FLOOR, b.x, b.y)).toBe("off");
    expect(s.drops).toBe(1);
  });

  it("命中区跟着球走，不按落地位置", () => {
    const s = createBall(0, 0.5);
    const high = ballAt(s, BALL_PERIOD_MS / 2, FACE, FLOOR);
    expect(ballAtPoint(s, BALL_PERIOD_MS / 2, FACE, FLOOR, high.x, high.y)).toBe(true);
    expect(ballAtPoint(s, BALL_PERIOD_MS / 2, FACE, FLOOR, high.x, FLOOR)).toBe(false);
  });

  it("命中区就是球外扩一圈：贴着边点得到，再外 8px 算点空且不记账", () => {
    const at = 2 * BALL_PERIOD_MS + 40;
    const s = createBall(0, 0.35);
    const b = ballAt(s, at, FACE, FLOOR);
    expect(patBall(s, at, FACE, FLOOR, b.x, b.y + b.r + 2)).toBe("hit");
    // 另一颗干净的账：点空既不算拍中，也不算掉球。
    const s2 = createBall(0, 0.35);
    expect(patBall(s2, at, FACE, FLOOR, b.x, b.y + b.r + 10)).toBe("miss");
    expect(s2.bounces).toBe(0);
    expect(s2.drops).toBe(0);
    expect(s2.lastPatAt).toBe(-1);
  });

  it("画法：球是双色（描边+填充）、投影随离地收小、拍数用粉笔正字；收走为空", () => {
    const s = createBall(0, 0.7);
    const idle = buildBallOps(s, BALL_PERIOD_MS / 2, FACE, FLOOR);
    expect(idle.some((op) => op.kind === "strokeEllipse")).toBe(true);
    expect(idle.some((op) => op.kind === "fillEllipse")).toBe(true);
    const ball = ballAt(s, BALL_PERIOD_MS / 2, FACE, FLOOR);
    const first = idle.find((op) => op.kind === "fillEllipse" && op.cx === ball.x);
    const second = idle.find((op) => op.kind === "strokeEllipse" && op.cx === ball.x);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    patBall(s, BALL_PERIOD_MS + 40, FACE, FLOOR, ballAt(s, BALL_PERIOD_MS + 40, FACE, FLOOR).x, ballAt(s, BALL_PERIOD_MS + 40, FACE, FLOOR).y);
    const hit = buildBallOps(s, BALL_PERIOD_MS + 60, FACE, FLOOR);
    expect(hit.length).toBeGreaterThan(idle.length);
    expect(finite(hit)).toBe(true);
    for (let t = 0; t < BALL_MS; t += 91) expect(finite(buildBallOps(s, t, FACE, FLOOR))).toBe(true);
    expect(buildBallOps(s, BALL_MS - 1, FACE, FLOOR).length).toBeGreaterThan(0);
  });

  it("连击星级：三连以上才画星，掉球后收回", () => {
    const s = createBall(0, 0.8);
    for (let k = 1; k <= 3; k += 1) {
      const at = k * BALL_PERIOD_MS + 30;
      const b = ballAt(s, at, FACE, FLOOR);
      expect(patBall(s, at, FACE, FLOOR, b.x, b.y)).toBe("hit");
    }
    expect(s.streak).toBe(3);
    expect(buildBallOps(s, 3 * BALL_PERIOD_MS + 60, FACE, FLOOR).some((op) => op.kind === "fillPath")).toBe(true);
    const at = 4 * BALL_PERIOD_MS + BALL_PERIOD_MS / 2;
    const high = ballAt(s, at, FACE, FLOOR);
    patBall(s, at, FACE, FLOOR, high.x, high.y);
    expect(buildBallOps(s, at + 20, FACE, FLOOR).some((op) => op.kind === "fillPath")).toBe(false);
  });
});

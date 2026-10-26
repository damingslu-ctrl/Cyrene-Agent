import { describe, expect, it } from "vitest";
import {
  ROLL_CROUCH_MS,
  ROLL_FLIP_COOLDOWN_MS,
  ROLL_MAX_FLIPS,
  ROLL_MS,
  ROLL_SPIN_END_MS,
  buildRollOps,
  createRoll,
  flipRoll,
  rollAlive,
  rollAtPoint,
  rollPhase,
  rollSpin,
} from "./girl-roll";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildRollOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("翻跟头", () => {
  it("时间表：蓄力 → 翻 → 落地 → 收走", () => {
    const s = createRoll(0, 0.3);
    expect(rollPhase(s, 0)).toBe("crouch");
    expect(rollPhase(s, ROLL_CROUCH_MS - 1)).toBe("crouch");
    expect(rollPhase(s, ROLL_CROUCH_MS)).toBe("spin");
    expect(rollPhase(s, ROLL_SPIN_END_MS - 1)).toBe("spin");
    expect(rollPhase(s, ROLL_SPIN_END_MS)).toBe("land");
    expect(rollAlive(s, ROLL_MS - 1)).toBe(true);
    expect(rollAlive(s, ROLL_MS)).toBe(false);
  });

  it("翻滚进度从 0 到 1 单调增长", () => {
    const s = createRoll(0, 0.2);
    expect(rollSpin(s, ROLL_CROUCH_MS)).toBeCloseTo(0, 5);
    expect(rollSpin(s, ROLL_SPIN_END_MS)).toBeCloseTo(1, 5);
    const a = rollSpin(s, 1_000);
    const b = rollSpin(s, 1_800);
    expect(b).toBeGreaterThan(a);
  });

  it("最高点点她加一个跟头：蓄力期不认、有冷却、最多三个", () => {
    const s = createRoll(0, 0.1);
    expect(flipRoll(s, 200)).toBe("miss");
    expect(flipRoll(s, 1_000)).toBe("flip");
    expect(flipRoll(s, 1_000 + ROLL_FLIP_COOLDOWN_MS - 1)).toBe("miss");
    expect(flipRoll(s, 1_000 + ROLL_FLIP_COOLDOWN_MS)).toBe("flip");
    expect(flipRoll(s, 1_600 + ROLL_FLIP_COOLDOWN_MS)).toBe("flip");
    expect(s.flips).toBe(ROLL_MAX_FLIPS);
    expect(flipRoll(s, 2_200 + ROLL_FLIP_COOLDOWN_MS)).toBe("capped");
  });

  it("命中区是整个人；身外点不到", () => {
    const s = createRoll(0, 0.1);
    expect(rollAtPoint(s, 1_000, FACE, FLOOR, FACE.cx, FACE.bottom)).toBe(true);
    expect(rollAtPoint(s, 1_000, FACE, FLOOR, FACE.cx - 80, FACE.bottom)).toBe(false);
    expect(rollAtPoint(s, 100, FACE, FLOOR, FACE.cx, FACE.bottom)).toBe(false);
  });

  it("画法：尘土 + 旋转弧 + 跟头星，坐标全有限；收走后清空", () => {
    const s = createRoll(0, 0.4);
    flipRoll(s, 1_000);
    const ops = buildRollOps(s, 1_200, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "fillEllipse").length).toBeGreaterThanOrEqual(4);
    expect(ops.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(2);
    expect(finite(ops)).toBe(true);
    expect(buildRollOps(s, ROLL_MS, FACE, FLOOR)).toEqual([]);
  });
});

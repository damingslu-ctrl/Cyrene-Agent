import { describe, expect, it } from "vitest";
import { gesturePoseFor } from "./girl-gesture";
import {
  COMBO_FINAL_MS,
  COMBO_MS,
  COMBO_STEPS,
  buildComboOps,
  createCombo,
  comboAge,
  comboApplaud,
  comboAlive,
  comboProgress,
  comboStepAt,
} from "./girl-combo";

const FACE = { cx: 41, top: 20, bottom: 54, w: 44, h: 34 };
const FLOOR = 84;

function stepStart(index: number): number {
  let at = 0;
  for (let i = 0; i < index; i += 1) at += COMBO_STEPS[i].holdMs;
  return at;
}

describe("节目单连招", () => {
  it("节目单只准用真的举得起的姿态：每个 id 都在手势表里", () => {
    expect(COMBO_STEPS.length).toBeGreaterThanOrEqual(4);
    for (const step of COMBO_STEPS) {
      const pose = gesturePoseFor(step.gesture);
      expect(pose, step.gesture).not.toBeNull();
      expect(step.holdMs).toBe(pose!.holdMs);
      expect(step.label.length).toBeGreaterThan(0);
    }
    expect(COMBO_MS).toBe(COMBO_STEPS.reduce((sum, s) => sum + s.holdMs, 0) + COMBO_FINAL_MS);
  });

  it("帧时间戳早于出生那一拍时只当刚出生，不许判死", () => {
    const s = createCombo(1_000, 0.3);
    expect(comboAge(s, 984)).toBe(0);
    expect(comboAlive(s, 984)).toBe(true);
    expect(comboStepAt(s, 984)!.index).toBe(0);
    expect(comboAge(s, 1_000 + COMBO_MS - 1)).toBe(COMBO_MS - 1);
    expect(comboAlive(s, 1_000 + COMBO_MS - 1)).toBe(true);
    expect(comboAlive(s, 1_000 + COMBO_MS)).toBe(false);
  });

  it("按表走台：每一步的起止刚好接上，最后一跳是收尾", () => {
    const s = createCombo(0, 0.1);
    for (let i = 0; i < COMBO_STEPS.length; i += 1) {
      const start = stepStart(i);
      expect(comboStepAt(s, start)!.index).toBe(i);
      expect(comboStepAt(s, start + COMBO_STEPS[i].holdMs - 1)!.index).toBe(i);
      expect(comboStepAt(s, start + COMBO_STEPS[i].holdMs)!.index).toBe(i + 1);
      expect(comboStepAt(s, start)!.step.gesture).toBe(COMBO_STEPS[i].gesture);
    }
    expect(comboStepAt(s, COMBO_MS - COMBO_FINAL_MS)!.index).toBe(COMBO_STEPS.length);
    expect(comboStepAt(s, COMBO_MS - 1)!.index).toBe(COMBO_STEPS.length);
    expect(comboStepAt(s, COMBO_MS)).toBeNull();
  });

  it("进度是单调的 0..1，收尾段仍算满台前", () => {
    const s = createCombo(0, 0.2);
    let prev = -1;
    for (let t = 0; t <= COMBO_MS; t += 43) {
      const p = comboProgress(s, t);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
    expect(comboProgress(s, 0)).toBe(0);
    expect(comboProgress(s, COMBO_MS)).toBe(1);
  });

  it("谢幕拍点：每步最后 400ms 算跟上了，早拍只算催", () => {
    const s = createCombo(0, 0.4);
    const first = COMBO_STEPS[0];
    expect(comboApplaud(s, first.holdMs - 200)).toBe("clap");
    expect(s.claps).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.best).toBe(1);
    // 同一拍连点被吞掉：一步只许一次。
    expect(comboApplaud(s, first.holdMs - 100)).toBe("miss");
    expect(s.claps).toBe(1);
    // 站在台中间催：不算跟上，也不清空连击。
    expect(comboApplaud(s, stepStart(1) + 120)).toBe("early");
    expect(s.streak).toBe(1);
    expect(s.claps).toBe(1);
    // 收尾段：节目演完再拍仍算一次。
    expect(comboApplaud(s, COMBO_MS - COMBO_FINAL_MS / 2)).toBe("clap");
    expect(s.claps).toBe(2);
    expect(comboApplaud(s, COMBO_MS)).toBe("miss");
  });

  it("连击有上限账：best 记最高一段，掉一拍才归零", () => {
    const s = createCombo(0, 0.5);
    for (let i = 0; i < 3; i += 1) {
      const at = stepStart(i) + COMBO_STEPS[i].holdMs - 150;
      expect(comboApplaud(s, at)).toBe("clap");
    }
    expect(s.streak).toBe(3);
    expect(s.best).toBe(3);
    // 整步没拍：连击断，账还在。
    comboApplaud(s, stepStart(4) + COMBO_STEPS[4].holdMs - 150);
    expect(s.best).toBe(3);
    expect(s.claps).toBe(4);
  });

  it("画法：台前一行节目圆点（演完填实、当前高亮）+ 收尾礼花；收走为空", () => {
    const s = createCombo(0, 0.6);
    const early = buildComboOps(s, 60, FACE, FLOOR);
    const dots = early.filter((op) => op.kind === "fillEllipse" || op.kind === "strokeRoundRect");
    expect(dots.length).toBeGreaterThanOrEqual(COMBO_STEPS.length);
    const mid = buildComboOps(s, stepStart(2) + 20, FACE, FLOOR);
    expect(mid.length).toBeGreaterThanOrEqual(early.length);
    expect(finiteAll(mid)).toBe(true);
    const final = buildComboOps(s, COMBO_MS - COMBO_FINAL_MS + 40, FACE, FLOOR);
    expect(final.some((op) => op.kind === "fillPath")).toBe(true);
    expect(buildComboOps(s, COMBO_MS, FACE, FLOOR)).toEqual([]);
  });
});

function finiteAll(ops: ReturnType<typeof buildComboOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

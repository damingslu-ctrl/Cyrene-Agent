import { describe, expect, it } from "vitest";
import {
  CATNIP_MS, CATNIP_PUFF_MS, buildCatnipOps, catnipAlive, catnipAt, catnipAtPoint,
  catnipPhase, createCatnip, puffCatnip,
} from "./girl-catnip";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildCatnipOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("猫薄荷", () => {
  it("三段：闻 1.6s → 打滚 3s → 坐回来 1.8s", () => {
    const nip = createCatnip(0, 0.3);
    expect(catnipPhase(nip, 0)).toBe("sniff");
    expect(catnipPhase(nip, 1_599)).toBe("sniff");
    expect(catnipPhase(nip, 1_600)).toBe("roll");
    expect(catnipPhase(nip, 4_599)).toBe("roll");
    expect(catnipPhase(nip, 4_600)).toBe("settle");
    expect(catnipAlive(nip, CATNIP_MS - 1)).toBe(true);
    expect(catnipAlive(nip, CATNIP_MS)).toBe(false);
  });

  it("薄荷枝落在面朝那一侧的脚边；点得中枝头，点不中隔一条街", () => {
    const nip = createCatnip(0, 0.5);
    const sprig = catnipAt(nip, 500, FACE, FLOOR, 1);
    expect(sprig.y).toBeLessThan(FLOOR);
    expect(sprig.x).toBeGreaterThan(FACE.cx);
    expect(catnipAtPoint(nip, 500, FACE, FLOOR, 1, sprig.x, sprig.y)).toBe(true);
    expect(catnipAtPoint(nip, 500, FACE, FLOOR, 1, sprig.x + 24, sprig.y)).toBe(false);
    const left = catnipAt(nip, 500, FACE, FLOOR, -1);
    expect(left.x).toBeLessThan(FACE.cx);
  });

  it("点薄荷会喷一蓬叶子，连点有冷却；花谢后点不到", () => {
    const nip = createCatnip(0, 0.1);
    expect(puffCatnip(nip, 1_000)).toBe(true);
    expect(puffCatnip(nip, 1_000 + CATNIP_PUFF_MS)).toBe(false);
    expect(puffCatnip(nip, 1_000 + CATNIP_PUFF_MS + 200)).toBe(true);
    expect(nip.puffs).toBe(2);
    expect(puffCatnip(nip, CATNIP_MS + 10)).toBe(false);
  });

  it("三段的记号各不相同：闻香有绿弯、打滚有六颗星与两颗心、最后淡出", () => {
    const nip = createCatnip(0, 0.2);
    const sniff = buildCatnipOps(nip, 800, FACE, FLOOR, 1);
    expect(sniff.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(4);
    expect(finite(sniff)).toBe(true);

    const roll = buildCatnipOps(nip, 2_500, FACE, FLOOR, 1);
    expect(roll.filter((op) => op.kind === "fillPath").length).toBeGreaterThan(sniff.filter((op) => op.kind === "fillPath").length);
    expect(finite(roll)).toBe(true);

    expect(buildCatnipOps(nip, CATNIP_MS, FACE, FLOOR, 1)).toEqual([]);
  });
});

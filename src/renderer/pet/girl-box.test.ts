import { describe, expect, it } from "vitest";
import {
  BOX_KNOCK_MS, BOX_MS, BOX_POP_MS, boxAlive, boxAt, boxHeadRect, boxPhase, boxRectFor,
  buildBoxOps, catchBox, createBox, knockBox,
} from "./girl-box";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildBoxOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("纸箱躲猫猫", () => {
  it("时间表：进场 → 躲藏/探头三段 → 离场；抓住后只剩 900ms 收尾", () => {
    const box = createBox(0, 0.4);
    expect(boxPhase(box, 0)).toBe("enter");
    expect(boxPhase(box, 800)).toBe("hidden");
    expect(boxPhase(box, 1_500)).toBe("peek");
    expect(boxPhase(box, 2_300)).toBe("hidden");
    expect(boxPhase(box, 3_000)).toBe("peek");
    expect(boxPhase(box, 4_500)).toBe("peek");
    expect(boxPhase(box, 5_300)).toBe("leave");
    expect(boxAlive(box, BOX_MS - 1)).toBe(true);
    expect(boxAlive(box, BOX_MS)).toBe(false);

    catchBox(box, 3_100);
    expect(boxPhase(box, 3_100)).toBe("pop");
    expect(boxAlive(box, 3_100 + BOX_POP_MS)).toBe(true);
    expect(boxAlive(box, 3_100 + BOX_POP_MS + 1)).toBe(false);
  });

  it("躲藏时箱沿盖过发顶，探头时落到下巴：脑袋只在探头窗口露出来", () => {
    const box = createBox(0, 0.2);
    const hidden = boxRectFor(box, 1_000, FACE, FLOOR);
    expect(hidden.y).toBeLessThan(FACE.top);
    expect(hidden.y + hidden.h).toBeGreaterThan(FLOOR);
    const peek = boxRectFor(box, 1_800, FACE, FLOOR);
    expect(peek.y).toBeGreaterThan(FACE.top);
    expect(peek.y).toBeCloseTo(FACE.bottom + 0.5, 6);
    const head = boxHeadRect(box, 1_800, FACE);
    expect(head.y).toBe(FACE.top);
    expect(head.x).toBeLessThan(FACE.cx);
    expect(head.x + head.w).toBeGreaterThan(FACE.cx);
  });

  it("探头时点头 → head；躲着时点箱面 → box；抓住后谁都点不到", () => {
    const box = createBox(0, 0.2);
    expect(boxAt(box, 1_800, FACE, FLOOR, FACE.cx, FACE.top + 8)).toBe("head");
    expect(boxAt(box, 1_800, FACE, FLOOR, FACE.cx, FLOOR - 6)).toBe("box");
    expect(boxAt(box, 1_000, FACE, FLOOR, FACE.cx, FACE.top + 8)).toBe("box");
    expect(boxAt(box, 2_600, FACE, FLOOR, FACE.cx, FACE.top + 8)).toBe("box");

    catchBox(box, 1_850);
    expect(boxAt(box, 1_900, FACE, FLOOR, FACE.cx, FACE.top + 8)).toBeNull();
  });

  it("敲箱子有抖动与冷却；抓住后不再接受敲击", () => {
    const box = createBox(0, 0.1);
    expect(knockBox(box, 1_000)).toBe(true);
    expect(knockBox(box, 1_000 + BOX_KNOCK_MS)).toBe(false);
    expect(knockBox(box, 1_000 + BOX_KNOCK_MS + 200)).toBe(true);
    expect(box.knocks).toBe(2);
    const shaken = boxRectFor(box, 1_000 + 60, FACE, FLOOR);
    const calm = boxRectFor(createBox(0, 0.1), 1_000 + 60 + BOX_KNOCK_MS + 200 + 400, FACE, FLOOR);
    expect(Math.abs(shaken.x - calm.x)).toBeGreaterThan(0);

    catchBox(box, 1_500);
    expect(knockBox(box, 1_600)).toBe(false);
  });

  it("画法：箱身、胶带、翻盖、爪印至少四类图元；收尾多出炸线，坐标全有限", () => {
    const box = createBox(0, 0.3);
    const ops = buildBoxOps(box, 1_000, FACE, FLOOR);
    expect(ops.filter((op) => op.kind === "fillPath").length).toBeGreaterThanOrEqual(4);
    expect(ops.some((op) => op.kind === "fillRoundRect")).toBe(true);
    expect(ops.some((op) => op.kind === "fillEllipse")).toBe(true);
    expect(finite(ops)).toBe(true);

    catchBox(box, 1_200);
    const pop = buildBoxOps(box, 1_300, FACE, FLOOR);
    expect(pop.length).toBeGreaterThan(ops.length);
    expect(finite(pop)).toBe(true);
    expect(buildBoxOps(box, 1_200 + BOX_POP_MS + 1, FACE, FLOOR)).toEqual([]);
  });
});

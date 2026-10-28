import { describe, expect, it } from "vitest";
import {
  FISH_BITE_MS,
  FISH_BITS,
  FISH_CAST_MS,
  FISH_COOLDOWN_MS,
  FISH_MS,
  buildFishingOps,
  createFishing,
  fishAge,
  fishBobberAt,
  fishPhaseAt,
  reelFish,
} from "./girl-fishing";

const FACE = { cx: 41, top: 20, bottom: 54, w: 44, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildFishingOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("钓鱼（甩线-浮标-咬钩-收杆）", () => {
  it("帧时间戳早于出生那一拍时只当刚出生，不许判死", () => {
    const s = createFishing(1_000, 0.3);
    expect(fishAge(s, 984)).toBe(0);
    expect(fishPhaseAt(s, 984)).toBe("cast");
    expect(buildFishingOps(s, 984, FACE, FLOOR).length).toBeGreaterThan(0);
    expect(fishAge(s, 1_000 + FISH_MS - 1)).toBe(FISH_MS - 1);
    expect(fishPhaseAt(s, 1_000 + FISH_MS - 1)).not.toBe("gone");
    expect(buildFishingOps(s, 1_000 + FISH_MS, FACE, FLOOR)).toEqual([]);
  });

  it("时刻表按阶段走：甩线 → 等 → 咬钩窗口 → 再等，最后一口转收竿", () => {
    const s = createFishing(0, 0.1);
    expect(fishPhaseAt(s, 0)).toBe("cast");
    expect(fishPhaseAt(s, FISH_CAST_MS - 1)).toBe("cast");
    expect(fishPhaseAt(s, FISH_CAST_MS)).toBe("wait");
    for (let i = 0; i < FISH_BITS.length; i += 1) {
      const bit = FISH_BITS[i];
      const last = i === FISH_BITS.length - 1;
      expect(fishPhaseAt(s, bit.at - 1)).toBe("wait");
      expect(fishPhaseAt(s, bit.at)).toBe("bite");
      expect(fishPhaseAt(s, bit.at + FISH_BITE_MS - 1)).toBe("bite");
      // 最后一口之后不再等鱼，她把线收回来数鱼。
      expect(fishPhaseAt(s, bit.at + FISH_BITE_MS)).toBe(last ? "haul" : "wait");
    }
    expect(FISH_BITS[FISH_BITS.length - 1].at + FISH_BITE_MS).toBeLessThan(FISH_MS);
    expect(fishPhaseAt(s, FISH_MS - 1)).toBe("haul");
  });

  it("咬钩时浮标真的往下沉：咬钩中的下沉量比平静时大", () => {
    const s = createFishing(0, 0.2);
    const calm = fishBobberAt(s, FISH_CAST_MS + 300, FACE, FLOOR);
    const bite = fishBobberAt(s, FISH_BITS[0].at + 120, FACE, FLOOR);
    expect(bite.dip).toBeGreaterThan(calm.dip);
    expect(bite.y).toBeGreaterThan(calm.y);
    expect(calm.dip).toBeLessThan(1);
    for (let t = 0; t < FISH_MS; t += 29) {
      const b = fishBobberAt(s, t, FACE, FLOOR);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      // 甩线要飞得起来，但整条弧不许出窗（82×108）。
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(82);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(FLOOR + 6);
    }
  });

  it("收杆：咬钩窗口内上鱼，同一口不许收两次；平静时收是空竿", () => {
    const s = createFishing(0, 0.4);
    const bob = fishBobberAt(s, FISH_BITS[0].at + 150, FACE, FLOOR);
    expect(reelFish(s, FISH_BITS[0].at + 150, FACE, FLOOR, bob.x, bob.y)).toBe("catch");
    expect(s.catches).toBe(1);
    expect(reelFish(s, FISH_BITS[0].at + 300, FACE, FLOOR, bob.x, bob.y)).toBe("nibble");
    expect(s.catches).toBe(1);
    // 空竿：把线重新甩出去，等待从下一次咬钩开始。
    const idle = fishBobberAt(s, FISH_CAST_MS + 200, FACE, FLOOR);
    expect(reelFish(s, FISH_CAST_MS + 200, FACE, FLOOR, idle.x, idle.y)).toBe("empty");
    expect(s.misses).toBe(1);
    // 点在水塘外：什么也没发生。
    expect(reelFish(s, FISH_BITS[1].at + 100, FACE, FLOOR, idle.x - 30, idle.y - 26)).toBe("miss");
    expect(s.catches).toBe(1);
    // 冷却吞掉同一拍的连点。
    expect(reelFish(s, FISH_BITS[1].at + 120, FACE, FLOOR, ...(() => {
      const b = fishBobberAt(s, FISH_BITS[1].at + 120, FACE, FLOOR);
      return [b.x, b.y];
    })())).toBe("catch");
    expect(reelFish(s, FISH_BITS[1].at + 120 + FISH_COOLDOWN_MS - 40, FACE, FLOOR, ...(() => {
      const b = fishBobberAt(s, FISH_BITS[1].at + 260, FACE, FLOOR);
      return [b.x, b.y];
    })())).toBe("miss");
    expect(s.catches).toBe(2);
    expect(reelFish(s, FISH_MS, FACE, FLOOR, bob.x, bob.y)).toBe("miss");
  });

  it("错过的那一口要记账：窗口走完没收就算跑鱼", () => {
    const s = createFishing(0, 0.5);
    const at = FISH_BITS[0].at + FISH_BITE_MS;
    expect(fishPhaseAt(s, at)).toBe("wait");
    expect(s.escaped).toBe(1);
    void at;
  });

  it("命中区就是浮标外扩一圈：贴着边点得到，再外 8px 算点空且不记账", () => {
    const at = FISH_BITS[0].at + 150;
    const s = createFishing(0, 0.7);
    const b = fishBobberAt(s, at, FACE, FLOOR);
    expect(reelFish(s, at, FACE, FLOOR, b.x, b.y + b.r + 4)).toBe("catch");
    // 另一颗干净的账：外 8px 不该摸到，也不许留「空竿」的账。
    const s2 = createFishing(0, 0.7);
    expect(reelFish(s2, at, FACE, FLOOR, b.x, b.y + b.r + 12)).toBe("miss");
    expect(s2.catches).toBe(0);
    expect(s2.misses).toBe(0);
    expect(s2.lastReelAt).toBe(-1);
  });

  it("画法：水塘双色 + 钓竿描边 + 钓线连到浮标 + 咬钩涟漪 + 上鱼闪光", () => {
    const s = createFishing(0, 0.6);
    const cast = buildFishingOps(s, 120, FACE, FLOOR);
    expect(finite(cast)).toBe(true);
    const wait = buildFishingOps(s, FISH_CAST_MS + 400, FACE, FLOOR);
    expect(wait.some((op) => op.kind === "strokePath")).toBe(true);
    expect(wait.some((op) => op.kind === "fillEllipse")).toBe(true);
    const bite = buildFishingOps(s, FISH_BITS[0].at + 150, FACE, FLOOR);
    expect(bite.length).toBeGreaterThan(wait.length);
    expect(finite(bite)).toBe(true);
    const bob = fishBobberAt(s, FISH_BITS[0].at + 150, FACE, FLOOR);
    reelFish(s, FISH_BITS[0].at + 150, FACE, FLOOR, bob.x, bob.y);
    const caught = buildFishingOps(s, FISH_BITS[0].at + 200, FACE, FLOOR);
    expect(caught.some((op) => op.kind === "fillPath")).toBe(true);
    expect(buildFishingOps(s, FISH_MS, FACE, FLOOR)).toEqual([]);
  });
});

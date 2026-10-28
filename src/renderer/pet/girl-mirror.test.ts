import { describe, expect, it } from "vitest";
import { EXPRESSIONS, FACE_REST, faceOf, type Expression } from "./face";
import {
  MIRROR_AFTER_MS,
  MIRROR_COOLDOWN_MS,
  MIRROR_FACE_MS,
  MIRROR_FACES,
  MIRROR_GAP_MS,
  MIRROR_MS,
  buildMirrorOps,
  copyFace,
  createMirror,
  mirrorAge,
  mirrorAlive,
  mirrorFaceAt,
  mirrorRectAt,
} from "./girl-mirror";

const FACE = { cx: 41, top: 20, bottom: 54, w: 44, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildMirrorOps>): boolean {
  // gradPath 带 from/to/stops：数值可能藏在任意一层，逐层走一遍才算「有限」。
  const ok = (value: unknown): boolean => {
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(ok);
    if (value && typeof value === "object") return Object.values(value).every(ok);
    return true;
  };
  return ops.every((op) => Object.values(op).every(ok));
}

function center(now: number): [number, number] {
  const r = mirrorRectAt(createMirror(0, 0.1), now, FACE, FLOOR);
  return [r.x + r.w / 2, r.y + r.h / 2];
}

describe("照镜子做鬼脸", () => {
  it("鬼脸表用的是生产的 16 档差分，且每档都真的和常态不同", () => {
    expect(MIRROR_FACES.length).toBeGreaterThanOrEqual(4);
    const ctx = { t: 0, blink: 0, mouse: null, energy: 1, speaking: false };
    for (const expr of MIRROR_FACES) {
      expect(EXPRESSIONS).toContain(expr);
      const fp = faceOf(expr as Expression, ctx);
      const differs = Object.keys(FACE_REST).filter((key) => {
        const a = fp[key as keyof typeof fp];
        const b = FACE_REST[key as keyof typeof FACE_REST];
        return JSON.stringify(a) !== JSON.stringify(b);
      });
      expect(differs.length, expr).toBeGreaterThanOrEqual(2);
    }
    // 两两不许撞：靠嘴/眼分辨的档，彼此至少差两个通道。
    for (let i = 0; i < MIRROR_FACES.length; i += 1) {
      for (let j = i + 1; j < MIRROR_FACES.length; j += 1) {
        const a = faceOf(MIRROR_FACES[i] as Expression, ctx);
        const b = faceOf(MIRROR_FACES[j] as Expression, ctx);
        const delta = Object.keys(FACE_REST).filter((key) =>
          JSON.stringify(a[key as keyof typeof a]) !== JSON.stringify(b[key as keyof typeof b]));
        expect(delta.length, `${MIRROR_FACES[i]} vs ${MIRROR_FACES[j]}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("帧时间戳早于出生那一拍时只当刚出生，不许判死", () => {
    const s = createMirror(1_000, 0.2);
    expect(mirrorAge(s, 984)).toBe(0);
    expect(mirrorAlive(s, 984)).toBe(true);
    expect(mirrorFaceAt(s, 984)!.index).toBe(0);
    expect(buildMirrorOps(s, 984, FACE, FLOOR).length).toBeGreaterThan(0);
    expect(mirrorAge(s, 1_000 + MIRROR_MS - 1)).toBe(MIRROR_MS - 1);
    expect(mirrorAlive(s, 1_000 + MIRROR_MS)).toBe(false);
  });

  it("排期：做脸 MIRROR_FACE_MS、换脸 MIRROR_GAP_MS，最后留一段得意", () => {
    const s = createMirror(0, 0.3);
    const cycle = MIRROR_FACE_MS + MIRROR_GAP_MS;
    expect(MIRROR_MS).toBe(MIRROR_FACES.length * cycle + MIRROR_AFTER_MS);
    for (let i = 0; i < MIRROR_FACES.length; i += 1) {
      expect(mirrorFaceAt(s, i * cycle)!.index).toBe(i);
      expect(mirrorFaceAt(s, i * cycle)!.expression).toBe(MIRROR_FACES[i]);
      expect(mirrorFaceAt(s, i * cycle + MIRROR_FACE_MS - 1)!.index).toBe(i);
      expect(mirrorFaceAt(s, i * cycle + MIRROR_FACE_MS)).toBeNull();
      expect(mirrorFaceAt(s, (i + 1) * cycle - 1)).toBeNull();
    }
    // 收尾段：不再抽新鬼脸，她把镜子举正得意地照。
    expect(mirrorFaceAt(s, MIRROR_MS - MIRROR_AFTER_MS)).toBeNull();
    expect(mirrorFaceAt(s, MIRROR_MS - 1)).toBeNull();
  });

  it("接得上算一分：做脸时点中镜框才记，换脸当口点不算，过期不响", () => {
    const s = createMirror(0, 0.4);
    const cycle = MIRROR_FACE_MS + MIRROR_GAP_MS;
    const [x, y] = center(cycle);
    expect(copyFace(s, cycle + 60, FACE, FLOOR, x, y)).toBe("match");
    expect(s.matched).toBe(1);
    expect(s.streak).toBe(1);
    expect(copyFace(s, cycle + 60 + MIRROR_COOLDOWN_MS - 30, FACE, FLOOR, x, y)).toBe("miss");
    expect(s.matched).toBe(1);
    expect(copyFace(s, cycle + MIRROR_FACE_MS + 40, FACE, FLOOR, x, y)).toBe("wrong");
    expect(s.matched).toBe(1);
    expect(s.streak).toBe(0);
    const [far] = center(0);
    expect(copyFace(s, cycle * 2 + 60, FACE, FLOOR, far - 40, y)).toBe("miss");
    expect(copyFace(s, MIRROR_MS, FACE, FLOOR, x, y)).toBe("miss");
  });

  it("得意段也算接得住：收尾那一拍点镜子记「收尾」分", () => {
    const s = createMirror(0, 0.5);
    const [x, y] = center(MIRROR_MS - MIRROR_AFTER_MS / 2);
    expect(copyFace(s, MIRROR_MS - MIRROR_AFTER_MS / 2, FACE, FLOOR, x, y)).toBe("match");
    expect(s.matched).toBe(1);
  });

  it("画法：镜框双色 + 镜面渐变 + 镜里那张脸跟着差分表变；收走为空", () => {
    const s = createMirror(0, 0.6);
    const cycle = MIRROR_FACE_MS + MIRROR_GAP_MS;
    const first = buildMirrorOps(s, 80, FACE, FLOOR);
    expect(first.some((op) => op.kind === "strokeRoundRect")).toBe(true);
    expect(first.some((op) => op.kind === "gradPath")).toBe(true);
    expect(first.some((op) => op.kind === "fillEllipse")).toBe(true);
    expect(finite(first)).toBe(true);
    const later = buildMirrorOps(s, 2 * cycle + 60, FACE, FLOOR);
    expect(JSON.stringify(later)).not.toBe(JSON.stringify(first));
    expect(finite(later)).toBe(true);
    for (let i = 0; i < MIRROR_FACES.length; i += 1) expect(finite(buildMirrorOps(s, i * cycle + 60, FACE, FLOOR))).toBe(true);
    // 同一时刻比「记了一分」前后：多的那几笔只能是记分牌，不是在比两张脸。
    const plain = buildMirrorOps(s, 6_000, FACE, FLOOR);
    expect(copyFace(s, 6_000, FACE, FLOOR, ...center(6_000))).toBe("match");
    const scored = buildMirrorOps(s, 6_000, FACE, FLOOR);
    expect(scored.length).toBeGreaterThan(plain.length);
    expect(buildMirrorOps(s, MIRROR_MS, FACE, FLOOR)).toEqual([]);
  });

  it("镜框在她脚边一侧，不许盖住她的脸", () => {
    const s = createMirror(0, 0.7);
    const r = mirrorRectAt(s, 600, FACE, FLOOR);
    expect(r.y).toBeGreaterThanOrEqual(FACE.bottom - 4);
    expect(r.y + r.h).toBeLessThanOrEqual(FLOOR + 6);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(82);
  });

  it("命中区就是镜框外扩三像素：框内算接住，外 7px 算点空且不记账", () => {
    const s = createMirror(0, 0.75);
    const r = mirrorRectAt(s, 600, FACE, FLOOR);
    expect(copyFace(s, 600, FACE, FLOOR, r.x + r.w / 2, r.y + r.h / 2)).toBe("match");
    const s2 = createMirror(0, 0.75);
    expect(copyFace(s2, 600, FACE, FLOOR, r.x + r.w + 7, r.y + r.h / 2)).toBe("miss");
    expect(copyFace(s2, 600, FACE, FLOOR, r.x - 7, r.y + r.h / 2)).toBe("miss");
    expect(s2.matched).toBe(0);
    expect(s2.misses).toBe(0);
    expect(s2.lastCopyAt).toBe(-1);
  });
});

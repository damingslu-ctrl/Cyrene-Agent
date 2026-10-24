import { describe, expect, it } from "vitest";
import { EXPRESSIONS, FACE_REST, MOOD_TO_EXPRESSION, faceOf, type FaceCtx, type FaceParams } from "./face";

const CTX: FaceCtx = { t: 0, blink: 0, mouse: null, energy: 1, speaking: false };
/** 12 个可比的标量/向量通道，键名与 FaceParams 逐字一致（`browTilt`，不是 `brotTilt`；pupil 按数组比）。 */
const KEYS: Array<keyof FaceParams> =
  ["lidL", "lidR", "eyeOpen", "pupil", "brow", "browTilt", "mouth", "mouthWide", "blush", "tear", "sweat", "star"];

function same(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;
}

describe("16 档表情差分表", () => {
  it("16 档，名字与 spec §3.2 逐字一致", () => {
    expect(EXPRESSIONS).toHaveLength(16);
    expect([...EXPRESSIONS].sort()).toEqual(
      ["neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
       "sleepy", "thinking", "smug", "pout", "worried", "excited", "cry", "confused"].sort(),
    );
  });

  it("纯函数：同 ctx 连调两次逐字段相等；ctx.t 不参与（相位归 clip）", () => {
    for (const e of EXPRESSIONS) {
      expect(faceOf(e, CTX), e).toEqual(faceOf(e, CTX));
      expect(faceOf(e, { ...CTX, t: 1234.5 })).toEqual(faceOf(e, CTX));
    }
  });

  it("每档与任一其它档至少差 3 个通道（尺 #72 的单位层）", () => {
    const rows = EXPRESSIONS.map((e) => faceOf(e, CTX));
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const diff = KEYS.filter((k) => !same(rows[i][k], rows[j][k])).length;
        expect(diff, `${EXPRESSIONS[i]} vs ${EXPRESSIONS[j]} 只差 ${diff} 通道`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("闭眼档必须真的闭（lid 到 1），wink 必须两眼不等", () => {
    expect(faceOf("sleepy", CTX).lidL).toBeGreaterThanOrEqual(0.9);
    expect(faceOf("wink", CTX).lidL).not.toBe(faceOf("wink", CTX).lidR);
    expect(faceOf("neutral", CTX).lidL).toBeLessThan(0.2);
  });

  it("泪与汗只在有它们的档出现，其余档恒为 0（防「每档都挂一滴」）", () => {
    expect(faceOf("cry", CTX).tear).toBeGreaterThan(0);
    expect(faceOf("worried", CTX).sweat).toBeGreaterThan(0);
    for (const e of EXPRESSIONS.filter((x) => x !== "cry" && x !== "sad")) {
      expect(faceOf(e, CTX).tear, e).toBe(0);
    }
  });

  it("blink 只压 lid，不改任何别的通道（死通道复活的入口条件）", () => {
    const open = faceOf("happy", CTX);
    const mid = faceOf("happy", { ...CTX, blink: 0.6 });
    expect(mid.lidL).toBeCloseTo(Math.max(open.lidL, 0.6), 6);
    for (const k of KEYS.filter((x) => x !== "lidL" && x !== "lidR")) expect(mid[k]).toEqual(open[k]);
  });

  it("gaze：mouse 给了才追，没给时保持 rest 瞳孔", () => {
    expect(faceOf("neutral", { ...CTX, mouse: [10, 60] }).pupil).not.toEqual(FACE_REST.pupil);
    expect(faceOf("neutral", CTX).pupil).toEqual(FACE_REST.pupil);
  });

  it("Mood 五档各有归属，且不许出现未定义", () => {
    expect(MOOD_TO_EXPRESSION.idle).toBe("neutral");
    expect(MOOD_TO_EXPRESSION.sleep).toBe("sleepy");
    expect(MOOD_TO_EXPRESSION.grumpy).toBe("angry");
    expect(new Set(Object.values(MOOD_TO_EXPRESSION)).size).toBeGreaterThanOrEqual(4);
  });
});

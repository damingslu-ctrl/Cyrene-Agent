import { describe, expect, it } from "vitest";
import { GIRL_ANIM, GIRL_ANIM_RANGES } from "./girl-anim-meta";
import { GIRL_FACE, GIRL_INK_BOX } from "./girl-face-meta";

/** 每段动作的第一帧：换镜头允许脸心跳，段内不允许。 */
const SEGMENT_STARTS = new Set(Object.values(GIRL_ANIM_RANGES).map(([lo]) => lo));

/**
 * 逐帧表是「用哪一格画」和「记号落在哪」之间的唯一契约。
 * 它由 scripts/assets/build-girl-face.py 从图集实测生成，这里只钉住三件事：
 * 帧数对齐、每格都在脸该在的地方、脸框落在墨框里。
 */
describe("girl face meta", () => {
  it("每帧一行，和图集帧数对齐", () => {
    expect(GIRL_FACE).toHaveLength(GIRL_ANIM.count);
    expect(GIRL_INK_BOX).toHaveLength(GIRL_ANIM.count);
  });

  it("脸框始终落在人身上半段（不会跑到头发外或格子里）", () => {
    for (const [i, face] of GIRL_FACE.entries()) {
      const [cx, cy, w, h] = face;
      expect(cx, `frame ${i} cx`).toBeGreaterThan(0.32);
      expect(cx, `frame ${i} cx`).toBeLessThan(0.68);
      expect(cy, `frame ${i} cy`).toBeGreaterThan(0.2);
      expect(cy, `frame ${i} cy`).toBeLessThan(0.58);
      expect(w, `frame ${i} w`).toBeGreaterThan(0.12);
      expect(w, `frame ${i} w`).toBeLessThan(0.34);
      expect(h, `frame ${i} h`).toBeGreaterThan(0.2);
      expect(h, `frame ${i} h`).toBeLessThan(0.45);
    }
  });

  it("脸框永远包在墨框里（贴纸记号的落点不会落到空气上）", () => {
    for (const [i, face] of GIRL_FACE.entries()) {
      const [cx, cy, w, h] = face;
      const [x, y, iw, ih] = GIRL_INK_BOX[i];
      expect(cx - w / 2, `frame ${i} left`).toBeGreaterThanOrEqual(x - 0.005);
      expect(cx + w / 2, `frame ${i} right`).toBeLessThanOrEqual(x + iw + 0.005);
      expect(cy - h / 2, `frame ${i} top`).toBeGreaterThanOrEqual(y - 0.005);
      expect(cy + h / 2, `frame ${i} bottom`).toBeLessThanOrEqual(y + ih + 0.005);
    }
  });

  it("同一镜头的相邻帧脸心不会瞬移（真正的换镜头除外）", () => {
    for (let i = 1; i < GIRL_FACE.length; i += 1) {
      if (SEGMENT_STARTS.has(i)) continue;
      // 源片在一段动作内部也会切镜头（wink 72-77 是特写、78-80 是中景），
      // 换镜头时整只墨框的高度会变；只有墨框稳定的连续帧才要求脸心连续。
      const [_, _y0, _w, h0] = GIRL_INK_BOX[i - 1];
      const [__, _y1, _w1, h1] = GIRL_INK_BOX[i];
      if (Math.abs(h1 - h0) > 0.05) continue;
      // 大笑/哈欠时头会在一帧里点一下，实测最大 0.118 格；0.13 是「还在动」的上限，
      // 不是拟合出来的边界——表被手改成常数或乱序会先从别的断言红。
      expect(Math.abs(GIRL_FACE[i][0] - GIRL_FACE[i - 1][0]), `frame ${i} cx jump`).toBeLessThan(0.13);
      expect(Math.abs(GIRL_FACE[i][1] - GIRL_FACE[i - 1][1]), `frame ${i} cy jump`).toBeLessThan(0.13);
    }
  });
});

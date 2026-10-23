import { describe, expect, it } from "vitest";
import { EYE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, ACCENT, WARN, wash } from "./pet-tokens";
import { CAT_COATS, COAT_READS_BY, INK_COAT, coatOf, luminance, type CoatName } from "./cat-coats";

/** 板内色全体——本期「不许引入新色相」这条判据的定义域。 */
const BOARD = [INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, EYE, ACCENT, WARN] as const;

/** 板内色的所有 wash 像：`wash(板, α, 板)`，α 取 1..255。约 2 万条，构造一次就够。 */
const WASH_IMAGE = new Set<string>();
for (const fg of BOARD) for (const bg of BOARD) for (let a = 1; a <= 255; a += 1) WASH_IMAGE.add(wash(fg, a, bg));

describe("花色轴", () => {
  it("默认花色＝art.ts 改动前用的那批常量（桌面猫零像素变动）", () => {
    expect(coatOf(undefined)).toEqual({
      furTop: INK, furBot: INK_SOFT, furEdge: INK, earInner: ROSE_DEEP,
      light: PAPER, shade: PAPER_SHADE, nose: ROSE_DEEP, blush: ROSE, eye: EYE,
    });
    expect(INK_COAT).toEqual(coatOf("ink"));
  });

  it("五色齐、名字 slug 与 spec 对得上", () => {
    expect(Object.keys(CAT_COATS).sort()).toEqual(["azure", "gray", "ink", "paper", "rose"]);
  });

  it("每档都读得出来：瞳压在眼白上、腮红压在亮面上、胸布比亮面深", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const c = CAT_COATS[name];
      expect(luminance(c.light) - luminance(c.eye), `${name} 瞳/眼白`).toBeGreaterThanOrEqual(60);
      expect(luminance(c.light) - luminance(c.blush), `${name} 腮红/亮面`).toBeGreaterThanOrEqual(40);
      expect(luminance(c.light) - luminance(c.shade), `${name} 胸布两层`).toBeGreaterThanOrEqual(12);
      // 轮廓不许比身体亮（糊成一片的入口）
      expect(luminance(c.furEdge) - luminance(c.furTop), `${name} 轮廓不超亮`).toBeLessThanOrEqual(6);
    }
  });

  it("深色猫靠亮部结构、奶油猫靠暗部轮廓，两套读法各自锁死", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const c = CAT_COATS[name];
      if (COAT_READS_BY[name] === "light-markings") {
        expect(luminance(c.light) - luminance(c.furTop), `${name} 亮部对毛面`).toBeGreaterThanOrEqual(40);
      } else {
        expect(luminance(c.furTop) - luminance(c.furEdge), `${name} 毛面对轮廓`).toBeGreaterThanOrEqual(60);
        expect(luminance(c.furTop) - luminance(c.shade), `${name} 毛面对胸布`).toBeGreaterThanOrEqual(30);
      }
    }
    // 正对照：奶油猫是故意走「暗轮廓」这一支的，它的亮部差只有 21 左右，
    // 拿第一条判据去卡它必红——所以两支持平权，不是给某档开后门。
    expect(luminance(CAT_COATS.paper.light) - luminance(CAT_COATS.paper.furTop)).toBeLessThan(40);
    expect(COAT_READS_BY.paper).toBe("dark-outline");
  });

  it("全部板内色或板内色的 wash，不引入新色相", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      for (const [slot, value] of Object.entries(CAT_COATS[name])) {
        expect(BOARD.includes(value as typeof BOARD[number]) || WASH_IMAGE.has(value),
          `${name}.${slot}=${value}`).toBe(true);
      }
    }
  });
});

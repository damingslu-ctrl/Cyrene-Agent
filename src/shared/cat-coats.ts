/**
 * 花色轴（spec §3-D D1「奶油/灰/墨/蓝/粉 5 色，全部板内色」）。
 *
 * 九个槽对应 `art.ts::buildCatOps` 实际用到的板色位置：
 * - furTop/furBot：身体与尾巴那条 34..106 全局渐变的两端（原 `BODY_TOP`/`BODY_BOT`）
 * - furEdge：耳朵外廓与一切「同墨」的深色部件（原 `BODY_COL`）
 * - earInner：耳内（原 `INNER_EAR` 的非 grumpy 支）
 * - light：白爪、白尾尖、胸布上端、眼白、眼神光、胡须、闭眼弧（原 `PAPER`，15 处）
 * - shade：胸布渐变下端与爪缝（原 `PAPER_SHADE`，3 处）
 * - nose / blush / eye：鼻（ROSE_DEEP）／腮红·嘴内·爱心（ROSE）／瞳（EYE）
 *
 * **不管的东西**：`BADGE_INK`/`ACCENT`/`GREEN`/`WARN`/`SHADOW`/`BREAK_*` 都是语义色
 * （徽章、上行绿、告警橙、投影、炸毛/不悦的破色块），照 tokens 台账的规矩不进花色；
 * `mood === "grumpy"` 依旧整体换成 BREAK_*——那是表情信号，不是花色。
 */
import {
  ACCENT, EYE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, WARN, wash,
} from "./pet-tokens";

export interface CatCoat {
  furTop: string;
  furBot: string;
  furEdge: string;
  earInner: string;
  light: string;
  shade: string;
  nose: string;
  blush: string;
  eye: string;
}

export const INK_COAT: CatCoat = {
  furTop: INK, furBot: INK_SOFT, furEdge: INK, earInner: ROSE_DEEP,
  light: PAPER, shade: PAPER_SHADE, nose: ROSE_DEEP, blush: ROSE, eye: EYE,
};

/** 灰：往墨里掺投影黑，亮面掺一点 INK_SOFT——冷灰猫，轮廓仍走墨。 */
const GRAY_COAT: CatCoat = {
  furTop: wash(INK, 170, PAPER_SHADE), furBot: wash(INK_SOFT, 200, PAPER_SHADE),
  furEdge: wash(INK, 215, INK_SOFT), earInner: wash(ROSE_DEEP, 200, PAPER_SHADE),
  light: wash(PAPER, 235, INK_SOFT), shade: wash(PAPER_SHADE, 220, INK),
  nose: wash(ROSE_DEEP, 235, INK), blush: wash(ROSE, 170, PAPER_SHADE), eye: EYE,
};

/** 奶油：亮面变成主体，轮廓交给掺墨的那一支——浅色猫最容易糊，furEdge 与 shade 是它的骨头。 */
const PAPER_COAT: CatCoat = {
  furTop: wash(PAPER_SHADE, 150, PAPER), furBot: wash(PAPER_SHADE, 205, PAPER),
  furEdge: wash(INK, 120, PAPER_SHADE), earInner: wash(ROSE_DEEP, 210, PAPER_SHADE),
  light: PAPER, shade: wash(INK, 55, PAPER_SHADE),
  nose: ROSE_DEEP, blush: wash(ROSE, 190, PAPER), eye: EYE,
};

/** 蓝：颜料用 ACCENT，掺进墨里；亮面是掺了 ACCENT 的纸。 */
const AZURE_COAT: CatCoat = {
  furTop: wash(ACCENT, 90, INK), furBot: wash(ACCENT, 120, INK_SOFT),
  furEdge: wash(ACCENT, 60, INK), earInner: wash(ROSE_DEEP, 190, ACCENT),
  light: wash(ACCENT, 35, PAPER), shade: wash(ACCENT, 80, PAPER_SHADE),
  nose: wash(ROSE_DEEP, 220, INK), blush: wash(ROSE, 150, ACCENT), eye: EYE,
};

/** 粉：颜料用 ROSE，掺进墨里；比蓝深一档，不然腮红与脸同色。 */
const ROSE_COAT: CatCoat = {
  furTop: wash(ROSE, 95, INK), furBot: wash(ROSE, 130, INK_SOFT),
  furEdge: wash(ROSE, 60, INK), earInner: wash(ROSE_DEEP, 220, ROSE),
  light: wash(ROSE, 40, PAPER), shade: wash(ROSE, 90, PAPER_SHADE),
  nose: wash(ROSE_DEEP, 230, INK), blush: WARN, eye: EYE,
};

export type CoatName = "ink" | "paper" | "gray" | "azure" | "rose";

export const CAT_COATS: Record<CoatName, CatCoat> = {
  ink: INK_COAT, paper: PAPER_COAT, gray: GRAY_COAT, azure: AZURE_COAT, rose: ROSE_COAT,
};

/**
 * 这档靠什么读出来——`cat-coats.test.ts` 按它分支，所以它是**判据的一部分**，不是注释。
 * 深色猫的白爪/眼白/胸布就是结构线（native 的墨青猫正是这么读的）；奶油猫反过来，
 * 亮面与毛面只差 20 出头，结构必须由掺墨的轮廓和胸布暗端撑着。
 */
export const COAT_READS_BY: Record<CoatName, "light-markings" | "dark-outline"> = {
  ink: "light-markings", gray: "light-markings", azure: "light-markings",
  rose: "light-markings", paper: "dark-outline",
};

export function coatOf(name: CoatName | undefined): CatCoat {
  return name === undefined ? INK_COAT : CAT_COATS[name];
}

export function luminance(color: string): number {
  const { r, g, b } = parseRgb(color);
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/** 与 `pet-tokens.parse` 同口径，但这里要的是能直接进公式的整数值。 */
function parseRgb(color: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color);
  if (!m) throw new RangeError(`花色只收 #rrggbb，收到 ${color}`);
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

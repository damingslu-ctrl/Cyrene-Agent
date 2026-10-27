/**
 * 薄荷田：脚边一只小盆，种下后按真实时间发芽、长叶、成熟；成熟才能收一茬。
 * 空盆用 -1 当哨兵，和「刚在 0 时刻种下」区分开。绘制只在种下之后出现。
 */
import { GREEN, INK_SOFT, PAPER, PAPER_SHADE, ROSE, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp } from "./ops";

export const GARDEN_STAGES = {
  sprout: 3 * 60_000,
  leafy: 8 * 60_000,
  ready: 15 * 60_000,
} as const;

export type GardenStage = "empty" | "seed" | "sprout" | "leafy" | "ready";

export interface GardenState {
  /** -1 = 空盆；否则为播种时刻。 */
  plantedAt: number;
  harvests: number;
}

export interface GardenFace {
  cx: number;
  top: number;
  w: number;
}

export function createGarden(): GardenState {
  return { plantedAt: -1, harvests: 0 };
}

export function gardenStage(state: GardenState, now: number): GardenStage {
  if (!(state.plantedAt >= 0)) return "empty";
  const age = Math.max(0, now - state.plantedAt);
  if (age < GARDEN_STAGES.sprout) return "seed";
  if (age < GARDEN_STAGES.leafy) return "sprout";
  if (age < GARDEN_STAGES.ready) return "leafy";
  return "ready";
}

export function plantGarden(state: GardenState, now: number): boolean {
  if (state.plantedAt >= 0) return false;
  state.plantedAt = now;
  return true;
}

export function harvestGarden(state: GardenState, now: number): boolean {
  if (gardenStage(state, now) !== "ready") return false;
  state.plantedAt = -1;
  state.harvests += 1;
  return true;
}

/** 到下一阶段的毫秒数；空盆与成熟都返回 0。 */
export function gardenNextMs(state: GardenState, now: number): number {
  const stage = gardenStage(state, now);
  if (stage === "empty" || stage === "ready") return 0;
  const age = Math.max(0, now - state.plantedAt);
  const next = stage === "seed" ? GARDEN_STAGES.sprout : stage === "sprout" ? GARDEN_STAGES.leafy : GARDEN_STAGES.ready;
  return Math.max(0, next - age);
}

const STAGE_LABEL: Record<Exclude<GardenStage, "empty">, string> = {
  seed: "刚种下",
  sprout: "冒芽了",
  leafy: "叶子长开了",
  ready: "可以收啦",
};

export function gardenReport(state: GardenState, now: number): string[] {
  const stage = gardenStage(state, now);
  if (stage === "empty") return ["薄荷盆 空着", "种一颗吧，很快会发芽"];
  const lines = [`薄荷盆 · ${STAGE_LABEL[stage]}`, `收成 ${Math.max(0, Math.floor(state.harvests))} 次`];
  if (stage === "seed") lines.push("等它发芽…");
  else if (stage === "sprout") lines.push("再等等，叶子就长开");
  else if (stage === "leafy") lines.push("再过一会儿就能收");
  else lines.push("点一下，收一茬");
  return lines;
}

export function parseGarden(raw: unknown): GardenState {
  const state = createGarden();
  if (!raw || typeof raw !== "object") return state;
  const obj = raw as { plantedAt?: unknown; harvests?: unknown };
  if (typeof obj.plantedAt === "number" && Number.isFinite(obj.plantedAt) && obj.plantedAt >= 0) {
    state.plantedAt = obj.plantedAt;
  }
  if (typeof obj.harvests === "number" && Number.isFinite(obj.harvests) && obj.harvests > 0) {
    state.harvests = Math.min(1_000_000, Math.floor(obj.harvests));
  }
  return state;
}

const LEAF_COUNT: Record<Exclude<GardenStage, "empty">, number> = {
  seed: 0,
  sprout: 2,
  leafy: 4,
  ready: 6,
};

export function buildGardenOps(state: GardenState, now: number, face: GardenFace, floorY: number): DrawOp[] {
  const stage = gardenStage(state, now);
  if (stage === "empty") return [];
  const ops: DrawOp[] = [];
  const x = face.cx + face.w * 0.42;
  const potY = floorY - 1.4;
  const rx = Math.max(3.2, face.w * 0.1);
  const ry = Math.max(1.9, rx * 0.52);
  // 盆：奶油底 + 深墨描边，浅桌深桌都立得住。
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.98), cx: x, cy: potY, rx, ry });
  ops.push({ kind: "strokeEllipse", stroke: withAlpha(INK_SOFT, 0.85), width: 0.8, cx: x, cy: potY, rx, ry });
  ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER_SHADE, 0.9), cx: x, cy: potY - ry * 0.45, rx: rx * 0.78, ry: ry * 0.42 });
  const stemTop = potY - ry - (stage === "seed" ? 1.2 : stage === "sprout" ? 3.2 : stage === "leafy" ? 4.8 : 5.8);
  ops.push({
    kind: "strokePath",
    stroke: withAlpha(INK_SOFT, 0.8),
    width: 0.7,
    points: [[x, potY - ry * 0.5], [x + Math.sin(now / 1_400) * 0.5, stemTop]],
  });
  if (stage === "seed") {
    ops.push({ kind: "fillEllipse", fill: withAlpha(GREEN, 0.95), cx: x, cy: stemTop, rx: 1.1, ry: 1.1 });
    return ops;
  }
  const leaves = LEAF_COUNT[stage];
  for (let i = 0; i < leaves; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2);
    const lx = x + side * (1.8 + tier * 0.9) + Math.sin(now / 1_100 + i) * 0.35;
    const ly = stemTop + tier * 1.3;
    const lr = Math.max(1.3, 1.9 - tier * 0.15);
    ops.push({ kind: "fillEllipse", fill: withAlpha(GREEN, 0.95), cx: lx, cy: ly, rx: lr, ry: lr * 0.62 });
    ops.push({ kind: "strokeEllipse", stroke: withAlpha(PAPER, 0.75), width: 0.45, cx: lx, cy: ly, rx: lr, ry: lr * 0.62 });
  }
  if (stage === "ready") {
    // 成熟那一朵小小的薄荷尖：玫瑰点，和满盆绿分开。
    ops.push({ kind: "fillEllipse", fill: withAlpha(PAPER, 0.9), cx: x, cy: stemTop - 1.1, rx: 1.2, ry: 1.2 });
    ops.push({ kind: "fillEllipse", fill: withAlpha(ROSE, 0.95), cx: x, cy: stemTop - 1.1, rx: 0.65, ry: 0.65 });
  }
  return ops;
}

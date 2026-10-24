import type { WorkStatusTier } from "../../shared/work-status-types";
import type { Expression } from "./face";

/**
 * 六档工作状态 → 演出（spec §6）。
 *
 * 表驱动、纯函数：给定档位返回「身体、表情、手势、粒子记号」四件事，
 * 渲染端只负责把 channels/expression 喂给 buildPetOps。
 * 未知档位**抛错**（缺行当场红，同 variantFor 的纪律），不许静默退化成 neutral。
 */
export interface WorkPresentation {
  tier: WorkStatusTier;
  body: string;
  gesture: string | null;
  expression: Expression;
  /** 粒子记号：汗滴 / 手指点颊 / 星星 / 泪。 */
  particle: "sweat" | "point" | "star" | "none";
  /** 气泡文案（提示行；空数组＝不说话）。 */
  lines: readonly string[];
}

export const WORK_PRESENTATIONS: Readonly<Record<WorkStatusTier, WorkPresentation>> = {
  连接中: {
    tier: "连接中", body: "stand", gesture: null, expression: "worried", particle: "sweat",
    lines: ["正在连…", "等一下下"],
  },
  思考中: {
    tier: "思考中", body: "stand", gesture: "tilt", expression: "thinking", particle: "point",
    lines: ["在想呢"],
  },
  工作中: {
    tier: "工作中", body: "sit", gesture: "typeCode", expression: "smug", particle: "none",
    lines: ["忙着呢"],
  },
  提醒: {
    tier: "提醒", body: "stand", gesture: "peek", expression: "surprised", particle: "none",
    lines: ["有事找你"],
  },
  已处理: {
    tier: "已处理", body: "stand", gesture: "nod", expression: "happy", particle: "star",
    lines: ["好啦"],
  },
  已中断: {
    tier: "已中断", body: "stand", gesture: "shake", expression: "sad", particle: "none",
    lines: ["没做成…"],
  },
};

export const WORK_STATUS_TIERS: readonly WorkStatusTier[] = [
  "连接中", "思考中", "工作中", "提醒", "已处理", "已中断",
];

export function presentationOf(tier: WorkStatusTier): WorkPresentation {
  const p = WORK_PRESENTATIONS[tier];
  if (!p) throw new Error(`未知工作状态档：${tier}`);
  return p;
}

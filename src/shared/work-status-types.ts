/**
 * 工作状态的类型家（v1.5.0 P3 Task 16）。
 *
 * 住 shared 而不是 main：渲染端（`work-status-presentation.ts`）与主进程
 * （`work-status.ts`）都要这两个类型，而渲染端不许 import main。
 */
export type WorkStatusTier = "连接中" | "思考中" | "工作中" | "提醒" | "已处理" | "已中断";

export interface WorkStatus {
  tier: WorkStatusTier;
  /** 事件来源（agent / tool / ask-card / stream）。 */
  source: string;
  /** 档位起点（epoch ms）。 */
  since: number;
  /** 细节：工具名或卡片首行；**只给宠物窗**，不上其他窗（可能含用户问句）。 */
  detail?: string;
}

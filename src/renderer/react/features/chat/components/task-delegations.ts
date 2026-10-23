import type { TaskDelegationDisplayRecord } from "../../../../../shared/chat-types";
import type { TaskDelegationPresentation } from "../../../../../shared/task-session";

const TASK_CHARACTER_ASSETS: Readonly<Record<string, string>> = {
  年糕: "年糕.png", 豆花: "豆花.png", 汤圆: "汤圆.png", 布丁: "布丁.png", 抹茶: "抹茶.png",
  可可: "可可.png", 芝麻: "芝麻.png", 栗子: "栗子.png", 海苔: "海苔.png",
  棉花: "棉花.png", 鱼丸: "鱼丸.png", 奶盖: "奶盖.png",
};

export function normalizeTaskDelegationEvent(value: unknown): TaskDelegationPresentation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = value as Partial<TaskDelegationPresentation>;
  if (typeof event.invocationId !== "string" || !event.invocationId
    || typeof event.taskId !== "string" || !event.taskId
    || typeof event.description !== "string" || !event.description.trim()
    || typeof event.nickname !== "string"
    || TASK_CHARACTER_ASSETS[event.nickname] !== event.assetFileName
    || (event.status !== "running" && event.status !== "completed" && event.status !== "failed" && event.status !== "cancelled")) return undefined;
  return {
    invocationId: event.invocationId,
    taskId: event.taskId,
    description: event.description.trim(),
    nickname: event.nickname,
    assetFileName: event.assetFileName,
    status: event.status,
  };
}

export function applyTaskDelegationEvent(
  records: readonly TaskDelegationDisplayRecord[],
  event: TaskDelegationPresentation,
  roundId?: string,
): TaskDelegationDisplayRecord[] {
  const index = records.findIndex((record) => record.invocationId === event.invocationId);
  if (index < 0) return [...records, { ...event, ...(roundId !== undefined ? { roundId } : {}) }];
  return records.map((record, recordIndex) => {
    if (recordIndex !== index) return record;
    const { roundId: existingRoundId, ...recordWithoutRound } = record;
    const nextRoundId = existingRoundId ?? roundId;
    return {
      ...recordWithoutRound,
      ...event,
      ...(nextRoundId !== undefined ? { roundId: nextRoundId } : {}),
    };
  });
}

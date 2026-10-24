import type { WorkStatus, WorkStatusTier } from "../../shared/work-status-types";

/**
 * 六档工作状态的**主进程单一权威**（v1.5.0 P3 Task 16）。
 *
 * 为什么要有这一层：今天「工作中/提醒」散在工具派发、提问卡、流式回调三处，
 * 每处各自通知渲染层，于是「一轮跑完却没人说已处理」这类空洞没人负责。
 * 本服务把事件汇成一条状态机，订阅者只认 `subscribe`。
 *
 * 降级：8 s 没有新事件 → 自动回落空闲（不让猫冻在「工作中」），
 * 但**不回落到「已处理」**——那是假报「做完啦」。
 */

export const WORK_STATUS_EMPTY_MS = 8_000;

/** 未知工具的展示名（#74：内部标识不许漏进 UI）。 */
export const UNKNOWN_TOOL_LABEL = "一个工具";

const KNOWN_TOOLS: Readonly<Record<string, string>> = {
  read_file: "读文件",
  write_file: "写文件",
  run_shell: "跑命令",
  web_search: "查资料",
  ask_user: "问你一件事",
  update_plan: "整理计划",
  code_edit: "改代码",
};

export function toolLabelOf(toolName: string | undefined): string {
  if (!toolName) return UNKNOWN_TOOL_LABEL;
  return KNOWN_TOOLS[toolName] ?? UNKNOWN_TOOL_LABEL;
}

export type WorkStatusEvent =
  | { kind: "run-start" }
  | { kind: "thinking" }
  | { kind: "tool-start"; toolName?: string }
  | { kind: "tool-end" }
  | { kind: "ask-card"; intro?: string }
  | { kind: "ask-resolved" }
  | { kind: "run-end"; ok: boolean }
  | { kind: "stream-end" };

export interface WorkStatusService {
  get(): WorkStatus | null;
  feed(event: WorkStatusEvent, now?: number): WorkStatus | null;
  tick(now?: number): WorkStatus | null;
  nextTickAt(now?: number): number | null;
  subscribe(fn: (status: WorkStatus | null) => void): () => void;
  dispose(): void;
}

export interface WorkStatusDeps {
  now?: () => number;
  emptyMs?: number;
}

export function createWorkStatusService(deps: WorkStatusDeps = {}): WorkStatusService {
  const now = deps.now ?? (() => Date.now());
  const emptyMs = deps.emptyMs ?? WORK_STATUS_EMPTY_MS;
  let status: WorkStatus | null = null;
  let lastEventAt = 0;
  const listeners = new Set<(status: WorkStatus | null) => void>();

  const emit = (next: WorkStatus | null): WorkStatus | null => {
    status = next;
    for (const fn of listeners) fn(next);
    return next;
  };

  const set = (tier: WorkStatusTier, source: string, detail: string | undefined, at: number): WorkStatus | null => {
    // 细节只对 工作中/提醒 有意义；其它档把它清掉（#74 的「不泄漏」从源头做）。
    const keepDetail = tier === "工作中" || tier === "提醒";
    return emit({ tier, source, since: at, ...(keepDetail && detail ? { detail } : {}) });
  };

  return {
    get: () => (status ? { ...status } : null),

    feed(event, at = now()) {
      lastEventAt = at;
      switch (event.kind) {
        case "run-start": return set("连接中", "agent", undefined, at);
        case "thinking": return set("思考中", "agent", undefined, at);
        case "tool-start": return set("工作中", "tool", toolLabelOf(event.toolName), at);
        case "tool-end": return set("思考中", "tool", undefined, at);
        case "ask-card": return set("提醒", "ask-card", event.intro, at);
        case "ask-resolved": return set("已处理", "ask-card", undefined, at);
        case "stream-end": return set("已处理", "stream", undefined, at);
        case "run-end": return event.ok
          ? set("已处理", "agent", undefined, at)
          : set("已中断", "agent", undefined, at);
      }
    },

    tick(at = now()) {
      if (!status) return null;
      if (at - lastEventAt < emptyMs) return status;
      return emit(null);
    },

    nextTickAt(at = now()) {
      if (!status) return null;
      return lastEventAt + emptyMs - at;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    dispose() {
      listeners.clear();
      status = null;
    },
  };
}

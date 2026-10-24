import { describe, expect, it, vi } from "vitest";
import { UNKNOWN_TOOL_LABEL, WORK_STATUS_EMPTY_MS, createWorkStatusService, toolLabelOf } from "./work-status";

describe("workStatus 六档", () => {
  const mk = () => {
    let t = 1_000;
    const svc = createWorkStatusService({ now: () => t, emptyMs: WORK_STATUS_EMPTY_MS });
    return { svc, at: (v: number) => { t = v; } };
  };

  it("事件序：连接中 → 思考中 → 工作中 → 提醒 → 已处理", () => {
    const { svc, at } = mk();
    expect(svc.feed({ kind: "run-start" })?.tier).toBe("连接中");
    at(1_100);
    expect(svc.feed({ kind: "thinking" })?.tier).toBe("思考中");
    at(1_200);
    expect(svc.feed({ kind: "tool-start", toolName: "read_file" })?.tier).toBe("工作中");
    at(1_300);
    expect(svc.feed({ kind: "ask-card", intro: "选哪个？" })?.tier).toBe("提醒");
    at(1_400);
    expect(svc.feed({ kind: "ask-resolved" })?.tier).toBe("已处理");
  });

  it("中断与成功分开：run-end ok=false → 已中断", () => {
    const { svc } = mk();
    expect(svc.feed({ kind: "run-end", ok: false })?.tier).toBe("已中断");
    expect(svc.feed({ kind: "run-end", ok: true })?.tier).toBe("已处理");
  });

  it("未知工具名不泄漏内部标识（#74）", () => {
    const { svc } = mk();
    const s = svc.feed({ kind: "tool-start", toolName: "totally_unregistered_tool" });
    expect(s?.detail).toBe(UNKNOWN_TOOL_LABEL);
    expect(JSON.stringify(s)).not.toContain("totally_unregistered_tool");
    const s2 = svc.feed({ kind: "tool-start" });
    expect(s2?.detail).toBe(UNKNOWN_TOOL_LABEL);
  });

  it("细节只挂在 工作中/提醒；其它档清空", () => {
    const { svc } = mk();
    expect(svc.feed({ kind: "tool-start", toolName: "run_shell" })?.detail).toBe("跑命令");
    expect(svc.feed({ kind: "thinking" })?.detail).toBeUndefined();
    expect(svc.feed({ kind: "ask-card", intro: "要不要继续" })?.detail).toBe("要不要继续");
    expect(svc.feed({ kind: "stream-end" })?.detail).toBeUndefined();
  });

  it("8s 空洞回落 null（不是「已处理」）", () => {
    const { svc, at } = mk();
    svc.feed({ kind: "thinking" }, 1_000);
    expect(svc.tick(1_000 + WORK_STATUS_EMPTY_MS - 1)?.tier).toBe("思考中");
    expect(svc.tick(1_000 + WORK_STATUS_EMPTY_MS)).toBeNull();
    expect(svc.get()).toBeNull();
    void at;
  });

  it("nextTickAt 报剩余毫秒；空闲时 null", () => {
    const { svc } = mk();
    expect(svc.nextTickAt(1_000)).toBeNull();
    svc.feed({ kind: "thinking" }, 1_000);
    expect(svc.nextTickAt(1_500)).toBe(WORK_STATUS_EMPTY_MS - 500);
  });

  it("订阅者在每次状态变化时收到通知；退订后不再收到", () => {
    const { svc } = mk();
    const seen: Array<string | null> = [];
    const off = svc.subscribe((s) => seen.push(s?.tier ?? null));
    svc.feed({ kind: "run-start" }, 1_000);
    svc.feed({ kind: "thinking" }, 1_100);
    off();
    svc.feed({ kind: "tool-start" }, 1_200);
    expect(seen).toEqual(["连接中", "思考中"]);
  });

  it("get 返回副本（改不坏内部状态）", () => {
    const { svc } = mk();
    svc.feed({ kind: "tool-start", toolName: "read_file" }, 1_000);
    const a = svc.get()!;
    a.tier = "已处理";
    expect(svc.get()?.tier).toBe("工作中");
  });

  it("toolLabelOf：已知名给中文，未知/缺省都给统一代称", () => {
    expect(toolLabelOf("read_file")).toBe("读文件");
    expect(toolLabelOf("evil_tool")).toBe(UNKNOWN_TOOL_LABEL);
    expect(toolLabelOf(undefined)).toBe(UNKNOWN_TOOL_LABEL);
  });

  it("dispose 之后订阅清空（不泄漏）", () => {
    const { svc } = mk();
    const fn = vi.fn();
    svc.subscribe(fn);
    svc.dispose();
    svc.feed({ kind: "thinking" }, 1_100);
    expect(fn).not.toHaveBeenCalled();
  });
});

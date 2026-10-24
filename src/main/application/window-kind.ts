/**
 * webContents.id → 窗口类别登记簿（R-D11）。
 *
 * 为什么按 id 而不是 URL：8 个窗口共用同一条 preload，dev 下 origin 全是 localhost:5173，
 * prod 下 loadFile 也是同盘——URL 分不出 pet 与 toast。而 Electron 44 没有 getData()。
 * 本文件不 import electron，便于纯单测。
 */
export type WindowKind = "pet" | "chat" | "unknown";

const REGISTRY = new Map<number, Exclude<WindowKind, "unknown">>();

export function markWebContents(id: number, kind: Exclude<WindowKind, "unknown">): void {
  REGISTRY.set(id, kind);
}

export function forgetWebContents(id: number): void {
  REGISTRY.delete(id);
}

export function windowKindOf(id: number): WindowKind {
  return REGISTRY.get(id) ?? "unknown";
}

export function __resetWindowKindsForTest(): void {
  REGISTRY.clear();
}

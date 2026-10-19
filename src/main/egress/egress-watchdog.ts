/**
 * 运行时出口看门狗（P4 Task 6，spec §3-A 的「真窗尺」）。
 *
 * 静态锁 `upstream-off.test.ts` 只能证明「标识面干净」；间接路径（某个库里写死的 URL、
 * 动态拼出来的 host）静态 grep 抓不到。这里在 `onBeforeSendHeaders` 这一层记表：
 * 凡是分类为 external 的请求都留一笔，E2 用 `--egress-probe` 起真进程跑
 * 「默认启动 → 空闲 20s → 外部请求 = 0」。
 *
 * 本模块只做分类与记账，不做放行/拦截——它不是防火墙，是尺子。
 */
import { session, type Session } from "electron";

/** 本 fork 认得的自有 scheme：privileged scheme 注册点与 `local-sticker`/`moment-media`。 */
const LOCAL_SCHEMES = ["cyrene-exam", "cyrene-plugin", "local-sticker", "moment-media", "mochi"];

export interface EgressEntry {
  url: string;
  method: string;
  resourceType: string;
  /** 相对进程启动的毫秒数，方便探针排「开机 20s 内」这条判据。 */
  atMs: number;
}

/**
 * 本地 = 环回 + 文件 + 内建数据 scheme。其余一律 external，**包括**模型供应商的 API：
 * 那些是用户配了 key 才会发的显式请求，探针档不该看到它们（探针不配 key），
 * 但静态表里没有「看着像本地其实不是」的容错——宁可记出来让人读。
 */
export function classifyRequest(url: string): "local" | "external" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "external";
  }
  if (["file:", "data:", "blob:", "chrome-extension:", "devtools:", "about:"].includes(parsed.protocol)) return "local";
  if (LOCAL_SCHEMES.includes(parsed.protocol.replace(":", ""))) return "local";
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return "local";
  return "external";
}

export function installEgressWatchdog(
  target: Session = session.defaultSession,
  startedAt: number = Date.now(),
): { entries(): EgressEntry[]; dispose(): void } {
  const table: EgressEntry[] = [];
  const listener = (details: Electron.OnBeforeSendHeadersListenerDetails) => {
    if (classifyRequest(details.url) !== "external") return;
    if (table.length < 1000) table.push({
      url: details.url,
      method: details.method,
      resourceType: details.resourceType,
      atMs: Date.now() - startedAt,
    });
  };
  target.webRequest.onBeforeSendHeaders(listener);
  return {
    entries: () => [...table],
    dispose: () => target.webRequest.onBeforeSendHeaders(null),
  };
}

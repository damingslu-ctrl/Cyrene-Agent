/**
 * 运行时出口看门狗（P4 Task 6，spec §3-A 的「真窗尺」）。
 *
 * 静态锁 `upstream-off.test.ts` 只能证明「标识面干净」；间接路径（某个库里写死的 URL、
 * 动态拼出来的 host）静态 grep 抓不到。这里在 `webRequest` 的**通报通道**（`onSendHeaders`
 * + `onErrorOccurred`）上记表：凡是分类为 external 的请求都留一笔，E2 用 `--egress-probe`
 * 起真进程跑「默认启动 → 空闲 20s → 外部请求 = 0」。
 *
 * 本模块只做分类与记账，不做放行/拦截——它不是防火墙，是尺子。
 *
 * 只能登记通报通道（Task 31 第二层撞出来的死锁）：`onBeforeSendHeaders` 这类「可改报文」的
 * channel 一旦挂了监听，Chromium 把主框架导航也压进异步等待队列，聊天窗的 `file://` 导航
 * 永远不 commit，于是永远不发 `ready-to-show`，20s 超时后整个启动被判致命失败——
 * 进程 0% CPU、没有 `did-fail-load`、preload 根本不执行。尺子不该有权拦请求。
 * 两条通道互补：`onSendHeaders` 认「报文真发出去了」，`onErrorOccurred` 认「发了但没通」
 * （上游域名被断后走的就是这条），只挂前者会把失败的尝试读成 0 笔 = 假绿。
 *
 * 覆盖面（B-2 修）：尺子按 **Session 对象**挂，不是只挂 defaultSession。
 * 内置浏览器用 `persist:cyrene-right-browser`、考试页用 `cyrene-learn-exam`，
 * 都是独立 partition 的 session；只挂 defaultSession 的话，这两个 partition 里的外呼
 * 一笔都看不见。`installEgressWatchdogEverywhere` 会连 `app.on("session-created")`
 * 一起接上，运行期新开的 partition 也自动进射程。
 *
 * 已知盲区（写在这里而不是假装没有）：**主进程的 `fetch()` / node `http`（undici）不经过
 * `webRequest`**，本尺子看不见。那些请求的入口闸门由各工具自己把守（fetch_url /
 * download_file 的上游黑名单），探针 JSON 的 `scope.excludes` 也把这条写明。
 */
import { app, session, type Session } from "electron";

/** 本 fork 认得的自有 scheme：privileged scheme 注册点与 `local-sticker`/`moment-media`。 */
const LOCAL_SCHEMES = ["cyrene-exam", "cyrene-plugin", "local-sticker", "moment-media", "mochi"];

export interface EgressEntry {
  url: string;
  method: string;
  resourceType: string;
  /** 相对进程启动的毫秒数，方便探针排「开机 20s 内」这条判据。 */
  atMs: number;
  /** `sent` = 报文真发出去了；`failed` = 发了但没通（域名解析不了走这条）。 */
  via: "sent" | "failed";
}

export interface EgressWatchdog {
  entries(): EgressEntry[];
  /** 把某个 session 纳入记账面；重复 attach 同一对象不会重复登记。 */
  attach(target: Session): void;
  /** 已纳入的 session 数（探针写进 JSON，用来证明覆盖面不是 1）。 */
  sessionCount(): number;
  dispose(): void;
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
  // `URL.hostname` 对 IPv6 字面量保留方括号（`"[::1]"`），比较前先剥掉。
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
  return "external";
}

interface WatchdogCore extends EgressWatchdog {
  attach(target: Session): void;
}

function createWatchdog(startedAt: number): WatchdogCore {
  const table: EgressEntry[] = [];
  // 同一条 URL 只留第一笔：一条请求会在两条通道各出现一次，重复计数只会把表读脏。
  const seen = new Set<string>();
  const attached = new Set<Session>();
  const record = (
    details: Electron.OnSendHeadersListenerDetails | Electron.OnErrorOccurredListenerDetails,
    via: EgressEntry["via"],
  ) => {
    if (classifyRequest(details.url) !== "external") return;
    if (seen.has(details.url)) return;
    if (table.length >= 1000) return;
    seen.add(details.url);
    table.push({
      url: details.url,
      method: details.method,
      resourceType: details.resourceType,
      atMs: Date.now() - startedAt,
      via,
    });
  };
  return {
    entries: () => [...table],
    attach: (target: Session) => {
      if (attached.has(target)) return;
      attached.add(target);
      target.webRequest.onSendHeaders((details) => record(details, "sent"));
      target.webRequest.onErrorOccurred((details) => record(details, "failed"));
    },
    sessionCount: () => attached.size,
    dispose: () => {
      for (const target of attached) {
        target.webRequest.onSendHeaders(null);
        target.webRequest.onErrorOccurred(null);
      }
      attached.clear();
    },
  };
}

export function installEgressWatchdog(
  target: Session = session.defaultSession,
  startedAt: number = Date.now(),
): EgressWatchdog {
  const watchdog = createWatchdog(startedAt);
  watchdog.attach(target);
  return watchdog;
}

/** `app.on("session-created")` 的最小面：单测用假 emitter 证明事件名与解绑都对。 */
export interface SessionCreatedEmitter {
  on(event: "session-created", listener: (created: Session) => void): unknown;
  removeListener(event: "session-created", listener: (created: Session) => void): unknown;
}

/** 把运行期新建的 partition 接进记账面；返回解绑函数。 */
export function bindSessionCreated(
  emitter: SessionCreatedEmitter,
  watchdog: EgressWatchdog,
): () => void {
  const listener = (created: Session) => watchdog.attach(created);
  emitter.on("session-created", listener);
  return () => emitter.removeListener("session-created", listener);
}

/** defaultSession + 运行期新建的每个 partition（浏览器面板、考试页都在这一类里）。 */
export function installEgressWatchdogEverywhere(startedAt: number = Date.now()): EgressWatchdog {
  const watchdog = installEgressWatchdog(session.defaultSession, startedAt);
  const unbind = bindSessionCreated(app, watchdog);
  return {
    entries: () => watchdog.entries(),
    attach: (target: Session) => watchdog.attach(target),
    sessionCount: () => watchdog.sessionCount(),
    dispose: () => {
      unbind();
      watchdog.dispose();
    },
  };
}

/**
 * 运行时出口尺的分类器单测（P4 Task 6）。
 *
 * 这一层只锁「一条 URL 归 local 还是 external」——不启动 Electron、不碰网络。
 * 真进程口径（默认启动到空闲 20s 外部请求 = 0）留给 E2 用 `--egress-probe` 跑，
 * 静态锁（upstream-off.test.ts 的 A6）只负责「看门狗没有被摘掉」。
 */
import { describe, expect, it } from "vitest";
import { classifyRequest, installEgressWatchdog } from "./egress-watchdog";

type WatchdogTarget = NonNullable<Parameters<typeof installEgressWatchdog>[0]>;
type Listener = (details: { url: string; method: string; resourceType: string }) => unknown;

/** 假 session：记下登记过哪些 webRequest channel，并把处理函数留着手动喂。 */
function fakeSession() {
  const channels = [
    "onBeforeRequest",
    "onBeforeSendHeaders",
    "onHeadersReceived",
    "onAuthRequired",
    "onSendHeaders",
    "onResponseStarted",
    "onCompleted",
    "onErrorOccurred",
  ] as const;
  const registered: string[] = [];
  const handlers = new Map<string, Listener | null>();
  const webRequest: Record<string, unknown> = {};
  for (const name of channels) {
    webRequest[name] = (fn: Listener | null) => {
      registered.push(name);
      handlers.set(name, fn);
    };
  }
  return { session: { webRequest } as unknown as WatchdogTarget, registered, handlers };
}

describe("出口尺的登记面", () => {
  /**
   * 启动死锁回归（Task 31 第二层撞出来的）：`onBeforeSendHeaders` 这类「可改报文」的
   * channel 一旦挂了监听，Chromium 把主框架导航也压进等待队列，聊天窗永远不 commit，
   * 也就永远不发 ready-to-show，20s 超时后整个启动被判致命失败。
   * 尺子只记账，不该有权拦请求。
   */
  it("绝不登记会阻塞请求的 channel", () => {
    const f = fakeSession();
    installEgressWatchdog(f.session);
    for (const blocking of ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived", "onAuthRequired"]) {
      expect(f.registered, `出口尺压在了 ${blocking} 这条阻塞通道上`).not.toContain(blocking);
    }
    expect(f.registered.length, "一个 channel 都没登记，等于尺子没装").toBeGreaterThan(0);
  });

  it("外部请求进表，本地请求不进表", () => {
    const f = fakeSession();
    const watchdog = installEgressWatchdog(f.session, 1_000);
    for (const name of f.registered) {
      const handler = f.handlers.get(name);
      if (!handler) continue;
      handler({ url: "https://api.github.com/repos/x/releases", method: "GET", resourceType: "XHR" });
      handler({ url: "http://127.0.0.1:9097/version", method: "GET", resourceType: "XHR" });
      handler({ url: "file:///D:/app/dist/renderer/react/index.html", method: "GET", resourceType: "Document" });
    }
    const entries = watchdog.entries();
    expect(entries.map((e) => e.url)).toEqual(["https://api.github.com/repos/x/releases"]);
    expect(entries[0]).toMatchObject({ method: "GET", resourceType: "XHR" });
    expect(Number.isFinite(entries[0].atMs)).toBe(true);
  });

  it("解析不了的外部请求也进表（正对照：尺子不只认发成功的报文）", () => {
    const f = fakeSession();
    const watchdog = installEgressWatchdog(f.session);
    const handler = f.handlers.get("onErrorOccurred");
    if (!handler) throw new Error("onErrorOccurred 没登记——上游域名被断后走的正是这条，漏了它就把失败读成 0 笔");
    handler({ url: "https://api.github.com/repos/x/releases/latest", method: "GET", resourceType: "XHR" });
    expect(watchdog.entries().map((e) => e.via)).toEqual(["failed"]);
  });

  it("同一条 URL 两条通道都看见时只记一笔", () => {
    const f = fakeSession();
    const watchdog = installEgressWatchdog(f.session);
    for (const name of ["onSendHeaders", "onErrorOccurred"]) {
      f.handlers.get(name)?.({ url: "https://example.com/a", method: "GET", resourceType: "Image" });
    }
    expect(watchdog.entries().map((e) => e.url)).toEqual(["https://example.com/a"]);
  });

  it("dispose 把登记过的 channel 逐个注销", () => {
    const f = fakeSession();
    const watchdog = installEgressWatchdog(f.session);
    watchdog.dispose();
    for (const name of f.registered) {
      expect(f.handlers.get(name), `${name} 没被注销，退出后还会留一个空转监听`).toBeNull();
    }
  });
});

describe("出口分类", () => {
  it("本地环回与内建 scheme 记为 local", () => {
    for (const url of [
      "http://127.0.0.1:7896/proxies",
      "http://[::1]:7896/proxies",
      "http://[0:0:0:0:0:0:0:1]:7896/proxies",
      "http://localhost:5173/",
      "file:///D:/app/index.html",
      "data:image/png;base64,AAAA",
      "blob:https://example.com/1",
      "chrome-extension://abcdef/bg.js",
      "cyrene-exam://page/1",
      "cyrene-plugin://mochi/1",
      "local-sticker://stickers/a.png",
      "moment-media://media/a.png",
    ]) {
      expect(classifyRequest(url)).toBe("local");
    }
  });

  it("真外部 origin 记为 external（正对照：分类器不是永远返回 local）", () => {
    expect(classifyRequest("https://example.com/css2?family=x")).toBe("external");
    expect(classifyRequest("https://mirror.example.org/x/raw/main/y")).toBe("external");
    expect(classifyRequest("https://api.anthropic.com/v1/messages")).toBe("external");
  });

  it("解析不了的怪 URL 归 external，宁可多记一笔也不静默放行", () => {
    expect(classifyRequest("not a url")).toBe("external");
  });
});

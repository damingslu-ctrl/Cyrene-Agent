/**
 * 运行时出口尺的分类器单测（P4 Task 6）。
 *
 * 这一层只锁「一条 URL 归 local 还是 external」——不启动 Electron、不碰网络。
 * 真进程口径（默认启动到空闲 20s 外部请求 = 0）留给 E2 用 `--egress-probe` 跑，
 * 静态锁（upstream-off.test.ts 的 A6）只负责「看门狗没有被摘掉」。
 */
import { describe, expect, it } from "vitest";
import { classifyRequest } from "./egress-watchdog";

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

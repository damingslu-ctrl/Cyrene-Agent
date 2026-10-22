// download_file 上游闸门测试：只验证「拒绝发生在联网之前」，不写真实文件。

import { afterEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_HOSTS } from "../../../../shared/upstream-hosts";
import { downloadFileTool } from "./download-file-tool";

/** 官方站域名从黑名单表派生：A4 静态锁不允许源码里出现该字面量（表本身有豁免）。 */
const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("download_file 上游域名闸门", () => {
  it.each([
    "https://github.com/foo/bar/releases/download/v1/cat.png",
    "https://raw.githubusercontent.com/foo/bar/main/cat.png",
    "https://gitee.com/foo/bar/raw/master/cat.png",
    `https://${OFFICIAL_HOST}/cat.png`,
  ])("%s 被拒绝且一次网络请求都不发", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await downloadFileTool.execute({ url, filename: "cat.png" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toContain("上游");
  });

  it("正对照：长得像上游但不是子域的站点会走到联网这一步", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await downloadFileTool.execute(
      { url: "https://evilgithub.com/cat.png", filename: "cat.png" },
      { userQuery: "test", resolvedWorkspaceRoot: "D:\\cyrene-p4-accept\\dl-test" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toContain("响应无内容");
  });
});

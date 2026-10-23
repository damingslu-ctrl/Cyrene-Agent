// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPagePanelHost } from "./ChatPagePanelHost";

describe("ChatPagePanelHost", () => {
  it("网络页是侧栏面板的一等目标", () => {
    const html = renderToStaticMarkup(createElement(ChatPagePanelHost, {
      panel: "network",
      onPickWorkspace: async () => ({ ok: false }),
      onOpenSession: () => undefined,
    }));

    expect(html).toContain("net-panel");
    expect(html).toContain("网络");
    expect(html).toContain("正在读取内核状态");
  });
});

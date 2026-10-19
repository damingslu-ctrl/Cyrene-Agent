import { describe, expect, it } from "vitest";
import { isUpstreamUrl } from "../../shared/upstream-hosts";

describe("上游链接拦截", () => {
  it("拦上游、放用户自己的域名（正对照防空判据）", () => {
    expect(isUpstreamUrl("https://github.com/Playa-Cyrene/Cyrene-Agent/issues")).toBe(true);
    expect(isUpstreamUrl("https://gitee.com/playa0/cyrene-plugins/raw/main/registry.json")).toBe(true);
    expect(isUpstreamUrl("https://playaagentcyrene.online/")).toBe(true);
    // 上游域名的子域别名同样要拦：只比 hostname 全等时这三个都是绕过口
    expect(isUpstreamUrl("https://www.github.com/Playa-Cyrene/Cyrene-Agent")).toBe(true);
    expect(isUpstreamUrl("https://gist.github.com/Playa-0v0/abc123")).toBe(true);
    expect(isUpstreamUrl("https://www.playaagentcyrene.online/")).toBe(true);
    // 正对照：非上游域名必须放行，否则整条外链通道被关死也算「判据通过」
    expect(isUpstreamUrl("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(isUpstreamUrl("https://www.deepseek.com/")).toBe(false);
    // 子域判据带点号：后缀巧合的域名不能被误伤
    expect(isUpstreamUrl("https://notgithub.com/")).toBe(false);
    expect(isUpstreamUrl("mailto:someone@example.com")).toBe(false);
    expect(isUpstreamUrl("not a url")).toBe(false);
  });
});

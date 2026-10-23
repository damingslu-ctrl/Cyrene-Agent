import { describe, expect, it } from "vitest";
import { UPSTREAM_HOSTS, isUpstreamHost, isUpstreamUrl } from "./upstream-hosts";

const OFFICIAL_HOST = UPSTREAM_HOSTS.find((host) => host.endsWith(".online"));
if (!OFFICIAL_HOST) throw new Error("upstream host table is missing the official site");

describe("isUpstreamHost", () => {
  it.each([
    "github.com",
    "GitHub.com",
    "github.com.",
    "www.github.com.",
    "gist.github.com",
    "raw.githubusercontent.com.",
    "gitee.com.",
    "GITEE.COM.",
    OFFICIAL_HOST,
    `${OFFICIAL_HOST}.`,
  ])("整域、子域与尾点写法都算上游：%s", (host) => {
    expect(isUpstreamHost(host)).toBe(true);
  });

  it.each([
    "notgithub.com",
    "notgithub.com.",
    "github.com.evil.example",
    "github.com.evil.example.",
    "githubcom",
    "example.com",
    `${OFFICIAL_HOST}.evil.example`,
  ])("只是长得像上游的域名不受误伤：%s", (host) => {
    expect(isUpstreamHost(host)).toBe(false);
  });
});

describe("isUpstreamUrl", () => {
  it.each([
    "https://github.com/x",
    "https://github.com./x",
    "http://raw.githubusercontent.com./a/b",
    "https://api.github.com./repos/a/b",
    `https://${OFFICIAL_HOST}./`,
  ])("解析后按归一化主机名判定：%s", (url) => {
    expect(isUpstreamUrl(url)).toBe(true);
  });

  it.each(["https://example.com/", "https://github.com.evil.example/", "not a url"])(
    "非上游或解析失败：%s",
    (url) => {
      expect(isUpstreamUrl(url)).toBe(false);
    },
  );
});

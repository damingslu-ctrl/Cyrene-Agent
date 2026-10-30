import { describe, expect, it } from "vitest";
import {
  CLIENT_RELEASE_API_URL,
  CLIENT_UPDATE_REPO,
  decideClientCheck,
  inspectClientRelease,
  pickInstallerAsset,
  releaseBelongsToRepo,
  versionFromTag,
} from "./github-release";

/**
 * 假发布页的骨架。默认值是「一切正常」那一档：正因为正常形状只写一次，
 * 下面每一条把它改坏一档的测试才知道自己改的是哪一处。
 */
const DIGEST = `sha256:${"ab".repeat(32)}`;

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: "v1.16.0",
    name: "Mochi 1.16.0",
    prerelease: false,
    draft: false,
    html_url: `https://github.com/${CLIENT_UPDATE_REPO}/releases/tag/v1.16.0`,
    url: `https://api.github.com/repos/${CLIENT_UPDATE_REPO}/releases/9001`,
    assets: [
      {
        name: "Mochi-Setup-1.16.0.exe",
        browser_download_url: `https://github.com/${CLIENT_UPDATE_REPO}/releases/download/v1.16.0/Mochi-Setup-1.16.0.exe`,
        digest: DIGEST,
        size: 289_746_294,
      },
    ],
    ...overrides,
  };
}

const CURRENT = "1.15.0";

describe("github-release：版本号只按 semver 比高低", () => {
  it("1.9.9 与 1.10.0 这种「字符串比较必错」的一对，按 semver 判能升", () => {
    // 字符串比：`1.9.9` > `1.10.0`（第 3 个字符 `9` > `1`）。这一档错了的形状是
    // 「永远说你是最新」——用户点多少次都不升，界面上一句错误都没有。
    expect("1.9.9" > "1.10.0").toBe(true);
    expect(decideClientCheck(release({ tag_name: "v1.9.9" }), "1.10.0")).toMatchObject({
      outcome: "latest",
      latestVersion: "1.9.9",
    });
    expect(decideClientCheck(release(), CURRENT).outcome).toBe("available");
  });

  it("同号与更旧都叫 latest，不叫失败：这一档没有 reason 可读", () => {
    const same = decideClientCheck(release({ tag_name: "v1.15.0" }), CURRENT);
    expect(same).toMatchObject({ outcome: "latest", reason: null, detail: null, asset: null });
    const older = decideClientCheck(release({ tag_name: "v1.14.9" }), CURRENT);
    expect(older).toMatchObject({ outcome: "latest", latestVersion: "1.14.9", asset: null });
  });

  it("tag 只脱一层 v 前缀；剩下的不是完整 semver 就回 null", () => {
    expect(versionFromTag("v1.16.0")).toBe("1.16.0");
    expect(versionFromTag("V1.16.0")).toBe("1.16.0");
    expect(versionFromTag("1.16.0")).toBe("1.16.0");
    expect(versionFromTag("v1.16")).toBeNull();
    expect(versionFromTag("1.16.0.1")).toBeNull();
    expect(versionFromTag("01.16.0")).toBeNull();
    expect(versionFromTag("v1.16.0-beta.1")).toBe("1.16.0-beta.1");
    expect(versionFromTag(null)).toBeNull();
  });

  it("预发布低于同号正式版：1.16.0-beta.1 不算比 1.16.0 新", () => {
    expect(decideClientCheck(release({ tag_name: "v1.16.0-beta.1" }), "1.16.0")).toMatchObject({
      outcome: "latest",
    });
    expect(decideClientCheck(release({ tag_name: "v1.16.0" }), "1.16.0-beta.1").outcome).toBe("available");
  });

  it("本机版本号读不出时不许滑成「已是最新」，要说清是哪一边读不出", () => {
    const decided = decideClientCheck(release(), "main-2026-10-31");
    expect(decided).toMatchObject({ outcome: "failed", reason: "bad-response", latestVersion: "1.16.0" });
    expect(decided.detail).toContain("本机版本号");
    // 正对照：同一份 release 配上合法的本机版本号就是能升——坏的确实是那一边。
    expect(decideClientCheck(release(), CURRENT).outcome).toBe("available");
  });
});

describe("github-release：来源钉在仓库，不只钉在 host", () => {
  it("html_url 与 url 指到别人的 repo 就拒，哪怕 tag 与摘要都自洽", () => {
    const forged = release({
      html_url: "https://github.com/someone-else/Cyrene-Agent/releases/tag/v1.16.0",
      url: "https://api.github.com/repos/someone-else/Cyrene-Agent/releases/9001",
    });
    expect(decideClientCheck(forged, CURRENT)).toMatchObject({ outcome: "failed", reason: "wrong-source" });
    // 正对照：同一份东西换回我们自己的 repo 就能升。
    expect(decideClientCheck(release(), CURRENT).outcome).toBe("available");
  });

  it("前缀陷阱：Cyrene-Agent-evil 不是 Cyrene-Agent（按路径段比，不按 startsWith）", () => {
    expect(releaseBelongsToRepo({ html_url: `https://github.com/${CLIENT_UPDATE_REPO}-evil/releases/tag/v1` })).toBe(false);
    expect(releaseBelongsToRepo({ html_url: "https://github.com/damingslu-ctrl/Cyrene-AgentX/releases" })).toBe(false);
    expect(releaseBelongsToRepo({ html_url: "https://evil.tld/damingslu-ctrl/Cyrene-Agent/releases" })).toBe(true);
    // 最后一条是**故意**的：host 归 host（isAllowedUpdateUrl 那一层拦），这里只认路径段。
    // 两层各管一头，合成一层就会有一头漏。
  });

  it("两头都看：只有 api 的 url 或只有 html_url 都算数，两个都不给就不认", () => {
    expect(releaseBelongsToRepo({ url: `https://api.github.com/repos/${CLIENT_UPDATE_REPO}/releases/1` })).toBe(true);
    expect(releaseBelongsToRepo({ html_url: `https://github.com/${CLIENT_UPDATE_REPO}/releases/tag/v1` })).toBe(true);
    expect(releaseBelongsToRepo({ tag_name: "v1.16.0" })).toBe(false);
    expect(releaseBelongsToRepo(null)).toBe(false);
    expect(releaseBelongsToRepo(release(), "")).toBe(false);
  });

  it("钉住的仓库与检查用的 URL 是同一本，且只有 https", () => {
    expect(CLIENT_RELEASE_API_URL).toBe(`https://api.github.com/repos/${CLIENT_UPDATE_REPO}/releases/latest`);
    expect(CLIENT_RELEASE_API_URL.startsWith("https://api.github.com/repos/")).toBe(true);
  });
});

describe("github-release：预发布/草稿与资产挑选", () => {
  it("prerelease 与 draft 各一档都拒，且拒在版本号之前（不先比大小再说不装）", () => {
    expect(decideClientCheck(release({ prerelease: true, tag_name: "v99.0.0" }), CURRENT)).toMatchObject({
      reason: "prerelease-only",
    });
    expect(decideClientCheck(release({ draft: true, tag_name: "v99.0.0" }), CURRENT)).toMatchObject({
      reason: "prerelease-only",
    });
    expect(decideClientCheck(release({ prerelease: true }), CURRENT).asset).toBeNull();
  });

  it("没有能读的 tag_name 是 bad-response，不是「无新版」", () => {
    for (const tag of ["", "  ", "nightly", undefined, 42]) {
      const decided = decideClientCheck(release({ tag_name: tag }), CURRENT);
      expect(decided, `tag=${String(tag)}`).toMatchObject({ outcome: "failed", reason: "bad-response" });
    }
  });

  it("安装包按名字里的版本号认，同版本号的第二颗出现就当认不出", () => {
    const picked = pickInstallerAsset(release(), "1.16.0");
    expect(picked).toMatchObject({ name: "Mochi-Setup-1.16.0.exe", version: "1.16.0" });

    const doubled = release({
      assets: [
        ...release().assets as unknown[],
        { name: "Mochi-Setup-1.16.0.exe", browser_download_url: "https://github.com/x/y/releases/download/v/Mochi-Setup-1.16.0.exe", digest: DIGEST },
      ],
    });
    expect(pickInstallerAsset(doubled, "1.16.0")).toBeNull();
    expect(decideClientCheck(doubled, CURRENT)).toMatchObject({ outcome: "failed", reason: "no-asset" });
  });

  it("别的资产（blockmap / portable / 旧版号 / 空数组 / 非数组）都不算安装包", () => {
    const noisy = release({
      assets: [
        { name: "Mochi-Setup-1.16.0.exe.blockmap", browser_download_url: "https://github.com/x/y/releases/download/v/a", digest: DIGEST },
        { name: "Mochi-Portable-1.16.0.exe.7z", browser_download_url: "https://github.com/x/y/releases/download/v/b", digest: DIGEST },
        { name: "Mochi-Setup-1.15.0.exe", browser_download_url: "https://github.com/x/y/releases/download/v/c", digest: DIGEST },
        { name: "Mochi-Setup-1.16.0.exe", digest: DIGEST }, // 没有下载地址
        { name: "Mochi-Setup-1.16.0.exe", browser_download_url: "" },
      ],
    });
    expect(pickInstallerAsset(noisy, "1.16.0")).toBeNull();
    expect(decideClientCheck(noisy, CURRENT)).toMatchObject({ reason: "no-asset", latestVersion: "1.16.0" });
    for (const bad of [{ assets: null }, { assets: "x" }, { assets: [] }, { assets: undefined }]) {
      expect(pickInstallerAsset(release(bad), "1.16.0")).toBeNull();
    }
  });

  it("没有 digest 在检查这一步就拒：连一个字节都不下（比 spec 的「拒绝安装」严一档）", () => {
    const missing = release({ assets: [{ ...((release().assets as unknown[])[0] as object), digest: null }] });
    const decided = decideClientCheck(missing, CURRENT);
    expect(decided).toMatchObject({ outcome: "failed", reason: "digest-missing", latestVersion: "1.16.0" });
    expect(decided.asset).toBeNull();
    // 正对照 + 算法档：只有 sha256 认，md5 与裸十六进制都不认。
    for (const digest of [`sha256:${"ab".repeat(32)}`, "sha1:abc", `${"ab".repeat(32)}`, "sha256:abc", "sha512:".padEnd(70, "0")]) {
      const withDigest = release({ assets: [{ ...((release().assets as unknown[])[0] as object), digest }] });
      expect(
        pickInstallerAsset(withDigest, "1.16.0")?.digest,
        digest,
      ).toBe(digest.startsWith("sha256:") && digest.length === 71 ? digest.slice(7) : null);
    }
  });

  it("inspectClientRelease 报的是事实，不做判定：各档坏各自露各自的那一格", () => {
    expect(inspectClientRelease(release())).toMatchObject({
      version: "1.16.0",
      prerelease: false,
      draft: false,
      fromPinnedRepo: true,
    });
    expect(inspectClientRelease({}).version).toBeNull();
    expect(inspectClientRelease(null)).toMatchObject({ version: null, fromPinnedRepo: false, asset: null });
  });
});

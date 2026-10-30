import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MIXED_PORT,
  FALLBACK_PORT_START,
  PORT_SCAN_LIMIT,
} from "../../shared/core-types";
import {
  buildCoreArgs,
  bundledExePath,
  coreDirOf,
  isAllowedUpdateUrl,
  parseSha256Digest,
  pickInstalledBinary,
  pickMihomoAsset,
  pickPortPair,
  resolveCoreSource,
  selectExtractedExe,
} from "./core-source";

describe("借用哪一颗内核", () => {
  it("本机那种目录里，stable 赢 alpha", () => {
    // 这份清单是 2026-10-30 从 C:\Program Files\Clash Verge\ 真读回来的。
    expect(
      pickInstalledBinary([
        "clash-verge.exe",
        "frontend-contract.exe",
        "resources",
        "uninstall.exe",
        "verge-mihomo-alpha.exe",
        "verge-mihomo.exe",
      ]),
    ).toBe("verge-mihomo.exe");
  });

  it("只有 alpha 时用 alpha，但绝不碰别人的 exe", () => {
    expect(pickInstalledBinary(["clash-verge.exe", "Verge-Mihomo-Alpha.EXE"])).toBe("verge-mihomo-alpha.exe");
    expect(pickInstalledBinary(["clash-verge.exe", "uninstall.exe"])).toBeNull();
    expect(pickInstalledBinary([])).toBeNull();
  });

  it("两颗都不是 stable 时按名字定序，别每次开机借到不同那颗", () => {
    expect(pickInstalledBinary(["verge-mihomo-beta.exe", "verge-mihomo-alpha.exe"])).toBe("verge-mihomo-alpha.exe");
  });
});

describe("端口是一对，不是一个个挑", () => {
  it("没人占就用默认档（7897 是刻意躲开 Verge 常见的 7896）", () => {
    expect(pickPortPair([])).toEqual({ mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT });
    expect(DEFAULT_MIXED_PORT).toBe(7897);
  });

  it("只有 controller 被占也要整对搬家：只挪一个会起在半套端口上", () => {
    expect(pickPortPair([9097])).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
    expect(pickPortPair([7897])).toEqual({ mixed: FALLBACK_PORT_START, controller: FALLBACK_PORT_START + 1 });
  });

  it("默认档被占后从 17890 起找第一组两个都空的", () => {
    expect(pickPortPair([7897, 9097, FALLBACK_PORT_START])).toEqual({
      mixed: FALLBACK_PORT_START + 1,
      controller: FALLBACK_PORT_START + 2,
    });
  });

  it("扫不到空位回 null——回 0 或回被占的那个号，页面就会报一个没在听的端口", () => {
    const jammed: number[] = [DEFAULT_MIXED_PORT, DEFAULT_CONTROLLER_PORT];
    for (let i = 0; i < PORT_SCAN_LIMIT + 5; i += 1) jammed.push(FALLBACK_PORT_START + i);
    expect(pickPortPair(jammed)).toBeNull();
  });

  it("非端口形状（0、负数、超限、小数）不算「占用」，免得脏数据把扫描带跑", () => {
    expect(pickPortPair([0, -1, 70000, 1.5])).toEqual({ mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT });
  });
});

describe("起进程的参数与目录", () => {
  it("-d 是内核自己的家，-f 是我们喂给它的那份配置", () => {
    expect(buildCoreArgs("C:\\u\\core", "C:\\u\\runtime\\x.yaml")).toEqual([
      "-d",
      "C:\\u\\core",
      "-f",
      "C:\\u\\runtime\\x.yaml",
    ]);
  });

  it("自托管内核落在 Mochi 自己的 userData 里，不进 Verge 目录", () => {
    expect(coreDirOf("D:\\u")).toBe(path.join("D:\\u", "core"));
    expect(bundledExePath("D:\\u")).toBe(path.join("D:\\u", "core", "mihomo.exe"));
  });
});

describe("摘要只认 sha256", () => {
  const HEX = "a".repeat(64);
  it("带前缀的收下并归一大小写", () => {
    expect(parseSha256Digest(`sha256:${HEX}`)).toBe(HEX);
    expect(parseSha256Digest(`SHA256:${HEX.toUpperCase()}`)).toBe(HEX);
  });

  it("缺前缀、别的算法、长度不对、非字符串一律 null", () => {
    expect(parseSha256Digest(HEX)).toBeNull();
    expect(parseSha256Digest(`sha512:${HEX}`)).toBeNull();
    expect(parseSha256Digest(`sha256:${HEX.slice(0, 63)}`)).toBeNull();
    expect(parseSha256Digest("sha256:oh-no")).toBeNull();
    expect(parseSha256Digest(undefined)).toBeNull();
    expect(parseSha256Digest(null)).toBeNull();
  });
});

describe("挑 release 资产", () => {
  const asset = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    browser_download_url: `https://objects.githubusercontent.com/${name}`,
    digest: `sha256:${"b".repeat(64)}`,
    ...extra,
  });
  // 名字模式按 spec D2（`mihomo-windows-amd64-v*.zip`）；实现当天本机没有出站，
  // 真 release 列表没核对过——所以挑中的原名一定回出去，抓错了页面上看得见是哪一颗。
  it("plain 赢变体，变体之间按名字定序", () => {
    const picked = pickMihomoAsset({
      assets: [asset("mihomo-windows-amd64-compatible-v1.19.1.zip"), asset("mihomo-windows-amd64-v1.19.1.zip")],
    });
    expect(picked?.name).toBe("mihomo-windows-amd64-v1.19.1.zip");
    expect(picked?.digest).toBe("b".repeat(64));
  });

  it("别的平台与别的包一个都不选", () => {
    expect(
      pickMihomoAsset({
        assets: [asset("mihomo-linux-amd64-v1.19.1.zip"), asset("mihomo-windows-386-v1.19.1.zip"), asset("mihomo-windows-amd64-v1.19.1.tar.gz")],
      }),
    ).toBeNull();
  });

  it("没有 browser_download_url 的不要：API 的 url 吃匿名限额，真文件本来在 objects 域", () => {
    expect(pickMihomoAsset({ assets: [{ name: "mihomo-windows-amd64-v1.19.1.zip", url: "https://api.github.com/…" }] })).toBeNull();
  });

  it("digest 缺失照样挑出来（把「没有摘要」带进回执），但形状坏掉的 assets 不炸", () => {
    const picked = pickMihomoAsset({ assets: [asset("mihomo-windows-amd64-v1.19.1.zip", { digest: undefined })] });
    expect(picked?.name).toBe("mihomo-windows-amd64-v1.19.1.zip");
    expect(picked?.digest).toBeNull();
    expect(pickMihomoAsset({ assets: "nope" })).toBeNull();
    expect(pickMihomoAsset(null)).toBeNull();
    expect(pickMihomoAsset({})).toBeNull();
  });
});

describe("真 release 列表认证（2026-10-30 实测）。挑资产不再靠猜", () => {
  // 这一族的形状是从 `api.github.com/repos/MetaCubeX/mihomo/releases/latest` 的**真响应**里
  // 抄下来的（tag `v1.19.33`、127 个资产、windows-amd64 那一族 23 个 zip，摘要串原样保留）。
  // 上一版这段只能靠 spec D2 那句 `mihomo-windows-amd64-v*.zip` 推——推错的样子是
  // 「下载成功、校验通过、装上去起不来」，而那一趟要烧 22MB 才看得见。
  const REAL: Array<[string, string]> = [
    ["mihomo-windows-amd64-compatible-v1.19.33.zip", "7aaf636a4f2172dcd8ec34ac4f52797b059195e5afd6409508c963e545f8864d"],
    ["mihomo-windows-amd64-v1-v1.19.33.zip", "fb0b960eff568459502d4ebe53e9cca203053d86ec9024fe935f19615d74d9aa"],
    ["mihomo-windows-amd64-v3-go125-v1.19.33.zip", "a7c34577d6ab539adfb33556c8fe33729fb7387d60ef00cd101d5488e77ee73e"],
    ["mihomo-windows-amd64-v1.19.33.zip", "6ab2180875f9f6fff8b19386d760daec257f66b45f72b3afc650634272fa837a"],
  ];
  const release = {
    tag_name: "v1.19.33",
    prerelease: false,
    assets: REAL.map(([name, digest]) => ({
      name,
      digest: `sha256:${digest}`,
      browser_download_url: `https://github.com/MetaCubeX/mihomo/releases/download/v1.19.33/${name}`,
    })),
  };

  it("plain 那一颗赢下全部变体，摘要与原 url 都跟着真值", () => {
    const picked = pickMihomoAsset(release);
    expect(picked?.name).toBe("mihomo-windows-amd64-v1.19.33.zip");
    expect(picked?.digest).toBe("6ab2180875f9f6fff8b19386d760daec257f66b45f72b3afc650634272fa837a");
    expect(picked?.downloadUrl).toBe(
      "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.33/mihomo-windows-amd64-v1.19.33.zip",
    );
  });

  it("那颗资产的下载入口在出口白名单里（实测它 302 到 release-assets.githubusercontent.com）", () => {
    expect(isAllowedUpdateUrl(pickMihomoAsset(release)!.downloadUrl, "asset")).toBe(true);
  });

  it("真包里躺的是 mihomo-windows-amd64.exe，不是 mihomo.exe——所以换装前必须改名", () => {
    // 实测 `tar -tf` 那份 zip：唯一条目 `mihomo-windows-amd64.exe`（61,247,488 字节）。
    // 直接当 `bundledExePath` 用会「装好了、但发现逻辑看不见它」，于是下次还是 no-binary。
    expect(selectExtractedExe(["mihomo-windows-amd64.exe"])).toBe("mihomo-windows-amd64.exe");
  });
});

describe("解压产物与出口边界", () => {
  it("零个 exe 与两个以上一律拒：不替用户猜哪一颗是内核", () => {
    expect(selectExtractedExe([])).toBeNull();
    expect(selectExtractedExe(["README.md"])).toBeNull();
    expect(selectExtractedExe(["mihomo.exe", "mihomo-alpha.exe"])).toBeNull();
  });

  it("只认 .exe（大小写不敏感）；别的扩展名一个都不算内核", () => {
    expect(selectExtractedExe(["MIHOMO.EXE"])).toBe("MIHOMO.EXE");
    expect(selectExtractedExe(["lib.dll"])).toBeNull();
    expect(selectExtractedExe(["mihomo.exe.bak"])).toBeNull();
  });

  it("包里有目录层也照样认出来：回的是相对解压根的那一段", () => {
    expect(selectExtractedExe(["bin/mihomo.exe"])).toBe("bin/mihomo.exe");
  });

  it("发布页只认 api.github.com；资产只认 github.com 与 *.githubusercontent.com", () => {
    expect(isAllowedUpdateUrl("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest", "release")).toBe(true);
    expect(isAllowedUpdateUrl("https://github.com/MetaCubeX/mihomo/releases/download/v1/x.zip", "asset")).toBe(true);
    expect(isAllowedUpdateUrl("https://objects.githubusercontent.com/x", "asset")).toBe(true);
    expect(isAllowedUpdateUrl("https://release-assets.githubusercontent.com/x", "asset")).toBe(true);
    // 后缀吃掉一整段域名的写法：`api.github.com.evil.tld` 看着像我们那本发布页。
    expect(isAllowedUpdateUrl("https://api.github.com.evil.tld/x", "release")).toBe(false);
    expect(isAllowedUpdateUrl("https://githubusercontent.com.evil.tld/x", "asset")).toBe(false);
    expect(isAllowedUpdateUrl("https://evil.tld/MetaCubeX/mihomo/x.zip", "asset")).toBe(false);
    // 口令式 userinfo 混淆：URL 解析后 host 是 evil.tld，白名单必须按 host 判而不是按前缀。
    expect(isAllowedUpdateUrl("https://api.github.com@evil.tld/x", "release")).toBe(false);
    expect(isAllowedUpdateUrl("https://objects.githubusercontent.com@evil.tld/x", "asset")).toBe(false);
  });

  it("不是 https 就别说自己是发布页；解析不出来的字符串也不炸", () => {
    expect(isAllowedUpdateUrl("http://api.github.com/x", "release")).toBe(false);
    expect(isAllowedUpdateUrl("file:///C:/x/mihomo.zip", "asset")).toBe(false);
    expect(isAllowedUpdateUrl("", "asset")).toBe(false);
    expect(isAllowedUpdateUrl(undefined as unknown as string, "asset")).toBe(false);
  });
});

describe("三态发现", () => {
  it("控制器可达就是 external，并且根本不去看二进制在哪儿", () => {
    expect(
      resolveCoreSource({ controllerReachable: true, installedExe: "C:\\Verge\\verge-mihomo.exe", bundledExe: null }),
    ).toEqual({ mode: "external", exePath: null, needsDownload: false });
  });

  it("不可达才借安装版；安装版没有才用自托管那颗", () => {
    expect(resolveCoreSource({ controllerReachable: false, installedExe: "C:\\V\\verge-mihomo.exe", bundledExe: "D:\\core\\mihomo.exe" }))
      .toEqual({ mode: "installed", exePath: "C:\\V\\verge-mihomo.exe", needsDownload: false });
    expect(resolveCoreSource({ controllerReachable: false, installedExe: null, bundledExe: "D:\\core\\mihomo.exe" }))
      .toEqual({ mode: "bundled", exePath: "D:\\core\\mihomo.exe", needsDownload: false });
  });

  it("哪儿都没有＝「要下载」，不是失败——下不下由用户点，我们不替他决定下载", () => {
    expect(resolveCoreSource({ controllerReachable: false, installedExe: null, bundledExe: null }))
      .toEqual({ mode: "bundled", exePath: null, needsDownload: true });
  });
});

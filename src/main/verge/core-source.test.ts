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
  parseSha256Digest,
  pickInstalledBinary,
  pickMihomoAsset,
  pickPortPair,
  resolveCoreSource,
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

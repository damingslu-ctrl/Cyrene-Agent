/**
 * v1.26 内核宿主（Wave 3 T10）的纯函数层：选二进制、选端口、拼参数、挑资产。
 *
 * 这一层不碰 fs、不碰 net、不起进程——判定全在这里，`core-manager.ts` 只接线。
 * 三条口径值得单独钉住：
 * - **stable 优先于 alpha**：`verge-mihomo-alpha.exe` 与 `mihomo-*-alpha.*.zip` 是别人在试的版本，
 *   拿它当「默认借用的内核」等于替用户选了一条更会崩的路。
 * - **两个端口一起挑**：mixed 与 controller 都得空着才算这组能用；只挑一个的话，
 *   第二个撞车时内核会起在半套端口上，页面显示的端口就不是真在监听的那一个。
 * - **摘要缺失＝拒**：GitHub API 的 `assets[].digest` 是 `sha256:…`，缺失或不是 sha256 一律拒装
 *   （spec D3「digest 必填」）——只有名字对得上不构成「这就是那个文件」。
 */
import path from "node:path";
import {
  CORE_DIR_NAME,
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MIXED_PORT,
  FALLBACK_PORT_START,
  INSTALLED_CORE_PREFIX,
  PORT_SCAN_LIMIT,
  type CorePortPair,
} from "../../shared/core-types";

/** 目录里的文件名 → 该借用哪一个；一个都不合格回 null（回 null 是「没有」，不是猜一个）。 */
export function pickInstalledBinary(names: readonly string[]): string | null {
  const family = names
    .filter((name) => /^verge-mihomo.*\.exe$/i.test(name))
    .map((name) => name.toLowerCase());
  if (family.length === 0) return null;
  const stable = `${INSTALLED_CORE_PREFIX}.exe`;
  if (family.includes(stable)) return stable;
  return [...family].sort()[0];
}

/**
 * 端口对：默认档两个都空着就用默认；否则从 `FALLBACK_PORT_START` 往上扫，
 * 找**第一组两个都空**的号——不是「mixed 找到后 controller 再随便找」。
 */
export function pickPortPair(
  usedPorts: readonly number[] = [],
  preferred: CorePortPair = { mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT },
): CorePortPair | null {
  const used = new Set(usedPorts.filter((p) => Number.isInteger(p) && p > 0 && p <= 65535));
  if (!used.has(preferred.mixed) && !used.has(preferred.controller)) return preferred;
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const mixed = FALLBACK_PORT_START + offset;
    if (mixed > 65535) break;
    const controller = FALLBACK_PORT_START + offset + 1;
    if (controller > 65535) break;
    if (!used.has(mixed) && !used.has(controller)) return { mixed, controller };
  }
  return null;
}

/**
 * 控制器地址 → 端口号。装配层用它把「Verge 那本 `clash-verge.yaml` 里声明的端口」
 * 变成起内核时的首选档：整条数据面（网络页、桌宠播报）都按那本账上的地址找内核，
 * 我们起的这颗若落在别的端口上，就成了「进程在跑、页面当它不存在」。
 *
 * 解析不出端口回 null——调用方拿默认档顶上，而不是猜。
 */
export function controllerPortOf(baseUrl: string | null | undefined): number | null {
  if (typeof baseUrl !== "string" || !baseUrl) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`);
  } catch {
    return null;
  }
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * `-d` 是内核的工作目录（config、缓存、geo 都落这儿），`-f` 是我们要它吃的那份配置。
 *
 * 上游 Verge 还会补 `-ext-ctl-pipe`（非 Windows 是 `-ext-ctl-unix`）走命名管道控制面；
 * 我们不吃那一套——本客户端整条数据面都按 TCP 控制器写的（`/proxies`、`/traffic`…），
 * 只要 runtime config 里的 `external-controller` 指到我们选的那个端口就够了。
 */
export function buildCoreArgs(coreDir: string, configPath: string): string[] {
  return ["-d", coreDir, "-f", configPath];
}

/** 自托管内核与日志的根：`<userData>/core/`。Verge 的目录一律不碰。 */
export function coreDirOf(userData: string): string {
  return path.join(userData, CORE_DIR_NAME);
}

export function bundledExePath(userData: string): string {
  return path.join(coreDirOf(userData), "mihomo.exe");
}

/**
 * GitHub 的 `assets[].digest` 形如 `sha256:1a2b…`。只认 sha256，返回小写十六进制；
 * 其它算法、缺前缀、长度不对都回 null——null 和「不符」在回执里是两档，别并成一档。
 */
export function parseSha256Digest(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  const matched = /^sha256:([0-9a-f]{64})$/.exec(trimmed);
  return matched ? matched[1] : null;
}

export interface CoreAssetPick {
  name: string;
  /** 用 `browser_download_url`：API 的 `url` 要带 Accept 且吃 60/时的匿名限额，
   *  而真文件本来就在 `objects.githubusercontent.com`（spec D3 的出口白名单里就有它）。 */
  downloadUrl: string;
  digest: string | null;
}

/**
 * 从 release 的 assets 里挑 Windows x64 那个 zip。
 *
 * 2026-10-30 拿真响应认证过（`v1.19.33`、127 个资产）：windows-amd64 那一族有 23 个 zip，
 * 变体名是 `-compatible-`、`-v1|-v2|-v3`（GOAMD64 档）、`-go1NN`（Go 版本）及其组合，
 * **plain 那一颗（`mihomo-windows-amd64-v1.19.33.zip`）连字符最少**，所以下面这个排法选中它。
 * 实测那颗在本机正常（`Mihomo Meta v1.19.33 windows amd64 with go1.26.10`）；不选 `-v3`
 * 是因为它要 AVX2，机器不保证有——挑错了的形状是「装上了但起不来」，比多下一颗慢的包贵得多。
 */
export function pickMihomoAsset(release: unknown): CoreAssetPick | null {
  if (typeof release !== "object" || release === null) return null;
  const assets = (release as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  const candidates: CoreAssetPick[] = [];
  for (const entry of assets) {
    if (typeof entry !== "object" || entry === null) continue;
    const asset = entry as Record<string, unknown>;
    const name = typeof asset.name === "string" ? asset.name : "";
    const downloadUrl = typeof asset.browser_download_url === "string" ? asset.browser_download_url : "";
    if (!/^mihomo-windows-amd64-.*\.zip$/i.test(name) || !downloadUrl) continue;
    candidates.push({ name, downloadUrl, digest: parseSha256Digest(asset.digest) });
  }
  if (candidates.length === 0) return null;
  // 「plain」按连字符最少认：`mihomo-windows-amd64-v1.19.33.zip` 切出来是 4 段，
  // `-compatible-` / `-v3-go125-` 这些变体各多一或两段。名字里没有会变体名的 plain。
  const weight = (name: string): number => name.split("-").length;
  return [...candidates].sort(
    (a, b) => weight(a.name) - weight(b.name) || a.name.localeCompare(b.name),
  )[0];
}

/**
 * 解压产物里那颗可执行文件的名字（相对解压根）。
 *
 * **只有正好一个 `.exe` 才算数**，多一个都回 null。取第一个是替用户猜：mihomo 的包里
 * 现在只有一个 exe，哪天上游多塞一个装机辅助程序，我们就会把运气当成判定装进内核目录——
 * 而这一档错的形状是「装了个不相干的 exe，起内核时报 spawn-failed」，最难往回查。
 *
 * 实测真包那一条目叫 `mihomo-windows-amd64.exe`，**不叫 `mihomo.exe`**：
 * 不换名就摆进 `bundledExePath` 的话，发现逻辑永远看不见它，下次还是 `no-binary`。
 */
export function selectExtractedExe(names: readonly string[]): string | null {
  const exes = names.filter((name) => /\.exe$/i.test(name));
  return exes.length === 1 ? exes[0] : null;
}

/**
 * 更新通道的出口白名单（spec D3「只有更新器能碰 GitHub」的另一半：更新器自己认哪些 host）。
 *
 * 判 host 而不是判前缀：`https://api.github.com.evil.tld/…` 与
 * `https://api.github.com@evil.tld/…` 都长得像我们那本发布页，真 host 却是别人的域。
 * 这一层拦的是「假发布页给自己发一枚合法摘要」——摘要在伪造的 JSON 面前自证不了任何东西，
 * 只有来源钉住才有意义。资产那一头必须放行 `*.githubusercontent.com`：
 * 实测 `github.com` 的下载入口 302 到 `release-assets.githubusercontent.com`。
 */
export function isAllowedUpdateUrl(raw: string, kind: "release" | "asset"): boolean {
  if (typeof raw !== "string" || !raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (kind === "release") return host === "api.github.com";
  return host === "github.com" || host.endsWith(".githubusercontent.com");
}

export type CoreSource =
  | { mode: "external"; exePath: null; needsDownload: false }
  | { mode: "installed"; exePath: string; needsDownload: false }
  | { mode: "bundled"; exePath: string; needsDownload: false }
  /** 哪儿都没有内核：这一档不是失败，是「要下载」——下载与否由用户点，不由我们替用户决定。 */
  | { mode: "bundled"; exePath: null; needsDownload: true };

/**
 * 三态发现的判定（spec D2）：可达即 external，**不启进程**；
 * 不可达才轮到借用安装版，再没有才看自托管那份下没下过。
 */
export function resolveCoreSource(input: {
  controllerReachable: boolean;
  installedExe: string | null;
  bundledExe: string | null;
}): CoreSource {
  if (input.controllerReachable) return { mode: "external", exePath: null, needsDownload: false };
  if (input.installedExe) return { mode: "installed", exePath: input.installedExe, needsDownload: false };
  if (input.bundledExe) return { mode: "bundled", exePath: input.bundledExe, needsDownload: false };
  return { mode: "bundled", exePath: null, needsDownload: true };
}

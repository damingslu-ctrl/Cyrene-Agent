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
 * 名字模式按 spec D2 写的 `mihomo-windows-amd64-v*.zip`；**本机实现时无出站可核对真 release 列表**，
 * 所以这里按「前缀对、后缀是 .zip、优先没有额外变体后缀」排，并把挑中的原名回出去——
 * 页面与 core.log 都看得见到底抓的是哪一个，猜错时不至于连案发现场都没有。
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
  // 「plain」按连字符最少认：`mihomo-windows-amd64-v1.18.10.zip` 是 3 个，
  // `-compatible-` / `-go19s-` 这些变体各多一个。名字里没有会变体名的 plain。
  const weight = (name: string): number => name.split("-").length;
  return [...candidates].sort(
    (a, b) => weight(a.name) - weight(b.name) || a.name.localeCompare(b.name),
  )[0];
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

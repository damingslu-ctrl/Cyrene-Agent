/**
 * v1.26 客户端更新通道的纯解析（Wave 4 T12a）。
 *
 * 这一份一个 I/O 都没有：给它一份 `releases/latest` 的 JSON 与本机版本号，它回「能不能升、
 * 升到哪、从哪儿下、凭据是什么」。之所以单独成一份而不是塞进 service，是因为这四条判断
 * 全部是**读错就只会绿在自己脸上**的那一类：
 *
 * 1) **来源钉在仓库，不只钉在 host**。`isAllowedUpdateUrl` 判的是 host（拦 `api.github.com.evil.tld`
 *    这类假发布页），但 host 干净不等于内容是我们的那本：`api.github.com` 也可以被指到别人的 repo。
 *    所以这里再核一次 `html_url`/`url` 属于钉住的那个仓库——伪造的 JSON 里可以写着完全自洽的
 *    sha256，摘要在假来源面前自证不了任何东西。
 * 2) **版本号只按 semver 比高低**。字符串比较会把 `1.9.9` 判成比 `1.10.0` 新（`9` > `1`），
 *    于是这一档错的形状是「永远说你是最新」——用户永远升不上去，而界面上一句错误都没有。
 *    规则复用 `shared/version.ts` 那一份（与插件市场同一把尺），不在这儿另写。
 * 3) **读不出就当不能升**。tag 缺失、tag 不是合法 semver、本机版本号读不出——一律 `failed`
 *    并说清是哪一边，不许悄悄回一句「已是最新」把这一趟盖过去。
 * 4) **摘要缺失在检查这一步就拒**，等不到下载。spec D3 的字面口径是「缺失即拒绝安装」，
 *    这里更严一档：连 290 MB 都不下。理由与内核通道同一档（`digest-missing` 与
 *    `digest-mismatch` 分开）——「上游没给凭据」是上游的事，「货不对板」才需要用户做别的事。
 */
import { parseSha256Digest, type CoreAssetPick } from "../verge/core-source";
import { isValidPluginVersion, isNewerVersion } from "../../shared/version";

/**
 * 客户端通道只认这一个仓库（spec D3「客户端从 fork 的 Release 拉安装包」）。
 *
 * 写成 `owner/name` 一整串而不是两个字段，除了少一次拼接，还有一条工程上的理由：
 * 出口锁（`egress/upstream-off.test.ts`）扫的是「不许把发布源配回 electron-builder」那种
 * `repo: <名字>` 形状，两个字段并排写会撞在它的字面量上。
 */
export const CLIENT_UPDATE_REPO = "damingslu-ctrl/Cyrene-Agent";

/** 公开仓库、无 token；匿名 60 次/时，对「启动一次 + 每 6 小时一次 + 用户手动点」这个频率够用。 */
export const CLIENT_RELEASE_API_URL = `https://api.github.com/repos/${CLIENT_UPDATE_REPO}/releases/latest`;

/** 资产名与 `electron-builder.yml` 的 `artifactName: Mochi-Setup-${version}.${ext}` 同源。 */
export const INSTALLER_ASSET_PATTERN = /^Mochi-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;

export interface ClientAssetPick extends CoreAssetPick {
  /** 从资产名里读出来的版本号；与 tag 对不上就当没有这颗。 */
  version: string;
}

export interface ClientReleaseInspection {
  /** tag 里读出的版本号（`v1.16.0` → `1.16.0`）；读不出为 null。 */
  version: string | null;
  prerelease: boolean;
  draft: boolean;
  /** 这份 release 属不属于钉住的那个仓库（看 `html_url` / `url` 的路径段）。 */
  fromPinnedRepo: boolean;
  asset: ClientAssetPick | null;
}

/** tag → 版本号：只脱掉一层 `v` 前缀，剩下的必须是完整 semver，否则回 null（不猜）。 */
export function versionFromTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  return isValidPluginVersion(trimmed) ? trimmed : null;
}

/**
 * `release.html_url` / `release.url` 里那两段 `/owner/name/` 是不是我们钉住的那本。
 *
 * 按**路径段**比，不按 `startsWith` 比：`https://github.com/damingslu-ctrl/Cyrene-Agent-evil/releases/1`
 * 前缀看着对，真 repo 是别人的。两头都看是因为 API 给的 `url` 与 `html_url` 形状不同
 * （`api.github.com/repos/<repo>/releases/<id>` 与 `github.com/<repo>/releases/<tag>`），
 * 少读一头就等于给伪造者留一头。
 */
export function releaseBelongsToRepo(release: unknown, repo: string = CLIENT_UPDATE_REPO): boolean {
  if (typeof release !== "object" || release === null) return false;
  const record = release as Record<string, unknown>;
  const want = repo.trim().toLowerCase().split("/");
  if (want.length !== 2 || want.some((part) => part === "")) return false;
  for (const key of ["html_url", "url"] as const) {
    const raw = record[key];
    if (typeof raw !== "string" || !raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const segments = url.pathname.split("/").filter((part) => part !== "").map((part) => part.toLowerCase());
    const hit = segments.findIndex((part) => part === want[0]);
    if (hit >= 0 && segments[hit + 1] === want[1]) return true;
  }
  return false;
}

/**
 * 从 release 的 assets 里挑那一个安装包。
 *
 * 认法按名字里的**版本号**而不是「第一个 .exe」：一次 release 里可能同时挂着
 * `Mochi-Setup-1.16.0.exe`、`.blockmap`、Portable 版与旧的 `latest.yml`（本 fork 不发后者），
 * 取第一个是把运气当判定。只认与 tag 同号的那一颗；同号的有两颗也回 null——
 * 与内核通道 `selectExtractedExe` 同一档戒律：认不出就拒，不替用户挑。
 */
export function pickInstallerAsset(release: unknown, version: string | null): ClientAssetPick | null {
  if (version === null || typeof release !== "object" || release === null) return null;
  const assets = (release as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  const matches: ClientAssetPick[] = [];
  for (const entry of assets) {
    if (typeof entry !== "object" || entry === null) continue;
    const asset = entry as Record<string, unknown>;
    const name = typeof asset.name === "string" ? asset.name : "";
    const downloadUrl = typeof asset.browser_download_url === "string" ? asset.browser_download_url : "";
    const parsed = INSTALLER_ASSET_PATTERN.exec(name);
    if (!parsed || !downloadUrl) continue;
    if (parsed[1] !== version) continue;
    matches.push({ name, downloadUrl, digest: parseSha256Digest(asset.digest), version });
  }
  return matches.length === 1 ? matches[0] : null;
}

export function inspectClientRelease(release: unknown): ClientReleaseInspection {
  const record = typeof release === "object" && release !== null ? (release as Record<string, unknown>) : {};
  const version = versionFromTag(record.tag_name);
  return {
    version,
    prerelease: record.prerelease === true,
    draft: record.draft === true,
    fromPinnedRepo: releaseBelongsToRepo(release),
    asset: pickInstallerAsset(release, version),
  };
}

export interface ClientCheckDecision {
  outcome: "available" | "latest" | "failed";
  /** 只有读到了才非空——「读不到」与「读到但没更新」在回执里必须是两档。 */
  latestVersion: string | null;
  reason: string | null;
  detail: string | null;
  asset: ClientAssetPick | null;
}

const FAIL = (reason: string, detail: string, latestVersion: string | null = null): ClientCheckDecision => ({
  outcome: "failed",
  latestVersion,
  reason,
  detail,
  asset: null,
});

/**
 * 检查这一段的完整判定（顺序就是成本的顺序：先花得少的）。
 *
 * 来源在版本号之前、版本号在资产之前、资产在摘要之前：越靠前的判错了，后面那些字节就越不该下。
 */
export function decideClientCheck(release: unknown, currentVersion: string): ClientCheckDecision {
  const info = inspectClientRelease(release);
  if (!info.fromPinnedRepo) {
    return FAIL("wrong-source", `发布页回来的不是 ${CLIENT_UPDATE_REPO} 那本 release`);
  }
  if (info.prerelease || info.draft) {
    return FAIL("prerelease-only", "发布页给的是预发布或草稿，不装");
  }
  if (info.version === null) {
    return FAIL("bad-response", "发布页里没有能读的 tag_name（不是合法版本号）");
  }
  if (!isValidPluginVersion(currentVersion)) {
    return FAIL("bad-response", `本机版本号 ${currentVersion} 不是合法 semver，比不出高低`, info.version);
  }
  if (!isNewerVersion(info.version, currentVersion)) {
    // 已是最新不是失败：这一档没有 reason，页面说的是「已经是最新版」。
    return { outcome: "latest", latestVersion: info.version, reason: null, detail: null, asset: null };
  }
  if (info.asset === null) {
    return FAIL("no-asset", `发布页 ${info.version} 里没有正好一颗对得上的 Mochi-Setup-*.exe`, info.version);
  }
  if (info.asset.digest === null) {
    return FAIL("digest-missing", `${info.asset.name} 没带 sha256 凭据，一个字节都不下`, info.version);
  }
  return { outcome: "available", latestVersion: info.version, reason: null, detail: null, asset: info.asset };
}

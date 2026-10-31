// 客户端安装包的发布通路（Wave 4 T13）：本地算摘要 → 打印计划 →（点头之后）建 Release → 回读远端摘要核对。
//
// 为什么要有这一份：v1.3.5 到 v1.26 那十几版是人手敲 `gh release create` 发出来的，
// 而这条通路**错了就改不动**——Release 一旦公开，资产覆盖上传会让已装机用户拿到的那一版
// 与文档里记的 sha256 对不上，而客户端是按摘要拒装的（spec D3）。所以把当时手敲的那几步行成脚本，
// 并且默认只出计划：`--publish` 才是那句「我知道这不可回滚」。
//
// 三条不写清楚就会被忽略的事实：
//   1. tag 必须已经在远端、而且是 annotated。`gh release create` 发现本地没有这个 tag 时会顺手
//      建一枚轻量标签（指向默认分支 HEAD，不带作者与日期）。到那一步错的形状是「Release 挂着
//      一个不是我们打的 tag」，回滚时认不出哪一版是谁发的。
//   2. `releases/latest` 才是客户端读的那一本（`CLIENT_RELEASE_API_URL`）。发布成功但 latest
//      还指向旧版（比如更高版本号的 Release 已经存在），界面上会写「已经是最新版」——
//      这一档必须单独说，不能被「创建成功」盖过去。
//   3. 本机直连 github.com 被 SNI DPI 拦着，Clash Verge 的 7896 是唯一通路（2026-10-24 实测）。
//      这里不硬编码代理地址，只把环境里已有的 HTTPS_PROXY 原样带进子进程，没设时明确警告。
//
// 用法：node scripts/release/publish-update.mjs [--notes-file <md>] [--publish] [--tag vX.Y.Z]
//         [--installer <path>] [--output-dir <dir>] [--repo <owner/name>] [--allow-not-latest] [--help]
//   --publish           真发：默认不发，只打印将要执行的命令
//   --notes-file        要发就必须带：没有说明的 Release 之后没人记得这版改了什么
//   --allow-not-latest  认下「发出去了但 latest 不是这一版」（先发过更高版本号时才用）
//   --help              只打印用法，不碰任何产物
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as yaml from "yaml";
import { assertNoUpdateFeed, MIN_INSTALLER_BYTES } from "../verify/installer-artifacts.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");

/** 体积下限只有 `verify:installer` 一处定义：这里转手导出，不再抄第二个数。 */
export { MIN_INSTALLER_BYTES };

/**
 * 发布目标。这一串必须与 `src/main/update/github-release.ts` 的 `CLIENT_UPDATE_REPO` 同值，
 * 两边对不上时客户端拿的是 A 本、我们发的是 B 本——那一档在界面上同样是「已经是最新版」。
 * `publish-update.test.ts` 拿导入的常量钉这一条。
 */
export const DEFAULT_REPO = "damingslu-ctrl/Cyrene-Agent";
/** 白名单只有一本：换源是改锁（egress 那段普查）而不是改命令行参数。 */
export const ALLOWED_REPOS = Object.freeze([DEFAULT_REPO]);
/** 与安装器一起挂上去的那份人可读凭据。 */
export const SUMS_ASSET_NAME = "SHA256SUMS.txt";

const GH_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;

export function assertRepoAllowed(repo, allowed = ALLOWED_REPOS) {
  if (typeof repo !== "string" || repo === "" || !allowed.includes(repo)) {
    throw new Error(
      `发布目标必须在白名单里（白名单：${allowed.join(", ")}），收到的是 ${JSON.stringify(repo)}。` +
        "要换一本得先改 src/main/egress/upstream-off.test.ts 那段普查，不是在这儿加个参数。",
    );
  }
  return repo;
}

export function assertInstallerSize(size, min = MIN_INSTALLER_BYTES) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= min) {
    throw new Error(`安装器体积 ${size} bytes 不超过下限 ${min} bytes：产物大概不完整，发出去装机必坏`);
  }
  return size;
}

export function assertTagMatchesVersion(tag, version) {
  if (typeof tag !== "string" || tag === "") {
    throw new Error("没拿到要发布的 tag：--tag vX.Y.Z，或让脚本从 package.json 推");
  }
  if (tag !== `v${version}`) {
    throw new Error(
      `tag ${tag} 与 package.json 版本 ${version} 不同号（期望形如 v${version}）：` +
        "客户端从 tag 读版本号、从资产名读另一份版本号，两处不同号时这一版永远装不上",
    );
  }
  return tag;
}

/** coreutils 的那个格式：`<小写十六进制>␣␣<文件名>\n`，`sha256sum -c` 直接认。 */
export function buildSumsContent({ digest, assetName }) {
  return `${String(digest).toLowerCase()}  ${assetName}\n`;
}

/** GitHub 的资产摘要形如 `sha256:<64 hex>`；读不出就当没有，与客户端 `parseSha256Digest` 同一档。 */
export function parseGhDigest(raw) {
  if (typeof raw !== "string") return null;
  const matched = GH_DIGEST_PATTERN.exec(raw.trim().toLowerCase());
  return matched ? matched[1] : null;
}

/** 流式摘要：290 MB 不许进内存。 */
export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

/**
 * 安装器名从 `electron-builder.yml` 的 `nsis.artifactName` 派生（与 `verify:installer` 同一处）。
 * 这里绝不补一份默认名：品牌一改，本脚本会静默按旧名找文件，最后以 ENOENT 的形式伪装成产物缺失。
 */
export async function resolveBuild({ root = projectRoot, tag, version } = {}) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const builderConfig = yaml.parse(await readFile(path.join(root, "electron-builder.yml"), "utf8")) ?? {};
  const template = builderConfig.nsis?.artifactName;
  if (!template) {
    throw new Error(
      "electron-builder.yml 缺少 nsis.artifactName：安装器名只能由 src/shared/brand.ts 经 sync-brand.mjs 生成，本脚本不维护第二份",
    );
  }
  const resolvedVersion = typeof version === "string" && version !== "" ? version : pkg.version;
  const assetName = template.replace("${version}", resolvedVersion).replace("${ext}", "exe");
  const outputDir = path.join(root, builderConfig.directories?.output ?? "release");
  const resolvedTag = typeof tag === "string" && tag !== "" ? tag : `v${resolvedVersion}`;
  return {
    version: resolvedVersion,
    assetName,
    outputDir,
    installerPath: path.join(outputDir, assetName),
    tag: resolvedTag,
  };
}

/** 代理只透传，不硬编码：没设时 gh 会挂在超时上，那句警告比一次静默重试值钱。 */
export function ghEnv(env = process.env) {
  const out = { ...env };
  const proxy = out.HTTPS_PROXY ?? out.https_proxy;
  if (!proxy) out.MOCHI_PUBLISH_NO_PROXY = "1";
  return out;
}

export function ghProxyWarning(env) {
  return env.MOCHI_PUBLISH_NO_PROXY === "1"
    ? "！环境里没有 HTTPS_PROXY：本机直连 github.com 被 SNI DPI 拦着，gh 大概率挂在超时上。" +
        "正确姿势是 HTTPS_PROXY=http://127.0.0.1:7896（Clash Verge 的混合端口）再跑一次。"
    : null;
}

/** 真的那条 gh：单测一律注入假 runner，这一份只在 --publish 时走到。 */
export async function runGh(args, { env = process.env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      env: ghEnv(env),
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: error?.stdout ?? "",
      stderr: (error?.stderr ?? String(error?.message ?? error)).trim(),
    };
  }
}

/** 远端那一本 Release 已经存在就不许再发：资产会被覆盖，而摘要跟着变。 */
export async function assertReleaseAbsent({ gh, repo, tag }) {
  const res = await gh(["release", "view", tag, "--repo", repo]);
  if (res.code === 0) {
    throw new Error(
      `Release ${tag} 已存在：发出去的东西不改写。要重做就把版本号升一位、重新打 tag、发新的一版。`,
    );
  }
}

/** tag 必须已在远端且是 annotated：`gh release create` 会顺手建轻量标签，那一档最难往回查。 */
export async function assertRemoteTag({ gh, repo, tag }) {
  const res = await gh(["api", `repos/${repo}/git/ref/tags/${tag}`]);
  let type = "";
  if (res.code === 0) {
    try {
      type = JSON.parse(res.stdout || "{}")?.object?.type ?? "";
    } catch {
      type = "";
    }
  }
  if (res.code !== 0) {
    throw new Error(
      `远端（${repo}）没有 tag ${tag}：先把 annotated tag 推上去再发。` +
        "让 gh release create 自己补一枚轻量标签，等于发布一个不带作者与日期的版本，回滚时认不出是谁打的。",
    );
  }
  if (type !== "tag") {
    throw new Error(
      `远端的 ${tag} 是 ${type || "unknown"} 而不是 annotated tag：那一枚是轻量标签（指向 commit、不带作者与日期），` +
        "先删掉它、在本地重打 annotated 再推上来。",
    );
  }
  return type;
}

/**
 * 发完那一圈回读校验：资产在不在、摘要对不对、latest 是不是这一版。
 * 回的是判定而不是抛错——Release 已经建出来了，这一趟不可回滚，
 * 所以「发出去了但有一件事不对」必须能被调用方原样说出去。
 */
export async function verifyPublished({ gh, repo, tag, assetName, digest, allowNotLatest = false }) {
  const res = await gh(["api", `repos/${repo}/releases/tags/${tag}`]);
  if (res.code !== 0) {
    return { ok: false, reason: "no-release", detail: `${tag} 在 ${repo} 上读不回来：${res.stderr || "gh 非零退出"}`, assetName: null };
  }
  let release = null;
  try {
    release = JSON.parse(res.stdout || "{}");
  } catch {
    return { ok: false, reason: "bad-response", detail: `${tag} 的响应不是能读的 JSON`, assetName: null };
  }
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  // 认名字而不是「第一个 .exe」：与客户端 pickInstallerAsset 同一戒律。
  const asset = assets.find((entry) => entry && entry.name === assetName);
  if (!asset) {
    return { ok: false, reason: "no-asset", detail: `${tag} 的资产里没有正好一颗叫 ${assetName} 的文件`, assetName: null };
  }
  const remote = parseGhDigest(asset.digest);
  if (remote === null) {
    return {
      ok: false,
      reason: "digest-missing",
      detail: `${assetName} 在远端没带 sha256 凭据：客户端那一头本来就会 digest-missing 拒装，这一版发了也装不了`,
      assetName,
    };
  }
  if (remote !== String(digest).toLowerCase()) {
    return {
      ok: false,
      reason: "digest-mismatch",
      detail: `远端摘要 ${remote} 与本地 ${String(digest).toLowerCase()} 不一致：上传断过或资产被换过，别装机，先查这一版`,
      assetName,
    };
  }
  const latest = await gh(["api", `repos/${repo}/releases/latest`]);
  let latestTag = null;
  if (latest.code === 0) {
    try {
      latestTag = JSON.parse(latest.stdout || "{}")?.tag_name ?? null;
    } catch {
      latestTag = null;
    }
  }
  if (latestTag !== tag) {
    if (allowNotLatest) {
      return { ok: true, reason: null, detail: `latest 指向 ${latestTag}（已按 --allow-not-latest 认下）`, assetName };
    }
    return {
      ok: false,
      reason: "not-latest",
      detail: `资产摘要对得上，但 releases/latest 现在指向 ${latestTag ?? "读不出"}——客户端「检查更新」读的正是这一本，界面上会是「已经是最新版」`,
      assetName,
    };
  }
  return { ok: true, reason: null, detail: null, assetName };
}

/**
 * 本地这一圈闸门：按「花得少的在前」排。
 * 参数先判（不发任何请求、不读盘），再读配置、再看产物目录里有没有旧通道的索引、
 * 最后才流式算摘要——290 MB 那一趟是这一串里最贵的一步。
 */
export async function preflight(options = {}, deps = {}) {
  const log = deps.log ?? (() => {});
  const repo = assertRepoAllowed(options.repo ?? DEFAULT_REPO);
  const notesFile = typeof options.notesFile === "string" && options.notesFile !== "" ? options.notesFile : null;
  if (options.publish && notesFile === null) {
    throw new Error("要发（--publish）就必须带 --notes-file <md>：没有说明的 Release 之后没人记得这版改了什么");
  }
  const build = await resolveBuild({ tag: options.tag, version: options.version });
  assertTagMatchesVersion(build.tag, build.version);
  const outputDir = typeof options.outputDir === "string" && options.outputDir !== "" ? options.outputDir : build.outputDir;
  const installerPath = typeof options.installer === "string" && options.installer !== "" ? options.installer : build.installerPath;
  // 旧通道的反向锁在发布这一头也得守：产物目录里出现 latest.yml，说明 publish 块被引回来了，
  // 那种 Release 发出去等于把上游那套更新器从后门再装回去（Task 3 / Wave 4 的 A3）。
  await assertNoUpdateFeed(outputDir);
  const info = await stat(installerPath);
  // 这个下限只有 `verify:installer` 一处定义。参数只给程序内注入留口子（单测要跑这一串闸门
  // 又不必真造 20 MB），`parseArgs` 不认它——命令行上能放宽体积闸门，等于自己把闸门拆了。
  const minInstallerBytes = typeof options.minInstallerBytes === "number" ? options.minInstallerBytes : MIN_INSTALLER_BYTES;
  assertInstallerSize(info.size, minInstallerBytes);
  const digest = await sha256File(installerPath);
  const allowNotLatest = options.allowNotLatest === true;
  log(`本地闸门过：${build.assetName} ${info.size} bytes，sha256=${digest}`);
  return {
    publish: options.publish === true,
    repo,
    tag: build.tag,
    version: build.version,
    assetName: build.assetName,
    installerPath,
    sumsPath: path.join(outputDir, SUMS_ASSET_NAME),
    outputDir,
    size: info.size,
    digest,
    notesFile,
    allowNotLatest,
  };
}

/** 打印给人核对的那几行——「要跑什么」必须看得见，因为这一趟不可回滚。 */
export function makePlan(prepared) {
  const lines = [
    `发布目标：${prepared.repo}（白名单唯一的一本）`,
    `tag：${prepared.tag} · 版本：${prepared.version}`,
    `资产：${prepared.assetName}（${prepared.size} bytes）`,
    `本地 sha256：${prepared.digest}`,
    `凭据文件：${prepared.sumsPath}`,
    `说明：${prepared.notesFile ?? "（缺 --notes-file：--publish 会被拒绝）"}`,
    "顺序：release view（必须不存在）→ git/ref/tags（必须是 annotated）→ 落盘 SHA256SUMS.txt → release create → 回读摘要与 latest",
    `gh release create ${prepared.tag} ${prepared.installerPath} ${prepared.sumsPath} --repo ${prepared.repo} --notes-file ${prepared.notesFile ?? "<说明文件.md>"}`,
  ];
  if (!prepared.publish) {
    lines.push("现在是计划模式：一条命令都没发。点头的话加 --publish。");
  }
  return lines;
}

/**
 * 主流程：默认只出计划，`--publish` 才动远端。
 * 返回的是判定（published / ok / reason），不是布尔——「建出来了但摘要对不上」与
 * 「根本没建」是两件事，混成一句「失败」会让人以为可以原着重试。
 */
export async function publishUpdate(options = {}, deps = {}) {
  const gh = deps.gh ?? runGh;
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line) => console.log(line));
  const prepared = await preflight(options, { log });
  for (const line of makePlan(prepared)) log(line);
  const warning = ghProxyWarning(ghEnv(env));
  if (warning) log(warning);
  if (!prepared.publish) {
    return { ...prepared, published: false, sumsWritten: false, ok: true, reason: null, detail: null };
  }
  await assertReleaseAbsent({ gh, repo: prepared.repo, tag: prepared.tag });
  await assertRemoteTag({ gh, repo: prepared.repo, tag: prepared.tag });
  await writeFile(prepared.sumsPath, buildSumsContent({ digest: prepared.digest, assetName: prepared.assetName }), "utf8");
  const created = await gh([
    "release",
    "create",
    prepared.tag,
    prepared.installerPath,
    prepared.sumsPath,
    "--repo",
    prepared.repo,
    "--notes-file",
    prepared.notesFile,
  ]);
  if (created.code !== 0) {
    throw new Error(`gh release create 失败（exit ${created.code}）：${created.stderr || "没有错误正文"}`);
  }
  const check = await verifyPublished({
    gh,
    repo: prepared.repo,
    tag: prepared.tag,
    assetName: prepared.assetName,
    digest: prepared.digest,
    allowNotLatest: prepared.allowNotLatest,
  });
  return { ...prepared, published: true, sumsWritten: true, ...check };
}

export function parseArgs(argv) {
  const options = { publish: false, help: false };
  const flags = new Map([
    ["--installer", "installer"],
    ["--output-dir", "outputDir"],
    ["--repo", "repo"],
    ["--tag", "tag"],
    ["--notes-file", "notesFile"],
  ]);
  const booleans = new Map([["--publish", "publish"], ["--allow-not-latest", "allowNotLatest"], ["--help", "help"]]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (flags.has(token)) {
      const value = argv[i + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--")) {
        throw new Error(`${token} 后面要跟一个值`);
      }
      options[flags.get(token)] = value;
      i += 1;
      continue;
    }
    if (booleans.has(token)) {
      options[booleans.get(token)] = true;
      continue;
    }
    throw new Error(`不认识的参数：${token}（--help 看用法）`);
  }
  return options;
}

const USAGE = [
  "用法：node scripts/release/publish-update.mjs [--notes-file <md>] [--publish] [选项]",
  "  --publish            真发：默认只打印计划，一条命令都不发",
  "  --notes-file <md>    要发就必须带：Release 的说明正文",
  "  --tag vX.Y.Z         默认由 package.json 版本号推（v<version>），不同号直接拒",
  "  --installer <path>   默认取 electron-builder.yml 的 directories.output + nsis.artifactName",
  "  --output-dir <dir>   默认同上；这一目录里出现 latest.yml 就不许发",
  "  --repo <owner/name>  默认且只允许钉住的那本；换源要先改 egress 那段普查",
  "  --allow-not-latest   认下「发出去了但 latest 不是这一版」（更高版本号的 Release 已存在时）",
  "  --help               只打印本说明",
  "判据：产物体积合理 · 无 latest.yml · tag 与版本号同号 · 远端 tag 是 annotated · 该版无 Release · 上传后摘要一致且 latest 对上",
  "代理：HTTPS_PROXY=http://127.0.0.1:7896（直连 github.com 被 SNI DPI 拦着，见文件头第 3 条）",
].join("\n");

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[publish] ${error.message}`);
    process.exitCode = 2;
  }
  if (options && !options.help) {
    publishUpdate(options, {})
      .then((result) => {
        if (!result.published) {
          console.log("[publish] 计划模式：什么都没发。");
          return;
        }
        if (result.ok) {
          console.log(`[publish] ${result.tag} 已发布，远端摘要与本地一致：${result.digest}`);
          return;
        }
        console.error(`[publish] ${result.tag} 发出去了，但校验没过（${result.reason}）：${result.detail}`);
        process.exitCode = 1;
      })
      .catch((error) => {
        console.error(`[publish] 停止：${error.message}`);
        process.exitCode = 1;
      });
  } else if (options?.help) {
    console.log(USAGE);
  }
}

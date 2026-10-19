// 安装包产物验证：NSIS 安装器与随包二进制是否齐全，且不携带任何升级源。
// 在 electron-builder --win nsis 构建完成后运行，检查输出目录（electron-builder.yml
// 的 directories.output，默认 release/）：
//   1. Cyrene-Setup-<version>.exe 存在且体积合理
//   2. 升级源索引不得存在：本 fork 没有更新来源，latest.yml 一旦出现就说明
//      publish 块或 electron-updater 被引回来了（Task 3 的反向锁）。
//   3. 安装器同名 .blockmap 允许存在，不视为升级元数据（理由见下方反向锁处的注释）。
//   4. win-unpacked/resources 内截图辅助程序、mpv、MinGit、skills 快照齐全
// 用法：node scripts/verify/installer-artifacts.mjs [--expect-version x.y.z] [--help]
//   --expect-version：标签构建时传入标签版本，校验「产物版本与标签一致」
//   --help：只打印用法，不校验产物
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "yaml";
import { verifyScreenshotHelper } from "./screenshot-helper.mjs";
import { verifyMpvHelper } from "./mpv-helper.mjs";

const parseYaml = yaml.parse;
const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");

// 安装器小于该值必然缺资源（Electron 本体 + mpv + MinGit 远大于此）
const MIN_INSTALLER_BYTES = 20 * 1024 * 1024;

/**
 * 反向锁：输出目录里不得出现升级源索引 `latest.yml`。
 *
 * 为什么只锁 `latest.yml`、放行同名 `.exe.blockmap`：
 * - `.blockmap` 是差分包的指纹表，electron-builder 26 对 NSIS 目标**无条件**产出，
 *   与 `publish` 无关（`nsis.differentialPackage: true` 只决定它有没有意义）。
 *   把它列为禁品等于把生成器的正常产物当违规，打包验证必红。
 * - 没有 `latest.yml` 这个索引，客户端无从发现 blockmap，它只是一份死文件；
 *   真正判断「有没有更新源」的是索引，不是指纹表。
 * 因此：latest.yml 出现 = publish 块或 electron-updater 被引回来了；blockmap 出现 = 正常打包。
 */
export async function assertNoUpdateFeed(outputDir) {
  const feedIndex = path.join(outputDir, "latest.yml");
  let present = true;
  try {
    await stat(feedIndex);
  } catch (err) {
    if (err && err.code === "ENOENT") present = false;
    else throw err;
  }
  if (present) throw new Error(`不应存在的升级源索引：${feedIndex}`);
}

export async function verifyInstallerArtifacts(options = {}) {
  const { expectVersion } = options;

  const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const builderConfig = parseYaml(
    await readFile(path.join(projectRoot, "electron-builder.yml"), "utf8"),
  );
  const outputDir = path.join(projectRoot, builderConfig.directories?.output ?? "release");
  const artifactName = (builderConfig.nsis?.artifactName ?? "Cyrene-Setup-${version}.${ext}")
    .replace("${version}", pkg.version)
    .replace("${ext}", "exe");

  if (expectVersion && expectVersion !== pkg.version) {
    throw new Error(`标签版本 ${expectVersion} 与 package.json 版本 ${pkg.version} 不一致`);
  }

  // 1. 安装器本体
  const installerPath = path.join(outputDir, artifactName);
  const installerStat = await stat(installerPath);
  if (installerStat.size <= MIN_INSTALLER_BYTES) {
    throw new Error(`安装器体积异常（${installerStat.size} bytes）：${installerPath}`);
  }

  // 2. 升级源索引不得存在：本 fork 没有更新来源，latest.yml 一旦出现就说明
  //    publish 块或 electron-updater 被引回来了（Task 3 的反向锁）。
  await assertNoUpdateFeed(outputDir);

  // 3. win-unpacked 内的随包二进制（与安装器内容一致，免去装机检查）
  const resourcesDir = path.join(outputDir, "win-unpacked", "resources");
  const screenshot = await verifyScreenshotHelper(path.join(resourcesDir, "bin", "cyrene-screenshot.exe"));
  const mpv = await verifyMpvHelper(path.join(resourcesDir, "bin", "mpv", "mpv.exe"));
  // MinGit 的 cmd/git.exe 只是启动器（几十 KB），真二进制在 mingw64/bin/，
  // 体积阈值无意义，以 --version 运行探测为准（与 prepare-mingit 同一判定）
  const gitExe = path.join(resourcesDir, "mingit", "cmd", "git.exe");
  await stat(gitExe);
  const { stdout: gitVersion } = await execFileAsync(gitExe, ["--version"], {
    windowsHide: true,
    timeout: 10_000,
  });
  await stat(path.join(resourcesDir, "cyrene-skills", "skills-snapshot.zip"));

  return {
    installerPath,
    installerSize: installerStat.size,
    version: pkg.version,
    mpvVersion: mpv.version,
    gitVersion: gitVersion.trim(),
    screenshotSize: screenshot.size,
  };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    // 离线自描述：不读产物 / 不触发打包，只说明用法与判据
    console.log(
      [
        "用法：node scripts/verify/installer-artifacts.mjs [--expect-version x.y.z] [--help]",
        "  --expect-version  标签构建时传入标签版本，校验产物版本与标签一致",
        "  --help            打印本说明并退出（不校验任何产物）",
        "判据：安装器存在且体积合理；latest.yml 不得存在（.blockmap 允许）；win-unpacked 随包二进制齐全",
      ].join("\n"),
    );
    process.exit(0);
  }
  const expectIndex = process.argv.indexOf("--expect-version");
  const expectVersion = expectIndex !== -1 ? process.argv[expectIndex + 1] : undefined;
  verifyInstallerArtifacts({ expectVersion })
    .then((result) => {
      console.log(
        `[installer] verified ${result.installerPath} (${result.installerSize} bytes) — v${result.version}`,
      );
      console.log(`[installer] mpv: ${result.mpvVersion}`);
      console.log(`[installer] mingit: ${result.gitVersion}`);
      console.log(`[installer] screenshot helper: ${result.screenshotSize} bytes`);
    })
    .catch((error) => {
      console.error(`[installer] verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}

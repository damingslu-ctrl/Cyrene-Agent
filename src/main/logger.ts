/**
 * Main-process wrapper around the shared logger.
 *
 * Responsibilities on top of src/shared/logger.ts:
 *   - Apply the dev-vs-release default level (info when unpackaged, warn
 *     when packaged) by calling setLogLevel() at module init.
 *   - Expose installMainLogSink() so the composition root can bind the file
 *     sink AFTER the instance identity (and therefore userData) is configured.
 *   - Re-export LogTag from the shared location so call sites can
 *     `import { LogTag } from "../logger"`.
 */
import { app } from "electron";
import { setLogLevel, type LogLevel } from "../shared/logger";
import { logger } from "../shared/logger";
import { installFileLogSink } from "./log-sink-file";

function resolveDefaultLevel(): LogLevel {
  // env wins
  const env = process.env.CYRENE_LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  // Both dev and release: warn by default. Startup prints the banner plus
  // whatever warn/error fires during init; set CYRENE_LOG_LEVEL=info to see
  // the full startup trace.
  return "warn";
}

setLogLevel(resolveDefaultLevel());

// 打包版 stdout 不可见：把日志同步落盘到 userData/logs/cyrene.log（滚动 3 份×5MB），
// 用户/issue 上报可直接附日志文件。dev 下同样落盘，便于本地排查。
//
// ⚠️ 这里【不能】在模块顶层装接收器。本模块会被入口的 import 图在
// `configureIdentity()` 之前就求值，那一刻 `app.getPath("userData")` 还是 package.json
// productName 决定的上游目录（`%APPDATA%\Cyrene`），而 installFileLogSink 会把路径永久
// 绑进闭包（`log-sink-file.ts` 里 mkdirSync + appendFileSync），于是 fork 的启动
// warn/error 全写进上游账本 —— 正是 R6 要杜绝的。必须由组合根在身份配好之后显式调用。
let fileSinkUninstall: (() => void) | null = null;

/**
 * 把文件落盘接收器绑到「当前」userData。
 *
 * 调用点唯一：`application/default-dependencies.ts` 的 `configureIdentity()` 闭包里、
 * 紧跟 `configureVergeIdentity()` 之后。重复调用无副作用（幂等），返回卸载函数供测试收尾。
 */
export function installMainLogSink(): () => void {
  if (fileSinkUninstall !== null) return fileSinkUninstall;
  try {
    fileSinkUninstall = installFileLogSink(app.getPath("userData"));
  } catch {
    // userData 不可用时静默跳过，日志落盘只是增强项
    fileSinkUninstall = () => {};
  }
  return fileSinkUninstall;
}

export { logger, setLogLevel, LogTag } from "../shared/logger";
export type { LogLevel } from "../shared/logger";

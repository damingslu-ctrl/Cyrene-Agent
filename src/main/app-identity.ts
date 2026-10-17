/**
 * fork 的进程身份（R6）。
 *
 * 单实例锁与 userData 目录都取自应用名。不改身份的话，`verge` 分支启动时会被
 * 已安装的上游 Cyrene 判为「第二实例」而直接退出（`app.requestSingleInstanceLock`
 * 按名字建锁），反过来也会把上游那份踢下线；两者的 `app.getPath("userData")`
 * 还会同时指向 `%APPDATA%\Cyrene`，双轨期间互相写脏同一套账本。
 *
 * 所以必须在取锁之前 `setName` + `setPath("userData")`：取锁与迁移目标目录、
 * GPU 开关的设置读取都以解析后的身份为准（见 application/pre-ready.ts 的顺序约束）。
 */

import * as path from "node:path";

/** fork 的实例名：与上游 `Cyrene` 区分，同时决定 userData 目录名。 */
export const VERGE_INSTANCE_NAME = "cyrene-verge";

/**
 * 解析 fork 的 userData 目录。
 *
 * `name` 只为可测性存在（正对照：证明拼接用的是传入值而不是常量）；
 * 生产调用一律省略它，走 `VERGE_INSTANCE_NAME`。
 */
export function resolveAppUserDataPath(
  appDataDir: string,
  name: string = VERGE_INSTANCE_NAME,
): string {
  return path.join(appDataDir, name);
}

/** `configureVergeIdentity` 需要的最小 Electron `app` 能力面，便于测试注入。 */
export interface IdentityApp {
  setName(name: string): void;
  setPath(key: "userData", value: string): void;
}

/**
 * 一次性把进程身份改成 fork 自己的名字与数据目录。
 *
 * 顺序必须是先 `setName` 再 `setPath`：`setPath("userData")` 只有在名字已定、
 * 目录尚未被任何读取点触碰时才生效，而改名又必须早于任何按名字解析的东西
 * （单实例锁、临时目录、快捷键作用域等）。
 */
export function configureVergeIdentity(
  app: IdentityApp,
  appDataDir: string,
): { name: string; userDataPath: string } {
  const userDataPath = resolveAppUserDataPath(appDataDir);
  app.setName(VERGE_INSTANCE_NAME);
  app.setPath("userData", userDataPath);
  return { name: VERGE_INSTANCE_NAME, userDataPath };
}

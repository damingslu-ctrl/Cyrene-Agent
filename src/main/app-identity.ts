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

/**
 * 命令行里有没有显式给 `--user-data-dir`。
 *
 * `app.setPath("userData", …)` 的优先级**高于** Chromium 的命令行开关：不认这个开关
 * 的话，`--user-data-dir=D:/x` 会被我们静默吞掉，仍然解析到 `%APPDATA%\cyrene-verge`，
 * 下游（屏幕层验收等）靠它指定 profile 的机制就失效了。所以显式给过时要让路。
 *
 * 只认带值的写法（`--user-data-dir=<path>`，以及 Chromium 等价的单短横线简写）；
 * 没有值的裸开关按「未显式指定」处理，继续用 fork 自己的目录。
 * 纯函数、不碰 electron，便于单测。
 */
export function hasExplicitUserDataDir(argv: string[]): boolean {
  return argv.some((arg) => /^-{1,2}user-data-dir=.+$/.test(arg));
}

/** `configureVergeIdentity` 需要的最小 Electron `app` 能力面，便于测试注入。 */
export interface IdentityApp {
  setName(name: string): void;
  setPath(key: "userData", value: string): void;
  /** 显式 `--user-data-dir` 时用它读回真正生效的目录（我们不再覆盖）。 */
  getPath(key: "userData"): string;
}

export interface VergeIdentity {
  name: string;
  /** 本次**实际生效**的 userData 目录：走开关时是 Electron 解析出来的那个，不是我们拼的。 */
  userDataPath: string;
  /** true = 命令行显式给了 `--user-data-dir`，本次没有覆盖它。 */
  explicitUserDataDir: boolean;
}

/**
 * 一次性把进程身份改成 fork 自己的名字与数据目录。
 *
 * 顺序必须是先 `setName` 再 `setPath`，且整步要早于任何**捕获** userData 的读取点：
 * 身份改名决定单实例锁、临时目录、快捷键作用域等按名字解析的东西，而 userData 一旦被
 * 某个消费者读走并长期记住（历史教训：日志落盘接收器在模块顶层就 `getPath("userData")`，
 * 于是永久绑到了上游 `%APPDATA%\Cyrene`），之后再改路径对它无效。
 * `setPath` 本身在 `app.ready` 前调用即可生效，跟「名字先定」没有因果关系。
 *
 * 例外：命令行显式给了 `--user-data-dir` 时不调 `setPath`（见 `hasExplicitUserDataDir`），
 * 让调用方的选择赢；`setName` 仍然无条件执行，因为身份名决定的单实例锁与上游隔离不受
 * 目录选择影响，显式指定的目录同样与上游账本隔离（R6 依旧成立）。
 */
export function configureVergeIdentity(
  app: IdentityApp,
  appDataDir: string,
  argv: string[] = process.argv,
): VergeIdentity {
  app.setName(VERGE_INSTANCE_NAME);
  if (hasExplicitUserDataDir(argv)) {
    return {
      name: VERGE_INSTANCE_NAME,
      userDataPath: app.getPath("userData"),
      explicitUserDataDir: true,
    };
  }
  const userDataPath = resolveAppUserDataPath(appDataDir);
  app.setPath("userData", userDataPath);
  return { name: VERGE_INSTANCE_NAME, userDataPath, explicitUserDataDir: false };
}

/**
 * Electron `ready` 之前的同步预配置阶段。
 * 必须保持小、同步、无业务服务构造：相关 API 只允许在 app ready 前调用。
 * 单实例锁获取失败时返回 isPrimaryProcess=false，由入口直接退出，不继续启动。
 */

import type { WindowActivationBroker } from "./window-activation";
import type { LegacyUserDataMigrationResult } from "../user-data-migration";

export interface PreReadyDependencies {
  /**
   * 必须先于 installSingleInstance：单实例锁与 userData 都按应用名解析。
   * 下面所有步骤（取锁、迁移目标目录、GPU 开关读设置）都以这里的身份为准。
   * 实现方（组合根）还必须在同一个闭包里、身份改动之后才绑定日志落盘目录，
   * 否则落盘接收器会把上游 userData 永久记住（见 src/main/logger.ts）。
   */
  configureIdentity(): void;
  installSingleInstance(onSecondInstance: () => void): boolean;
  /** 历史 userData 目录（live2d-cyrene）数据迁移到当前目录。 */
  migrateLegacyUserData(): LegacyUserDataMigrationResult;
  /** 上一代 fork 目录（cyrene-verge）整体迁移到 brand 指定的当前目录（Mochi）。 */
  migrateVergeUserData(): LegacyUserDataMigrationResult;
  registerPrivilegedSchemes(): void;
  configureGpuSwitches(): void;
  ensureGpuSandboxAcl(): void;
  /** 第二实例唤起统一形成 chat 激活请求，由激活代理决定何时打开窗口。 */
  activation: Pick<WindowActivationBroker, "request">;
}

export interface PreReadyResult {
  isPrimaryProcess: boolean;
}

export function prepareBeforeReady(deps: PreReadyDependencies): PreReadyResult {
  // 身份先于取锁：锁按名字建，userData 按名字解析，顺序颠倒就会与上游 Cyrene 抢同一把锁
  deps.configureIdentity();

  const isPrimary = deps.installSingleInstance(() => {
    deps.activation.request({ kind: "chat" });
  });
  if (!isPrimary) {
    return { isPrimaryProcess: false };
  }

  // 数据迁移必须在单实例锁之后（防并发搬运）、
  // 下方 GPU 开关读取设置之前（那是 userData 的第一处读取点）
  const migration = deps.migrateLegacyUserData();
  if (migration.status === "failed" || migration.status === "partial") {
    throw new Error("用户数据迁移未完成，已停止启动以避免使用不完整的数据目录。请关闭其他 Cyrene 实例及占用数据文件的程序后重试；不要删除旧数据目录。");
  }

  // 两次迁移的先后：先历史 live2d-cyrene，再本次的 cyrene-verge → Mochi，两步都早于
  // registerPrivilegedSchemes（下面 GPU 开关那处才是 userData 的第一个读取点，不许拖到它后面）。
  // 这个顺序是为角落情形钉的，不是装饰（plan Step 4 粘的那段注释把顺序写反了，按裁决改正）：
  //   1. 合并语义是「旧目录同名文件覆盖目标」。live2d 先跑，它并进来的东西随后被
  //      cyrene-verge 的整体改名盖过去——较新的那份赢；反过来是让十几年前的陈旧文件覆盖现状。
  //   2. 历史标记 .legacy-user-data-migrated 就躺在 cyrene-verge 里，会随整体重命名被原样
  //      搬进 Mochi。若先改名再跑 live2d 迁移，它会凭这份搬进来的标记直接返回
  //      already_migrated，把真正没并的数据永久留在 live2d-cyrene 里不搬。
  // 常见情况（live2d 目录早就不在了）两种顺序结果一样，plan 那段注释自己也承认；
  // 钉死顺序的同时，报错里的「旧目录」从此明确指向哪一个。
  const vergeMigration = deps.migrateVergeUserData();
  if (vergeMigration.status === "failed" || vergeMigration.status === "partial") {
    throw new Error("Mochi 数据目录迁移未完成，已停止启动以避免使用不完整的数据目录。旧目录原样保留，请勿删除。");
  }

  deps.registerPrivilegedSchemes();
  deps.configureGpuSwitches();
  deps.ensureGpuSandboxAcl();
  return { isPrimaryProcess: true };
}

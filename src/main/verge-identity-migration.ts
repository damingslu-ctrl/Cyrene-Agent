/**
 * fork 身份改名带来的一次性 userData 搬运（Task 9 / B3）：`%APPDATA%\cyrene-verge` → `%APPDATA%\Mochi`。
 *
 * 这是一层**薄封装**，不写第二套合并逻辑：源目录名、完成标记名、目标目录三个身份参数
 * 填进通用的 `migrateLegacyUserData`，重命名/逐项并入/失败保留旧目录/幂等标记的语义
 * 全部由它负责（两个调用点共享同一份实现，行为才不会分叉）。
 *
 * 顺序约束见 `application/pre-ready.ts`：这一步跑在历史 live2d-cyrene 迁移**之后**、
 * 任何 userData 读取点之前，且同样必须晚于单实例锁。
 */

import * as path from "node:path";

import { BRAND } from "../shared/brand";
import { VERGE_LEGACY_DIR_NAME, VERGE_MIGRATION_MARKER } from "./app-identity";
import {
  migrateLegacyUserData,
  type LegacyUserDataMigrationResult,
} from "./user-data-migration";

export interface VergeUserDataMigrationInput {
  /** app.getPath("appData") —— 上一代目录 `cyrene-verge` 的父目录 */
  appDataPath: string;
  /**
   * 迁移目标目录；省略时按 brand 的 `dataDirName` 拼（正常启动就是它）。
   *
   * 这个参数只为可测性与显式覆盖存在，**生产调用不许**把 `--user-data-dir` 的探针目录传进来：
   * 那等于把用户的全部账本搬进一次性的探针目录。带那个开关启动时，pre-ready 整步跳过搬运
   * （见 `application/pre-ready.ts` 的 `usesExplicitUserDataDir`），压根不会走到这里。
   */
  targetUserDataPath?: string;
}

/** 把上一代 fork 目录整体并进/改名成 brand 指定的当前目录。 */
export function migrateVergeUserData(
  input: VergeUserDataMigrationInput,
): LegacyUserDataMigrationResult {
  return migrateLegacyUserData({
    appDataPath: input.appDataPath,
    targetUserDataPath:
      input.targetUserDataPath ?? path.join(input.appDataPath, BRAND.dataDirName),
    legacyDirName: VERGE_LEGACY_DIR_NAME,
    markerFileName: VERGE_MIGRATION_MARKER,
  });
}

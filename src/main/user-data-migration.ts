/**
 * 旧 userData 目录 → 新目录的一次性数据迁移。
 *
 * 背景：历史上 userData 目录名由 package.json 的 name 字段决定（live2d-cyrene），
 * 开发版与安装版共用。补充 productName 后目录跟着改名，老用户升级时需要把旧目录
 * 数据搬过来。源目录名与完成标记名都是入参（默认值就是那次历史迁移的取值），所以
 * 同一个迁移器既服务 live2d-cyrene → 当前目录，也服务 cyrene-verge → Mochi。
 * 调用时机必须满足两点：
 *   1. 单实例锁获取成功之后（避免两个实例并发搬运）；
 *   2. 任何读取 userData 的代码之前（首个读取点是 GPU 开关里的 loadGeneralSettings）。
 *
 * 安全策略：只做重命名/复制，绝不主动删除旧目录里有内容的东西；
 * 任一条目失败就留在旧目录，下次启动自动重试。（应用拒启动时还有一条手动退路：
 * `scripts/migrate-user-data.ps1` 搬同样的两个源进 `Mochi`，按同样的路径段规则拒绝上游
 * `Cyrene`，覆盖前同样移进时间戳备份目录 —— 那份脚本的这三点由测试按文本钉住。）
 * 另有一道按名字的硬闸门（`assertMigratable`）：上游 `Cyrene` 目录里是用户的真实数据，
 * 本 fork 全程只读禁写，任何迁移都不许拿它当源或目标。
 */

import { CONSOLE_PREFIX } from "../shared/brand";
import * as fs from "fs";
import * as path from "path";
import { renameWithRetrySync } from "./storage/rename-with-retry";

/** 历史目录名：package.json 的 name 字段 */
const LEGACY_USER_DATA_DIR_NAME = "live2d-cyrene";

/** 运行时文件：新目录里是刚生成的有效状态，旧目录里的是陈旧垃圾。
 *  迁移时保留新目录版本，删除旧目录版本（进程已退出，必然陈旧）。 */
const RUNTIME_FILE_NAMES = new Set(["lockfile", "SingletonLock", "SingletonSocket", "SingletonCookie"]);

/**
 * 迁移完成标记，写在目标目录里。
 *
 * 迁移只该发生一次。若没有这个标记，之后只要旧目录重新出现（例如用户又运行了一次
 * 1.2.x 旧版，它会按旧名字重新建出 live2d-cyrene），下次启动就会再次「旧数据优先」
 * 并入，用旧版的陈旧文件覆盖用户当前的数据。有标记时，重新出现的旧目录不再并入。
 */
const MIGRATION_MARKER_FILE_NAME = ".legacy-user-data-migrated";

/** 合并时被旧目录同名条目覆盖的目标条目移到这里，而不是直接删除，便于找回。 */
const OVERWRITTEN_BACKUP_DIR_NAME = ".legacy-migration-overwritten";

/**
 * 只读禁写的上游目录名：这是用户真实数据，任何迁移都不许把它当源或目标。
 *
 * 上游安装版（`Cyrene`）与本 fork 是两个产品，账本必须物理隔离；一旦哪次迁移把
 * 它当成源，用户升级 fork 时就会把上游的真实数据搬空——246 MB，不可逆。所以这道
 * 闸门按名字拒绝，且在任何文件系统操作之前抛出（`user-data-migration.test.ts` 里
 * 用「抛出之后整棵子树逐文件比对不变」把它钉住）。
 */
const FORBIDDEN_DIR_NAMES = new Set(["Cyrene"]);
/** Windows 路径不区分大小写，闸门比较前先归一（`%APPDATA%\cyrene` 与 `%APPDATA%\Cyrene` 是同一个目录）。 */
const FORBIDDEN_DIR_NAMES_LOWER = new Set([...FORBIDDEN_DIR_NAMES].map((name) => name.toLowerCase()));

export interface LegacyUserDataMigrationInput {
  /** app.getPath("appData") —— 旧目录的父目录 */
  appDataPath: string;
  /** app.getPath("userData") —— 迁移目标，即应用当前真正使用的数据目录 */
  targetUserDataPath: string;
  /** 迁移源目录名；默认历史 live2d-cyrene，身份迁移显式传 `cyrene-verge`。 */
  legacyDirName?: string;
  /**
   * 完成标记文件名；默认历史 `.legacy-user-data-migrated`。
   *
   * 每一次独立的迁移必须用**不同**的名字：pre-ready 里 live2d 那步先跑，首启时目标目录已被
   * `configureIdentity` 的日志落盘接收器建出（`installFileLogSink` 会 `mkdirSync(userData/logs)`；
   * Windows 上单实例锁不在 userData 落文件）、旧目录早就不在，它什么也没搬却按 `none` 分支
   * 把标记**补记**进目标。
   * 复用同名标记会让后跑的身份迁移一进门就看到「已迁移过」，静默返回 already_migrated，
   * 数据留在旧目录不搬。
   */
  markerFileName?: string;
}

export type LegacyUserDataMigrationStatus =
  | "skipped" // 目录已是目标（同一路径），无需迁移
  | "none" // 旧目录不存在（新用户），无需迁移
  | "renamed" // 目标不存在，旧目录整体原子重命名
  | "merged" // 两者并存，逐项并入且全部成功
  | "partial" // 逐项并入但有失败，残留留在旧目录
  | "failed" // 整体重命名失败，保留旧目录并阻止本次启动
  | "already_migrated"; // 已迁移过（有完成标记），重新出现的旧目录原样保留、不再并入

export interface LegacyUserDataMigrationResult {
  status: LegacyUserDataMigrationStatus;
}

/** 命中禁写目录名时返回那个原始路径段，否则返回 undefined。 */
function findForbiddenSegment(candidate: string): string | undefined {
  return candidate
    .split(/[/\\]/)
    .find((segment) => FORBIDDEN_DIR_NAMES_LOWER.has(segment.toLowerCase()));
}

/**
 * 迁移前的硬闸门：拒绝任何路径里出现 `Cyrene` 段的搬运，并解析两次迁移各自的取值。
 *
 * 按名字判，不看内容也不碰文件系统 —— 连 `existsSync` 都不许先跑，否则「读一下确认是不是
 * 那个目录」本身就已经碰了只读禁写的目录。判据是**逐段**扫这三条完整路径
 * （`appDataPath`、拼出来的 legacy 路径、`targetUserDataPath`）：
 *   - 只看 basename 会被 `Cyrene/sub` 绕过（basename 是 sub），也看不见 appDataPath 整个躲在
 *     上游目录里面；而生产里 legacy 路径正是 `appDataPath` + `legacyDirName` 拼出来的。
 *   - 只认**完整**路径段：`cyrene-verge`、`live2d-cyrene` 都是合法目录名，必须照常能搬。
 *   - 比较前转小写，因为 Windows 路径不区分大小写，`%APPDATA%\cyrene` 就是同一个目录；
 *     每段先 `resolve` 过再拆，相对路径与尾部分隔符都不留死角。
 */
function assertMigratable(input: LegacyUserDataMigrationInput): {
  legacyDirName: string;
  markerFileName: string;
} {
  const legacyDirName = input.legacyDirName ?? LEGACY_USER_DATA_DIR_NAME;
  const markerFileName = input.markerFileName ?? MIGRATION_MARKER_FILE_NAME;
  const candidates = [
    input.appDataPath,
    path.join(input.appDataPath, legacyDirName),
    input.targetUserDataPath,
  ];
  for (const candidate of candidates) {
    const segment = findForbiddenSegment(path.resolve(candidate));
    if (segment) {
      throw new Error(`迁移被拒绝：路径段 \`${segment}\` 是上游 Cyrene 的真实用户数据，本 fork 全程只读禁写（spec §6）。命中路径：${candidate}`);
    }
  }
  return { legacyDirName, markerFileName };
}

export function migrateLegacyUserData(
  input: LegacyUserDataMigrationInput,
): LegacyUserDataMigrationResult {
  // 闸门先于任何文件系统操作：拒绝上游 Cyrene，同时把两次迁移各自的目录名/标记名定下来
  const { legacyDirName, markerFileName } = assertMigratable(input);
  const legacyPath = path.join(input.appDataPath, legacyDirName);
  if (path.resolve(legacyPath) === path.resolve(input.targetUserDataPath)) {
    return { status: "skipped" };
  }
  const markerPath = path.join(input.targetUserDataPath, markerFileName);
  if (!fs.existsSync(legacyPath)) {
    // 已有安装（含本修复之前完成迁移的用户）：目标在、旧目录不在，说明迁移已完成或从未需要。
    // 补记完成标记，以后旧版即使重新建出旧目录也不会再并入。
    if (fs.existsSync(input.targetUserDataPath) && !fs.existsSync(markerPath)) {
      writeMigrationMarker(markerPath, "none");
    }
    return { status: "none" };
  }
  if (fs.existsSync(markerPath)) {
    console.warn(`${CONSOLE_PREFIX} 已完成过用户数据迁移，忽略重新出现的旧目录（原样保留，不并入）: ${legacyPath}`);
    return { status: "already_migrated" };
  }

  // 目标不存在：整体重命名，同卷内原子完成，速度与数据完整性都有保障
  if (!fs.existsSync(input.targetUserDataPath)) {
    try {
      fs.mkdirSync(path.dirname(input.targetUserDataPath), { recursive: true });
      renameWithRetrySync(legacyPath, input.targetUserDataPath);
      console.log(`${CONSOLE_PREFIX} 用户数据目录已整体迁移: ${legacyPath} -> ${input.targetUserDataPath}`);
      writeMigrationMarker(markerPath, "renamed");
      return { status: "renamed" };
    } catch (err) {
      console.error(CONSOLE_PREFIX + " 用户数据目录整体迁移失败:", err);
      return { status: "failed" };
    }
  }

  // 两者并存（安装版用户常态：新目录里有安装器写入的文件）。
  // 旧目录是真实用户数据，逐项搬入且旧文件优先覆盖目标同名文件。
  // 被覆盖的目标条目移到备份目录而不是删除：首次迁移失败后应用以全新目录启动，
  // 用户在此期间产生的数据会在下次重试时被覆盖，留一份才能找回。
  const backupRoot = path.join(
    input.targetUserDataPath,
    OVERWRITTEN_BACKUP_DIR_NAME,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  let failures = 0;
  for (const entry of fs.readdirSync(legacyPath)) {
    const from = path.join(legacyPath, entry);
    if (RUNTIME_FILE_NAMES.has(entry)) {
      // 陈旧的运行时文件直接丢弃，保住目标目录里刚生成的版本
      try {
        fs.rmSync(from, { recursive: true, force: true });
      } catch {
        // 删不掉也无碍，留在旧目录
      }
      continue;
    }
    const to = path.join(input.targetUserDataPath, entry);
    try {
      if (fs.existsSync(to)) moveAside(to, backupRoot, entry);
      fs.renameSync(from, to);
    } catch {
      try {
        // rename 失败（文件被占用等）时退化为复制，旧目录原样保留
        fs.cpSync(from, to, { recursive: true, force: true });
      } catch (err) {
        failures += 1;
        console.warn(`${CONSOLE_PREFIX} 迁移条目失败，已保留在旧目录: ${entry}`, err);
      }
    }
  }

  // 全部搬空才移除旧目录；有残留说明还有文件被占用，留给下次重试
  try {
    if (fs.readdirSync(legacyPath).length === 0) {
      fs.rmdirSync(legacyPath);
    }
  } catch {
    // 移除失败不影响使用
  }

  const status = failures === 0 ? "merged" : "partial";
  console.log(`${CONSOLE_PREFIX} 用户数据目录合并迁移完成（${status}）: ${legacyPath} -> ${input.targetUserDataPath}`);
  // 部分失败不写标记：残留条目还在旧目录，下次启动需要继续并入
  if (status === "merged") writeMigrationMarker(markerPath, status);
  return { status };
}

/** 把即将被覆盖的目标条目移进备份目录；移不动时退回原先的删除行为，不阻断迁移。 */
function moveAside(target: string, backupRoot: string, entry: string): void {
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.renameSync(target, path.join(backupRoot, entry));
  } catch {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

/** 尽力写入完成标记；写不进去只记日志，不影响本次启动。 */
function writeMigrationMarker(markerPath: string, status: LegacyUserDataMigrationStatus): void {
  try {
    fs.writeFileSync(markerPath, JSON.stringify({ status, completedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn(CONSOLE_PREFIX + " 写入用户数据迁移完成标记失败:", err);
  }
}

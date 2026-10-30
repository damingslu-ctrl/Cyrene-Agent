/**
 * `ProfileStorePort` 的真身——订阅落盘唯一的一条路。
 *
 * 单独一个文件只为一件事：`profile-service.ts` 里不许 import `node:fs`。
 * 那边"Verge 在跑就零写入""切换失败 current 不动"这类判据只能拿假端口证；
 * 真端口在这里，判据换成真目录跑（见 profile-store-port.test.ts）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProfileStorePort } from "./profile-service";
import {
  PROFILES_FILE,
  ProfilesStoreError,
  readProfilesDoc,
  writeProfilesAtomic,
  writeTextAtomicWithBackup,
  type ProfilesDoc,
} from "./profiles-store";
import { runtimeConfigPath } from "./runtime-config";
import { SUB_MAX_BYTES } from "./subscription-fetch";

export const PROFILES_DIR = "profiles";

/**
 * 正文文件名白名单。
 *
 * 这个值是 `profiles.yaml` 里的 `file` 键——一份用户能亲手编辑的文件。字符集里不含
 * `/`、`\`、`:` 与控制字符，所以拼出来的路径必然落在目录内，`..\..\x` 这类值进不来。
 * 扩展名收 yaml/yml/json：前两个是 Verge 的写法，json 订阅确实存在（同名正文不改名）。
 */
const PROFILE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(ya?ml|json)$/i;

function checkedName(name: string): string {
  if (!PROFILE_FILE_NAME.test(name)) {
    throw new ProfilesStoreError("invalid", `订阅正文文件名不合法：${JSON.stringify(name)}`);
  }
  return name;
}

export interface ProfileStoreOptions {
  /** Verge 的数据目录：`profiles.yaml` 与 `profiles/` 都在这儿。 */
  configRoot: string;
  /** 本客户端的 userData：runtime 配置写这儿，不进 Verge 目录（spec D2 的边界）。 */
  userData: string;
  /** 注入时钟：备份名的时间戳要能钉住。 */
  now?(): Date;
}

export function createProfileStore(options: ProfileStoreOptions): ProfileStorePort {
  const docFile = path.join(options.configRoot, PROFILES_FILE);
  const profilesDir = path.join(options.configRoot, PROFILES_DIR);
  const now = () => options.now?.() ?? new Date();

  const bodyPath = (name: string) => path.join(profilesDir, checkedName(name));

  /** tmp→rename，不备份：runtime 是可再生产物，留备份只会把目录堆成历史垃圾场。 */
  const writePlain = (file: string, text: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
  };

  return {
    readDoc: () => readProfilesDoc(options.configRoot),

    writeDoc: (doc: ProfilesDoc) => writeProfilesAtomic(docFile, doc, now()),

    readProfileFile(name: string) {
      const file = bodyPath(name);
      if (!existsSync(file)) return null;
      if (!statSync(file).isFile()) return null;
      return readFileSync(file, "utf8");
    },

    writeProfileFile(name: string, text: string) {
      mkdirSync(profilesDir, { recursive: true });
      // 备份 + tmp→rename 用账本那一条：两份文件的备份名长得一样，用户才认得出是谁写的。
      writeTextAtomicWithBackup(bodyPath(name), text, now());
    },

    removeProfileFile(name: string) {
      const file = bodyPath(name);
      // 文件本来就不在＝账本记了个空指针，删成功才是想要的结果；这里不该用一次报错拦住清账。
      if (existsSync(file)) unlinkSync(file);
    },

    writeRuntime(uid: string, text: string) {
      const file = path.resolve(runtimeConfigPath(options.userData, uid));
      writePlain(file, text);
      return file;
    },
  };
}

/** 本地导入的那一口：不存在/是目录/读不动都回 null，超大直接拒（跟订阅下载同一个上限）。 */
export function readProfileSource(file: string, maxBytes: number = SUB_MAX_BYTES): string | null {
  let info;
  try {
    info = statSync(file);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (info.size > maxBytes) {
    throw new ProfilesStoreError("invalid", `订阅文件 ${info.size} 字节，超过 ${maxBytes} 字节上限，不敢整份读进来`);
  }
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

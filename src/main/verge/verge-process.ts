/**
 * 「隔壁那款在不在跑」的探测——spec D1 单写者闸门的第一道。
 *
 * 只有一处需要费神：探测本身坏了怎么办。答案是**当作在跑**（fail closed）。
 * 判错的代价不对称——多拒一次写入，用户看到一句「先退出 Clash Verge 再由我接管」，
 * 改一下就好；把人家正在使用的账本盖掉，是静默丢改动，没有回头的入口。
 *
 * `tasklist` 是 Windows 自带的；非 Windows 平台不该用这个探针（装配层按平台选实现）。
 */
import { execFileSync } from "node:child_process";

/** Verge 安装版与便携版的映像名都是这个；改名发行的不在本期覆盖（宁可拒写也不猜）。 */
export const VERGE_IMAGE = "clash-verge.exe";

/** 一次 tasklist 约 100–300ms，一次订阅操作里会被问好几遍，所以留一个短缓存。 */
export const VERGE_PROBE_TTL_MS = 2000;

/**
 * `tasklist /FO CSV /NH` 每行形如 `"clash-verge.exe","1234","Console","1","12,345 K"`。
 * 取第一列原样（大小写交给比对那一层）；不带引号开头的行（表头、空行、被本地化改坏的行）
 * 一律跳过，不参与判断。
 */
export function parseTasklistImages(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const matched = /^\s*"([^"]*)"/.exec(line);
    if (matched) names.push(matched[1].trim());
  }
  return names;
}

export function isVergeImageRunning(images: readonly string[]): boolean {
  return images.some((name) => name.toLowerCase() === VERGE_IMAGE);
}

export interface VergeProbeDeps {
  /** 返回 tasklist 的原始输出；抛错＝探测不了。单测换假的。 */
  readTasklist?(): string;
  now?(): number;
  ttlMs?: number;
}

export function createVergeRunningProbe(deps: VergeProbeDeps = {}): () => boolean {
  const readTasklist = deps.readTasklist ?? defaultReadTasklist;
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? VERGE_PROBE_TTL_MS;
  let cached: { at: number; running: boolean } | null = null;

  return () => {
    const at = now();
    if (cached && at - cached.at < ttlMs) return cached.running;
    let running: boolean;
    try {
      running = isVergeImageRunning(parseTasklistImages(readTasklist()));
    } catch {
      running = true;
    }
    cached = { at, running };
    return running;
  };
}

function defaultReadTasklist(): string {
  return execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
}

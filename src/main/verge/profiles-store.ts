/**
 * `profiles.yaml` 读写（Verge 兼容的订阅账本）。
 *
 * 这份文件是 Clash Verge 的权威账本，也是本客户端唯一的订阅落点：D1 单写者闸门在
 * 上层（verge 版在跑就不许动盘），这里只保证两件事——
 * 1) 读的时候**原样保留未知键**（Verge 会往 item 里塞 x-note、option 这类我们不懂的字段，
 *    写回去必须一个不少，否则等于替用户把隔壁那款的私有设置擦了）；
 * 2) 写的时候先备份再 tmp→rename，坏盘最多退回到上一份，不会退化成空账本。
 *
 * 读失败绝不静悄悄当成空账本：一旦当成空，下一次写就把用户全部订阅抹掉。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProfileRow } from "../../shared/subscription-types";
import { decodeSubscriptionUser } from "./controller-config";

export const PROFILES_FILE = "profiles.yaml";

/** Verge 自己的内置项：只跟着 uid 认，type 也一并兜住（有人手改过 type）。 */
const BUILTIN_UIDS = new Set(["Merge", "Script"]);
/** 只有这两种能当"当前订阅"用；附件（rules/proxies/groups/merge/script）改了不生效。 */
const SELECTABLE_TYPES = new Set(["remote", "local"]);

export interface ProfileItem {
  uid: string;
  type: string;
  name?: string | null;
  file?: string;
  desc?: string;
  url?: string;
  updated?: number;
  [key: string]: unknown;
}

export interface ProfilesDoc {
  current: string;
  items: ProfileItem[];
  [key: string]: unknown;
}

export type ProfilesStoreReason = "bad-yaml" | "bad-shape" | "not-found" | "invalid" | "uid-clash";

export class ProfilesStoreError extends Error {
  readonly reason: ProfilesStoreReason;

  constructor(reason: ProfilesStoreReason, message: string) {
    super(message);
    this.name = "ProfilesStoreError";
    this.reason = reason;
  }
}

export function randomUid(): string {
  // Verge 用 10 位 [A-Za-z0-9]；取 base62 直出，不用 UUID 截断（截断会把分布压歪）。
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function readProfilesDoc(root: string): ProfilesDoc {
  const file = path.join(root, PROFILES_FILE);
  if (!existsSync(file)) return { current: "", items: [] };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new ProfilesStoreError("bad-yaml", `${PROFILES_FILE} 读不出 YAML：${why}`);
  }
  if (raw === null || raw === undefined) return { current: "", items: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProfilesStoreError("bad-shape", `${PROFILES_FILE} 不是一份对象账本`);
  }
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.items)) {
    throw new ProfilesStoreError("bad-shape", `${PROFILES_FILE} 里没有 items 数组，不敢当空账本写回去`);
  }
  return {
    ...doc,
    current: typeof doc.current === "string" ? doc.current : "",
    items: doc.items as ProfileItem[],
  };
}

/**
 * `option` 里的两个白名单键回读。
 * 只认类型对的值：盘上被人手改歪了（`with_proxy: "no"`）就当没写过，
 * 而不是替它编一个 false——页面拿假初值去摆开关，比开关没初值更难查。
 */
function optionOf(item: ProfileItem): { withProxy: boolean | null; updateInterval: number | null } {
  const option = item.option;
  const map = typeof option === "object" && option !== null && !Array.isArray(option)
    ? option as Record<string, unknown>
    : {};
  const interval = typeof map.update_interval === "number" && Number.isInteger(map.update_interval)
    ? map.update_interval
    : null;
  return {
    withProxy: typeof map.with_proxy === "boolean" ? map.with_proxy : null,
    updateInterval: interval,
  };
}

export function listProfiles(doc: ProfilesDoc): ProfileRow[] {
  return doc.items.map((item) => {
    const uid = typeof item.uid === "string" ? item.uid : "";
    const type = typeof item.type === "string" ? item.type : "";
    const builtin = BUILTIN_UIDS.has(uid) || type === "merge" || type === "script";
    const desc = typeof item.desc === "string" && item.desc.trim() ? item.desc.trim() : null;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
    return {
      uid,
      type,
      label: desc || decodeSubscriptionUser(item.name) || name || uid,
      url: typeof item.url === "string" && item.url ? item.url : null,
      desc,
      updatedAt: typeof item.updated === "number" && item.updated > 0 ? item.updated * 1000 : null,
      current: uid !== "" && uid === doc.current,
      builtin,
      selectable: !builtin && SELECTABLE_TYPES.has(type),
      ...optionOf(item),
    };
  });
}

export interface RemoteProfileInput {
  url: string;
  desc?: string;
  name?: string | null;
  file?: string;
  /** 秒（跟盘上的 `updated` 同一个单位）。 */
  now?: number;
}

/** uid 生成器可注入：单测要演"第一次撞车、第二次成"。 */
export interface UidSource {
  uid(): string;
}

/**
 * appendItem 的入参＝账本新项去掉 uid（还没有）与 file（要等最终 uid 定了才算）。
 * 手写字段而不是 `Omit`：`ProfileItem` 带索引签名，`keyof` 摊平成 `string`，`Omit` 既会
 * 把 `type` 这类已知键一起吞掉，也会让 `file` 的「可选字符串」退化成 `unknown`。
 */
interface NewItem {
  type: string;
  name?: string | null;
  desc?: string;
  url?: string;
  updated?: number;
  file?: string;
}

function appendItem(
  doc: ProfilesDoc,
  base: NewItem,
  source: UidSource,
): { doc: ProfilesDoc; item: ProfileItem } {
  const taken = new Set(doc.items.map((entry) => entry.uid));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = source.uid();
    // 没指定文件名时，file 必须跟着**最终**的 uid 走：先按占位 uid 算好再换 uid，
    // 会留下两条订阅指向同一份正文。
    if (!taken.has(candidate)) {
      const item: ProfileItem = { ...base, uid: candidate, file: base.file ?? `${candidate}.yaml` };
      return { doc: { ...doc, items: [...doc.items, item] }, item };
    }
  }
  throw new ProfilesStoreError("uid-clash", "生成了 100 次 uid 都跟账本里现有的撞车");
}

export function withRemoteProfile(
  doc: ProfilesDoc,
  input: RemoteProfileInput,
  source: UidSource = { uid: randomUid },
): { doc: ProfilesDoc; item: ProfileItem } {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) {
    throw new ProfilesStoreError("invalid", "订阅地址得是 http(s):// 开头");
  }
  return appendItem(doc, {
    type: "remote",
    name: input.name ?? null,
    file: input.file,
    desc: input.desc ?? "",
    url,
    updated: typeof input.now === "number" ? input.now : Math.floor(Date.now() / 1000),
  }, source);
}

export interface LocalProfileInput {
  desc?: string;
  name?: string | null;
  file?: string;
  /** 秒（跟盘上的 `updated` 同一个单位）。 */
  now?: number;
}

/**
 * 本地文件导入的那一条。
 *
 * 关键是**不写 url 键**（连空串都不行）：Verge 与我们的更新逻辑都按「有 url 才去下载」判，
 * 留一个空串会让这条本地订阅每次更新都 404，用户只会看到一句读不懂的失败。
 */
export function withLocalProfile(
  doc: ProfilesDoc,
  input: LocalProfileInput,
  source: UidSource = { uid: randomUid },
): { doc: ProfilesDoc; item: ProfileItem } {
  return appendItem(doc, {
    type: "local",
    name: input.name ?? null,
    file: input.file,
    desc: input.desc ?? "",
    updated: typeof input.now === "number" ? input.now : Math.floor(Date.now() / 1000),
  }, source);
}

export function withSelected(doc: ProfilesDoc, uid: string): ProfilesDoc {
  const row = listProfiles(doc).find((entry) => entry.uid === uid);
  if (!row) throw new ProfilesStoreError("not-found", `账本里没有这个订阅 uid`);
  if (row.builtin) throw new ProfilesStoreError("invalid", `${uid} 是内置项，不能当当前订阅`);
  if (!row.selectable) throw new ProfilesStoreError("invalid", `${row.type} 是附件，不能当当前订阅`);
  return { ...doc, current: uid };
}

export function withoutProfile(doc: ProfilesDoc, uid: string): { doc: ProfilesDoc; removed: ProfileItem } {
  if (BUILTIN_UIDS.has(uid)) throw new ProfilesStoreError("invalid", `${uid} 是内置项，删不得`);
  const index = doc.items.findIndex((item) => item.uid === uid);
  if (index < 0) throw new ProfilesStoreError("not-found", `账本里没有这个订阅 uid`);
  const removed = doc.items[index];
  return {
    doc: {
      ...doc,
      current: doc.current === uid ? "" : doc.current,
      items: doc.items.filter((_, i) => i !== index),
    },
    removed,
  };
}

/** 备份名带本地时间到秒；同一秒写第二次往后加序号，绝不覆盖前一份。 */
export function backupTarget(file: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const base = `${file}.bak-mochi-${stamp}`;
  if (!existsSync(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * 「先备份、再 tmp→rename」这条写盘路只有一份：账本与订阅正文共用，
 * 这样 spec D5 的备份口径不会出现"profiles.yaml 有备份、正文没有"这种半吊子。
 */
export function writeTextAtomicWithBackup(file: string, text: string, at: Date = new Date()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, backupTarget(file, at));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

export function writeProfilesAtomic(file: string, doc: ProfilesDoc, at: Date = new Date()): void {
  // 先序列化再碰盘：循环引用一在这里炸，用户那份 profiles.yaml 就还是原样、连备份都不产。
  // lineWidth: 0 —— 订阅名是一串 base64url，被默认 80 列折行后读回来会多个空格，token 就废了。
  // aliasDuplicateObjects: false —— 关掉去重别名，共享引用（尤其是环）在序列化当场就报错。
  const text = stringifyYaml(doc, { lineWidth: 0, aliasDuplicateObjects: false });
  writeTextAtomicWithBackup(file, text, at);
}

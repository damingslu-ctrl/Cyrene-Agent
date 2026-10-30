/**
 * runtime config：订阅正文 + merge 链 + 本客户端的控制面注入，合成一份内核能直接吃的配置。
 *
 * 为什么不直接把订阅文件递给内核（`PUT /configs {path: profiles/xxx.yaml}`）：
 * 那样控制器地址、密钥、端口全靠订阅自己写，换一个订阅就把本客户端的数据面接管过去——
 * 我们的读盘与测速全断。所以必须自己生成一份，把控制面键按注入值钉死。
 *
 * merge 语义照 Clash Verge 的扩展配置（只支持 `merge` 类型，脚本与规则增强不在本期执行）：
 * - map 深合并、数组整体替换（拼接是 prepend-/append- 指令的活儿，不是默认行为）；
 * - `prepend-X`/`append-X` 按后缀找到目标键往两头拼，指令键本体不留在线上产物里；
 * - `null` 是删除键（用户就靠这个关掉 dns 之类）；
 * - 链上按顺序依次作用，后一份改的是前一份的结果；
 * - 注入永远排在链尾——扩展配置不许把 external-controller 搬走。
 */
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { ProfilesDoc } from "./profiles-store";

export const RUNTIME_DIR = "runtime";
export const BUILTIN_MERGE_UID = "Merge";

const PREPEND = "prepend-";
const APPEND = "append-";

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 只有 merge 类型能进链：script/rules/proxies/groups 这几类要靠执行 JS 或改账，本期不碰。 */
function isMergeItem(item: { type?: unknown } | undefined): boolean {
  return item !== undefined && item.type === "merge";
}

function mergeInto(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === null) {
    delete target[key];
    return;
  }
  const current = target[key];
  if (isMap(value) && isMap(current)) {
    const merged: Record<string, unknown> = { ...current };
    for (const [nested, nestedValue] of Object.entries(value)) mergeInto(merged, nested, nestedValue);
    target[key] = merged;
    return;
  }
  target[key] = clone(value);
}

function spliceList(target: Record<string, unknown>, key: string, value: unknown, prepend: boolean): void {
  const items = Array.isArray(value) ? clone(value) : [clone(value)];
  const base = Array.isArray(target[key]) ? target[key] as unknown[] : [];
  target[key] = prepend ? [...items, ...base] : [...base, ...items];
}

/** 指令键 → 目标键：`prepend-proxy-groups` → `proxy-groups`（按第一个连字符切，后缀自己带横杠）。 */
function spliceTarget(key: string): string {
  return key.slice(key.indexOf("-") + 1);
}

export function applyMergeChain(
  base: Record<string, unknown>,
  merges: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  const out = clone(base);
  for (const merge of merges) {
    if (!isMap(merge)) continue;
    for (const [key, value] of Object.entries(merge)) {
      if (key.startsWith(PREPEND)) {
        spliceList(out, spliceTarget(key), value, true);
        continue;
      }
      if (key.startsWith(APPEND)) {
        spliceList(out, spliceTarget(key), value, false);
        continue;
      }
      mergeInto(out, key, value);
    }
  }
  return out;
}

/**
 * 这个 profile 该走哪几份 merge。
 *
 * 优先级按 Verge 的账：`option.merge` 指定了就用指定的（字符串或数组），数组里非 merge
 * 类型与账本里没有的 uid 跳过；指定项一个都不剩、或压根没指定，才回落内置 `Merge`。
 * profile 本身不存在 → 空链——切换那一步会先把它拒了，这里不许替用户"凑一份"。
 */
export function mergeChainOf(doc: ProfilesDoc, uid: string): string[] {
  const items = doc.items.filter(isMap);
  const find = (candidate: string) => items.find((item) => item.uid === candidate);
  const target = find(uid);
  if (!target) return [];
  const option = isMap(target.option) ? target.option : undefined;
  const declared = option?.merge;
  const wanted = Array.isArray(declared)
    ? declared.filter((entry): entry is string => typeof entry === "string")
    : typeof declared === "string" ? [declared] : [];
  const chain = wanted.filter((candidate) => isMergeItem(find(candidate)));
  if (chain.length > 0) return chain;
  return isMergeItem(find(BUILTIN_MERGE_UID)) ? [BUILTIN_MERGE_UID] : [];
}

export interface RuntimeConfigInput {
  subscription: unknown;
  merges: ReadonlyArray<Record<string, unknown>>;
  inject: Record<string, unknown>;
}

export type RuntimeConfigResult =
  | { ok: true; doc: Record<string, unknown>; yaml: string }
  | { ok: false; reason: "bad-subscription" };

/**
 * `lineWidth: 0` 不是审美问题：YAML 默认把长标量折行，base64 的密码/token 折完再读回来
 * 中间多个空格，节点当场连不上，而且这种坏法在文件里看不出任何名堂。
 */
export function buildRuntimeConfig(input: RuntimeConfigInput): RuntimeConfigResult {
  if (!isMap(input.subscription)) return { ok: false, reason: "bad-subscription" };
  const doc = applyMergeChain(input.subscription, input.merges);
  for (const [key, value] of Object.entries(input.inject)) {
    if (value === undefined) continue;
    doc[key] = clone(value);
  }
  return { ok: true, doc, yaml: stringifyYaml(doc, { lineWidth: 0, aliasDuplicateObjects: false }) };
}

/**
 * uid 直接进文件名，而它是从 `profiles.yaml` 读回来的（用户可编辑的外部文件）——
 * 不锁字符集就等于给 `..\..\..\x` 开了口子。
 */
export function runtimeConfigPath(userData: string, uid: string): string {
  if (!/^[A-Za-z0-9]{1,64}$/.test(uid)) {
    throw new Error(`runtime 配置名不合法：${JSON.stringify(uid)}`);
  }
  return path.join(userData, RUNTIME_DIR, `${uid}.yaml`);
}

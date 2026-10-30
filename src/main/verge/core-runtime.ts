/**
 * 我们自己起的那颗内核吃的那份配置（Wave 3 T10 装配层的一块）。
 *
 * 与订阅页那条路（`profile-service.applyRuntime`）同一条合成链——正文 + merge 链 + 注入——
 * 差别只在**注入的是我们选的端口**，而且写完不去 `PUT /configs`：内核还没起来，没人可通知。
 * 之所以不复用那一份runtime 文件（`runtime/<uid>.yaml`）：那一口里钉的是 Verge 控制面上
 * 那一组端口，两组端口各写各的文件才不会互相盖掉——盖掉的后果是内核吃着 9097 的配置
 * 被我们按 17891 去敲门，然后 `not-ready`，而盘上已经看不出是谁改的。
 *
 * 控制面三键一律由这里钉死（`external-controller` / `secret` / `mixed-port`）：
 * 订阅正文里若自己写了这几样，注入排在链尾会把它们盖掉。让一个订阅决定我们的控制面
 * 等于把整条数据面的主权交出去（spec D5）。
 */
import { parse as parseYaml } from "yaml";
import { DEFAULT_MIXED_PORT, type CorePortPair } from "../../shared/core-types";
import { parseSubscriptionBody } from "./subscription-fetch";
import type { ProfilesDoc } from "./profiles-store";
import { mergeChainOf, buildRuntimeConfig } from "./runtime-config";
import { profileFileOf } from "./profile-service";

/** 我们那份 runtime 用的名字；走 `runtimeConfigPath` 那把字符集白名单，`core` 合法。 */
export const CORE_RUNTIME_UID = "core";

export interface CoreRuntimePort {
  readDoc(): ProfilesDoc;
  readProfileFile(name: string): string | null;
  writeRuntime(uid: string, text: string): string;
}

export type CoreRuntimeFailReason = "no-profile" | "profile-missing" | "bad-yaml" | "no-proxies";

export type CoreRuntimeResult =
  | { ok: true; file: string; uid: string; name: string | null; warnings: string[] }
  | { ok: false; reason: CoreRuntimeFailReason; detail: string };

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 账本里的 `name`，没有就退到 `desc`，再没有回 null——页面宁可空着也不编一个名字给用户看。 */
function nameOf(item: { name?: string | null; desc?: string } | undefined): string | null {
  if (!item) return null;
  const named = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
  if (named) return named;
  const desc = typeof item.desc === "string" && item.desc.trim() ? item.desc.trim() : null;
  return desc;
}

export function buildCoreRuntime(input: {
  port: CoreRuntimePort;
  ports: CorePortPair;
  secret: string;
}): CoreRuntimeResult {
  let doc: ProfilesDoc;
  try {
    doc = input.port.readDoc();
  } catch (error) {
    return {
      ok: false,
      reason: "bad-yaml",
      detail: `profiles.yaml 读不出来：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const uid = doc.current;
  if (!uid) {
    return { ok: false, reason: "no-profile", detail: "没有选中的订阅：先导入或启用一份，再起内核" };
  }
  const item = doc.items.find((entry) => entry.uid === uid);
  if (!item) {
    return { ok: false, reason: "profile-missing", detail: `账本里 current=${uid}，但 items 里没有这一条` };
  }
  const bodyName = profileFileOf(item);
  const text = input.port.readProfileFile(bodyName);
  if (text === null) {
    return { ok: false, reason: "profile-missing", detail: `订阅正文 ${bodyName} 不在 profiles 目录里` };
  }
  const parsed = parseSubscriptionBody(text);
  if ("reason" in parsed) {
    return {
      ok: false,
      reason: parsed.reason === "no-proxies" ? "no-proxies" : "bad-yaml",
      detail: parsed.reason === "no-proxies"
        ? `订阅正文里一个节点来源都没有（${bodyName}）`
        : `订阅正文 ${bodyName} 不是能吃的 YAML/JSON map`,
    };
  }

  const warnings: string[] = [];
  const merges: Array<Record<string, unknown>> = [];
  for (const mergeUid of mergeChainOf(doc, uid)) {
    const mergeItem = doc.items.find((entry) => entry.uid === mergeUid);
    const mergeText = mergeItem ? input.port.readProfileFile(profileFileOf(mergeItem)) : null;
    if (mergeText === null) {
      warnings.push(mergeUid);
      continue;
    }
    try {
      const mergeDoc = parseYaml(mergeText);
      if (!isMap(mergeDoc)) {
        warnings.push(mergeUid);
        continue;
      }
      merges.push(mergeDoc);
    } catch {
      warnings.push(mergeUid);
    }
  }

  const built = buildRuntimeConfig({
    subscription: parsed.doc,
    merges,
    inject: {
      // mihomo 要的是 `host:port`：把 `http://127.0.0.1:9097` 原样写进去，内核直接起不来。
      "external-controller": `127.0.0.1:${input.ports.controller}`,
      secret: input.secret,
      "mixed-port": input.ports.mixed,
    },
  });
  if (!built.ok) {
    // 上面已经确认过是 map，这条按类型走到位即可：真走到这里就是合成链自己坏了，照实报。
    return { ok: false, reason: "bad-yaml", detail: "配置合成失败（merge 链之后不再是一张 map）" };
  }

  return {
    ok: true,
    file: input.port.writeRuntime(CORE_RUNTIME_UID, built.yaml),
    uid,
    name: nameOf(item),
    warnings,
  };
}

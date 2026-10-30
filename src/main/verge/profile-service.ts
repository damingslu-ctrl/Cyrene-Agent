/**
 * 订阅写面：导入 / 更新 / 切换 / 删除 / 选项。
 *
 * 三条硬规矩都来自 spec D1+D5，单测逐条钉着：
 * 1) **单写者闸门排在一切写之前**。隔壁那款（Clash Verge）也在写同一份 profiles.yaml，
 *    两边同时写就是一场没有赢家的比赛；它在跑时这里只会返回 `verge-running`，一个字节都不落。
 * 2) **先写正文、再动账本**。账本指向一份不存在的文件＝下一条订阅切过去内核当场起不来；
 *    反过来只留一份没人认领的孤儿文件，Verge 与自己都不会读它， harmlessly 躺在那。
 * 3) **先写 runtime、再 PUT、最后才写 current**。顺序反了就会出现"账上切了、内核没切"——
 *    面板显示新订阅、流量还走旧配置，这种不一致比直接失败更难查。
 *
 * 这里不 import node:fs：所有盘操作都走 `ProfileStorePort`，"零写入"这条判据才证得起来。
 */
import { parse as parseYaml } from "yaml";
import {
  MIN_UPDATE_INTERVAL,
  PROFILE_OPTION_KEYS,
  type ProfileFailReason,
  type ProfileResult,
  type ProfileRow,
} from "../../shared/subscription-types";
import {
  ProfilesStoreError,
  listProfiles,
  withLocalProfile,
  withRemoteProfile,
  withSelected,
  withoutProfile,
  type ProfileItem,
  type ProfilesDoc,
  type UidSource,
} from "./profiles-store";
import { buildRuntimeConfig, mergeChainOf } from "./runtime-config";
import { fetchSubscription, parseSubscriptionBody, type FetchLike } from "./subscription-fetch";

/** 盘上端口：真实实现见 profile-store-port.ts，单测换假的。 */
export interface ProfileStorePort {
  readDoc(): ProfilesDoc;
  writeDoc(doc: ProfilesDoc): void;
  readProfileFile(name: string): string | null;
  writeProfileFile(name: string, text: string): void;
  removeProfileFile(name: string): void;
  /** 写 runtime 配置并把**真正落盘的路径**还回来——PUT /configs 要的就是这个字符串。 */
  writeRuntime(uid: string, text: string): string;
}

export interface ProfileServiceDeps {
  store: ProfileStorePort;
  fetch: FetchLike;
  reload(file: string): Promise<void>;
  inject(): Record<string, unknown>;
  isVergeRunning(): boolean;
  readSourceFile(path: string): string | null;
  uid?: UidSource;
  now?(): Date;
}

export interface ProfileService {
  list(): ProfileRow[];
  importUrl(input: { url: string; desc?: string }): Promise<ProfileResult>;
  importFile(input: { path: string; desc?: string }): Promise<ProfileResult>;
  update(uid: string): Promise<ProfileResult>;
  select(uid: string): Promise<ProfileResult>;
  remove(uid: string): Promise<ProfileResult>;
  setOption(uid: string, patch: Record<string, unknown>): Promise<ProfileResult>;
}

/** 白名单与下限都在 shared：页面照着同一张表摆开关，两边各抄一份迟早有一边先放行。 */
const OPTION_KEYS = new Set<string>(PROFILE_OPTION_KEYS);

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 正文文件名：账本里的 `file` 优先，缺失才按 uid 推（Verge 自己两条都写）。 */
function fileOf(item: ProfileItem): string {
  return typeof item.file === "string" && item.file ? item.file : `${item.uid}.yaml`;
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const nowSeconds = () => Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);

  const rowsOf = (doc: ProfilesDoc): ProfileRow[] => listProfiles(doc);

  /** 拒绝时也要把当前列表带回去：页面不能因为一次失败变成空白。 */
  const fail = (reason: ProfileFailReason, extra: { detail?: string; status?: number; replaced?: boolean } = {}): ProfileResult => {
    let rows: ProfileRow[] = [];
    try {
      rows = rowsOf(deps.store.readDoc());
    } catch {
      // 读不出账本正是失败原因的一部分，别在这里再抛一次
    }
    return { ok: false, reason, rows, ...extra };
  };

  const storeError = (error: unknown): ProfileResult => {
    if (error instanceof ProfilesStoreError) return fail(error.reason, { detail: error.message });
    return fail("bad-yaml", { detail: messageOf(error) });
  };

  const gated = (): ProfileResult | null => (deps.isVergeRunning() ? fail("verge-running") : null);

  /**
   * 订阅正文 + merge 链 + 注入 → runtime 落盘 → PUT /configs。
   * 返回 null 表示这条路走通了（调用方接着去写 current）；否则原样把失败递出去。
   */
  const applyRuntime = async (
    doc: ProfilesDoc,
    uid: string,
    subscriptionText: string,
  ): Promise<{ warnings: string[] } | ProfileResult> => {
    const parsed = parseSubscriptionBody(subscriptionText);
    if ("reason" in parsed) return fail(parsed.reason);
    const warnings: string[] = [];
    const merges: Array<Record<string, unknown>> = [];
    for (const mergeUid of mergeChainOf(doc, uid)) {
      const mergeItem = doc.items.find((entry) => entry.uid === mergeUid);
      const text = mergeItem ? deps.store.readProfileFile(fileOf(mergeItem)) : null;
      if (text === null) {
        warnings.push(mergeUid);
        continue;
      }
      try {
        const mergeDoc = parseYaml(text);
        if (!isMap(mergeDoc)) { warnings.push(mergeUid); continue; }
        merges.push(mergeDoc);
      } catch {
        warnings.push(mergeUid);
      }
    }
    /**
     * 控制面注入是唯一允许抛错的一步：装配层读不出 `clash-verge.yaml` 里的控制器地址时，
     * 宁可不写也不能塞一份空的进去——那样订阅自己写的 external-controller 就活了下来，
     * 换一个订阅等于把本客户端的数据面主权交出去（spec D5）。抛在这里也保证了零写入。
     */
    let injected: Record<string, unknown>;
    try {
      injected = deps.inject();
    } catch (error) {
      return storeError(error);
    }
    const built = buildRuntimeConfig({ subscription: parsed.doc, merges, inject: injected });
    if (!built.ok) return fail(built.reason);
    const file = deps.store.writeRuntime(uid, built.yaml);
    try {
      await deps.reload(file);
    } catch (error) {
      return fail("reload-failed", { detail: messageOf(error) });
    }
    return { warnings };
  };

  const writeLedger = (next: ProfilesDoc, warnings: string[], extra: { uid?: string; proxyCount?: number } = {}): ProfileResult => {
    try {
      deps.store.writeDoc(next);
    } catch (error) {
      return fail("write-failed", { detail: messageOf(error) });
    }
    return { ok: true, rows: rowsOf(next), warnings, ...extra };
  };

  return {
    list: () => rowsOf(deps.store.readDoc()),

    async importUrl({ url, desc }) {
      const blocked = gated();
      if (blocked) return blocked;
      // 先探一眼账本：读不出来就根本不该去下载。下载最长 20 秒，
      // 拿一场注定失败的下载占着用户的上行，是比报晚一步更难受的错法。
      // （下载完还要再读一次：这 20 秒里账本可能变了，用旧快照写回会静默盖掉别人的改动。）
      try {
        deps.store.readDoc();
      } catch (error) {
        return storeError(error);
      }
      const fetched = await fetchSubscription(url, { fetch: deps.fetch });
      if (!fetched.ok) return fail(fetched.reason, { status: fetched.status });
      let added: { doc: ProfilesDoc; item: ProfileItem };
      try {
        added = withRemoteProfile(deps.store.readDoc(), { url, desc, now: nowSeconds() }, deps.uid);
      } catch (error) {
        return storeError(error);
      }
      deps.store.writeProfileFile(fileOf(added.item), fetched.text);
      return writeLedger(added.doc, [], { uid: added.item.uid, proxyCount: fetched.proxyCount });
    },

    async importFile({ path, desc }) {
      const blocked = gated();
      if (blocked) return blocked;
      let text: string | null;
      try {
        text = deps.readSourceFile(path);
      } catch (error) {
        return fail("read-failed", { detail: messageOf(error) });
      }
      if (text === null) return fail("read-failed", { detail: `读不到 ${path}` });
      const parsed = parseSubscriptionBody(text);
      if ("reason" in parsed) return fail(parsed.reason);
      let added: { doc: ProfilesDoc; item: ProfileItem };
      try {
        added = withLocalProfile(deps.store.readDoc(), { desc, now: nowSeconds() }, deps.uid);
      } catch (error) {
        return storeError(error);
      }
      deps.store.writeProfileFile(fileOf(added.item), text);
      return writeLedger(added.doc, [], { uid: added.item.uid, proxyCount: parsed.doc.proxies && Array.isArray(parsed.doc.proxies) ? parsed.doc.proxies.length : 0 });
    },

    async update(uid) {
      const blocked = gated();
      if (blocked) return blocked;
      let doc: ProfilesDoc;
      try {
        doc = deps.store.readDoc();
      } catch (error) {
        return storeError(error);
      }
      const item = doc.items.find((entry) => entry.uid === uid);
      if (!item) return fail("not-found");
      const row = listProfiles(doc).find((entry) => entry.uid === uid);
      if (!row || row.builtin || !row.selectable) return fail("invalid");
      const url = typeof item.url === "string" && item.url ? item.url : null;
      if (url === null) return fail("invalid", { detail: "本地订阅没有可下载的地址" });
      const fetched = await fetchSubscription(url, { fetch: deps.fetch });
      if (!fetched.ok) return fail(fetched.reason, { status: fetched.status });
      deps.store.writeProfileFile(fileOf(item), fetched.text);
      const isCurrent = doc.current === uid;
      if (isCurrent) {
        const applied = await applyRuntime(doc, uid, fetched.text);
        if ("ok" in applied && applied.ok === false) {
          // 正文已经换新了，这一点必须告诉用户：回滚还是重试，是他的决定。
          return { ...applied, replaced: true };
        }
      }
      const next: ProfilesDoc = {
        ...doc,
        items: doc.items.map((entry) => (entry.uid === uid ? { ...entry, updated: nowSeconds() } : entry)),
      };
      return writeLedger(next, [], { uid, proxyCount: fetched.proxyCount });
    },

    async select(uid) {
      const blocked = gated();
      if (blocked) return blocked;
      let doc: ProfilesDoc;
      try {
        doc = deps.store.readDoc();
      } catch (error) {
        return storeError(error);
      }
      const item = doc.items.find((entry) => entry.uid === uid);
      if (!item) return fail("not-found");
      const row = listProfiles(doc).find((entry) => entry.uid === uid);
      if (!row || !row.selectable) return fail("invalid");
      const text = deps.store.readProfileFile(fileOf(item));
      if (text === null) return fail("profile-missing", { detail: `${fileOf(item)} 不在 profiles 目录里` });
      const applied = await applyRuntime(doc, uid, text);
      if ("ok" in applied && applied.ok === false) return applied;
      let next: ProfilesDoc;
      try {
        next = withSelected(doc, uid);
      } catch (error) {
        return storeError(error);
      }
      return writeLedger(next, applied.warnings, { uid });
    },

    async remove(uid) {
      const blocked = gated();
      if (blocked) return blocked;
      let doc: ProfilesDoc;
      try {
        doc = deps.store.readDoc();
      } catch (error) {
        return storeError(error);
      }
      let removed: { doc: ProfilesDoc; removed: ProfileItem };
      try {
        removed = withoutProfile(doc, uid);
      } catch (error) {
        return storeError(error);
      }
      // 先清账再删文件；两份订阅共用一个 file 时（用户手抄过账本）文件必须留着。
      const result = writeLedger(removed.doc, []);
      if (!result.ok) return result;
      const file = typeof removed.removed.file === "string" && removed.removed.file ? removed.removed.file : null;
      const shared = file !== null && removed.doc.items.some((entry) => entry.file === file);
      if (file !== null && !shared) deps.store.removeProfileFile(file);
      return result;
    },

    async setOption(uid, patch) {
      const blocked = gated();
      if (blocked) return blocked;
      const keys = Object.keys(patch);
      if (keys.length === 0 || keys.some((key) => !OPTION_KEYS.has(key))) {
        return fail("invalid", { detail: `只接受 ${[...OPTION_KEYS].join(" / ")}` });
      }
      if ("with_proxy" in patch && typeof patch.with_proxy !== "boolean") return fail("invalid");
      if ("update_interval" in patch) {
        const value = patch.update_interval;
        if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_UPDATE_INTERVAL) {
          return fail("invalid", { detail: `更新间隔至少 ${MIN_UPDATE_INTERVAL} 秒` });
        }
      }
      let doc: ProfilesDoc;
      try {
        doc = deps.store.readDoc();
      } catch (error) {
        return storeError(error);
      }
      if (!doc.items.some((entry) => entry.uid === uid)) return fail("not-found");
      const next: ProfilesDoc = {
        ...doc,
        items: doc.items.map((entry) => {
          if (entry.uid !== uid) return entry;
          const option = isMap(entry.option) ? entry.option : {};
          return { ...entry, option: { ...option, ...patch } };
        }),
      };
      return writeLedger(next, [], { uid });
    },
  };
}

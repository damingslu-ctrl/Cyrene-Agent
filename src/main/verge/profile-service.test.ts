/**
 * profile-service 的单测（Wave 2 的写面）。
 *
 * 全部走注入的假盘端口：这个模块唯一被允许碰真盘的地方是装配层的适配器，
 * 单测里出现 node:fs 就意味着"零写入"这条判据没法证——而它是 D1 单写者闸门的全部意义。
 */
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createProfileService,
  type ProfileServiceDeps,
  type ProfileStorePort,
} from "./profile-service";
import { ProfilesStoreError, type ProfilesDoc } from "./profiles-store";
import type { FetchLike, ResponseLike } from "./subscription-fetch";

const SUB_TEXT = `proxies:
- name: 节点A
  type: ss
  server: 1.2.3.4
proxy-groups:
- name: 🚀 节点选择
  type: select
  proxies: [节点A]
rules:
- MATCH
external-controller: 127.0.0.1:9090
mixed-port: 7890
`;

const INJECT = { "external-controller": "127.0.0.1:7897", secret: "mochi-key", "mixed-port": 7895 };

interface FakeStore extends ProfileStorePort {
  doc: ProfilesDoc;
  files: Map<string, string>;
  /** 按发生顺序记下的写入，用来证明"谁先谁后"和"根本没动盘"。 */
  log: string[];
  runtime: Array<{ uid: string; text: string }>;
  removed: string[];
  docWrites: number;
}

function fakeStore(doc: ProfilesDoc): FakeStore {
  const store = {
    doc,
    docWrites: 0,
    // 假盘必须跟假账本对得上：账本里写了 Sub00000002.yaml 与 Merge.yaml，盘上就得有，
    // 否则"切换"这条 tests 全在演 profile-missing，钉不住真正的顺序判据。
    files: new Map<string, string>([
      ["Sub00000001.yaml", SUB_TEXT],
      ["Sub00000002.yaml", SUB_TEXT],
      ["Merge.yaml", "dns:\n  enable: true\n"],
    ]),
    log: [] as string[],
    runtime: [] as Array<{ uid: string; text: string }>,
    removed: [] as string[],
    readDoc: () => structuredClone(store.doc),
    readProfileFile: (name: string) => store.files.get(name) ?? null,
    writeProfileFile: (name: string, text: string) => {
      store.log.push(`profile:${name}`);
      store.files.set(name, text);
    },
    removeProfileFile: (name: string) => {
      store.log.push(`unlink:${name}`);
      store.removed.push(name);
      store.files.delete(name);
    },
    writeRuntime: (uid: string, text: string) => {
      store.log.push(`runtime:${uid}`);
      store.runtime.push({ uid, text });
      return `runtime/${uid}.yaml`;
    },
    writeDoc: (next: ProfilesDoc) => {
      store.log.push("doc");
      store.docWrites += 1;
      store.doc = next;
    },
  } as FakeStore;
  return store;
}

function fakeFetch(text: string, init?: Partial<ResponseLike>): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      headers: new Map([["content-length", String(Buffer.byteLength(text))]]),
      text: async () => text,
      ...init,
    } as ResponseLike;
  };
  return { fetch, urls };
}

const failingFetch: FetchLike = async () => {
  throw new Error("unreachable");
};

function setup(overrides: Partial<ProfileServiceDeps> = {}) {
  const store = fakeStore({
    current: "Sub00000001",
    items: [
      { uid: "Merge", type: "merge", file: "Merge.yaml" },
      { uid: "Script", type: "script", file: "Script.js" },
      { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://api.example.test/sub", "x-note": "隔壁那款的私有字段" },
      { uid: "Sub00000002", type: "remote", file: "Sub00000002.yaml", url: "https://api.example.test/other" },
    ],
  });
  const reloads: string[] = [];
  let reloadError: Error | null = null;
  const deps: ProfileServiceDeps = {
    store,
    fetch: fakeFetch(SUB_TEXT).fetch,
    reload: async (file) => {
      if (reloadError) throw reloadError;
      reloads.push(file);
    },
    inject: () => INJECT,
    isVergeRunning: () => false,
    uid: { uid: () => "NewSub00001" },
    now: () => new Date("2026-10-30T10:00:00"),
    ...overrides,
  };
  const service = createProfileService(deps);
  return { service, store, reloads, failReload: (error: Error | null) => { reloadError = error; } };
}

describe("profile-service 单写者闸门（D1）", () => {
  it("Verge 在跑：六个写口子全部拒绝，盘上一个字节都不动、内核也不碰", async () => {
    const { service, store, reloads } = setup({ isVergeRunning: () => true });
    const attempts = await Promise.all([
      service.importUrl({ url: "https://api.example.test/sub" }),
      service.importFile({ path: "D:/x/sub.yaml" }),
      service.update("Sub00000001"),
      service.select("Sub00000002"),
      service.remove("Sub00000002"),
      service.setOption("Sub00000001", { with_proxy: true }),
    ]);
    for (const res of attempts) {
      expect(res.ok).toBe(false);
      expect((res as { reason: string }).reason).toBe("verge-running");
    }
    expect(store.log).toEqual([]);
    expect(reloads).toEqual([]);
  });

  it("闸门只挡写：Verge 在跑时列表照样读得出（页面不能变成空白）", () => {
    const { service } = setup({ isVergeRunning: () => true });
    const rows = service.list();
    expect(rows.map((row) => row.uid)).toEqual(["Merge", "Script", "Sub00000001", "Sub00000002"]);
    expect(rows.find((row) => row.uid === "Merge")?.builtin).toBe(true);
  });
});

describe("profile-service 切换", () => {
  it("顺序钉死：runtime 落盘 → PUT /configs → 才把 current 写回账本", async () => {
    const { service, store, reloads } = setup();
    const res = await service.select("Sub00000002");
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["runtime:Sub00000002", "doc"]);
    expect(reloads).toHaveLength(1);
    expect(store.doc.current).toBe("Sub00000002");
  });

  it("PUT 失败：账本一个字节不动，绝不留下「账上切了、内核没切」", async () => {
    const { service, store, failReload } = setup();
    failReload(new Error("controller rejected"));
    const res = await service.select("Sub00000002");
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("reload-failed");
    expect(store.doc.current).toBe("Sub00000001");
    expect(store.log).toEqual(["runtime:Sub00000002"]);
  });

  it("注入拿不到控制面＝拒绝切换：零写入，失败也带着当前列表", async () => {
    const { service, store, reloads } = setup({
      inject: () => {
        throw new ProfilesStoreError("invalid", "读不到控制面配置：clash-verge.yaml 里没有本机 external-controller");
      },
    });
    const res = await service.select("Sub00000002");
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("invalid");
    expect((res as { detail?: string }).detail).toMatch(/控制面/);
    expect((res as { rows: Array<{ uid: string }> }).rows.map((row) => row.uid)).toContain("Sub00000001");
    expect(store.log).toEqual([]);
    expect(reloads).toEqual([]);
  });

  it("注入排在链尾：runtime 里读回的控制器是本客户端的，不是订阅自己写的", async () => {
    const { service, store } = setup();
    await service.select("Sub00000002");
    const written = parseYaml(store.runtime[0].text) as Record<string, unknown>;
    expect(written["external-controller"]).toBe("127.0.0.1:7897");
    expect(written.secret).toBe("mochi-key");
    expect(written["mixed-port"]).toBe(7895);
    expect(written.proxies).toBeDefined();
  });

  it("内置项与附件（merge 类型）不许当当前订阅，且零写入", async () => {
    const { service, store } = setup();
    const merge = await service.select("Merge");
    expect((merge as { reason: string }).reason).toBe("invalid");
    const script = await service.select("Script");
    expect((script as { reason: string }).reason).toBe("invalid");
    expect(store.log).toEqual([]);
  });

  it("账本里没有的 uid → not-found，零写入", async () => {
    const { service, store } = setup();
    const res = await service.select("Ghost0000000");
    expect((res as { reason: string }).reason).toBe("not-found");
    expect(store.log).toEqual([]);
  });

  it("订阅正文不在盘上：profile-missing，不生成 runtime 也不 PUT", async () => {
    const { service, store, reloads } = setup();
    store.files.delete("Sub00000002.yaml");
    const res = await service.select("Sub00000002");
    expect((res as { reason: string }).reason).toBe("profile-missing");
    expect(store.log).toEqual([]);
    expect(reloads).toEqual([]);
  });

  it("merge 文件被人删了不拦切换：照样切过去，warning 里点名丢了哪一份", async () => {
    const { service, store } = setup();
    store.doc = {
      ...store.doc,
      items: store.doc.items.map((item) =>
        item.uid === "Sub00000002" ? { ...item, option: { merge: "Merge" } } : item,
      ),
    };
    store.files.delete("Merge.yaml");
    const res = await service.select("Sub00000002");
    expect(res.ok).toBe(true);
    expect((res as { warnings: string[] }).warnings).toContain("Merge");
  });

  it("切换后读回来的 current 以盘上为准：账本写失败要说 reload-failed 之外的真原因", async () => {
    const store = fakeStore({ current: "", items: [{ uid: "Sub00000002", type: "remote", file: "Sub00000002.yaml" }] });
    store.files.set("Sub00000002.yaml", SUB_TEXT);
    store.writeDoc = () => { throw new Error("EBUSY: resource busy"); };
    const service = createProfileService({
      store,
      fetch: failingFetch,
      reload: async () => {},
      inject: () => INJECT,
      isVergeRunning: () => false,
    });
    const res = await service.select("Sub00000002");
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("write-failed");
    expect((res as { detail?: string }).detail).toContain("EBUSY");
    // 盘上那份 profiles.yaml 没被换过：写尝试记在 docWrites，log 只剩 runtime。
    expect(store.docWrites).toBe(0);
    expect(store.log).toEqual(["runtime:Sub00000002"]);
  });
});

describe("profile-service 导入", () => {
  it("URL 导入：先落正文再记账，未知字段一个不少地带回去", async () => {
    const { service, store } = setup();
    const res = await service.importUrl({ url: "https://api.example.test/new", desc: "备用机场" });
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["profile:NewSub00001.yaml", "doc"]);
    const added = store.doc.items.find((item) => item.uid === "NewSub00001");
    expect(added).toMatchObject({ type: "remote", file: "NewSub00001.yaml", url: "https://api.example.test/new", desc: "备用机场" });
    expect(added?.updated).toBe(Math.floor(new Date("2026-10-30T10:00:00").getTime() / 1000));
    // 老条目的 x-note 与内置项都还在：写回的是整份账本，不是我们认得的那几个键。
    expect(store.doc.items.find((item) => item.uid === "Sub00000001")?.["x-note"]).toBe("隔壁那款的私有字段");
    expect(store.doc.current).toBe("Sub00000001");
  });

  it("导入不会替用户改当前订阅（切不切是另一个按钮）", async () => {
    const { service, store } = setup();
    await service.importUrl({ url: "https://api.example.test/new" });
    expect(store.doc.current).toBe("Sub00000001");
  });

  it("下载失败：连正文文件都不写，更不动账本", async () => {
    const { service, store } = setup({ fetch: () => Promise.resolve({
      ok: false, status: 502, headers: new Map(), text: async () => "bad gateway",
    } as unknown as ResponseLike) });
    const res = await service.importUrl({ url: "https://api.example.test/new" });
    expect((res as { reason: string }).reason).toBe("http-status");
    expect((res as { status?: number }).status).toBe(502);
    expect(store.log).toEqual([]);
  });

  it("非订阅内容（没有节点来源）拒绝入库，不给一份切过去就起不来的账", async () => {
    const { service, store } = setup({ fetch: fakeFetch("port: 7890\nmode: rule\n").fetch });
    const res = await service.importUrl({ url: "https://api.example.test/new" });
    expect((res as { reason: string }).reason).toBe("no-proxies");
    expect(store.log).toEqual([]);
  });

  it("本地文件导入：type=local、不落 url，读的是用户给的那条路径", async () => {
    const read: string[] = [];
    const { service, store } = setup({
      readSourceFile: (file) => { read.push(file); return SUB_TEXT; },
    });
    const res = await service.importFile({ path: "D:/downloads/my.yaml" });
    expect(res.ok).toBe(true);
    expect(read).toEqual(["D:/downloads/my.yaml"]);
    const added = store.doc.items.find((item) => item.uid === "NewSub00001");
    expect(added?.type).toBe("local");
    // 本地导入没有 url：写了空串，Verge 那边会把这条当远程订阅去更新，当场 404。
    expect(added?.url).toBeUndefined();
    expect("url" in (added ?? {})).toBe(false);
    expect(added?.file).toBe("NewSub00001.yaml");
  });

  it("本地文件读不出来 → read-failed，零写入", async () => {
    const { service, store } = setup({
      readSourceFile: () => { throw new Error("ENOENT: no such file"); },
    });
    const res = await service.importFile({ path: "D:/nope.yaml" });
    expect((res as { reason: string }).reason).toBe("read-failed");
    expect(store.log).toEqual([]);
  });

  it("uid 撞车就再生一个（100 次以内是纯模块的事，这里只管用）", async () => {
    let n = 0;
    const { service, store } = setup({ uid: { uid: () => (n++ === 0 ? "Sub00000001" : "Fresh000001") } });
    const res = await service.importUrl({ url: "https://api.example.test/new" });
    expect(res.ok).toBe(true);
    expect(store.doc.items.map((item) => item.uid)).toContain("Fresh000001");
    expect(store.log).toEqual(["profile:Fresh000001.yaml", "doc"]);
  });

  it("坏地址不开口：非 http(s) 的 url 直接 bad-url", async () => {
    const { service, store } = setup();
    const res = await service.importUrl({ url: "file:///C:/Windows/win.ini" });
    expect((res as { reason: string }).reason).toBe("bad-url");
    expect(store.log).toEqual([]);
  });
});

describe("profile-service 更新", () => {
  it("非当前订阅：只换正文并记 updated，不生成 runtime、不碰内核", async () => {
    const { service, store, reloads } = setup();
    const res = await service.update("Sub00000002");
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["profile:Sub00000002.yaml", "doc"]);
    expect(reloads).toEqual([]);
    expect(store.doc.items.find((item) => item.uid === "Sub00000002")?.updated)
      .toBe(Math.floor(new Date("2026-10-30T10:00:00").getTime() / 1000));
  });

  it("当前订阅：换完正文要重新生成 runtime 并 PUT，否则用户看到的还是旧节点", async () => {
    const { service, store, reloads } = setup();
    const res = await service.update("Sub00000001");
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["profile:Sub00000001.yaml", "runtime:Sub00000001", "doc"]);
    expect(reloads).toHaveLength(1);
  });

  it("更新成功但内核没吃进去：实话报 reload-failed，正文已换要标出来（回滚得让用户知道）", async () => {
    const { service, store, failReload } = setup();
    failReload(new Error("502 from mihomo"));
    const res = await service.update("Sub00000001");
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("reload-failed");
    expect((res as { detail?: string }).detail).toContain("502");
    expect(store.log).toEqual(["profile:Sub00000001.yaml", "runtime:Sub00000001"]);
    expect(store.doc.current).toBe("Sub00000001");
  });

  it("没有 url 的订阅（本地导入的）点更新 → invalid，零写入", async () => {
    const { service, store } = setup();
    store.doc = {
      ...store.doc,
      items: [...store.doc.items, { uid: "Local00001", type: "local", file: "Local00001.yaml" }],
    };
    store.files.set("Local00001.yaml", SUB_TEXT);
    const res = await service.update("Local00001");
    expect((res as { reason: string }).reason).toBe("invalid");
    expect(store.log).toEqual([]);
  });

  it("内置项不更新", async () => {
    const { service, store } = setup();
    const res = await service.update("Merge");
    expect((res as { reason: string }).reason).toBe("invalid");
    expect(store.log).toEqual([]);
  });
});

describe("profile-service 删除", () => {
  it("内置项删不得（Merge/Script 是 Verge 的地板）", async () => {
    for (const uid of ["Merge", "Script"]) {
      const { service, store } = setup();
      const res = await service.remove(uid);
      expect((res as { reason: string }).reason).toBe("invalid");
      expect(store.log).toEqual([]);
    }
  });

  it("先清 current 指向、再删文件：不能留一份账本指向不存在的订阅", async () => {
    const { service, store } = setup();
    const res = await service.remove("Sub00000001");
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["doc", "unlink:Sub00000001.yaml"]);
    expect(store.doc.current).toBe("");
    expect(store.doc.items.map((item) => item.uid)).toEqual(["Merge", "Script", "Sub00000002"]);
  });

  it("删非当前订阅：账本里的 current 不动", async () => {
    const { service, store } = setup();
    await service.remove("Sub00000002");
    expect(store.log).toEqual(["doc", "unlink:Sub00000002.yaml"]);
    expect(store.doc.current).toBe("Sub00000001");
  });

  it("账本里 file 撞名（两条指向同一份正文）时不许把文件删掉", async () => {
    const { service, store } = setup();
    store.doc = {
      ...store.doc,
      items: [...store.doc.items, { uid: "Twin0000001", type: "local", file: "Sub00000002.yaml" }],
    };
    const res = await service.remove("Sub00000002");
    expect(res.ok).toBe(true);
    expect(store.log).toEqual(["doc"]);
  });
});

describe("profile-service 选项白名单", () => {
  it("with_proxy / update_interval 能写，别的键一律拒绝", async () => {
    const { service, store } = setup();
    const ok = await service.setOption("Sub00000001", { with_proxy: true, update_interval: 3600 });
    expect(ok.ok).toBe(true);
    expect(store.doc.items.find((item) => item.uid === "Sub00000001")?.option)
      .toEqual({ with_proxy: true, update_interval: 3600 });

    store.docWrites = 0;
    const bad = await service.setOption("Sub00000001", { "external-controller": "0.0.0.0:1" });
    expect((bad as { reason: string }).reason).toBe("invalid");
    expect(store.docWrites).toBe(0);
  });

  it("更新间隔有下限：0 秒等于把用户挂在上游下载洪水里", async () => {
    const { service, store } = setup();
    const res = await service.setOption("Sub00000001", { update_interval: 0 });
    expect((res as { reason: string }).reason).toBe("invalid");
    expect(store.docWrites).toBe(0);
  });
});

describe("profile-service 账本读不出来的样子", () => {
  it("profiles.yaml 是坏的：报 bad-yaml，写口子全关（拿空账本写回去等于抹掉用户订阅）", async () => {
    const store = fakeStore({ current: "", items: [] });
    store.readDoc = () => {
      throw new ProfilesStoreError("bad-yaml", "profiles.yaml 读不出来");
    };
    const service = createProfileService({
      store,
      fetch: failingFetch,
      reload: async () => {},
      inject: () => INJECT,
      isVergeRunning: () => false,
    });
    expect(() => service.list()).toThrow();
    const res = await service.importUrl({ url: "https://api.example.test/new" });
    expect((res as { reason: string }).reason).toBe("bad-yaml");
    expect(store.log).toEqual([]);
  });
});

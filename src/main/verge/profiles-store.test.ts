import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  listProfiles,
  PROFILES_FILE,
  ProfilesStoreError,
  randomUid,
  readProfilesDoc,
  withRemoteProfile,
  withSelected,
  withoutProfile,
  writeProfilesAtomic,
} from "./profiles-store";

const dirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "verge-profiles-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const AT = new Date(2026, 9, 29, 15, 30, 0);

/** 真机 profiles.yaml 的形状：Merge/Script 内置、附件项、remote 带 token/selected/option。 */
const REAL_SHAPE = `# Profiles Config for Clash Verge

current: OldUid00001
items:
- uid: Merge
  type: merge
  name: null
  file: Merge.yaml
  updated: 1784885855
- uid: Script
  type: script
  name: null
  file: Script.js
  updated: 1784885855
- uid: AttachRules
  type: rules
  name: null
  file: AttachRules.yaml
  updated: 1791360470
- uid: OldUid00001
  type: remote
  name: eyJ1IjoiZGVmb25kIiwiZSI6MTc5NDE4OTk1OTM5OCwicyI6IjA3MzFmNGMyZTNkYWRiYWQifQ
  file: OldUid00001.yaml
  desc: ''
  url: https://example.test/sub/old
  selected:
  - name: 🚀 节点选择
    now: 专享-橘子-域名优选01
  extra:
    upload: 0
    download: 0
    total: 1098412116148224
    expire: 1794189959
  updated: 1793231977
  option:
    with_proxy: false
    update_interval: 720
    merge: AttachMerge
  x-note: keep-me
- uid: NewUid00002
  type: remote
  name: null
  file: NewUid00002.yaml
  desc: 备用机场
  url: https://example.test/sub/new
  updated: 1793231978
extraRoot: keep-root
`;

function seedReal(): string {
  const root = freshRoot();
  writeFileSync(path.join(root, PROFILES_FILE), REAL_SHAPE, "utf8");
  return root;
}

describe("profiles-store 读取与展示", () => {
  it("读真形状：current、条目与未知字段都在；Merge/Script 是内置不可选，附件项不可选", () => {
    const root = seedReal();
    const doc = readProfilesDoc(root);
    expect(doc.current).toBe("OldUid00001");
    expect(doc.extraRoot).toBe("keep-root");
    expect(doc.items).toHaveLength(5);

    const rows = listProfiles(doc);
    expect(rows.map((r) => r.uid)).toEqual([
      "Merge", "Script", "AttachRules", "OldUid00001", "NewUid00002",
    ]);
    const merge = rows.find((r) => r.uid === "Merge")!;
    expect(merge.builtin).toBe(true);
    expect(merge.selectable).toBe(false);
    const rules = rows.find((r) => r.uid === "AttachRules")!;
    expect(rules.selectable).toBe(false);

    const old = rows.find((r) => r.uid === "OldUid00001")!;
    expect(old.current).toBe(true);
    expect(old.selectable).toBe(true);
    expect(old.label).toBe("defond");
    expect(old.updatedAt).toBe(1793231977 * 1000);
    const fresh = rows.find((r) => r.uid === "NewUid00002")!;
    expect(fresh.current).toBe(false);
    expect(fresh.label).toBe("备用机场");
  });

  it("option 里那两个白名单键要读得回来：页面开关没有初值就是在说谎", () => {
    const rows = listProfiles(readProfilesDoc(seedReal()));
    const old = rows.find((r) => r.uid === "OldUid00001")!;
    expect(old.withProxy).toBe(false);
    expect(old.updateInterval).toBe(720);
    // 没写 option 的条目是「跟随默认」，不是 false / 0——那是两种不同的盘上状态。
    const fresh = rows.find((r) => r.uid === "NewUid00002")!;
    expect(fresh.withProxy).toBeNull();
    expect(fresh.updateInterval).toBeNull();
  });

  it("option 形状歪了只丢那一个键，别把整行读成空", () => {
    const doc = readProfilesDoc(seedReal());
    doc.items = doc.items.map((item) => (item.uid !== "OldUid00001" ? item : {
      ...item,
      option: { with_proxy: "no", update_interval: 12.5, merge: "AttachMerge" },
    }));
    const row = listProfiles(doc).find((r) => r.uid === "OldUid00001")!;
    expect(row.withProxy).toBeNull();
    expect(row.updateInterval).toBeNull();
    expect(row.selectable).toBe(true);
  });

  it("坏 YAML 直接报错，绝不悄悄当成空账本（会把用户订阅整页抹掉）", () => {
    const root = freshRoot();
    writeFileSync(path.join(root, PROFILES_FILE), "current: [unclosed", "utf8");
    expect(() => readProfilesDoc(root)).toThrowError(ProfilesStoreError);
    try {
      readProfilesDoc(root);
    } catch (error) {
      expect((error as ProfilesStoreError).reason).toBe("bad-yaml");
    }
  });

  it("文件不存在当空账本；items 不是数组也当坏账本", () => {
    expect(readProfilesDoc(freshRoot())).toEqual({ current: "", items: [] });
    const root = freshRoot();
    writeFileSync(path.join(root, PROFILES_FILE), "current: x\nitems: nope\n", "utf8");
    expect(() => readProfilesDoc(root)).toThrowError(ProfilesStoreError);
  });
});

describe("profiles-store 增删选", () => {
  it("加订阅：uid 10 位、追加到末尾、file 默认 <uid>.yaml、name 默认 null、保留未知字段", () => {
    const doc = readProfilesDoc(seedReal());
    const { doc: next, item } = withRemoteProfile(doc, {
      url: "https://example.test/sub/third",
      desc: "第三家",
      now: 1793231999,
    }, { uid: () => "AbCdEf1234" });
    expect(item).toMatchObject({
      uid: "AbCdEf1234", type: "remote", name: null, file: "AbCdEf1234.yaml",
      desc: "第三家", url: "https://example.test/sub/third", updated: 1793231999,
    });
    expect(next.current).toBe("OldUid00001");
    expect(next.extraRoot).toBe("keep-root");
    expect(next.items).toHaveLength(doc.items.length + 1);
    expect(next.items[next.items.length - 1].uid).toBe("AbCdEf1234");
  });

  it("uid 撞车要换一个；一直撞满 100 次才报错", () => {
    const doc = readProfilesDoc(seedReal());
    let n = 0;
    const { item } = withRemoteProfile(doc, { url: "https://example.test/x" }, {
      uid: () => (n++ === 0 ? "OldUid00001" : "Unique0001"),
    });
    expect(item.uid).toBe("Unique0001");
    expect(() => withRemoteProfile(doc, { url: "https://example.test/x" }, {
      uid: () => "OldUid00001",
    })).toThrowError(/uid/i);
  });

  it("randomUid 是 10 位 [A-Za-z0-9]", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(randomUid()).toMatch(/^[A-Za-z0-9]{10}$/);
    }
  });

  it("选订阅只改 current；附件/不存在/内置一律拒绝", () => {
    const doc = readProfilesDoc(seedReal());
    const next = withSelected(doc, "NewUid00002");
    expect(next.current).toBe("NewUid00002");
    expect(next.extraRoot).toBe("keep-root");
    expect(next.items).toEqual(doc.items);
    for (const uid of ["AttachRules", "Merge", "NoSuchUid0"]) {
      expect(() => withSelected(doc, uid), uid).toThrowError(ProfilesStoreError);
    }
  });

  it("删订阅：Merge/Script 拒删；删当前项要把 current 清空", () => {
    const doc = readProfilesDoc(seedReal());
    for (const uid of ["Merge", "Script"]) {
      expect(() => withoutProfile(doc, uid), uid).toThrowError(ProfilesStoreError);
    }
    const { doc: next, removed } = withoutProfile(doc, "OldUid00001");
    expect(removed.uid).toBe("OldUid00001");
    expect(next.current).toBe("");
    expect(next.items.map((i) => i.uid)).not.toContain("OldUid00001");
    expect(next.extraRoot).toBe("keep-root");

    const other = withoutProfile(doc, "NewUid00002").doc;
    expect(other.current).toBe("OldUid00001");
  });
});

describe("profiles-store 写盘", () => {
  it("先备份再 tmp→rename：备份名带时间，写回 YAML 保留未知键", () => {
    const root = seedReal();
    const file = path.join(root, PROFILES_FILE);
    const doc = withSelected(readProfilesDoc(root), "NewUid00002");
    writeProfilesAtomic(file, doc, AT);

    const backup = path.join(root, "profiles.yaml.bak-mochi-20261029-153000");
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, "utf8")).toBe(REAL_SHAPE);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);

    const after = parseYaml(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after.current).toBe("NewUid00002");
    expect(after.extraRoot).toBe("keep-root");
    const items = after.items as Array<Record<string, unknown>>;
    expect(items.find((i) => i.uid === "OldUid00001")?.["x-note"]).toBe("keep-me");
  });

  it("同一秒写两次：第二份备份加序号，不覆盖第一份", () => {
    const root = seedReal();
    const file = path.join(root, PROFILES_FILE);
    const doc = readProfilesDoc(root);
    writeProfilesAtomic(file, doc, AT);
    writeProfilesAtomic(file, withSelected(doc, "NewUid00002"), AT);
    expect(existsSync(path.join(root, "profiles.yaml.bak-mochi-20261029-153000"))).toBe(true);
    expect(existsSync(path.join(root, "profiles.yaml.bak-mochi-20261029-153000-2"))).toBe(true);
  });

  it("序列化失败（循环引用）不落盘、不产备份", () => {
    const root = seedReal();
    const file = path.join(root, PROFILES_FILE);
    const before = readFileSync(file, "utf8");
    const doc = readProfilesDoc(root) as unknown as Record<string, unknown>;
    doc.self = doc;
    expect(() => writeProfilesAtomic(file, doc, AT)).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(root).some((n) => n.includes(".bak-mochi-"))).toBe(false);
  });

  it("目录不存在时写盘要自己建目录（首次导入）", () => {
    const root = freshRoot();
    const nested = path.join(root, "verge-data");
    mkdirSync(nested, { recursive: true });
    const file = path.join(nested, PROFILES_FILE);
    writeProfilesAtomic(file, { current: "", items: [] }, AT);
    expect(readProfilesDoc(nested).items).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});

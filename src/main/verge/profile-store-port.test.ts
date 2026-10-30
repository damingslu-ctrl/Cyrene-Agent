import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PROFILES_FILE, ProfilesStoreError, readProfilesDoc, type ProfilesDoc } from "./profiles-store";
import { PROFILES_DIR, createProfileStore, readProfileSource } from "./profile-store-port";

const dirs: string[] = [];
function freshRoot(): { configRoot: string; userData: string } {
  const base = mkdtempSync(path.join(tmpdir(), "verge-profile-port-"));
  dirs.push(base);
  const configRoot = path.join(base, "verge");
  const userData = path.join(base, "mochi");
  mkdirSync(path.join(configRoot, PROFILES_DIR), { recursive: true });
  mkdirSync(userData, { recursive: true });
  return { configRoot, userData };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const AT = new Date(2026, 9, 29, 15, 30, 0);

const DOC: ProfilesDoc = {
  current: "Sub00000001",
  items: [
    { uid: "Merge", type: "merge", file: "Merge.yaml" },
    { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/s", "x-note": "keep-me" },
  ],
  extraRoot: "keep-root",
};

describe("profile-store-port 账本", () => {
  it("writeDoc→readDoc 原样回来：未知键一个不少，备份名跟着注入的时钟", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData, now: () => AT });
    store.writeDoc(DOC);

    expect(readProfilesDoc(configRoot)).toEqual(DOC);
    expect(existsSync(path.join(configRoot, "profiles.yaml.bak-mochi-20261029-153000"))).toBe(false);

    store.writeDoc({ ...DOC, current: "" });
    const backup = path.join(configRoot, "profiles.yaml.bak-mochi-20261029-153000");
    expect(existsSync(backup)).toBe(true);
    expect((parseYaml(readFileSync(backup, "utf8")) as ProfilesDoc).current).toBe("Sub00000001");
    // 临时文件不许留在目录里（rename 失败时留下的半截最害人）
    expect(readdirSync(configRoot).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("profiles.yaml 里那个 x-note 写回盘还在（隔壁那款的私有字段不能替用户擦掉）", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData, now: () => AT });
    store.writeDoc(DOC);
    const onDisk = parseYaml(readFileSync(path.join(configRoot, PROFILES_FILE), "utf8")) as ProfilesDoc;
    const item = onDisk.items.find((entry) => entry.uid === "Sub00000001")!;
    expect(item["x-note"]).toBe("keep-me");
    expect(onDisk.extraRoot).toBe("keep-root");
  });
});

describe("profile-store-port 正文", () => {
  it("写进 profiles/ 再读回来；重写同一份会先留一份同口径备份", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData, now: () => AT });
    store.writeProfileFile("Sub00000001.yaml", "port: 7890\nproxies: []\n");
    const file = path.join(configRoot, PROFILES_DIR, "Sub00000001.yaml");
    expect(readFileSync(file, "utf8")).toBe("port: 7890\nproxies: []\n");
    expect(store.readProfileFile("Sub00000001.yaml")).toBe("port: 7890\nproxies: []\n");

    store.writeProfileFile("Sub00000001.yaml", "port: 7891\n");
    expect(readFileSync(path.join(configRoot, PROFILES_DIR, "Sub00000001.yaml.bak-mochi-20261029-153000"), "utf8"))
      .toBe("port: 7890\nproxies: []\n");
    expect(store.readProfileFile("Sub00000001.yaml")).toBe("port: 7891\n");
  });

  it("读不到就是 null：不存在、是个目录，都不许抛", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData });
    expect(store.readProfileFile("NoSuch0001.yaml")).toBeNull();
    mkdirSync(path.join(configRoot, PROFILES_DIR, "Dir0000001.yaml"), { recursive: true });
    expect(store.readProfileFile("Dir0000001.yaml")).toBeNull();
  });

  it("删正文：删掉就没了，本来不存在也当删成功（清账不能被一次报错拦住）", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData });
    store.writeProfileFile("Sub00000001.yaml", "proxies: []\n");
    store.removeProfileFile("Sub00000001.yaml");
    expect(existsSync(path.join(configRoot, PROFILES_DIR, "Sub00000001.yaml"))).toBe(false);
    expect(() => store.removeProfileFile("Sub00000001.yaml")).not.toThrow();
  });

  it("文件名白名单：带路径的分量一律拒，且一个字节都不许落在目录外", () => {
    const { configRoot, userData } = freshRoot();
    const base = path.dirname(configRoot);
    const store = createProfileStore({ configRoot, userData, now: () => AT });
    const bad = [
      "../../escape.yaml",
      "..\\..\\escape.yaml",
      "/etc/passwd.yaml",
      "C:\\Windows\\escape.yaml",
      "sub/inside.yaml",
      "evil.exe",
      ".hidden.yaml",
      "",
      "带中文的名字.yaml",
    ];
    for (const name of bad) {
      expect(() => store.writeProfileFile(name, "x"), name).toThrowError(/文件名不合法/);
      expect(() => store.readProfileFile(name), name).toThrowError(/文件名不合法/);
      expect(() => store.removeProfileFile(name), name).toThrowError(/文件名不合法/);
    }
    expect(existsSync(path.join(base, "escape.yaml"))).toBe(false);
    expect([...readdirSync(base)].sort()).toEqual(["mochi", "verge"]);
    // 正例：Verge 的三种写法都得放过
    for (const name of ["Sub00000001.yaml", "Merge.yml", "Plain.json"]) store.writeProfileFile(name, "a: 1\n");
    expect(store.readProfileFile("Merge.yml")).toBe("a: 1\n");
  });
});

describe("profile-store-port runtime", () => {
  it("写 <userData>/runtime/<uid>.yaml，回绝对路径，且不产备份（可再生产物）", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData, now: () => AT });
    const file = store.writeRuntime("Sub00000001", "external-controller: 127.0.0.1:9097\n");
    expect(path.isAbsolute(file)).toBe(true);
    expect(file).toBe(path.join(userData, "runtime", "Sub00000001.yaml"));
    expect(readFileSync(file, "utf8")).toBe("external-controller: 127.0.0.1:9097\n");
    expect(readdirSync(path.dirname(file))).toEqual(["Sub00000001.yaml"]);
    expect(readdirSync(path.dirname(file)).filter((n) => n.includes(".bak-mochi-"))).toEqual([]);
  });

  it("目录不存在时自己建（首次切换）", () => {
    const { configRoot, userData } = freshRoot();
    rmSync(path.join(userData), { recursive: true, force: true });
    const store = createProfileStore({ configRoot, userData });
    expect(existsSync(userData)).toBe(false);
    store.writeRuntime("Fresh00001", "a: 1\n");
    expect(statSync(path.join(userData, "runtime", "Fresh00001.yaml")).isFile()).toBe(true);
  });

  it("uid 里塞路径分隔符要拦住，别让 runtime 目录变成任意写入口", () => {
    const { configRoot, userData } = freshRoot();
    const store = createProfileStore({ configRoot, userData });
    for (const uid of ["../../escape", "..\\..\\escape", "a/b", ""]) {
      expect(() => store.writeRuntime(uid, "x"), uid).toThrowError(/不合法/);
    }
    expect([...readdirSync(path.dirname(configRoot))].sort()).toEqual(["mochi", "verge"]);
  });
});

describe("readProfileSource 本地导入", () => {
  it("读得到就回文本；不存在／是目录回 null", () => {
    const { configRoot, userData } = freshRoot();
    const file = path.join(configRoot, PROFILES_DIR, "import.yaml");
    writeFileSync(file, "proxies:\n- name: a\n", "utf8");
    expect(readProfileSource(file)).toBe("proxies:\n- name: a\n");
    expect(readProfileSource(path.join(configRoot, "nope.yaml"))).toBeNull();
    expect(readProfileSource(configRoot)).toBeNull();
  });

  it("超过上限当场拒：宁可报错也不整份吞进来（订阅 URL 同一个上限口径）", () => {
    const { configRoot, userData } = freshRoot();
    const file = path.join(configRoot, PROFILES_DIR, "big.yaml");
    writeFileSync(file, "x".repeat(4096), "utf8");
    expect(readProfileSource(file, 8192)).toHaveLength(4096);
    let caught: unknown;
    try {
      readProfileSource(file, 1024);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProfilesStoreError);
    expect((caught as ProfilesStoreError).reason).toBe("invalid");
    expect((caught as Error).message).toMatch(/超过 1024 字节/);
  });
});

/**
 * 装配层的单测：把「真盘 + 真读控制面」这条路跑通。
 *
 * profile-service 那 30 条用的是假盘端口，证的是判据；这里证的是**接线**——
 * 装配漏掉任何一根（闸门、注入、客户端缓存、读文件），在那边全都看不出来。
 */
import { createServer, type AddressInfo } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { PROFILES_FILE, ProfilesStoreError, type ProfilesDoc } from "./profiles-store";
import { createProfileAssembly } from "./profile-bootstrap";
import { PROFILES_DIR } from "./profile-store-port";
import { RUNTIME_DIR } from "./runtime-config";
import type { ControllerConfig } from "./controller-config";
import type { FetchLike, ResponseLike } from "./subscription-fetch";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BODY = "proxies:\n- name: hk-1\n  type: ss\n  server: 1.2.3.4\nmixed-port: 7888\n";

const CONTROLLER = "external-controller: http://127.0.0.1:7897\nsecret: mochi-key\nmixed-port: 7895\n";

function fakeFetch(text: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(Buffer.byteLength(text))]]),
    text: async () => text,
  } as unknown as ResponseLike);
}

interface Fixture {
  configRoot: string;
  userData: string;
  writeController(text: string): void;
}

/** 一份最小但真实的 Verge 目录：账本、正文、merge、控制面文件全在盘上，走的是真读取。 */
function freshVerge(controller: string = CONTROLLER): Fixture {
  const base = mkdtempSync(path.join(tmpdir(), "verge-profile-boot-"));
  dirs.push(base);
  const configRoot = path.join(base, "verge");
  const userData = path.join(base, "mochi");
  mkdirSync(path.join(configRoot, PROFILES_DIR), { recursive: true });
  mkdirSync(userData, { recursive: true });
  const doc: ProfilesDoc = {
    current: "Sub00000001",
    items: [
      { uid: "Merge", type: "merge", file: "Merge.yaml" },
      { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/a", "x-note": "keep-me" },
      { uid: "Sub00000002", type: "remote", file: "Sub00000002.yaml", url: "https://example.test/b" },
    ],
  };
  writeFileSync(path.join(configRoot, PROFILES_FILE), stringifyYaml(doc, { lineWidth: 0, aliasDuplicateObjects: false }), "utf8");
  writeFileSync(path.join(configRoot, PROFILES_DIR, "Sub00000001.yaml"), BODY, "utf8");
  writeFileSync(path.join(configRoot, PROFILES_DIR, "Sub00000002.yaml"), BODY, "utf8");
  // merge 故意把控制面往别处搬：注入排在链尾，这份改不动我们的地址。
  writeFileSync(path.join(configRoot, PROFILES_DIR, "Merge.yaml"), "external-controller: 0.0.0.0:1\nmixed-port: 10000\n", "utf8");
  const controllerFile = path.join(configRoot, "clash-verge.yaml");
  writeFileSync(controllerFile, controller, "utf8");
  return { configRoot, userData, writeController: (text: string) => writeFileSync(controllerFile, text, "utf8") };
}

function isDir(file: string): boolean {
  return existsSync(file) && statSync(file).isDirectory();
}

function runtimeDoc(userData: string, uid: string): Record<string, unknown> {
  return parseYaml(readFileSync(path.join(userData, RUNTIME_DIR, `${uid}.yaml`), "utf8")) as Record<string, unknown>;
}

function ledgerCurrent(configRoot: string): string {
  return (parseYaml(readFileSync(path.join(configRoot, PROFILES_FILE), "utf8")) as ProfilesDoc).current;
}

function recorder() {
  const clients: ControllerConfig[] = [];
  const reloaded: string[] = [];
  return {
    clients,
    reloaded,
    createClient: (config: ControllerConfig) => {
      clients.push(config);
      return { reloadConfig: async (file: string) => { reloaded.push(file); } };
    },
  };
}

interface ControllerHit {
  method: string;
  url: string;
  body: string;
  auth: string;
}

/**
 * 一台真的听在 127.0.0.1 随机端口上的控制器。
 *
 * `recorder()` 把 HTTP 那一腿整条换掉了：装配层要是压根不发 PUT、或者发的不是
 * `PUT /configs {path}`， recorder 照样绿。这条尺只留盘与 socket 是真的。
 */
async function startController(): Promise<{ port: number; hits: ControllerHit[]; close(): Promise<void> }> {
  const hits: ControllerHit[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => {
      hits.push({ method: String(req.method), url: String(req.url), body, auth: String(req.headers.authorization ?? "") });
      // mihomo 对 PUT /configs 回的就是 204，回 200 反而是在演一个不存在的内核。
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    hits,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    }),
  };
}

function ledgerDoc(file: string): ProfilesDoc {
  return parseYaml(readFileSync(file, "utf8")) as ProfilesDoc;
}

describe("profile-bootstrap 装配", () => {
  it("切换订阅：runtime 的控制面是注入的那一份，merge 搬不走", async () => {
    const root = freshVerge();
    const seen = recorder();
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: seen.createClient,
    });

    const result = await service.select("Sub00000002");
    expect(result.ok).toBe(true);

    const file = path.join(root.userData, RUNTIME_DIR, "Sub00000002.yaml");
    expect(seen.reloaded).toEqual([file]);
    const doc = runtimeDoc(root.userData, "Sub00000002");
    // mihomo 吃的是 host:port：协议前缀必须在注入前剥掉，否则内核直接起不来。
    expect(doc["external-controller"]).toBe("127.0.0.1:7897");
    expect(doc.secret).toBe("mochi-key");
    expect(doc["mixed-port"]).toBe(7895);
    expect(ledgerCurrent(root.configRoot)).toBe("Sub00000002");
  });

  it("客户端拿到的 baseUrl 保留协议，注入进 runtime 的那一份才剥掉", async () => {
    const root = freshVerge();
    const seen = recorder();
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: seen.createClient,
    });
    await service.select("Sub00000002");
    expect(seen.clients[0]).toMatchObject({ baseUrl: "http://127.0.0.1:7897", secret: "mochi-key" });
  });

  it("clash-verge.yaml 没写 mixed-port 时不许注入 null 把下面的端口抹掉", async () => {
    const root = freshVerge("external-controller: 127.0.0.1:7897\nsecret: mochi-key\n");
    // merge 那份也撤干净：这条要验的是「我们不写＝不改」，端口得由订阅正文自己说了算。
    writeFileSync(path.join(root.configRoot, PROFILES_DIR, "Merge.yaml"), "dns:\n  enable: true\n", "utf8");
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: recorder().createClient,
    });
    const result = await service.select("Sub00000002");
    expect(result.ok).toBe(true);
    expect(runtimeDoc(root.userData, "Sub00000002")["mixed-port"]).toBe(7888);
  });

  it("控制面读不出来：不写一个字节，且失败照样带着当前列表", async () => {
    const root = freshVerge('external-controller: ""\nsecret: mochi-key\n');
    const seen = recorder();
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: seen.createClient,
    });
    const result = await service.select("Sub00000002");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该成功");
    expect(result.reason).toBe("invalid");
    expect(result.detail).toMatch(/控制面/);
    expect(result.rows.map((row) => row.uid)).toContain("Sub00000001");
    expect(isDir(path.join(root.userData, RUNTIME_DIR))).toBe(false);
    expect(seen.reloaded).toEqual([]);
    expect(ledgerCurrent(root.configRoot)).toBe("Sub00000001");
  });

  it("Verge 在跑＝闸门真的接上了：拒写、不碰控制面", async () => {
    const root = freshVerge();
    const seen = recorder();
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => true,
      createClient: seen.createClient,
    });
    const result = await service.select("Sub00000002");
    expect(result.ok === false && result.reason).toBe("verge-running");
    expect(seen.reloaded).toEqual([]);
    expect(isDir(path.join(root.userData, RUNTIME_DIR))).toBe(false);
  });

  it("找不到配置目录时说的是目录，不是「没有订阅」", () => {
    const service = createProfileAssembly({
      getConfigRoot: () => null,
      userData: mkdtempSync(path.join(tmpdir(), "verge-boot-orphan-")),
      isVergeRunning: () => false,
      createClient: recorder().createClient,
    });
    expect(() => service.list()).toThrow(ProfilesStoreError);
    expect(() => service.list()).toThrow(/配置目录/);
  });

  it("Verge 换了目录（安装版↔便携版）要跟上，不许抱着旧目录不放", () => {
    const a = freshVerge();
    const b = freshVerge();
    let active = a.configRoot;
    const service = createProfileAssembly({
      getConfigRoot: () => active,
      userData: a.userData,
      isVergeRunning: () => false,
      createClient: recorder().createClient,
    });
    expect(service.list().map((row) => row.uid)).toContain("Sub00000001");
    writeFileSync(
      path.join(b.configRoot, PROFILES_FILE),
      stringifyYaml({ current: "", items: [{ uid: "OnlyB", type: "remote", file: "OnlyB.yaml", url: "https://example.test/c" }] }, { lineWidth: 0 }),
      "utf8",
    );
    active = b.configRoot;
    expect(service.list().map((row) => row.uid)).toEqual(["OnlyB"]);
  });

  it("控制面没改就复用客户端；端口或密钥一改就得换一个新的", async () => {
    const root = freshVerge();
    const seen = recorder();
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: seen.createClient,
    });
    await service.select("Sub00000002");
    await service.select("Sub00000001");
    expect(seen.clients).toHaveLength(1);
    // 端口与密钥一起改（只改端口会让 readControllerConfig 的 mtime+size 缓存撞在同一条上）。
    root.writeController("external-controller: http://127.0.0.1:9099\nsecret: another-key\n");
    await service.select("Sub00000002");
    expect(seen.clients).toHaveLength(2);
    expect(seen.clients[1]).toMatchObject({ baseUrl: "http://127.0.0.1:9099", secret: "another-key" });
  });

  it("本地导入读的是用户给的那条路径：正文进 profiles，账本多一条 local", async () => {
    const root = freshVerge();
    const source = path.join(root.userData, "from-user.yaml");
    writeFileSync(source, BODY, "utf8");
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: recorder().createClient,
    });
    const result = await service.importFile({ path: source, desc: "手动的一份" });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.uid) throw new Error("本地导入没给出新 uid");
    const uid = result.uid;
    expect(uid).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(readFileSync(path.join(root.configRoot, PROFILES_DIR, `${uid}.yaml`), "utf8")).toContain("hk-1");
    // uid 是随机的，落在字母表哪一格都可能，所以按集合比、不按顺序比。
    expect(new Set(readdirSync(path.join(root.configRoot, PROFILES_DIR)))).toEqual(new Set([
      "Merge.yaml",
      "Sub00000001.yaml",
      "Sub00000002.yaml",
      `${uid}.yaml`,
    ]));
  });

  it("下载用的是装配给的那一路 fetch", async () => {
    const root = freshVerge();
    const urls: string[] = [];
    const service = createProfileAssembly({
      getConfigRoot: () => root.configRoot,
      userData: root.userData,
      isVergeRunning: () => false,
      createClient: recorder().createClient,
      fetch: async (url: string) => {
        urls.push(url);
        return fakeFetch(BODY)(url);
      },
    });
    const result = await service.importUrl({ url: "https://example.test/new" });
    expect(result.ok).toBe(true);
    expect(urls).toEqual(["https://example.test/new"]);
    const doc = (parseYaml(readFileSync(path.join(root.configRoot, PROFILES_FILE), "utf8")) as ProfilesDoc).items;
    expect(doc.some((item) => item.type === "remote" && item.url === "https://example.test/new")).toBe(true);
  });

  it("切走再切回原 profile：两次 PUT 真打在控制器上，账本回到起始 uid", async () => {
    const ctl = await startController();
    try {
      const root = freshVerge(`external-controller: http://127.0.0.1:${ctl.port}\nsecret: mochi-key\nmixed-port: 7895\n`);
      // 这里不换客户端：走的是装配默认的 createMihomoClient，HTTP 那一腿是真的。
      const service = createProfileAssembly({
        getConfigRoot: () => root.configRoot,
        userData: root.userData,
        isVergeRunning: () => false,
      });
      const ledger = path.join(root.configRoot, PROFILES_FILE);
      const before = ledgerDoc(ledger);
      expect(before.current).toBe("Sub00000001");

      const away = await service.select("Sub00000002");
      expect(away.ok).toBe(true);
      const back = await service.select("Sub00000001");
      expect(back.ok).toBe(true);

      const after = ledgerDoc(ledger);
      expect(after.current).toBe("Sub00000001");
      // 两次写之后，条目顺序、条数与隔壁那款的私有字段都得原样在——
      // 「切回去」把账本顺手理一遍，是最难复现的那种事故。
      expect(after.items).toEqual(before.items);

      expect(ctl.hits.map((hit) => `${hit.method} ${hit.url}`)).toEqual(["PUT /configs", "PUT /configs"]);
      expect(ctl.hits.map((hit) => (JSON.parse(hit.body) as { path: string }).path)).toEqual([
        path.join(root.userData, RUNTIME_DIR, "Sub00000002.yaml"),
        path.join(root.userData, RUNTIME_DIR, "Sub00000001.yaml"),
      ]);
      expect(ctl.hits.every((hit) => hit.auth === "Bearer mochi-key")).toBe(true);
      // 内核吃 host:port：runtime 里那条不许带协议前缀，客户端那边才留协议。
      expect(runtimeDoc(root.userData, "Sub00000001")["external-controller"]).toBe(`127.0.0.1:${ctl.port}`);
    } finally {
      await ctl.close();
    }
  });
});

/**
 * 「我们起的那颗内核吃的那份配置」的测试。
 *
 * 判据只有一条值得较真：控制面三键必须由我们钉死、并且落在自己那份文件里。
 * 订阅正文里那句 `external-controller` 是别人写的——让它活着，换一个订阅就把
 * 整条数据面的主权接了过去（spec D5）。盘上用真目录跑，假端口在那边证不了接线。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { RUNTIME_DIR } from "./runtime-config";
import { PROFILES_DIR, createProfileStore } from "./profile-store-port";
import { CORE_RUNTIME_UID, buildCoreRuntime } from "./core-runtime";
import { PROFILES_FILE, type ProfilesDoc } from "./profiles-store";

const OURS = "9f2c41a7be05d8136ce4a0f1d2b87e9c";
const BODY = [
  "proxies:",
  "  - name: hk-1",
  "    type: ss",
  "    server: 1.2.3.4",
  "external-controller: 0.0.0.0:1",
  "secret: somebody-else",
  "mixed-port: 10000",
  "dns:",
  "  enable: true",
  "",
].join("\n");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  userData: string;
  port: ReturnType<typeof createProfileStore>;
  writeBody(name: string, text: string): void;
}

/** 一份最小但真的 Verge 目录：账本按 input 写，正文与 merge 落在 profiles/ 下。 */
function fixture(doc: ProfilesDoc, bodies: Record<string, string> = { "Sub00000001.yaml": BODY }): Fixture {
  const base = mkdtempSync(path.join(tmpdir(), "core-runtime-"));
  dirs.push(base);
  const configRoot = path.join(base, "verge");
  const userData = path.join(base, "mochi");
  mkdirSync(path.join(configRoot, PROFILES_DIR), { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeFileSync(path.join(configRoot, PROFILES_FILE), stringifyYaml(doc, { lineWidth: 0 }), "utf8");
  for (const [name, text] of Object.entries(bodies)) {
    writeFileSync(path.join(configRoot, PROFILES_DIR, name), text, "utf8");
  }
  return {
    userData,
    port: createProfileStore({ configRoot, userData }),
    writeBody: (name, text) => writeFileSync(path.join(configRoot, PROFILES_DIR, name), text, "utf8"),
  };
}

const PORTS = { mixed: 17890, controller: 17891 };

function withCurrent(uid: string, extra: Record<string, unknown> = {}): ProfilesDoc {
  return {
    current: uid,
    items: [
      { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/a", ...extra },
    ],
  };
}

function runtimeFile(userData: string): string {
  return path.join(userData, RUNTIME_DIR, `${CORE_RUNTIME_UID}.yaml`);
}

function readRuntime(userData: string): Record<string, unknown> {
  return parseYaml(readFileSync(runtimeFile(userData), "utf8")) as Record<string, unknown>;
}

describe("buildCoreRuntime：控制面由我们钉死", () => {
  it("订阅正文自己写的那三键被链尾盖掉", () => {
    const root = fixture(withCurrent("Sub00000001"));
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const doc = readRuntime(root.userData);
    // mihomo 只吃 host:port：带协议前缀它直接起不来。
    expect(doc["external-controller"]).toBe("127.0.0.1:17891");
    expect(doc.secret).toBe(OURS);
    expect(doc["mixed-port"]).toBe(17890);
    // 盖掉的是控制面，不是整份订阅：节点与 dns 得原样在。
    expect((doc.proxies as Array<{ name: string }>).map((p) => p.name)).toEqual(["hk-1"]);
    expect(doc.dns).toEqual({ enable: true });
  });

  it("写的是 runtime/core.yaml，不跟订阅页那份 runtime/<uid>.yaml 互相盖", () => {
    const root = fixture(withCurrent("Sub00000001"));
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    if (!built.ok) throw new Error("该成功");
    expect(built.file).toBe(runtimeFile(root.userData));
    // 同名那一档（订阅页按 uid 写）在旁边：两份各写各的，谁也不把对方的端口抹掉。
    root.port.writeRuntime("Sub00000001", "mixed-port: 1\n");
    expect(parseYaml(readFileSync(path.join(root.userData, RUNTIME_DIR, "Sub00000001.yaml"), "utf8"))).toEqual({ "mixed-port": 1 });
    expect(readRuntime(root.userData)["mixed-port"]).toBe(17890);
  });

  it("merge 链照样吃得到，且改不动控制面", () => {
    const doc: ProfilesDoc = {
      current: "Sub00000001",
      items: [
        { uid: "Merge", type: "merge", file: "Merge.yaml" },
        { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/a" },
      ],
    };
    const root = fixture(doc, {
      "Sub00000001.yaml": BODY,
      "Merge.yaml": "prepend-proxy-groups:\n  - name: 手动\n    type: select\n    proxies:\n      - hk-1\nmixed-port: 20000\n",
    });
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings).toEqual([]);
    const runtime = readRuntime(root.userData);
    expect((runtime["proxy-groups"] as Array<{ name: string }>).map((g) => g.name)).toEqual(["手动"]);
    // merge 想搬走端口：允许它改别的，控制面这一组不行。
    expect(runtime["mixed-port"]).toBe(17890);
  });

  it("merge 那份读不出来：记一条 warn，但这一班内核照起", () => {
    const doc: ProfilesDoc = {
      current: "Sub00000001",
      items: [
        { uid: "Merge", type: "merge", file: "Merge.yaml" },
        { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", url: "https://example.test/a" },
      ],
    };
    const root = fixture(doc, { "Sub00000001.yaml": BODY });
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings).toEqual(["Merge"]);
  });
});

describe("buildCoreRuntime：起不来的那几种要说清是谁的问题", () => {
  function failWith(doc: ProfilesDoc, bodies?: Record<string, string>) {
    const root = fixture(doc, bodies);
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("该失败");
    return { reason: built.reason, detail: built.detail, root };
  }

  it("没选订阅＝no-profile，并且一个字节都不写", () => {
    const bad = failWith({ current: "", items: [] });
    expect(bad.reason).toBe("no-profile");
    expect(bad.detail).toContain("订阅");
    expect(existsSync(path.join(bad.root.userData, RUNTIME_DIR))).toBe(false);
  });

  it("账本 current 指了一条 items 里没有的＝profile-missing", () => {
    const bad = failWith({ current: "Ghost00000", items: [] });
    expect(bad.reason).toBe("profile-missing");
    expect(bad.detail).toContain("Ghost00000");
  });

  it("账本有、正文文件不在盘上＝profile-missing（报的是文件名，不是泛泛的读不到）", () => {
    const bad = failWith(withCurrent("Sub00000001"), {});
    expect(bad.reason).toBe("profile-missing");
    expect(bad.detail).toContain("Sub00000001.yaml");
  });

  it("正文不是 map（数组/标量/坏 YAML）＝bad-yaml", () => {
    expect(failWith(withCurrent("Sub00000001"), { "Sub00000001.yaml": "- a\n- b\n" }).reason).toBe("bad-yaml");
    expect(failWith(withCurrent("Sub00000001"), { "Sub00000001.yaml": "proxies: [{" }).reason).toBe("bad-yaml");
  });

  it("正文合法但一个节点来源都没有＝no-proxies", () => {
    const bad = failWith(withCurrent("Sub00000001"), { "Sub00000001.yaml": "dns:\n  enable: true\nmixed-port: 7890\n" });
    expect(bad.reason).toBe("no-proxies");
    expect(bad.detail).toContain("节点");
  });

  it("proxy-providers 也算节点来源，不许误报成 no-proxies", () => {
    const root = fixture(withCurrent("Sub00000001"), {
      "Sub00000001.yaml": "proxy-providers:\n  air: { type: http, url: 'https://example.test/p' }\n",
    });
    const built = buildCoreRuntime({ port: root.port, ports: PORTS, secret: OURS });
    expect(built.ok).toBe(true);
    expect(readRuntime(root.userData)["proxy-providers"]).toBeTruthy();
  });
});

describe("buildCoreRuntime：页面上那几个名字", () => {
  it("name 优先，退到 desc，都没有就回 null（页面宁可空着也不编一个）", () => {
    const named = buildCoreRuntime({
      port: fixture(withCurrent("Sub00000001", { name: "机场 A" })).port,
      ports: PORTS,
      secret: OURS,
    });
    if (!named.ok) throw new Error("该成功");
    expect(named.name).toBe("机场 A");
    expect(named.uid).toBe("Sub00000001");

    const described = buildCoreRuntime({
      port: fixture(withCurrent("Sub00000001", { name: "  ", desc: "备注那一份" })).port,
      ports: PORTS,
      secret: OURS,
    });
    if (!described.ok) throw new Error("该成功");
    expect(described.name).toBe("备注那一份");

    const anonymous = buildCoreRuntime({ port: fixture(withCurrent("Sub00000001")).port, ports: PORTS, secret: OURS });
    if (!anonymous.ok) throw new Error("该成功");
    expect(anonymous.name).toBeNull();
  });
});

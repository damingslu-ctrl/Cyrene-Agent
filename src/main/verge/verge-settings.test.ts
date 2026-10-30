/**
 * Wave 3 T9：Verge 自己的 `verge.yaml` 白名单读写。
 *
 * 这层的判据不是「能不能改」，而是「改的时候有没有顺手把别人的东西弄坏」——
 * 这个文件是隔壁那款的私有账本（44 个键、注释、块标量、列在 0 列的序列项都在里面），
 * 一次整档重排就会把 `pac_file_content` 的缩进、`test_list` 的 svg 引号全洗掉。
 * 所以写只走行级补丁：目标键那一行动，其余字节必须一模一样。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createVergeSettingsStore,
  patchVergeSettingsText,
  pickVergeSettings,
  VERGE_SETTING_KEYS,
  VergeSettingsError,
} from "./verge-settings";

const dirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "verge-settings-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const AT = new Date(2026, 9, 30, 15, 30, 0);

/** 真机 `verge.yaml` 的形：注释 + 空行 + null 值 + 块标量 + 0 列序列项 + 嵌套 map。 */
const REAL_SHAPE = `# Clash Verge Config

app_log_level: null
language: zh
theme_mode: system
traffic_graph: true
enable_tun_mode: false
enable_auto_launch: true
enable_system_proxy: true
enable_proxy_guard: false
enable_bypass_check: true
use_default_bypass: true
system_proxy_bypass: null
proxy_guard_duration: 30
pac_file_content: |
  function FindProxyForURL(url, host) {
    return "PROXY 127.0.0.1:7896; SOCKS5 127.0.0.1:7896; DIRECT;";
  }
proxy_host: 127.0.0.1
clash_core: verge-mihomo-alpha
test_list:
- uid: og1Mj1Y8KnKU
  name: Apple
  url: https://www.apple.com
- uid: D-gau60-iirP
  name: GitHub
  url: https://www.github.com
profile_dns_settings:
  R1pZeP8pNRzO:
    enabled: true
    system_proxy_bypass: nested-should-never-be-touched
verge_mixed_port: 7896
verge_socks_port: 7897
verge_socks_enabled: false
verge_port: 7897
verge_http_enabled: false
auto_check_update: true
enable_external_controller: true
`;

describe("pickVergeSettings：只认白名单，读不到就是 null", () => {
  it("七把键都在盘上时逐条对上", () => {
    const view = pickVergeSettings(parseYaml(REAL_SHAPE));
    expect(view).toEqual({
      enableSystemProxy: true,
      systemProxyBypass: null,
      useDefaultBypass: true,
      enableTunMode: false,
      mixedPort: 7896,
      socksPort: 7897,
      httpPort: 7897,
    });
  });

  it("白名单之外一个键都不带出去（Verge 的私有键不进 IPC）", () => {
    const view = pickVergeSettings(parseYaml(REAL_SHAPE)) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([
      "enableSystemProxy",
      "enableTunMode",
      "httpPort",
      "mixedPort",
      "socksPort",
      "systemProxyBypass",
      "useDefaultBypass",
    ]);
    expect(view).not.toHaveProperty("autoCheckUpdate");
    expect(view).not.toHaveProperty("clashCore");
  });

  it("缺键读成 null，不把「没写过」演成 false 或 0", () => {
    expect(pickVergeSettings({})).toEqual({
      enableSystemProxy: null,
      systemProxyBypass: null,
      useDefaultBypass: null,
      enableTunMode: null,
      mixedPort: null,
      socksPort: null,
      httpPort: null,
    });
    expect(pickVergeSettings(null).mixedPort).toBeNull();
  });

  it("脏值不冒充：端口写成字符串/越界、布尔写成 yes 一律 null", () => {
    const view = pickVergeSettings({
      verge_mixed_port: "7896",
      verge_socks_port: 70000,
      verge_port: -1,
      enable_system_proxy: "yes",
      enable_tun_mode: 1,
      system_proxy_bypass: 42,
      use_default_bypass: "true",
    });
    expect(view).toEqual({
      enableSystemProxy: null,
      systemProxyBypass: null,
      useDefaultBypass: null,
      enableTunMode: null,
      mixedPort: null,
      socksPort: null,
      httpPort: null,
    });
  });

  it("空串 bypass 是「一条都不豁免」，不是「没写过」", () => {
    expect(pickVergeSettings({ system_proxy_bypass: "" }).systemProxyBypass).toBe("");
  });
});

describe("patchVergeSettingsText：行级补丁，其余字节不许动", () => {
  it("改一个开关：只有那一行变了", () => {
    const next = patchVergeSettingsText(REAL_SHAPE, { enable_system_proxy: false });
    const before = REAL_SHAPE.split("\n");
    const after = next.split("\n");
    expect(after.length).toBe(before.length);
    const changed = before.map((line, i) => (line === after[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toEqual([before.findIndex((line) => line.startsWith("enable_system_proxy:"))]);
    expect(after[changed[0]]).toBe("enable_system_proxy: false");
  });

  it("块标量、0 列序列项、嵌套 map 原样保留（整档重排会把 svg 引号与缩进洗掉）", () => {
    const next = patchVergeSettingsText(REAL_SHAPE, { enable_tun_mode: true });
    expect(next).toContain(`pac_file_content: |
  function FindProxyForURL(url, host) {
    return "PROXY 127.0.0.1:7896; SOCKS5 127.0.0.1:7896; DIRECT;";
  }
`);
    expect(next).toContain(`test_list:
- uid: og1Mj1Y8KnKU
  name: Apple
`);
    expect(next.startsWith("# Clash Verge Config\n\napp_log_level: null\n")).toBe(true);
    expect(next).toContain("auto_check_update: true\nenable_external_controller: true\n");
  });

  it("只改顶层那一行：嵌套的同名键不许被顶包", () => {
    const next = patchVergeSettingsText(REAL_SHAPE, { system_proxy_bypass: "localhost;<local>" });
    expect(next).toContain("    system_proxy_bypass: nested-should-never-be-touched");
    expect(next).not.toContain("localhost;<local>\n  R1pZeP8pNRzO");
    const doc = parseYaml(next) as Record<string, unknown>;
    expect(doc.system_proxy_bypass).toBe("localhost;<local>");
    expect((doc.profile_dns_settings as Record<string, unknown>).R1pZeP8pNRzO).toEqual({
      enabled: true,
      system_proxy_bypass: "nested-should-never-be-touched",
    });
  });

  it("null → 值 → null 都能来回，且读回来的类型不变", () => {
    const on = patchVergeSettingsText(REAL_SHAPE, { enable_tun_mode: true });
    expect(pickVergeSettings(parseYaml(on)).enableTunMode).toBe(true);
    const back = patchVergeSettingsText(on, { enable_tun_mode: null });
    expect(back).toContain("enable_tun_mode: null\n");
    expect(pickVergeSettings(parseYaml(back)).enableTunMode).toBeNull();
  });

  it("端口写成十进制原值，不出现 7.9e3 之类的科学计数", () => {
    const next = patchVergeSettingsText(REAL_SHAPE, { verge_mixed_port: 7890, verge_port: 0 });
    expect(next).toContain("verge_mixed_port: 7890\n");
    expect(next).toContain("verge_port: 0\n");
    const view = pickVergeSettings(parseYaml(next));
    expect(view.mixedPort).toBe(7890);
    expect(view.httpPort).toBe(0);
  });

  it("bypass 里的 YAML 特殊字符必须转义到读回来还是那一串", () => {
    const cases = [
      "localhost;127.*;<local>",
      "*starts-with-alias",
      "a: b",
      "a #not-a-comment",
      "trailing ",
      "quote\"inside",
      "back\\slash",
      "",
    ];
    for (const value of cases) {
      const next = patchVergeSettingsText(REAL_SHAPE, { system_proxy_bypass: value });
      expect(pickVergeSettings(parseYaml(next)).systemProxyBypass).toBe(value);
    }
  });

  it("bypass 里长得像数字/布尔/别名的串不能被判成别的类型", () => {
    // 这些是「写进去还是那句话，读回来变成别的」的实测集合：裸写 `.inf` 读回来是 null、
    // `0x1A` 是 26、`-.0` 是 0——页面会把一条例外列表显示成「没写过」。
    const cases = [
      ".inf", "-.inf", ".Inf", ".nan", "-.0", "+.0", "0x1A", "0o17", "0b101",
      "1:30", "TRUE", "False", "NULL", "~", "010", "1e3", "1_000", "y", "Y",
      "&anchor", "%directive", "@reserved", "`tick", "- ", "? ", "-",
      "2026-10-30", "12:34:56", "[bracket]", "{brace}", "\"quoted\"", "'single'",
    ];
    for (const value of cases) {
      const next = patchVergeSettingsText(REAL_SHAPE, { system_proxy_bypass: value });
      const read = pickVergeSettings(parseYaml(next)).systemProxyBypass;
      expect(read, `「${value}」裸写会读成 ${JSON.stringify(read)}`).toBe(value);
    }
  });

  it("盘上没有的白名单键追加在文件末尾，前面的字节一个不动", () => {
    const sparse = "language: zh\ntraffic_graph: true\n";
    const next = patchVergeSettingsText(sparse, { verge_mixed_port: 7896, enable_tun_mode: true });
    expect(next).toBe("language: zh\ntraffic_graph: true\nverge_mixed_port: 7896\nenable_tun_mode: true\n");
  });

  it("CRLF 的盘追加时用同一套行尾", () => {
    const next = patchVergeSettingsText("language: zh\r\ntraffic_graph: true\r\n", { enable_tun_mode: true });
    expect(next).toBe("language: zh\r\ntraffic_graph: true\r\nenable_tun_mode: true\r\n");
    expect(next).not.toContain("\n\r\n");
  });

  it("没有结尾换行的文件不会被补丁补出黏行", () => {
    const next = patchVergeSettingsText("language: zh\ntraffic_graph: true", { verge_socks_port: 1080 });
    expect(next).toBe("language: zh\ntraffic_graph: true\nverge_socks_port: 1080");
    expect(parseYaml(next)).toEqual({ language: "zh", traffic_graph: true, verge_socks_port: 1080 });
  });

  it("非白名单键当场拒绝，且在生成文本之前就拒（enable_auto_launch 是别人的开机自启）", () => {
    expect(() => patchVergeSettingsText(REAL_SHAPE, { enable_auto_launch: false }))
      .toThrowError(expect.objectContaining({ reason: "bad-key" }));
    expect(REAL_SHAPE).toContain("enable_auto_launch: true");
  });

  it("坏值当场拒：越界端口、非整数、控制字符、空补丁", () => {
    for (const patch of [
      { verge_mixed_port: 65536 },
      { verge_mixed_port: -1 },
      { verge_mixed_port: 78.5 },
      { verge_mixed_port: "7896" },
      { enable_tun_mode: "true" },
      { system_proxy_bypass: "a\u0000b" },
      { system_proxy_bypass: "a\nb" },
      {},
    ]) {
      expect(() => patchVergeSettingsText(REAL_SHAPE, patch)).toThrowError(
        expect.objectContaining({ reason: "bad-value" }),
      );
    }
  });

  it("超长 bypass 拒掉（注册表与 Verge 都吃不下，不能让它落盘再说）", () => {
    expect(() => patchVergeSettingsText(REAL_SHAPE, { system_proxy_bypass: "x".repeat(2049) }))
      .toThrowError(expect.objectContaining({ reason: "bad-value" }));
  });

  it("值跨行的键不许只顶掉第一行（正文会被留下＝把别人的账本写花）", () => {
    // 盘上是合法的 YAML，补丁后的却是两码事：折叠标量的正文行、跨行的流序列、
    // 挂在键底下的嵌套 map——顶掉第一行就变成孤儿。这一条不是「怕麻烦」，
    // 是「不许把隔壁那款的账本写花」。
    const folded = "system_proxy_bypass: >-\n  localhost;127.*\nverge_port: 7890\n";
    const flow = "system_proxy_bypass: localhost,\n  127.0.0.1\nverge_port: 7890\n";
    const nested = "verge_port:\n  a: 1\n";
    const cases: [string, Record<string, unknown>][] = [
      [folded, { system_proxy_bypass: "127.0.0.1" }],
      [flow, { system_proxy_bypass: "127.0.0.1" }],
      [nested, { verge_port: 7897 }],
    ];
    for (const [text, patch] of cases) {
      expect(() => patchVergeSettingsText(text, patch))
        .toThrowError(expect.objectContaining({ reason: "write-failed" }));
    }
  });

  it("闸门只挡真正会被写坏的那一行：同一份跨行的盘，改别的键照样过", () => {
    const folded = "system_proxy_bypass: >-\n  localhost;127.*\nverge_port: 7890\n";
    const next = patchVergeSettingsText(folded, { verge_mixed_port: 7896 });
    expect(next).toContain("system_proxy_bypass: >-");
    expect(next).toContain("  localhost;127.*");
    expect(parseYaml(next).verge_mixed_port).toBe(7896);
  });

  it("补丁后的文档除目标键外与原文档逐键相同（不许顺手删掉未知键）", () => {
    const patch = { enable_system_proxy: false, verge_socks_port: 7898, system_proxy_bypass: "<local>" };
    const before = parseYaml(REAL_SHAPE) as Record<string, unknown>;
    const after = parseYaml(patchVergeSettingsText(REAL_SHAPE, patch)) as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      if (key in patch) continue;
      expect(after[key]).toEqual(before[key]);
    }
  });

  it("源文本不是 YAML map 时拒（把人家整个文件当字符串重写是灾难）", () => {
    expect(() => patchVergeSettingsText("- a\n- b\n", { enable_tun_mode: true })).toThrowError(VergeSettingsError);
    expect(() => patchVergeSettingsText("", { enable_tun_mode: true })).toThrowError(VergeSettingsError);
  });
});

describe("createVergeSettingsStore：闸门、备份、原子写", () => {
  function seed(root: string, text: string = REAL_SHAPE): string {
    const file = path.join(root, "verge.yaml");
    writeFileSync(file, text, "utf8");
    return file;
  }

  it("读：盘上的七把键进页面，读不到的键是 null", () => {
    const root = freshRoot();
    seed(root, "language: zh\nenable_system_proxy: true\n");
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    expect(store.read().view).toMatchObject({ enableSystemProxy: true, mixedPort: null });
    expect(store.read().reason).toBeNull();
  });

  it("盘上根本没有 verge.yaml：read 回 not-found，write 拒且绝不新建", () => {
    const root = freshRoot();
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    const first = store.read();
    expect(first.reason).toBe("not-found");
    expect(first.view.enableSystemProxy).toBeNull();
    const wrote = store.write({ enable_system_proxy: true });
    expect(wrote).toMatchObject({ ok: false, reason: "not-found" });
    expect(existsSync(path.join(root, "verge.yaml"))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("坏 YAML：read 回 bad-yaml，write 零写入（连备份都不产）", () => {
    const root = freshRoot();
    const file = seed(root, "language: zh\n\tbroken: [\n");
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    expect(store.read().reason).toBe("bad-yaml");
    const before = readFileSync(file, "utf8");
    expect(store.write({ enable_tun_mode: true })).toMatchObject({ ok: false, reason: "bad-yaml" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(root)).toEqual(["verge.yaml"]);
  });

  it("Verge 在跑：verge-running 且一个字节都不落", () => {
    const root = freshRoot();
    const file = seed(root);
    const before = readFileSync(file, "utf8");
    const store = createVergeSettingsStore({ root, isVergeRunning: () => true, now: () => AT.getTime() });
    expect(store.write({ enable_system_proxy: false })).toMatchObject({ ok: false, reason: "verge-running" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(root)).toEqual(["verge.yaml"]);
  });

  it("写成功：先备份再换文件，读回来是新的，别的键还在", () => {
    const root = freshRoot();
    const file = seed(root);
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    const result = store.write({ enable_system_proxy: false, verge_mixed_port: 7890 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.view.enableSystemProxy).toBe(false);
      expect(result.view.mixedPort).toBe(7890);
      expect(result.changed).toEqual(["enable_system_proxy", "verge_mixed_port"]);
    }
    const text = readFileSync(file, "utf8");
    expect(text).toContain("enable_system_proxy: false\n");
    expect(text).toContain("verge_mixed_port: 7890\n");
    expect(text).toContain("auto_check_update: true\n");
    const backups = readdirSync(root).filter((name) => name.startsWith("verge.yaml.bak-mochi-"));
    expect(backups).toEqual(["verge.yaml.bak-mochi-20261030-153000"]);
    expect(readFileSync(path.join(root, backups[0]), "utf8")).toBe(REAL_SHAPE);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("落盘是从头验证过的文本，不是「拼一半就写」：坏键在写之前就拒", () => {
    const root = freshRoot();
    const file = seed(root);
    const before = readFileSync(file, "utf8");
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    expect(store.write({ enable_auto_launch: false })).toMatchObject({ ok: false, reason: "bad-key" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(root)).toEqual(["verge.yaml"]);
  });

  it("写成功回的是读回来的值，不是发出去的值（盘上真是什么样只有读了才算）", () => {
    const root = freshRoot();
    seed(root);
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    const result = store.write({ system_proxy_bypass: "localhost;<local>" });
    expect(result.ok).toBe(true);
    const onDisk = readFileSync(path.join(root, "verge.yaml"), "utf8");
    expect(pickVergeSettings(parseYaml(onDisk)).systemProxyBypass).toBe("localhost;<local>");
    if (result.ok) expect(result.view.systemProxyBypass).toBe(pickVergeSettings(parseYaml(onDisk)).systemProxyBypass);
  });

  it("同一路径连写两次：两份备份，第二份不覆盖第一份", () => {
    const root = freshRoot();
    seed(root);
    let clock = AT.getTime();
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => clock });
    expect(store.write({ enable_tun_mode: true }).ok).toBe(true);
    clock = AT.getTime() + 500;
    expect(store.write({ enable_tun_mode: false }).ok).toBe(true);
    const backups = readdirSync(root).filter((name) => name.includes("bak-mochi-")).sort();
    expect(backups).toEqual(["verge.yaml.bak-mochi-20261030-153000", "verge.yaml.bak-mochi-20261030-153000-2"]);
    expect(readFileSync(path.join(root, "verge.yaml"), "utf8")).toContain("enable_tun_mode: false\n");
  });

  it("白名单只有一份：keys 表与 pick 的字段数对上，加键必须同时改判据", () => {
    expect(VERGE_SETTING_KEYS).toEqual([
      "enable_system_proxy",
      "system_proxy_bypass",
      "use_default_bypass",
      "enable_tun_mode",
      "verge_mixed_port",
      "verge_socks_port",
      "verge_port",
    ]);
  });
});

describe("读回来的口径", () => {
  it("stat 读不到文件时不抛（read 的返回值是唯一出口）", () => {
    const root = freshRoot();
    const store = createVergeSettingsStore({ root, isVergeRunning: () => false, now: () => AT.getTime() });
    expect(() => store.read()).not.toThrow();
    expect(statSync(root).isDirectory()).toBe(true);
  });
});

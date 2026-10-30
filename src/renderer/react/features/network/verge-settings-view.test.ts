import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
import {
  VERGE_SETTING_KEYS,
  VERGE_SETTING_LABELS,
  type VergeSettingsReason,
  type VergeSettingsView,
} from "../../../../shared/verge-settings-types";
import {
  EMPTY_SYSTEM_PROXY_STATUS,
  type SystemProxyAlign,
  type SystemProxyReason,
} from "../../../../shared/system-proxy-types";
import {
  alignKeyOf,
  draftFromSettings,
  effectiveBypass,
  invalidVergeFields,
  proxyStateOf,
  settingLabelKey,
  sysProxyReasonKey,
  vergePatchFromDraft,
  yamlProxySwitchKey,
  type VergeDraft,
} from "./verge-settings-view";

const VIEW: VergeSettingsView = {
  enableSystemProxy: true,
  systemProxyBypass: "localhost;10.*",
  useDefaultBypass: false,
  enableTunMode: false,
  mixedPort: 7890,
  socksPort: 7891,
  httpPort: 7892,
};

const DRAFT: VergeDraft = {
  tun: "off",
  mixedPort: "7890",
  socksPort: "7891",
  httpPort: "7892",
  useDefaultBypass: false,
  bypass: "localhost;10.*",
};

describe("verge.yaml 的读回 → 表单初值", () => {
  it("null 是「盘上没这把键」，不许画成 0 或 false", () => {
    const draft = draftFromSettings({
      enableSystemProxy: null,
      systemProxyBypass: null,
      useDefaultBypass: null,
      enableTunMode: null,
      mixedPort: null,
      socksPort: null,
      httpPort: null,
    });
    expect(draft.mixedPort).toBe("");
    expect(draft.socksPort).toBe("");
    expect(draft.httpPort).toBe("");
    expect(draft.bypass).toBe("");
  });

  it("TUN 的 null 是「跟随内核」那一档，不是关", () => {
    expect(draftFromSettings({ ...VIEW, enableTunMode: null }).tun).toBe("follow");
    expect(draftFromSettings({ ...VIEW, enableTunMode: true }).tun).toBe("on");
    expect(draftFromSettings({ ...VIEW, enableTunMode: false }).tun).toBe("off");
  });

  it("「用默认例外」没写过时按 Verge 自己的默认（开）起画", () => {
    expect(draftFromSettings({ ...VIEW, useDefaultBypass: null }).useDefaultBypass).toBe(true);
    expect(draftFromSettings({ ...VIEW, useDefaultBypass: false }).useDefaultBypass).toBe(false);
  });

  it("盘上的值原样落进框里", () => {
    expect(draftFromSettings(VIEW)).toEqual(DRAFT);
  });
});

describe("就地校验", () => {
  it("空串是「不改」，0 是合法端口，70000 与非数字才报错", () => {
    expect(invalidVergeFields({ ...DRAFT, mixedPort: "" })).toEqual([]);
    expect(invalidVergeFields({ ...DRAFT, mixedPort: "0" })).toEqual([]);
    expect(invalidVergeFields({ ...DRAFT, mixedPort: "70000" })).toEqual(["mixedPort"]);
    expect(invalidVergeFields({ ...DRAFT, httpPort: "78a" })).toEqual(["httpPort"]);
    expect(invalidVergeFields({ ...DRAFT, mixedPort: "70000", socksPort: "-1" })).toEqual(["mixedPort", "socksPort"]);
  });

  it("例外超长或带控制字符时点名 bypass", () => {
    expect(invalidVergeFields({ ...DRAFT, bypass: "a".repeat(2049) })).toEqual(["bypass"]);
    expect(invalidVergeFields({ ...DRAFT, bypass: "localhost\n10.*" })).toEqual(["bypass"]);
    // 清空是「回到跟随默认」，不是坏值。
    expect(invalidVergeFields({ ...DRAFT, bypass: "   " })).toEqual([]);
  });
});

describe("保存只发改过的键", () => {
  it("一个没动就是空补丁（组件据此禁用保存）", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT })).toEqual({});
    // 首尾空白不算改动：不然「点进框里再点出去」也会往盘上加一把键。
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, mixedPort: " 7890 ", bypass: " localhost;10.* " })).toEqual({});
  });

  it("端口改一个就只发那一个", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, socksPort: "7899" })).toEqual({ verge_socks_port: 7899 });
  });

  it("端口清空不算改动——那是「跟着默认」，而删键不是这一页的权限", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, mixedPort: "" })).toEqual({});
  });

  it("坏端口绝不进补丁（NaN 落盘是写坏配置文件）", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, mixedPort: "99999" })).toEqual({});
  });

  it("TUN 三档各写各的值，跟随内核写 null 而不是缺席", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, tun: "on" })).toEqual({ enable_tun_mode: true });
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, tun: "follow" })).toEqual({ enable_tun_mode: null });
    expect(vergePatchFromDraft({ ...DRAFT, tun: "follow" }, { ...DRAFT, tun: "off" })).toEqual({ enable_tun_mode: false });
  });

  it("例外清空写成 null（删掉那把键），不是空串（那是一条都不豁免）", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, bypass: "" })).toEqual({ system_proxy_bypass: null });
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, bypass: "localhost" })).toEqual({ system_proxy_bypass: "localhost" });
  });

  it("「用默认例外」翻一下只发那把键", () => {
    expect(vergePatchFromDraft(DRAFT, { ...DRAFT, useDefaultBypass: true })).toEqual({ use_default_bypass: true });
  });

  it("发出去的键全都在白名单里", () => {
    const patch = vergePatchFromDraft(DRAFT, {
      tun: "on",
      mixedPort: "7897",
      socksPort: "7898",
      httpPort: "7899",
      useDefaultBypass: true,
      bypass: "localhost",
    });
    expect(Object.keys(patch).sort()).toEqual([
      "enable_tun_mode",
      "system_proxy_bypass",
      "use_default_bypass",
      "verge_mixed_port",
      "verge_port",
      "verge_socks_port",
    ].sort());
    for (const key of Object.keys(patch)) {
      expect(VERGE_SETTING_KEYS, key).toContain(key);
    }
  });
});

describe("开关与回执的说法", () => {
  it("注册表读回的三种状态分得开", () => {
    expect(proxyStateOf({ ...EMPTY_SYSTEM_PROXY_STATUS, enabled: true })).toBe("on");
    expect(proxyStateOf({ ...EMPTY_SYSTEM_PROXY_STATUS, enabled: false })).toBe("off");
    expect(proxyStateOf(EMPTY_SYSTEM_PROXY_STATUS)).toBe("unset");
  });

  it("勾了「用默认例外」时，页面上要报出真正会写进系统的那一串", async () => {
    const { DEFAULT_SYSTEM_PROXY_BYPASS } = await import("../../../../shared/system-proxy-types");
    expect(effectiveBypass({ ...DRAFT, useDefaultBypass: true })).toBe(DEFAULT_SYSTEM_PROXY_BYPASS);
    expect(effectiveBypass({ ...DRAFT, useDefaultBypass: false, bypass: " localhost;10.* " })).toBe("localhost;10.*");
  });

  it("对齐回执五档都有话可说", () => {
    const cases: Array<[SystemProxyAlign, string]> = [
      [{ state: "aligned" }, "network.verge.align.aligned"],
      [{ state: "skipped", reason: "verge-running" }, "network.verge.align.skipped.verge-running"],
      [{ state: "skipped", reason: "no-file" }, "network.verge.align.skipped.no-file"],
      [{ state: "skipped", reason: "not-applied" }, "network.verge.align.skipped.not-applied"],
      [{ state: "failed" }, "network.verge.align.failed"],
    ];
    for (const [align, key] of cases) expect(alignKeyOf(align)).toBe(key);
  });

  it("verge.yaml 那一行也分得开开 / 关 / 没写过", () => {
    expect(yamlProxySwitchKey(true)).toBe("network.verge.yamlOn");
    expect(yamlProxySwitchKey(false)).toBe("network.verge.yamlOff");
    expect(yamlProxySwitchKey(null)).toBe("network.verge.yamlUnset");
  });
});

/**
 * 枚举锁：新增一档状态（比如又一个 SystemProxyReason）却忘了配一句话时，这里必须红。
 * 漏掉的说法在页面上会长成 `network.verge.sysReason.xxx`——i18next 缺 key 就回吐 key 本身，
 * 用户看到的是路径而不是话。
 */
describe("每一档状态都有三份语言的措辞", () => {
  const RESOURCES: Record<string, Record<string, unknown>> = {
    "zh-CN": zhCN as unknown as Record<string, unknown>,
    en: en as unknown as Record<string, unknown>,
    "ja-JP": jaJP as unknown as Record<string, unknown>,
  };

  function leaf(locale: string, key: string): unknown {
    let node: unknown = RESOURCES[locale];
    // 与 i18next 的默认 keySeparator 同口径：点分路径逐段下钻，段内的连字符留在段名里。
    for (const part of key.split(".")) {
      if (typeof node !== "object" || node === null) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return node;
  }

  const SYS_REASONS: SystemProxyReason[] = [
    "unsupported", "bad-value", "read-failed", "write-failed", "broadcast-failed", "mismatch", "no-port",
  ];
  const SETTINGS_REASONS: VergeSettingsReason[] = [
    "verge-running", "not-found", "bad-yaml", "bad-key", "bad-value", "write-failed", "read-failed",
  ];

  it.each(SYS_REASONS)("系统代理失败原因 %s 三种语言都有一句话", (reason) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, sysProxyReasonKey(reason));
      expect(typeof value, `${locale} · ${reason}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${reason}`).not.toBe("");
    }
  });

  it.each(SETTINGS_REASONS)("verge.yaml 读写失败原因 %s 三种语言都有一句话", (reason) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, `network.verge.reason.${reason}`);
      expect(typeof value, `${locale} · ${reason}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${reason}`).not.toBe("");
    }
  });

  it.each([
    "network.verge.proxyOn", "network.verge.proxyOff", "network.verge.proxyUnset",
    "network.verge.yamlOn", "network.verge.yamlOff", "network.verge.yamlUnset",
    "network.verge.align.aligned", "network.verge.align.failed",
    "network.verge.align.skipped.verge-running", "network.verge.align.skipped.no-file",
    "network.verge.align.skipped.not-applied",
  ])("%s 三种语言都补齐", (key) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, key);
      expect(typeof value, `${locale} · ${key}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
    }
  });

  it.each(VERGE_SETTING_KEYS)("白名单键 %s 的标签三种语言齐全", (key) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, settingLabelKey(key));
      expect(typeof value, `${locale} · ${key}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
    }
  });

  /** 「页面上叫 A、回执里叫 B」就是这张表分家了——共用同一份键名表，中文档必须一字不差。 */
  it("zh-CN 的键标签就是 shared 里那份 VERGE_SETTING_LABELS", () => {
    for (const key of VERGE_SETTING_KEYS) {
      expect(leaf("zh-CN", settingLabelKey(key)), key).toBe(VERGE_SETTING_LABELS[key]);
    }
  });

  /**
   * 组件里写死的 key 也要落到一句人话。
   * 上面几条按枚举生成 key，漏的是「新增一档状态没配话」；这条反过来扫源码，
   * 漏的是「组件引用了一把谁都没定义的 key」——三种语言一起缺时，key 平价锁照样是绿的，
   * 用户看到的却是一行 `network.verge.proxyTurnedOn`（i18next 缺 key 回吐 key 本身）。
   */
  it("VergeSettingsSection 里写死的每个 key 三种语言都有值", () => {
    const src = readFileSync(resolve(__dirname, "VergeSettingsSection.tsx"), "utf8");
    const keys = [...new Set([...src.matchAll(/"(network\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]))];
    // 正对照：路径写错或正则塌了会扫出 0 个，那不该读成全绿。
    expect(keys.length, "一把 key 都没扫到，尺子 itself 坏了").toBeGreaterThan(25);
    for (const key of keys) {
      for (const locale of Object.keys(RESOURCES)) {
        const value = leaf(locale, key);
        expect(typeof value, `${locale} · ${key}`).toBe("string");
        expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
      }
    }
  });
});

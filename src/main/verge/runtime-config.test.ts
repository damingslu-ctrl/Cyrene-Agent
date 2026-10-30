import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  applyMergeChain,
  buildRuntimeConfig,
  mergeChainOf,
  runtimeConfigPath,
} from "./runtime-config";
import type { ProfilesDoc } from "./profiles-store";

const SUBSCRIPTION = {
  "mixed-port": 7890,
  mode: "rule",
  proxies: [{ name: "A", type: "ss" }, { name: "B", type: "vmess" }],
  "proxy-groups": [{ name: "🚀 节点选择", type: "select", proxies: ["A"] }],
  rules: ["MATCH"],
  dns: { enable: true, "nameserver": ["223.5.5.5"], "fake-ip-range": "198.18.0.1/16" },
};

describe("runtime-config merge 链", () => {
  it("深合并 map：只改给到的子键，数组整体替换（不是拼接）", () => {
    const out = applyMergeChain(SUBSCRIPTION, [{ dns: { "nameserver": ["1.1.1.1"] }, mode: "global" }]) as Record<string, unknown>;
    const dns = out.dns as Record<string, unknown>;
    expect(dns["nameserver"]).toEqual(["1.1.1.1"]);
    expect(dns.enable).toBe(true);
    expect(dns["fake-ip-range"]).toBe("198.18.0.1/16");
    expect(out.mode).toBe("global");
  });

  it("prepend-/append- 列表按「贴在哪一头」拼，指令键本体不许留在输出里", () => {
    const out = applyMergeChain(SUBSCRIPTION, [{
      "prepend-rules": ["RULE-SET,https://example.test/reject.txt,REJECT"],
      "append-rules": ["MATCH,direct"],
    }]) as Record<string, unknown>;
    expect(out.rules).toEqual([
      "RULE-SET,https://example.test/reject.txt,REJECT",
      "MATCH",
      "MATCH,direct",
    ]);
    expect(Object.keys(out)).not.toContain("prepend-rules");
    expect(Object.keys(out)).not.toContain("append-rules");
  });

  it("prepend-proxies / prepend-proxy-groups 同样生效（扩展配置最常动的就是这两处）", () => {
    const out = applyMergeChain(SUBSCRIPTION, [{
      "append-proxies": [{ name: "C", type: "socks5" }],
      "prepend-proxy-groups": [{ name: "🐟 漏网之鱼", type: "select" }],
    }]) as Record<string, unknown>;
    expect((out.proxies as unknown[]).map((p) => (p as { name: string }).name)).toEqual(["A", "B", "C"]);
    expect((out["proxy-groups"] as unknown[]).map((g) => (g as { name: string }).name))
      .toEqual(["🐟 漏网之鱼", "🚀 节点选择"]);
  });

  it("多份 merge 按链上顺序依次作用：后一份改的是前一份的结果", () => {
    const out = applyMergeChain(SUBSCRIPTION, [
      { "prepend-rules": ["FROM-FIRST"], mode: "direct" },
      { "prepend-rules": ["FROM-SECOND"] },
    ]) as Record<string, unknown>;
    expect(out.rules).toEqual(["FROM-SECOND", "FROM-FIRST", "MATCH"]);
    expect(out.mode).toBe("direct");
  });

  it("merge 里写 null 是「删掉这个键」（Verge 的扩展配置就这么关功能）", () => {
    const out = applyMergeChain(SUBSCRIPTION, [{ dns: null, "mixed-port": null }]) as Record<string, unknown>;
    expect(Object.keys(out)).not.toContain("dns");
    expect(Object.keys(out)).not.toContain("mixed-port");
  });

  it("不改传入对象：merge 链跑完，订阅本体还是原样", () => {
    const before = JSON.stringify(SUBSCRIPTION);
    applyMergeChain(SUBSCRIPTION, [{ mode: "global", "append-rules": ["X"] }]);
    expect(JSON.stringify(SUBSCRIPTION)).toBe(before);
  });
});

describe("runtime-config 链的选取", () => {
  const doc: ProfilesDoc = {
    current: "Sub00000001",
    items: [
      { uid: "Merge", type: "merge", file: "Merge.yaml" },
      { uid: "Script", type: "script", file: "Script.js" },
      { uid: "ExtraMerge", type: "merge", file: "ExtraMerge.yaml" },
      { uid: "AttachRules", type: "rules", file: "AttachRules.yaml" },
      { uid: "Sub00000001", type: "remote", file: "Sub00000001.yaml", option: { merge: "ExtraMerge" } },
      { uid: "Sub00000002", type: "remote", file: "Sub00000002.yaml" },
      { uid: "Sub00000003", type: "remote", file: "Sub00000003.yaml", option: { merge: "Ghost000000" } },
      { uid: "Sub00000004", type: "remote", file: "Sub00000004.yaml", option: { merge: ["ExtraMerge", "AttachRules"] } },
    ],
  };

  it("option.merge 指定就用指定的；没指定回落内置 Merge", () => {
    expect(mergeChainOf(doc, "Sub00000001")).toEqual(["ExtraMerge"]);
    expect(mergeChainOf(doc, "Sub00000002")).toEqual(["Merge"]);
  });

  it("数组形态（新版 Verge 可挂多份）按给出的顺序排，非 merge 类型与不存在的 uid 跳过", () => {
    expect(mergeChainOf(doc, "Sub00000003")).toEqual(["Merge"]);
    expect(mergeChainOf(doc, "Sub00000004")).toEqual(["ExtraMerge"]);
  });

  it("账本里连 Merge 都没有 → 空链，不硬造一个不存在的文件", () => {
    const bare: ProfilesDoc = { current: "S", items: [{ uid: "S", type: "remote", file: "S.yaml" }] };
    expect(mergeChainOf(bare, "S")).toEqual([]);
  });

  it("不存在的 profile uid 直接空链（切换那一步会先拒）", () => {
    expect(mergeChainOf(doc, "NoSuchUid0000")).toEqual([]);
  });
});

describe("runtime-config 注入与产出", () => {
  const INJECT = {
    "external-controller": "127.0.0.1:7897",
    "secret": "mochi-key",
    "mixed-port": 7895,
    "external-controller-cors": { "allow-private-network": false },
  };

  it("注入键压过订阅自己的控制器/端口（内核必须听本客户端的）", () => {
    const sub = { ...SUBSCRIPTION, "external-controller": "127.0.0.1:9090", secret: "sub-secret", "mixed-port": 7890 };
    const res = buildRuntimeConfig({ subscription: sub, merges: [], inject: INJECT });
    expect(res.ok).toBe(true);
    const doc = (res as { doc: Record<string, unknown> }).doc;
    expect(doc["external-controller"]).toBe("127.0.0.1:7897");
    expect(doc.secret).toBe("mochi-key");
    expect(doc["mixed-port"]).toBe(7895);
  });

  it("merge 想改控制器也改不动：注入排在链尾", () => {
    const res = buildRuntimeConfig({
      subscription: SUBSCRIPTION,
      merges: [{ "external-controller": "0.0.0.0:9090", "append-rules": ["X"] }],
      inject: INJECT,
    });
    const doc = (res as { doc: Record<string, unknown> }).doc;
    expect(doc["external-controller"]).toBe("127.0.0.1:7897");
    expect(doc.rules).toEqual(["MATCH", "X"]);
  });

  it("产出能 parse 回来、且与 doc 同值；坏订阅（非 map）拒绝而不是一份空配置", () => {
    const res = buildRuntimeConfig({ subscription: SUBSCRIPTION, merges: [{ mode: "global" }], inject: INJECT });
    expect(res.ok).toBe(true);
    const r = res as { doc: Record<string, unknown>; yaml: string };
    expect(parseYaml(r.yaml)).toEqual(r.doc);
    for (const bad of [null, "hello", 42, ["a"], undefined]) {
      const out = buildRuntimeConfig({ subscription: bad, merges: [], inject: INJECT });
      expect(out.ok, JSON.stringify(bad)).toBe(false);
      expect((out as { reason: string }).reason).toBe("bad-subscription");
    }
  });

  it("长值不许折行：订阅密码/base64 被 YAML 折出换行，读回来就多个空格", () => {
    const long = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
    const res = buildRuntimeConfig({
      subscription: { proxies: [{ name: "A", password: long }] },
      merges: [],
      inject: INJECT,
    }) as { yaml: string; doc: Record<string, unknown> };
    expect(res.yaml).toContain(long);
    const back = parseYaml(res.yaml) as { proxies: Array<{ password: string }> };
    expect(back.proxies[0].password).toBe(long);
  });

  it("runtime 文件名按 uid 钉死，落在 userData/runtime 下", () => {
    expect(runtimeConfigPath("C:\\Users\\x\\AppData\\Roaming\\Mochi", "Sub00000001"))
      .toMatch(/runtime[\\/]Sub00000001\.yaml$/);
  });

  it("merge 链把订阅里的规则整段换掉时，注入的键仍在（配置不能没有控制器）", () => {
    const res = buildRuntimeConfig({
      subscription: SUBSCRIPTION,
      merges: [{ rules: ["GEOIP,CN,DIRECT"], "external-controller": null }],
      inject: INJECT,
    }) as { doc: Record<string, unknown> };
    expect(res.doc.rules).toEqual(["GEOIP,CN,DIRECT"]);
    expect(res.doc["external-controller"]).toBe("127.0.0.1:7897");
  });
});

/**
 * Wave 3 T9：系统代理（WinINET，HKCU 那份）的读写与广播。
 *
 * 判据只有一条硬的：**开关状态以读回来的值为准**（spec D4）。点下去就算成了，
 * 是这一层最容易犯的假绿——组策略、别的应用、写失败的第二个键都能让盘上不是那个值。
 * 所以下面每一条写都跟着一次读，读不回来就不许说 ok。
 *
 * 真机活性那一条默认跳过：`CYRENE_SYS_PROXY_PROBE=1` 才跑（它只动一个自建的暂存键，
 * 跑完当场删掉，不碰 Internet Settings——那是用户此刻上网的路）。
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  applySystemProxy,
  buildProxyServer,
  DEFAULT_SYSTEM_PROXY_BYPASS,
  INTERNET_SETTINGS_KEY,
  parseProxyJson,
  readSystemProxy,
  type ExecCall,
  type SystemProxyStatus,
} from "./system-proxy";

const NULLS: SystemProxyStatus = { enabled: null, server: null, bypass: null };

/** 命令文本里出现 `-Name Proxy<X>` 就当成动那一把键。 */
function writtenName(command: string): string | null {
  return /-Name (Proxy\w+)/.exec(command)?.[1] ?? null;
}

interface FakeRegistry {
  values: Record<string, string | number | null>;
  failOn?: string;
  failBroadcast?: boolean;
  /** 读回来还是请求前的旧值：组策略/别的应用当场回滚的形状。 */
  revert?: string;
}

function makeFake(registry: FakeRegistry) {
  const calls: ExecCall[] = [];
  const original: Record<string, string | number | null> = { ...registry.values };
  const envFor: Record<string, string> = {
    ProxyEnable: "MOCHI_PROXY_ENABLE",
    ProxyServer: "MOCHI_PROXY_SERVER",
    ProxyOverride: "MOCHI_PROXY_BYPASS",
  };
  const exec = (call: ExecCall): string => {
    calls.push(call);
    const command = call.args[3] ?? "";
    if (registry.failBroadcast && command.includes("SendMessageTimeout")) {
      throw new Error("Add-Type 找不到编译器");
    }
    const name = writtenName(command);
    if (registry.failOn && name === registry.failOn) throw new Error(`拒绝访问: ${registry.failOn}`);
    if (command.includes("ConvertTo-Json")) {
      const out: Record<string, unknown> = {};
      for (const key of ["ProxyEnable", "ProxyServer", "ProxyOverride"]) {
        const value = key === registry.revert ? original[key] : registry.values[key];
        if (value !== undefined && value !== null) out[key] = value;
      }
      return JSON.stringify(out);
    }
    if (!name) return "";
    if (command.includes("Remove-ItemProperty")) {
      registry.values[name] = null;
      return "";
    }
    const raw = call.env[envFor[name]];
    registry.values[name] = name === "ProxyEnable" ? Number(raw ?? 0) : raw ?? "";
    return "";
  };
  return { calls, exec, values: registry.values };
}

describe("parseProxyJson：读回来的形状", () => {
  it("三把值都在时逐条对上", () => {
    expect(parseProxyJson(JSON.stringify({
      ProxyEnable: 1,
      ProxyServer: "127.0.0.1:7896",
      ProxyOverride: "localhost;127.*;<local>",
    }))).toEqual({ enabled: true, server: "127.0.0.1:7896", bypass: "localhost;127.*;<local>" });
  });

  it("ProxyEnable=0 是「关着」，不是「没写过」", () => {
    expect(parseProxyJson(JSON.stringify({ ProxyEnable: 0 })).enabled).toBe(false);
  });

  it("盘上根本没有那把键时读成 null，不冒充 false 或空串", () => {
    expect(parseProxyJson(JSON.stringify({ ProxyEnable: null, ProxyServer: null, ProxyOverride: null })))
      .toEqual(NULLS);
    expect(parseProxyJson("{}")).toEqual(NULLS);
  });

  it("PowerShell 带 BOM 的输出照样能解析", () => {
    const raw = `${String.fromCharCode(0xfeff)}{"ProxyEnable":1,"ProxyServer":"127.0.0.1:7896"}`;
    expect(parseProxyJson(raw)).toMatchObject({ enabled: true, server: "127.0.0.1:7896" });
  });

  it("ProxyServer 写成空串不是「有个地址是空」", () => {
    expect(parseProxyJson(JSON.stringify({ ProxyEnable: 1, ProxyServer: "" })).server).toBeNull();
  });

  it("ProxyOverride 的空串是「一条都不豁免」，和没写过不一样", () => {
    expect(parseProxyJson(JSON.stringify({ ProxyOverride: "" })).bypass).toBe("");
  });

  it("非 JSON 的垃圾输出读成空状态（调用方要报 read-failed，不能说代理是关的）", () => {
    expect(parseProxyJson("命令语法不正确。")).toEqual(NULLS);
    expect(parseProxyJson("")).toEqual(NULLS);
    expect(parseProxyJson("[1,2]")).toEqual(NULLS);
  });

  it("ProxyEnable 是字符串也不认（DWORD 被人写成 SZ 时不猜）", () => {
    expect(parseProxyJson(JSON.stringify({ ProxyEnable: "1" })).enabled).toBeNull();
  });
});

describe("buildProxyServer 与入参校验", () => {
  it("本机 + 端口拼成 WinINET 要的那个形状", () => {
    expect(buildProxyServer("127.0.0.1", 7896)).toBe("127.0.0.1:7896");
    expect(buildProxyServer("localhost", 7890)).toBe("localhost:7890");
  });

  it("端口越界、主机带端口/空格/分号一律拒", () => {
    for (const bad of [["127.0.0.1", 0], ["127.0.0.1", 70000], ["127.0.0.1:7896", 7896],
      ["127.0.0.1 ", 7896], ["a;b", 7896], ["", 7896]] as const) {
      expect(() => buildProxyServer(bad[0], bad[1])).toThrowError(
        expect.objectContaining({ reason: "bad-value" }),
      );
    }
  });

  it("非环回的主机一律拒：这台机器的流量只能交给自己的内核", () => {
    // 「代理地址」在这一层永远是本机 mihomo 的监听口。放一个外部地址过去，
    // 就等于替用户把全机流量交给别人——这一条不是校验形状，是划边界。
    for (const bad of ["8.8.8.8", "10.0.0.5", "192.168.1.1", "proxy.example.com",
      "::1", "127.0.0.256", "0.0.0.0", "127.1"] as const) {
      expect(() => buildProxyServer(bad, 7896)).toThrowError(
        expect.objectContaining({ reason: "bad-value" }),
      );
    }
    expect(buildProxyServer("127.0.0.2", 7890)).toBe("127.0.0.2:7890");
  });

  it("例外列表里的控制字符与超长当场拒", () => {
    expect(applySystemProxy({ enabled: true, server: "127.0.0.1:7896", bypass: "a\u0000b" }, { exec: () => "", platform: "win32" }))
      .toMatchObject({ ok: false, reason: "bad-value" });
    expect(applySystemProxy({ enabled: true, server: "127.0.0.1:7896", bypass: "x".repeat(4096) }, { exec: () => "", platform: "win32" }))
      .toMatchObject({ ok: false, reason: "bad-value" });
  });
});

describe("applySystemProxy：写 → 广播 → 读回，状态以读回为准", () => {
  it("开代理：写三把键 + 一次广播 + 一次读回；值走环境变量而不进命令文本", () => {
    const registry = makeFake({ values: {} });
    const result = applySystemProxy(
      { enabled: true, server: "127.0.0.1:7896", bypass: "localhost;<local>" },
      { exec: registry.exec, platform: "win32" },
    );
    expect(result.ok).toBe(true);
    expect(registry.calls).toHaveLength(5);
    expect(registry.calls.map((call) => call.file)).toEqual(["powershell", "powershell", "powershell", "powershell", "powershell"]);
    for (const call of registry.calls) {
      expect(call.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
      expect(call.timeoutMs).toBeGreaterThan(0);
    }
    expect(registry.calls[0].env.MOCHI_PROXY_ENABLE).toBe("1");
    expect(registry.calls[0].args[3]).not.toContain("7896");
    expect(registry.calls[1].env.MOCHI_PROXY_SERVER).toBe("127.0.0.1:7896");
    expect(registry.calls[1].args[3]).not.toContain("127.0.0.1");
    expect(registry.calls[2].env.MOCHI_PROXY_BYPASS).toBe("localhost;<local>");
    expect(registry.calls[2].args[3]).not.toContain("<local>");
    expect(registry.calls[3].args[3]).toContain("SendMessageTimeout");
    expect(registry.calls[4].args[3]).toContain("ConvertTo-Json");
    expect(result.status).toEqual({ enabled: true, server: "127.0.0.1:7896", bypass: "localhost;<local>" });
  });

  it("每条命令都钉住那个 HKCU 键，不写 HKLM（普通用户写不了，也不该写）", () => {
    const registry = makeFake({ values: {} });
    applySystemProxy({ enabled: true, server: "127.0.0.1:7896" }, { exec: registry.exec, platform: "win32" });
    expect(registry.calls).toHaveLength(4);
    for (const call of registry.calls) {
      expect(call.args[3]).not.toContain("HKEY_LOCAL_MACHINE");
      expect(call.args[3]).not.toContain("HKLM:");
    }
    for (const call of registry.calls.filter((item) => !(item.args[3] ?? "").includes("SendMessageTimeout"))) {
      expect(call.args[3]).toContain(INTERNET_SETTINGS_KEY);
    }
    const broadcast = registry.calls.find((call) => (call.args[3] ?? "").includes("SendMessageTimeout"));
    expect(broadcast?.args[3]).toContain("'Internet Settings'");
  });

  it("关代理只动 ProxyEnable，不碰地址与例外（下次打开还得靠它们）", () => {
    const registry = makeFake({ values: { ProxyEnable: 1, ProxyServer: "127.0.0.1:7896", ProxyOverride: "localhost;<local>" } });
    const result = applySystemProxy({ enabled: false }, { exec: registry.exec, platform: "win32" });
    expect(result.ok).toBe(true);
    expect(registry.calls).toHaveLength(3);
    expect(writtenName(registry.calls[0].args[3] ?? "")).toBe("ProxyEnable");
    expect(registry.calls[1].args[3]).toContain("SendMessageTimeout");
    expect(registry.calls[2].args[3]).toContain("ConvertTo-Json");
    expect(registry.values.ProxyServer).toBe("127.0.0.1:7896");
    expect(registry.values.ProxyOverride).toBe("localhost;<local>");
  });

  it("没给 bypass 就不写例外；给了 null 就删掉那一把键", () => {
    const keep = makeFake({ values: { ProxyEnable: 1, ProxyOverride: "localhost" } });
    const kept = applySystemProxy({ enabled: true, server: "127.0.0.1:1" }, { exec: keep.exec, platform: "win32" });
    expect(kept.ok).toBe(true);
    expect(keep.calls.some((call) => writtenName(call.args[3] ?? "") === "ProxyOverride")).toBe(false);

    const wipe = makeFake({ values: { ProxyEnable: 1, ProxyOverride: "localhost" } });
    const result = applySystemProxy({ enabled: true, server: "127.0.0.1:1", bypass: null }, { exec: wipe.exec, platform: "win32" });
    expect(result.ok).toBe(true);
    expect(wipe.calls.some((call) => (call.args[3] ?? "").includes("Remove-ItemProperty"))).toBe(true);
    expect(wipe.values.ProxyOverride).toBeNull();
    if (result.ok) expect(result.status.bypass).toBeNull();
  });

  it("读回来不是那个值就说 mismatch，绝不报成功（组策略当场回滚的形状）", () => {
    const registry = makeFake({ values: { ProxyEnable: 0 }, revert: "ProxyEnable" });
    const result = applySystemProxy({ enabled: true, server: "127.0.0.1:7896" }, { exec: registry.exec, platform: "win32" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("mismatch");
      expect(result.status.enabled).toBe(false);
      expect(result.status.server).toBe("127.0.0.1:7896");
      expect(result.detail).toContain("ProxyEnable");
    }
  });

  it("写失败：不广播，但仍然读一次真状态回来报给用户", () => {
    const registry = makeFake({ values: { ProxyEnable: 0, ProxyServer: "127.0.0.1:7890" }, failOn: "ProxyServer" });
    const result = applySystemProxy({ enabled: true, server: "127.0.0.1:7896" }, { exec: registry.exec, platform: "win32" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("write-failed");
      expect(result.status.server).toBe("127.0.0.1:7890");
      expect(result.detail).toContain("ProxyServer");
    }
    expect(registry.calls.some((call) => (call.args[3] ?? "").includes("SendMessageTimeout"))).toBe(false);
  });

  it("广播失败：盘已经改了，就把真实状态连同 broadcast-failed 一起报出去", () => {
    const registry = makeFake({ values: {}, failBroadcast: true });
    const result = applySystemProxy({ enabled: true, server: "127.0.0.1:7896" }, { exec: registry.exec, platform: "win32" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("broadcast-failed");
      expect(result.status).toEqual({ enabled: true, server: "127.0.0.1:7896", bypass: null });
    }
  });

  it("非 Windows：unsupported，一次进程都不起", () => {
    const registry = makeFake({ values: {} });
    expect(applySystemProxy({ enabled: true, server: "127.0.0.1:7896" }, { exec: registry.exec, platform: "darwin" }))
      .toMatchObject({ ok: false, reason: "unsupported" });
    expect(registry.calls).toHaveLength(0);
  });

  it("空请求拒在门口（enabled 都不给，等于什么都不知道）", () => {
    const registry = makeFake({ values: {} });
    expect(applySystemProxy({}, { exec: registry.exec, platform: "win32" })).toMatchObject({ ok: false, reason: "bad-value" });
    expect(applySystemProxy(null, { exec: registry.exec, platform: "win32" })).toMatchObject({ ok: false, reason: "bad-value" });
    expect(registry.calls).toHaveLength(0);
  });

  it("开代理却不给地址：当场拒，不写一个「开着但没有地址」的状态", () => {
    const registry = makeFake({ values: {} });
    const result = applySystemProxy({ enabled: true }, { exec: registry.exec, platform: "win32" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-value");
    expect(registry.calls).toHaveLength(0);
  });
});

describe("readSystemProxy：只读，且读不到就说读不到", () => {
  it("盘上开着时回 enabled=true", () => {
    const registry = makeFake({ values: { ProxyEnable: 1, ProxyServer: "127.0.0.1:7896" } });
    const read = readSystemProxy({ exec: registry.exec, platform: "win32" });
    expect(read.reason).toBeNull();
    expect(read.status.enabled).toBe(true);
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0].args[3]).toContain("ConvertTo-Json");
    expect(registry.calls[0].args[3]).not.toContain("New-ItemProperty");
  });

  it("exec 抛错：read-failed，状态是一串 null 而不是「关着」", () => {
    const read = readSystemProxy({
      exec: () => { throw new Error("powershell 找不到"); },
      platform: "win32",
    });
    expect(read.reason).toBe("read-failed");
    expect(read.status).toEqual(NULLS);
  });

  it("非 Windows：unsupported，不起进程", () => {
    const calls: ExecCall[] = [];
    const read = readSystemProxy({
      exec: (call) => { calls.push(call); return "{}"; },
      platform: "linux",
    });
    expect(read.reason).toBe("unsupported");
    expect(read.status).toEqual(NULLS);
    expect(calls).toHaveLength(0);
  });
});

describe("默认例外表", () => {
  it("含 <local> 与私有段，不含公网段，长度在注册表吃得下的范围内", () => {
    expect(DEFAULT_SYSTEM_PROXY_BYPASS).toContain("<local>");
    expect(DEFAULT_SYSTEM_PROXY_BYPASS).toContain("192.168.*");
    expect(DEFAULT_SYSTEM_PROXY_BYPASS).not.toContain("8.8.8.8");
    expect(DEFAULT_SYSTEM_PROXY_BYPASS.length).toBeLessThanOrEqual(2048);
    const parts = DEFAULT_SYSTEM_PROXY_BYPASS.split(";");
    expect(new Set(parts).size).toBe(parts.length);
  });
});

/**
 * 真机通道活性：默认跳过。跑的话只碰一个自建的暂存键（跑完当场删），
 * 不碰 Internet Settings。
 */
const probe = process.env.CYRENE_SYS_PROXY_PROBE === "1" ? it : it.skip;
probe("真机：同一套命令文本在暂存键上写得进去也读得回来（含中文与 < 号）", () => {
  const scratch = "HKCU:\\Software\\MochiProbe";
  const value = "中文例外;127.*;<local>";
  const run = (command: string, env: Record<string, string> = {}): string =>
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, ...env },
    });
  try {
    run(`$ErrorActionPreference='Stop';New-Item -Path '${scratch}' -Force | Out-Null;`
      + `New-ItemProperty -Path '${scratch}' -Name ProxyOverride -PropertyType String -Value $env:MOCHI_PROXY_BYPASS -Force | Out-Null;`
      + `New-ItemProperty -Path '${scratch}' -Name ProxyEnable -PropertyType DWord -Value $env:MOCHI_PROXY_ENABLE -Force | Out-Null`,
      { MOCHI_PROXY_BYPASS: value, MOCHI_PROXY_ENABLE: "1" });
    const raw = run(`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;`
      + `Get-ItemProperty -Path '${scratch}' | Select-Object -Property ProxyEnable,ProxyServer,ProxyOverride | ConvertTo-Json -Compress`);
    expect(parseProxyJson(raw)).toEqual({ enabled: true, server: null, bypass: value });
    const broadcast = run(`$ErrorActionPreference='Stop';`
      + `Add-Type -Namespace Mochi -Name Win -MemberDefinition `
      + `'[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]`
      + `public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint msg,UIntPtr wParam,string lParam,uint flags,uint timeout,out IntPtr result);';`
      + `$res=[IntPtr]::Zero;`
      + `[void]([Mochi.Win]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Internet Settings',0x2,3000,[ref]$res));`
      + `Write-Output 'sent'`);
    expect(broadcast.trim()).toBe("sent");
  } finally {
    run(`Remove-Item -Path '${scratch}' -Recurse -Force -ErrorAction SilentlyContinue`);
    let gone = false;
    try {
      execFileSync("reg", ["query", "HKCU\\Software\\MochiProbe"], { encoding: "utf8", windowsHide: true });
    } catch {
      gone = true;
    }
    expect(gone).toBe(true);
  }
}, 60000);

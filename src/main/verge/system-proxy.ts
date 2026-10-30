/**
 * Wave 3 T9：读写 Windows 系统代理（WinINET 的 HKCU 那三份值）。
 *
 * 为什么是 PowerShell 而不是 `reg.exe`：注册表里的字符串是 UTF-16，`reg.exe` 按控制台
 * 代码页输出——中文 Windows 上非 ASCII 的例外列表读回来就是一串问号，
 * 读回比对会当场变成假的 mismatch（实测过：`ProbeValue REG_SZ 中文…` → `???`）。
 * PowerShell 里把 `[Console]::OutputEncoding` 钉成 UTF-8 再 `ConvertTo-Json`，中文与 `<local>`
 * 都能原样回来。
 *
 * 值一律走环境变量递给子进程，命令文本永远是常量：用户填的例外列表里出现 `;`、引号、
 * `$()` 都不该有机会改命令的语义——这是这条路上唯一能挡住「配置内容变成代码」的形状。
 */
import { execFileSync } from "node:child_process";
import {
  EMPTY_SYSTEM_PROXY_STATUS,
  MAX_SYSTEM_PROXY_BYPASS_LENGTH,
  type SystemProxyRead,
  type SystemProxyReason,
  type SystemProxyRequest,
  type SystemProxyResult,
  type SystemProxyStatus,
} from "../../shared/system-proxy-types";

export * from "../../shared/system-proxy-types";

/** Verge 与自家设置页用的都是这一把键；HKLM 那份要管理员，而且会盖住别人策略配的东西，不碰。 */
export const INTERNET_SETTINGS_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

const VALUE_NAMES = {
  enable: "ProxyEnable",
  server: "ProxyServer",
  bypass: "ProxyOverride",
} as const;

const ENV_NAMES = {
  enable: "MOCHI_PROXY_ENABLE",
  server: "MOCHI_PROXY_SERVER",
  bypass: "MOCHI_PROXY_BYPASS",
} as const;

const READ_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 8000;
const BROADCAST_TIMEOUT_MS = 6000;

export interface ExecCall {
  file: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

/** 起一个子进程并回 stdout；非零退出/起不来都要抛——「静悄悄失败」在这一层是最坏的形状。 */
export type ExecPort = (call: ExecCall) => string;

export interface SystemProxyDeps {
  exec?: ExecPort;
  /** 注入平台名只为把「非 Windows 一次进程都不起」这条判据写得可测。 */
  platform?: string;
}

export class SystemProxyError extends Error {
  readonly reason: SystemProxyReason;

  constructor(reason: SystemProxyReason, message: string) {
    super(message);
    this.name = "SystemProxyError";
    this.reason = reason;
  }
}

const PS_ARGS = ["-NoProfile", "-NonInteractive", "-Command"] as const;

/** 读回来的是 JSON，所以命令文本不含任何用户数据；`[Console]::OutputEncoding` 那一句是编码活性开关。 */
export function buildReadCommand(): string {
  return [
    "$ErrorActionPreference='Stop';",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;",
    `Get-ItemProperty -Path '${INTERNET_SETTINGS_KEY}' |`,
    "  Select-Object -Property ProxyEnable,ProxyServer,ProxyOverride |",
    "  ConvertTo-Json -Compress",
  ].join(" ");
}

export function buildWriteCommand(name: keyof typeof VALUE_NAMES): string {
  const type = name === "enable" ? "DWord" : "String";
  return [
    "$ErrorActionPreference='Stop';",
    `New-ItemProperty -Path '${INTERNET_SETTINGS_KEY}' -Name ${VALUE_NAMES[name]}`,
    `-PropertyType ${type} -Value $env:${ENV_NAMES[name]} -Force | Out-Null`,
  ].join(" ");
}

export function buildRemoveCommand(name: "bypass"): string {
  return [
    "$ErrorActionPreference='Stop';",
    `Remove-ItemProperty -Path '${INTERNET_SETTINGS_KEY}' -Name ${VALUE_NAMES[name]} -ErrorAction SilentlyContinue`,
  ].join(" ");
}

/**
 * `WM_SETTINGCHANGE` + lParam `"Internet Settings"`：WinINET 的应用（含 IE 内核的组件）
 * 收到后重新读那三份值。只写注册表不广播，用户看到的是「改了但浏览器没反应」。
 */
export function buildBroadcastCommand(): string {
  return [
    "$ErrorActionPreference='Stop';",
    "Add-Type -Namespace Mochi -Name Win -MemberDefinition",
    ` '[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]`,
    `public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint msg,UIntPtr wParam,`,
    `string lParam,uint flags,uint timeout,out IntPtr result);';`,
    `$res=[IntPtr]::Zero;`,
    `[void]([Mochi.Win]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Internet Settings',0x2,3000,[ref]$res))`,
  ].join("");
}

function defaultExec(call: ExecCall): string {
  return execFileSync(call.file, call.args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: call.timeoutMs,
    env: { ...process.env, ...call.env },
  });
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseProxyJson(raw: string): SystemProxyStatus {
  let doc: unknown;
  try {
    doc = JSON.parse(stripBom(raw).trim());
  } catch {
    return { ...EMPTY_SYSTEM_PROXY_STATUS };
  }
  const root = asRecord(doc);
  if (!root) return { ...EMPTY_SYSTEM_PROXY_STATUS };
  const enabled = root[VALUE_NAMES.enable];
  const server = root[VALUE_NAMES.server];
  const bypass = root[VALUE_NAMES.bypass];
  return {
    // DWORD 才是这一把键的形状；字符串/布尔说明盘被别的工具写成别的类型了，不猜。
    enabled: typeof enabled === "number" && Number.isFinite(enabled) ? enabled !== 0 : null,
    server: typeof server === "string" && server.trim() !== "" ? server : null,
    bypass: typeof bypass === "string" ? bypass : null,
  };
}

function call(exec: ExecPort, command: string, env: Record<string, string>, timeoutMs: number): void {
  exec({ file: "powershell", args: [...PS_ARGS, command], env, timeoutMs });
}

/** loopback 之外一律拒：这条路上「代理地址」永远是这台机器自己的 mihomo，指向别处等于替用户决定流量出境。 */
export function buildProxyServer(host: string, port: number): string {
  const trimmed = host.trim();
  if (trimmed !== host) throw new SystemProxyError("bad-value", "proxy host has surrounding spaces");
  if (trimmed.length === 0 || trimmed.length > 253) throw new SystemProxyError("bad-value", "proxy host is empty or too long");
  if (!/^[0-9a-zA-Z._-]+$/.test(trimmed)) {
    throw new SystemProxyError("bad-value", "proxy host has forbidden characters");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SystemProxyError("bad-value", "proxy port must be 1..65535");
  }
  if (!isLoopbackHost(trimmed)) throw new SystemProxyError("bad-value", "proxy host must be loopback");
  return `${trimmed}:${port}`;
}

/** `localhost` 与 127/8 整段都算本机；四段还要逐段验到 255，`127.0.0.256` 那种写不进 WinINET。 */
function isLoopbackHost(host: string): boolean {
  if (host === "localhost") return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts[0] !== "127") return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function validateBypass(bypass: string): void {
  if (bypass.length > MAX_SYSTEM_PROXY_BYPASS_LENGTH) {
    throw new SystemProxyError("bad-value", "proxy bypass is too long");
  }
  if (/[\u0000-\u001f\u007f]/.test(bypass)) {
    throw new SystemProxyError("bad-value", "proxy bypass has control characters");
  }
}

function validateRequest(request: SystemProxyRequest): void {
  if (typeof request.enabled !== "boolean") {
    throw new SystemProxyError("bad-value", "proxy enabled must be a boolean");
  }
  if (request.enabled && typeof request.server !== "string") {
    throw new SystemProxyError("bad-value", "enabling the system proxy needs an address");
  }
  if (request.server !== undefined) {
    if (typeof request.server !== "string" || request.server.length === 0 || request.server.length > 320) {
      throw new SystemProxyError("bad-value", "proxy server is empty or too long");
    }
    if (/[\u0000-\u001f\u007f]/.test(request.server)) {
      throw new SystemProxyError("bad-value", "proxy server has control characters");
    }
  }
  if (typeof request.bypass === "string") validateBypass(request.bypass);
}

export function readSystemProxy(deps: SystemProxyDeps = {}): SystemProxyRead {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return { status: { ...EMPTY_SYSTEM_PROXY_STATUS }, reason: "unsupported" };
  const exec = deps.exec ?? defaultExec;
  try {
    const stdout = exec({
      file: "powershell",
      args: [...PS_ARGS, buildReadCommand()],
      env: {},
      timeoutMs: READ_TIMEOUT_MS,
    });
    return { status: parseProxyJson(stdout), reason: null };
  } catch (error) {
    return {
      status: { ...EMPTY_SYSTEM_PROXY_STATUS },
      reason: "read-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function fail(reason: SystemProxyReason, deps: SystemProxyDeps, detail?: string): SystemProxyResult {
  const read = readSystemProxy(deps);
  return { ok: false, reason, status: read.status, ...(detail ? { detail } : {}) };
}

/** 请求里真正写出去的每把键，都要在读回来的状态里对上；返回的是没对上的注册表键名。 */
function unmatched(targets: readonly WriteTarget[], status: SystemProxyStatus): string[] {
  const bad: string[] = [];
  for (const target of targets) {
    const read = target.name === VALUE_NAMES.enable
      ? status.enabled
      : target.name === VALUE_NAMES.server ? status.server : status.bypass;
    if (read !== target.expected) bad.push(target.name);
  }
  return bad;
}

interface WriteTarget {
  /** 注册表里的键名，同时是回执与日志里对用户的说法。 */
  name: string;
  command: string;
  env: Record<string, string>;
  expected: boolean | string | null;
}

function writeTargets(request: SystemProxyRequest): WriteTarget[] {
  const targets: WriteTarget[] = [{
    name: VALUE_NAMES.enable,
    command: buildWriteCommand("enable"),
    env: { [ENV_NAMES.enable]: request.enabled ? "1" : "0" },
    expected: request.enabled,
  }];
  // 关掉时不碰地址与例外：那两把键是「下次打开还要用」的东西，Verge 也是这么留的。
  if (!request.enabled) return targets;
  targets.push({
    name: VALUE_NAMES.server,
    command: buildWriteCommand("server"),
    env: { [ENV_NAMES.server]: request.server as string },
    expected: request.server as string,
  });
  if (request.bypass !== undefined) {
    targets.push(request.bypass === null
      ? { name: VALUE_NAMES.bypass, command: buildRemoveCommand("bypass"), env: {}, expected: null }
      : {
        name: VALUE_NAMES.bypass,
        command: buildWriteCommand("bypass"),
        env: { [ENV_NAMES.bypass]: request.bypass },
        expected: request.bypass,
      });
  }
  return targets;
}

export function applySystemProxy(input: unknown, deps: SystemProxyDeps = {}): SystemProxyResult {
  const platform = deps.platform ?? process.platform;
  const shaped = (typeof input === "object" && input !== null ? input : {}) as SystemProxyRequest;
  try {
    if (typeof shaped.enabled !== "boolean") {
      throw new SystemProxyError("bad-value", "proxy request needs an enabled boolean");
    }
    validateRequest(shaped);
  } catch (error) {
    // 形状不对＝根本没打算碰系统，回空状态而不是去读一遍盘：读回来的值容易让人以为「这就是现状」。
    return {
      ok: false,
      reason: error instanceof SystemProxyError ? error.reason : "bad-value",
      status: { ...EMPTY_SYSTEM_PROXY_STATUS },
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (platform !== "win32") {
    return {
      ok: false,
      reason: "unsupported",
      status: { ...EMPTY_SYSTEM_PROXY_STATUS },
      detail: "系统代理只在 Windows 上有意义",
    };
  }

  const exec = deps.exec ?? defaultExec;
  const targets = writeTargets(shaped);

  for (const target of targets) {
    try {
      call(exec, target.command, target.env, WRITE_TIMEOUT_MS);
    } catch (error) {
      return fail("write-failed", deps, `${target.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    call(exec, buildBroadcastCommand(), {}, BROADCAST_TIMEOUT_MS);
  } catch (error) {
    // 盘已经改了，不广播只是「应用还没醒」——状态照样读回来给用户看。
    return fail("broadcast-failed", deps, error instanceof Error ? error.message : String(error));
  }

  const read = readSystemProxy(deps);
  if (read.reason) return { ok: false, reason: read.reason, status: read.status, detail: read.detail };
  const bad = unmatched(targets, read.status);
  if (bad.length > 0) {
    return {
      ok: false,
      reason: "mismatch",
      status: read.status,
      detail: `读回来不是发出去的值：${bad.join(", ")}`,
    };
  }
  return { ok: true, status: read.status };
}

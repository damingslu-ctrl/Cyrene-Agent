/**
 * Wave 3 T9：读写 Clash Verge 自己的 `verge.yaml`。
 *
 * 为什么不用 YAML 库整档重写：这个文件是隔壁那款的私有账本，里面既有注释、
 * `pac_file_content: |` 这种块标量，也有 `test_list:` 底下那一大串带引号的 SVG。
 * 序列化回去会重排键序、改引号风格、把块标量折成一行——用户看到的就是「Mochi 把我的
 * Verge 配置写花了」。所以这里只做行级补丁：目标键那一行换掉，其余字节照抄。
 *
 * 单写者闸门与订阅同源：Verge 在跑时一个字节都不落（它随时会整档写回这个文件，
 * 两边同时写就是一场没有赢家的比赛）。
 */
import { deepStrictEqual } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { writeTextAtomicWithBackup } from "./profiles-store";
import {
  EMPTY_VERGE_SETTINGS_VIEW,
  isVergeSettingKey,
  MAX_BYPASS_LENGTH,
  VERGE_SETTING_KEYS,
  type VergeSettingKey,
  type VergeSettingValue,
  type VergeSettingsPatch,
  type VergeSettingsReason,
  type VergeSettingsRead,
  type VergeSettingsResult,
  type VergeSettingsView,
} from "../../shared/verge-settings-types";

export { EMPTY_VERGE_SETTINGS_VIEW, VERGE_SETTING_KEYS } from "../../shared/verge-settings-types";
export type * from "../../shared/verge-settings-types";

export const VERGE_SETTINGS_FILE = "verge.yaml";

export class VergeSettingsError extends Error {
  readonly reason: VergeSettingsReason;

  constructor(reason: VergeSettingsReason, message: string) {
    super(message);
    this.name = "VergeSettingsError";
    this.reason = reason;
  }
}

const PORT_KEYS: readonly VergeSettingKey[] = ["verge_mixed_port", "verge_socks_port", "verge_port"];
const BOOL_KEYS: readonly VergeSettingKey[] = ["enable_system_proxy", "use_default_bypass"];

/** `enable_tun_mode` 的 null 是 Verge 的「跟随内核」档，不是「没写过」，允许原样写回。 */
function isPortKey(key: VergeSettingKey): boolean {
  return PORT_KEYS.includes(key);
}

function isBoolKey(key: VergeSettingKey): boolean {
  return BOOL_KEYS.includes(key) || key === "enable_tun_mode";
}

/**
 * 校验 + 归一。返回的数组保持调用方给的键序，`changed` 与设置页的提示都用这个顺序，
 * 免得「写了 3 条、回执说改了 2 条」这种对不上的账。
 */
export function validateSettingsPatch(patch: unknown): Array<[VergeSettingKey, VergeSettingValue]> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new VergeSettingsError("bad-value", "settings patch must be an object");
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) throw new VergeSettingsError("bad-value", "settings patch is empty");
  const out: Array<[VergeSettingKey, VergeSettingValue]> = [];
  for (const [rawKey, value] of entries) {
    if (!isVergeSettingKey(rawKey)) {
      throw new VergeSettingsError("bad-key", `settings key ${rawKey} is not allowed`);
    }
    if (isPortKey(rawKey)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 65535) {
        throw new VergeSettingsError("bad-value", `settings ${rawKey} must be a port`);
      }
    } else if (rawKey === "enable_tun_mode") {
      if (typeof value !== "boolean" && value !== null) {
        throw new VergeSettingsError("bad-value", "settings enable_tun_mode must be a boolean or null");
      }
    } else if (isBoolKey(rawKey)) {
      if (typeof value !== "boolean") {
        throw new VergeSettingsError("bad-value", `settings ${rawKey} must be a boolean`);
      }
    } else {
      if (value !== null && typeof value !== "string") {
        throw new VergeSettingsError("bad-value", "settings system_proxy_bypass must be a string or null");
      }
      if (typeof value === "string") {
        if (value.length > MAX_BYPASS_LENGTH) {
          throw new VergeSettingsError("bad-value", `settings system_proxy_bypass is too long`);
        }
        // 换行会在行级补丁里造出一条假键；控制字符则会让备份与读回比对各说一套。
        if (/[\u0000-\u001f\u007f]/.test(value)) {
          throw new VergeSettingsError("bad-value", "settings system_proxy_bypass has control characters");
        }
      }
    }
    out.push([rawKey, value as VergeSettingValue]);
  }
  return out;
}

/** 值 → YAML 标量。字符串只在「裸写会被读成别的东西」时才加引号，尽量维持 Verge 自己的书写习惯。 */
export function encodeSettingValue(value: VergeSettingValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // 先按形状粗筛（省掉绝大多数一次解析），漏网的再让真的 YAML 解析器判一次：
  // `.inf`、`0x1A`、`-.0` 这类「看着像字符串、读回来是别的类型」的串，靠正则永远数不完。
  if (needsQuoting(value) || !plainMeansItself(value)) return quote(value);
  return value;
}

const INDICATORS = "-?:,[]{}#&*!|>'\"%@`\\";
const AMBIGUOUS = /^(true|false|null|~|yes|no|on|off|y|n|[-+]?\d+(\.\d+)?([eE][-+]?\d+)?)$/i;

function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (/^\s|\s$/.test(value)) return true;
  if (INDICATORS.includes(value[0])) return true;
  if (/:(\s|$)/.test(value)) return true;
  if (/ #/.test(value)) return true;
  if (AMBIGUOUS.test(value)) return true;
  if (value.includes("\\")) return true;
  return false;
}

/** 裸写这一串之后，YAML 解析器读回来的还是不是同一串字符串——不是就必须加引号。 */
function plainMeansItself(value: string): boolean {
  try {
    const doc = parseMapOrThrow(`k: ${value}`);
    return typeof doc.k === "string" && doc.k === value;
  } catch {
    return false;
  }
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseMapOrThrow(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (error) {
    throw new VergeSettingsError("bad-yaml", error instanceof Error ? error.message : String(error));
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new VergeSettingsError("bad-yaml", "verge.yaml is not a mapping");
  }
  return doc as Record<string, unknown>;
}

/** 顶层键行：0 列、`键名:` 后紧跟行尾或空白。缩进行是别人的孩子，序列项以 `-` 开头，都进不来；
 * 块标量的正文在合法 YAML 里必定缩进，所以也只能落在这一条之外。 */
const TOP_LEVEL_KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?=[ \t]|$)/;

/**
 * 只替换白名单键的顶层那一行；盘上没有的按补丁顺序追加在文件末尾。
 *
 * 顶层重名（YAML 取最后一个）要全部改写：只改第一处的话，读回来还是被后面那一行遮蔽的旧值，
 * 页面就会显示一个盘上不存在的状态。
 *
 * 返回之前会做一次「补好的文本重新解析」的比对（见 assertPatchLandsClean）：
 * 行级补丁快，但它不知道那一行的值跨了几行。
 */
export function patchVergeSettingsText(text: string, patch: unknown): string {
  const entries = validateSettingsPatch(patch);
  const before = parseMapOrThrow(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const raw = text.split(/\r?\n/);
  const endsWithNewline = raw.length > 1 && raw[raw.length - 1] === "";
  const lines = endsWithNewline ? raw.slice(0, -1) : [...raw];

  const targets = new Map<string, VergeSettingValue>();
  for (const [key, value] of entries) targets.set(key, value);

  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const matched = TOP_LEVEL_KEY.exec(lines[i]);
    if (!matched || !targets.has(matched[1])) continue;
    seen.add(matched[1]);
    lines[i] = `${matched[1]}: ${encodeSettingValue(targets.get(matched[1]) as VergeSettingValue)}`;
  }

  const appended = entries.filter(([key]) => !seen.has(key));
  let out = lines.join(eol);
  if (endsWithNewline) out += eol;
  if (appended.length > 0) {
    if (!endsWithNewline && lines.length > 0) out += eol;
    out += `${appended.map(([key, value]) => `${key}: ${encodeSettingValue(value)}`).join(eol)}`;
    if (endsWithNewline) out += eol;
  }
  assertPatchLandsClean(before, out, entries);
  return out;
}

/**
 * 行级补丁的兜底判据：把补好的文本再解析一次，目标键必须读成发出去的那个值，
 * 其余每个键必须原样还在。顶掉跨行的值（`>-` 折叠、流序列、键底下的嵌套 map）
 * 会把正文变成孤儿、把别人的键挤出地图——那种补丁宁可拒着不写，也不能落盘。
 */
function assertPatchLandsClean(
  before: Record<string, unknown>,
  patched: string,
  entries: readonly [VergeSettingKey, VergeSettingValue][],
): void {
  let after: Record<string, unknown>;
  try {
    after = parseMapOrThrow(patched);
  } catch (error) {
    throw new VergeSettingsError("write-failed",
      `补丁后的 YAML 读不回来：${error instanceof Error ? error.message : String(error)}`);
  }
  const wanted = new Map<string, unknown>(Object.entries(before));
  for (const [key, value] of entries) wanted.set(key, value);
  // 一张比对表管两件事：目标键读回来必须是要写的值，别的键读回来必须还是原来那样
  // （键掉出地图时 after[key] 是 undefined，同样落在这一条里）。
  for (const [key, value] of wanted) {
    if (!sameDocValue(value, after[key])) {
      throw new VergeSettingsError("write-failed", `补丁后 ${key} 读回来不是预期的值`);
    }
  }
}

/** 未知键的值可能是嵌套 map，按结构比而不是按引用比。 */
function sameDocValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  try {
    deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

export function pickVergeSettings(doc: unknown): VergeSettingsView {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ...EMPTY_VERGE_SETTINGS_VIEW };
  const root = doc as Record<string, unknown>;
  const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
  const port = (value: unknown): number | null =>
    (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : null);
  const bypass = (value: unknown): string | null => {
    if (value === null) return null;
    // 非字符串（数字、map）说明盘上写坏了，不能把它当「一条都不豁免」的空串用。
    return typeof value === "string" ? value : null;
  };
  return {
    enableSystemProxy: bool(root.enable_system_proxy),
    systemProxyBypass: bypass(root.system_proxy_bypass),
    useDefaultBypass: bool(root.use_default_bypass),
    enableTunMode: root.enable_tun_mode === null ? null : bool(root.enable_tun_mode),
    mixedPort: port(root.verge_mixed_port),
    socksPort: port(root.verge_socks_port),
    httpPort: port(root.verge_port),
  };
}

export interface VergeSettingsStoreDeps {
  /** Verge 的数据根（`discoverConfigRoot` 的结果）。 */
  root: string;
  /** 单写者闸门。探测不了时按「在跑」处理，与订阅同一口径。 */
  isVergeRunning(): boolean;
  now?(): number;
}

export interface VergeSettingsStore {
  filePath(): string;
  read(): VergeSettingsRead;
  write(patch: unknown): VergeSettingsResult;
}

export function createVergeSettingsStore(deps: VergeSettingsStoreDeps): VergeSettingsStore {
  const now = deps.now ?? (() => Date.now());
  const filePath = () => path.join(deps.root, VERGE_SETTINGS_FILE);

  const fail = (reason: VergeSettingsReason, detail?: string): VergeSettingsResult => ({
    ok: false,
    reason,
    view: pickVergeSettings(readDocOrNull(filePath())),
    ...(detail ? { detail } : {}),
  });

  function readDocOrNull(file: string): Record<string, unknown> | null {
    try {
      return parseMapOrThrow(readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  return {
    filePath,
    read: (): VergeSettingsRead => {
      const file = filePath();
      if (!existsSync(file)) return { view: { ...EMPTY_VERGE_SETTINGS_VIEW }, reason: "not-found", filePath: file };
      let doc: Record<string, unknown>;
      try {
        doc = parseMapOrThrow(readFileSync(file, "utf8"));
      } catch (error) {
        return {
          view: { ...EMPTY_VERGE_SETTINGS_VIEW },
          reason: "bad-yaml",
          filePath: file,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      return { view: pickVergeSettings(doc), reason: null, filePath: file };
    },
    write: (patch: unknown): VergeSettingsResult => {
      let entries: Array<[VergeSettingKey, VergeSettingValue]>;
      try {
        entries = validateSettingsPatch(patch);
      } catch (error) {
        if (error instanceof VergeSettingsError) return fail(error.reason, error.message);
        return fail("bad-value", error instanceof Error ? error.message : String(error));
      }
      if (deps.isVergeRunning()) return fail("verge-running", "Clash Verge 正在运行，先退出再由我改配置");

      const file = filePath();
      if (!existsSync(file)) return fail("not-found", "没有找到 Verge 的配置文件");

      let text: string;
      try {
        text = readFileSync(file, "utf8");
        parseMapOrThrow(text);
      } catch (error) {
        if (error instanceof VergeSettingsError) return fail(error.reason, error.message);
        return fail("read-failed", error instanceof Error ? error.message : String(error));
      }

      let next: string;
      try {
        next = patchVergeSettingsText(text, Object.fromEntries(entries));
      } catch (error) {
        if (error instanceof VergeSettingsError) return fail(error.reason, error.message);
        return fail("write-failed", error instanceof Error ? error.message : String(error));
      }

      // 到这一步的文本已经被 patchVergeSettingsText 整档验过（目标键读回来就是要写的值、
      // 其余键一个没动），所以盘上没有「写了个说出去的假状态」这一档。
      try {
        writeTextAtomicWithBackup(file, next, new Date(now()));
      } catch (error) {
        return fail("write-failed", error instanceof Error ? error.message : String(error));
      }

      return { ok: true, view: pickVergeSettings(readDocOrNull(file) ?? {}), changed: entries.map(([key]) => key) };
    },
  };
}

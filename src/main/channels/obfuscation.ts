import * as os from "node:os";
import * as path from "node:path";

/**
 * 频道 secret 的 XOR 混淆。
 *
 * ⚠️ 这条存在的理由（spec §2.5 的雷）：改造前 `getMachineKey()` 的 seed 是
 * `${app.getPath("userData")}::${app.getName()}::cyrene-bot-secret`（settings-store.ts:52）。
 * 换 app 名或换 userData 目录**等于换钥匙**，而旧的 `deobfuscate` 没有任何完整性校验，
 * 结果不是报错，是解出一段乱码并被当成正确值用——飞书/QQ 的 secret 会静默变成垃圾字符串，
 * 用户只在渠道连不上时才发现。个人化改名（Task 9）正好踩这条，所以雷必须先拆。
 *
 * 现在的 key 只由「机器 + 固定 salt」派生，与 userData、app.name 都无关。
 * `os.userInfo().uid` 在 Windows 上不是真 uid（返回 token 字符串），稳定性够用且
 * 不碰注册表、不落盘第二份凭据。这仍然是**混淆**，不是加密：safeStorage 可用时轮不到它。
 */
const OBF_KEY_SALT = "mochi-obf-key-v2";
const CHECKSUM_BYTES = 4;

export const OBF_PREFIX_V2 = "obf:2:";
/** 旧前缀无版本号；`obf:2:` 也以它开头，所以判断顺序必须 v2 在前。 */
export const OBF_PREFIX_LEGACY = "obf:";

export class ObfuscationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObfuscationIntegrityError";
  }
}

function sha256(data: string | Buffer): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(data).digest();
}

function xor(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

function currentKey(): Buffer {
  const uid = (() => {
    try {
      return String(os.userInfo().uid);
    } catch {
      return "unknown-uid";
    }
  })();
  return sha256(`${uid}::${OBF_KEY_SALT}`).subarray(0, 16);
}

/** 历史 key：userData 路径与名字都钉成当年的常量，绝不读当前身份（读了一次就永远解不开）。 */
function legacyKey(appDataDir: string): Buffer {
  const seed = `${path.join(appDataDir, "cyrene-verge")}::cyrene-verge::cyrene-bot-secret`;
  return sha256(seed).subarray(0, 16);
}

export function obfuscateV2(plain: string): string {
  const body = xor(Buffer.from(plain, "utf8"), currentKey());
  const checksum = sha256(body).subarray(0, CHECKSUM_BYTES).toString("hex");
  return `${OBF_PREFIX_V2}${checksum}:${body.toString("base64")}`;
}

export function deobfuscateV2(stored: string): string {
  const rest = stored.slice(OBF_PREFIX_V2.length);
  const separator = rest.indexOf(":");
  if (separator < 0) throw new ObfuscationIntegrityError("obf:2: 缺少校验和字段");
  const checksum = rest.slice(0, separator);
  const body = Buffer.from(rest.slice(separator + 1), "base64");
  const expected = sha256(body).subarray(0, CHECKSUM_BYTES).toString("hex");
  if (checksum !== expected) {
    throw new ObfuscationIntegrityError("obf:2: 校验和不匹配：密钥轮换或数据被改坏");
  }
  return decodeStrictUtf8(xor(body, currentKey()));
}

export function deobfuscateLegacy(stored: string, appDataDir: string): string {
  const body = Buffer.from(stored.slice(OBF_PREFIX_LEGACY.length), "base64");
  return decodeStrictUtf8(xor(body, legacyKey(appDataDir)));
}

/**
 * 「解出乱码」必须能被判定。XOR 用错钥匙得到的字节大概率不是合法 UTF-8，
 * 而 `Buffer.toString("utf8")` 会把它替换成 U+FFFD 静默放过——所以这里按
 * 重新编码是否等价来否决，宁可返回失败让上层记 warn，也不把乱码当明文。
 */
function decodeStrictUtf8(buf: Buffer): string {
  const text = buf.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buf) && !text.includes("\uFFFD")) return text;
  throw new ObfuscationIntegrityError("解出的字节不是合法 UTF-8：密钥不匹配");
}

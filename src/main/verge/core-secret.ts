/**
 * 内核控制面口令（Wave 3 T10 装配层）。
 *
 * 借不到 Verge 那本 `clash-verge.yaml` 里的口令时，我们自己生成一枚并存在 userData。
 * 两件事必须同时成立：**生成的那一枚每次起内核都相同**（不然每起一次，页面与内核就对不上话），
 * 以及**它绝不进 core.log**（日志是给人贴到 issue 里的，口令进日志等于把控制面交给读日志的人；
 * 打码这件事本身归 `core-log.ts`——只有那里知道一共有几枚口令要认）。
 *
 * 存进 userData 而不是内存：进程重启后内核可能还活着（我们没退出，只是客户端崩了重开），
 * 换了口令就成了「内核在听、我们连不上」那种没有报错的坏状态。
 *
 * 形状尺只管我们自己这一枚。Verge 账上那枚**不经这里**——本机实测它是出厂占位值
 * `set-your-secret`，既不是十六进制也不够 32 位；拿这把尺去量它会把好值判成坏值，
 * 然后我们生成一枚数据面根本不认识的口令。
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 口令的形状：小写十六进制、够长。生成与读回共用这一把尺，读回来的坏值不能当口令用。 */
const SECRET_SHAPE = /^[0-9a-f]{32,128}$/;

/** 盘上是明文一行；多出来的空白、BOM、CRLF 都在这里吃掉，免得写进 YAML 变成带引号的另一个值。 */
export function normalizeCoreSecret(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return SECRET_SHAPE.test(trimmed) ? trimmed : null;
}

export function generateCoreSecret(size: number = 32): string {
  // 下限钉在这里：口令短到能被猜到，控制面就成了本机任意进程的可选项。
  if (!Number.isInteger(size) || size < 16) throw new Error(`密钥字节数不合法：${size}`);
  return randomBytes(size).toString("hex");
}

/**
 * 落进日志前的最后一道由 `core-log.ts` 负责——那里才知道一共有几枚口令。
 * 这里只留「生成与读回」这两件事，别处不许再抄一份形状尺。
 */
export interface CoreSecretStoreDeps {
  /** 存口令的文件（`<userData>/core/secret`）；每次现问，装配层才知道目录搬家了没。 */
  filePath(): string;
  read?(file: string): string | null;
  write?(file: string, text: string): void;
  generate?(): string;
}

export interface CoreSecretStore {
  /** 读回来能用就用；不能用（没有/坏形状）就当场生成一枚并落盘。 */
  (): string;
  /** 只有真的写盘失败时才非 null：口令没落住＝下次重启会换一枚，这是要说给用户的。 */
  warning(): string | null;
}

export function createCoreSecretStore(deps: CoreSecretStoreDeps): CoreSecretStore {
  const read = deps.read ?? defaultRead;
  const write = deps.write ?? defaultWrite;
  const generate = deps.generate ?? (() => generateCoreSecret());
  let cached: string | null = null;
  let lastWarning: string | null = null;

  return Object.assign(
    () => {
      if (cached !== null) return cached;
      const file = deps.filePath();
      const stored = normalizeCoreSecret(read(file));
      if (stored) {
        cached = stored;
        lastWarning = null;
        return cached;
      }
      const fresh = normalizeCoreSecret(generate());
      if (!fresh) {
        // 生成的东西不成形状＝随机源坏了，抛出去比拿一枚坏口令写进配置强。
        throw new Error("生成的控制面口令形状不合法");
      }
      try {
        write(file, `${fresh}\n`);
        lastWarning = null;
      } catch (error) {
        // 写不进去也要把这一班撑住：内存里这枚是真随机，只是下次重启会换一枚。
        lastWarning = `口令没能存盘（${error instanceof Error ? error.message : String(error)}），下次重启会换一枚`;
      }
      cached = fresh;
      return cached;
    },
    { warning: () => lastWarning },
  );
}

function defaultRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function defaultWrite(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

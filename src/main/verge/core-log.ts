/**
 * `core.log` 的落盘点（Wave 3 T10 装配层）。
 *
 * 内核宿主有两条只能在这里守住的线：
 *
 * 1) **口令不进日志**。mihomo 会把启动参数、有时也包括配置里的键值吐到 stderr，
 *    而我们的 runtime config 里正躺着控制面口令。脱敏放在**写入这唯一一道口**上，
 *    而不是要求每个调用方自己记得——`core-manager` 那层的日志点已经不少
 *    （spawn、退出码、stdout/stderr 透传），漏一次就是把口令交给贴日志的人。
 *    登记的口令包括 Verge 那本账里读回来的那一枚：它同样是控制面的钥匙。
 * 2) **写得动**。日志是崩溃现场唯一的证人，写失败不许把起内核这件事带崩；
 *    同时不能无限长——内核每次退出前都会吐一段，反复自愈能把文件撑到几十 MB。
 *    超上限就轮替一代（`core.log` → `core.log.1`），只留一代：
 *    上一班的现场够用，十班前的字节没人会看。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/** 单次轮替的门槛：512 KB 够留几千行，也就够覆盖一次崩溃前后那一段。 */
export const CORE_LOG_ROTATE_BYTES = 512 * 1024;

export interface CoreLogSinkDeps {
  /** 每次现问：userData 在便携版与安装版之间会搬家。 */
  filePath(): string;
  /** 口令登记表：装配层解出一枚就登记一枚，写入时逐条精确替换。 */
  secrets?(): Iterable<string | null | undefined>;
  append?(file: string, text: string): void;
  sizeOf?(file: string): number;
  rotate?(from: string, to: string): void;
  rotateBytes?: number;
}

export interface CoreLogSink {
  /** 追加一行（自带换行）；行内已知的口令一律先打码。 */
  write(line: string): void;
}

export function createCoreLogSink(deps: CoreLogSinkDeps): CoreLogSink {
  const append = deps.append ?? defaultAppend;
  const sizeOf = deps.sizeOf ?? defaultSizeOf;
  const rotate = deps.rotate ?? rotateSync;
  const rotateBytes = deps.rotateBytes ?? CORE_LOG_ROTATE_BYTES;

  return {
    write(line: string): void {
      const file = deps.filePath();
      let text = line;
      // 换行先压成空格：日志按行对齐，一条多行的内核报错不该占掉好几行的位置。
      text = text.replace(/\r?\n/g, " ");
      for (const secret of deps.secrets?.() ?? []) text = redactSecret(text, secret);
      if (sizeOf(file) > rotateBytes) rotate(file, `${file}.1`);
      append(file, `${text}\n`);
    },
  };
}

/**
 * 精确匹配替换，不做「凡像十六进制的都打码」。
 *
 * 日志里的端口、pid、mihomo 版本号都长得很像候选值；把它们糊掉，这份日志就没有诊断价值了。
 * 太短的值一律跳过：一来真口令不会短于此，二来拿 `"info"` 这种词去 split 会把整份日志切碎。
 */
function redactSecret(line: string, secret: string | null | undefined): string {
  const usable = typeof secret === "string" ? secret.trim() : "";
  if (usable.length < 8) return line;
  return line.includes(usable) ? line.split(usable).join("«密钥»") : line;
}

function defaultAppend(file: string, text: string): void {
  // 目录可能还没建（第一次起内核时 `<userData>/core/` 才刚要出现）：append 不会自己造父目录。
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, text, "utf8");
}

/** 文件不在＝0 字节；`statSync` 抛的其它错也不能把「写日志」这件事变成事故。 */
function defaultSizeOf(file: string): number {
  try {
    return existsSync(file) ? statSync(file).size : 0;
  } catch {
    return 0;
  }
}

/** 轮替时目标已存在要先删：Windows 上 rename 遇到同名目标会抛。 */
function rotateSync(from: string, to: string): void {
  try {
    // 删不掉上一代（被编辑器占着）也不拦这次轮替：让下面的 rename 自己去报真错误。
    if (existsSync(to)) unlinkSync(to);
  } catch {
    /* 交给 renameSync 报 */
  }
  renameSync(from, to);
}

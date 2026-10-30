/**
 * `core.log` 落盘点的测试：口令挡在写入这一道口，以及日志写得动、长不大。
 *
 * 脱敏之所以在这儿验而不是在 `core-secret` 那儿验：日志点散在装配层与管理器两侧
 * （spawn、退出码、stdout/stderr 透传），逐个调用方「记得打码」是要漏的。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_LOG_ROTATE_BYTES, createCoreLogSink } from "./core-log";

/** 我们自己生成的那枚（形状合法）。 */
const OURS = "9f2c41a7be05d8136ce4a0f1d2b87e9c3a5f60718293a4b5c6d7e8f9012345ab";
/** 本机实测：Verge 账上那枚是出厂占位值——不成形状，但它同样是控制面的钥匙。 */
const VERGE_PLACEHOLDER = "set-your-secret";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "core-log-"));
  dirs.push(dir);
  return dir;
}

function fakeSink(input: {
  secrets?: Array<string | null | undefined>;
  size?: number;
  appendThrows?: string;
} = {}) {
  const written: Array<{ file: string; text: string }> = [];
  const rotated: Array<[string, string]> = [];
  const sizes = new Map<string, number>();
  const sink = createCoreLogSink({
    filePath: () => String.raw`C:\fake\core.log`,
    secrets: () => input.secrets ?? [OURS, VERGE_PLACEHOLDER],
    sizeOf: (file) => sizes.get(file) ?? input.size ?? 0,
    append: (file, text) => {
      if (input.appendThrows) throw new Error(input.appendThrows);
      written.push({ file, text });
    },
    rotate: (from, to) => { rotated.push([from, to]); sizes.set(from, 0); },
  });
  return { sink, written, rotated, text: () => written.map((entry) => entry.text).join("") };
}

describe("core-log：口令不许进日志", () => {
  it("登记的每一枚都打码，包括 Verge 那本账上的占位值", () => {
    const h = fakeSink();
    h.sink.write(`listening with secret=${OURS} 以及 ${VERGE_PLACEHOLDER}`);
    const line = h.text();
    expect(line).not.toContain(OURS);
    expect(line).not.toContain(VERGE_PLACEHOLDER);
    expect(line).toContain("«密钥»");
  });

  it("同一行出现两次都要打码，不是只换第一处", () => {
    const h = fakeSink({ secrets: [OURS] });
    h.sink.write(`${OURS} ... ${OURS}`);
    expect(h.text().split(OURS)).toHaveLength(1);
    expect(h.text().match(/«密钥»/g)).toHaveLength(2);
  });

  it("只在日志里真出现时才动那一行：没命中就原样出去", () => {
    const h = fakeSink({ secrets: [OURS] });
    h.sink.write("spawn pid=4100 mode=installed");
    expect(h.text()).toBe("spawn pid=4100 mode=installed\n");
  });

  it("太短的值一律跳过：拿 \"info\" 去 split 会把整份日志切碎", () => {
    const h = fakeSink({ secrets: ["info", "a".repeat(7), null, undefined, "  padded  "] });
    h.sink.write("level=info listening 127.0.0.1:9097");
    expect(h.text()).toBe("level=info listening 127.0.0.1:9097\n");
  });

  it("精确匹配，不做「凡像十六进制的都打码」：端口、pid、内核版本号都得留着", () => {
    const h = fakeSink({ secrets: [OURS] });
    h.sink.write("mihomo v1.18.10 sha=deadbeefcafebabe1234567890abcdef pid=4100 127.0.0.1:9097");
    expect(h.text()).toContain("deadbeefcafebabe1234567890abcdef");
    expect(h.text()).toContain("9097");
  });

  it("口令前后空白也算同一枚：账上写 `secret: x\\n` 不能漏过去", () => {
    const h = fakeSink({ secrets: [`  ${VERGE_PLACEHOLDER}  `] });
    h.sink.write(`配置里 secret=${VERGE_PLACEHOLDER}`);
    expect(h.text()).not.toContain(VERGE_PLACEHOLDER);
  });

  it("换行压成空格：一条多行的内核报错不该占掉好几行", () => {
    const h = fakeSink({ secrets: [] });
    h.sink.write("open wintun: access denied\r\n\tat main.go:41");
    expect(h.text()).toBe("open wintun: access denied \tat main.go:41\n");
  });
});

describe("core-log：写得动，并且长不大", () => {
  it("超上限先轮替一代再写：轮替目标是同名加 .1", () => {
    const h = fakeSink({ size: CORE_LOG_ROTATE_BYTES + 1 });
    h.sink.write("新的一行");
    expect(h.rotated).toEqual([[String.raw`C:\fake\core.log`, String.raw`C:\fake\core.log.1`]]);
    expect(h.text()).toContain("新的一行");
  });

  it("刚好在上限内不轮替：每次起内核都轮一次会把上一班现场直接抹掉", () => {
    const h = fakeSink({ size: CORE_LOG_ROTATE_BYTES });
    h.sink.write("还在额度内");
    expect(h.rotated).toHaveLength(0);
  });

  it("写不进去把错误递出去：拦不拦是调用方的决定，这里不许演成「已记录」", () => {
    const h = fakeSink({ appendThrows: "EBUSY: resource busy or locked" });
    expect(() => h.sink.write("这一行落不了盘")).toThrow(/EBUSY/);
  });
});

describe("core-log：真盘", () => {
  it("父目录还没建也写得进去，第二次追加不覆盖第一次", () => {
    const dir = freshDir();
    const file = path.join(dir, "core", "core.log");
    const sink = createCoreLogSink({ filePath: () => file, secrets: () => [OURS] });
    sink.write(`第一行 secret=${OURS}`);
    sink.write("第二行");
    const text = readFileSync(file, "utf8");
    expect(text).toBe(`第一行 secret=«密钥»\n第二行\n`);
  });

  it("真轮替只留一代：旧的那份 .1 被新的上一代顶掉", () => {
    const dir = freshDir();
    const file = path.join(dir, "core.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "上一班：新".repeat(20), "utf8");
    writeFileSync(`${file}.1`, "十班以前：旧".repeat(20), "utf8");
    const sink = createCoreLogSink({ filePath: () => file, secrets: () => [], rotateBytes: 8 });
    sink.write("这一行触发轮替");
    expect(readFileSync(`${file}.1`, "utf8")).toContain("上一班");
    expect(readFileSync(`${file}.1`, "utf8")).not.toContain("十班以前");
    expect(readFileSync(file, "utf8")).toBe("这一行触发轮替\n");
  });

  it("文件不在＝0 字节，stat 这一步读不动也不许拦住这一行", () => {
    const dir = freshDir();
    const sink = createCoreLogSink({ filePath: () => path.join(dir, "没建过", "core.log") });
    expect(() => sink.write("第一次起内核")).not.toThrow();
    expect(existsSync(path.join(dir, "没建过", "core.log"))).toBe(true);
    // 路径是个目录：量的那一口（existsSync + statSync）不能抛。
    // 抛在 append 才是它的本分——那一层由调用方决定拦不拦（见上面 EBUSY 那条）。
    const appended: string[] = [];
    const probe = createCoreLogSink({
      filePath: () => dir,
      append: (_file, text) => { appended.push(text); },
    });
    expect(() => probe.write("路径是个目录")).not.toThrow();
    expect(appended).toEqual(["路径是个目录\n"]);
  });
});

/**
 * 控制面口令的生成与读回。
 *
 * 这里最要紧的两条：**每次起内核用的是同一枚**（换了就变成「内核在听、我们连不上」那种
 * 没有报错的坏状态），以及**形状尺不许去量 Verge 账上那一枚**（本机实测它是 `set-your-secret`，
 * 量一次就把好值判成坏值，然后我们生成一枚数据面根本不认识的口令）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreSecretStore, generateCoreSecret, normalizeCoreSecret } from "./core-secret";

const GOOD = "9f2c41a7be05d8136ce4a0f1d2b87e9c3a5f60718293a4b5c6d7e8f9012345ab";
/** 本机实测的 Verge 出厂占位值：不成形状，但它是数据面正在用的那一枚。 */
const VERGE_PLACEHOLDER = "set-your-secret";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "core-secret-"));
  dirs.push(dir);
  return dir;
}

function fakeStore(input: {
  stored?: string | null;
  generated?: string[];
  writeThrows?: string;
}) {
  const reads: string[] = [];
  const writes: Array<{ file: string; text: string }> = [];
  const queue = [...(input.generated ?? [GOOD])];
  const store = createCoreSecretStore({
    filePath: () => {
      reads.push(String(reads.length));
      return String.raw`C:\fake\core\secret`;
    },
    read: () => input.stored ?? null,
    write: (file, text) => {
      if (input.writeThrows) throw new Error(input.writeThrows);
      writes.push({ file, text });
    },
    generate: () => queue.shift() ?? GOOD,
  });
  return { store, reads, writes };
}

describe("normalizeCoreSecret：形状尺只管我们自己这一枚", () => {
  it("收下 32～128 位小写十六进制", () => {
    expect(normalizeCoreSecret(GOOD)).toBe(GOOD);
    expect(normalizeCoreSecret("a".repeat(32))).toBe("a".repeat(32));
    expect(normalizeCoreSecret("b".repeat(128))).toBe("b".repeat(128));
  });

  it("差一个字符就不算：31 位、129 位、大写、非串一律拒", () => {
    expect(normalizeCoreSecret("a".repeat(31))).toBeNull();
    expect(normalizeCoreSecret("a".repeat(129))).toBeNull();
    expect(normalizeCoreSecret(GOOD.toUpperCase())).toBeNull();
    expect(normalizeCoreSecret("g".repeat(32))).toBeNull();
    expect(normalizeCoreSecret(null)).toBeNull();
    expect(normalizeCoreSecret(12345)).toBeNull();
    expect(normalizeCoreSecret(undefined)).toBeNull();
  });

  it("盘上的空白、CRLF、BOM 都吃掉：留着它们进 YAML 会变成带引号的另一个值", () => {
    expect(normalizeCoreSecret(`\uFEFF${GOOD}\r\n`)).toBe(GOOD);
    expect(normalizeCoreSecret(`  ${GOOD}\n`)).toBe(GOOD);
  });

  it("Verge 那枚出厂占位值按这把尺是「坏值」——这是设计，不是漏洞", () => {
    // 钉住这一条，是为了拦住「把尺子放宽到能过 set-your-secret」那种改法：
    // 放宽之后我们自己那枚随机口令就没门槛了。Verge 的值走的是另一条路（装配层原样用）。
    expect(normalizeCoreSecret(VERGE_PLACEHOLDER)).toBeNull();
  });
});

describe("generateCoreSecret", () => {
  it("默认那一枚够长、够随机、形状合法", () => {
    const first = generateCoreSecret();
    const second = generateCoreSecret();
    expect(first).toHaveLength(64);
    expect(normalizeCoreSecret(first)).toBe(first);
    expect(first).not.toBe(second);
  });

  it("字节数下限钉死：短到能被猜到的口令等于把控制面交给本机任意进程", () => {
    expect(() => generateCoreSecret(15)).toThrow(/不合法/);
    expect(() => generateCoreSecret(0)).toThrow(/不合法/);
    expect(() => generateCoreSecret(-1)).toThrow(/不合法/);
    expect(() => generateCoreSecret(20.5)).toThrow(/不合法/);
    expect(generateCoreSecret(16)).toHaveLength(32);
  });
});

describe("createCoreSecretStore：同一枚用到底", () => {
  it("盘上能用就用，不生成新的", () => {
    const h = fakeStore({ stored: `${GOOD}\n` });
    expect(h.store()).toBe(GOOD);
    expect(h.writes).toHaveLength(0);
    expect(h.store.warning()).toBeNull();
  });

  it("第二次调用连盘都不碰：起停重启来回切也不该换一枚", () => {
    const h = fakeStore({ stored: GOOD });
    h.store();
    h.store();
    h.store();
    expect(h.reads).toHaveLength(1);
  });

  it("造 store 的时候不碰盘：口令是起内核那一刻才需要的东西", () => {
    const h = fakeStore({ stored: GOOD });
    expect(h.reads).toHaveLength(0);
  });

  it("盘上没有／是坏值 → 生成一枚并落盘，写的是明文一行带换行", () => {
    const h = fakeStore({ stored: null });
    expect(h.store()).toBe(GOOD);
    expect(h.writes).toEqual([{ file: String.raw`C:\fake\core\secret`, text: `${GOOD}\n` }]);
  });

  it("盘上是别人留下的坏字节也重生成：拿一枚用不了的口令写进配置更糟", () => {
    const h = fakeStore({ stored: "not-a-secret-at-all", generated: [GOOD] });
    expect(h.store()).toBe(GOOD);
    expect(h.writes).toHaveLength(1);
  });

  it("写不进去也把这班撑住：口令照样能用，只是 warning 要说下次会换一枚", () => {
    const h = fakeStore({ stored: null, writeThrows: "EPERM: operation not permitted" });
    expect(h.store()).toBe(GOOD);
    expect(h.store.warning()).toContain("EPERM");
    expect(h.store.warning()).toContain("下次重启会换一枚");
    // 内存里这枚是真随机：第二次调用不许换一枚，否则同一班内核就对不上话。
    expect(h.store()).toBe(GOOD);
  });

  it("随机源坏了＝抛，不许把一枚不成形状的口令写进内核配置", () => {
    const h = fakeStore({ stored: null, generated: ["too-short", GOOD] });
    expect(() => h.store()).toThrow(/形状不合法/);
    expect(h.writes).toHaveLength(0);
  });

  it("真盘：父目录还没建也写得进去，读回来的是同一枚", () => {
    const dir = freshDir();
    const file = path.join(dir, "core", "secret");
    const first = createCoreSecretStore({ filePath: () => file });
    const secret = first();
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(`${secret}\n`);
    expect(normalizeCoreSecret(secret)).toBe(secret);
    // 换一个新的 store（相当于客户端重开）必须读回同一枚——这正是「进程重启内核还活着」那一档。
    expect(createCoreSecretStore({ filePath: () => file })()).toBe(secret);
  });

  it("真盘：目录搬家后第一次解析用的是新路径", () => {
    const a = freshDir();
    const b = freshDir();
    mkdirSync(path.join(b, "core"), { recursive: true });
    writeFileSync(path.join(b, "core", "secret"), `${GOOD}\n`, "utf8");
    let active = path.join(a, "core", "secret");
    const store = createCoreSecretStore({ filePath: () => active });
    // a 那边什么都没有 → 生成并落在 a；这一班就用这一枚，搬家不再改口。
    const generated = store();
    expect(generated).not.toBe(GOOD);
    expect(existsSync(active)).toBe(true);
    active = path.join(b, "core", "secret");
    expect(store()).toBe(generated);
    expect(createCoreSecretStore({ filePath: () => active })()).toBe(GOOD);
  });
});

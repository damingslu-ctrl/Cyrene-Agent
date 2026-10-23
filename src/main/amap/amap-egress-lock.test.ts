// 高德凭据的结构性锁：
//   1) 只有 client.ts 能写死高德域名——各条链路各自手搓 URL 就绕开了 URLSearchParams 编码；
//   2) 主进程里除了 client.ts 的 URLSearchParams，不允许出现 `?key=` / `key=${...}` 这种拼接；
//   3) 高德链路上的 console 语句不允许出现 key 变量（日志里的 Key 原文无法回收）。
// 前两条是「会不会漏编码」，第三条是「会不会写进日志」。三条都配正对照，避免正则被改窄后变空转。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const MAIN_DIR = path.join(repoRoot, "src/main");
const CLIENT_FILE = path.join(MAIN_DIR, "amap/client.ts");

/** 高德链路上会接触 Key 的源文件（不含测试）。 */
const KEY_TOUCHING_FILES = [
  "src/main/amap/client.ts",
  "src/main/amap/key-check.ts",
  "src/main/orchestrator/tools/amap-place-tools.ts",
  "src/main/orchestrator/tools/travel-tools.ts",
  "src/main/orchestrator/tools/builtin-tools/weather-tool.ts",
  "src/main/settings/settings-ipc.ts",
];

const AMAP_HOST = "restapi.amap.com";
const RAW_KEY_PARAM = /[?&]key=|\bkey=\$\{|["'`]\s*\+\s*(?:amapKey|key)\b|\b(?:amapKey|key)\s*\+\s*["'`]/;
const CONSOLE_CALL = /console\s*\.\s*(?:log|info|warn|error|debug)\s*\(/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(abs));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(abs);
  }
  return out;
}

function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), "utf8");
}

/** 去掉字符串字面量后剩下的代码，用于「日志里有没有引用 key 变量」的判定。 */
function stripStringLiterals(source: string): string {
  return source
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** 逐条 console 语句（到本行结束）——够用，且不会把下一行的无关变量算进来。 */
function consoleLines(source: string): string[] {
  return stripStringLiterals(source)
    .split(/\r?\n/)
    .filter((line) => CONSOLE_CALL.test(line));
}

describe("高德出口的唯一性", () => {
  it("只有 client.ts 写死高德域名", () => {
    const offenders = listSourceFiles(MAIN_DIR)
      .filter((file) => file !== CLIENT_FILE)
      .filter((file) => fs.readFileSync(file, "utf8").includes(AMAP_HOST))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));

    expect(offenders).toEqual([]);
    // 正对照：client.ts 自己必须命中，证明扫描口径没跑偏。
    expect(fs.readFileSync(CLIENT_FILE, "utf8")).toContain(AMAP_HOST);
  });

  it("高德链路上没有手拼 key 参数（一律走 URLSearchParams）", () => {
    const offenders = KEY_TOUCHING_FILES.filter((file) => RAW_KEY_PARAM.test(read(file)));
    expect(offenders).toEqual([]);

    // 正对照：三种典型拼接都必须被同一条正则抓住。
    expect(RAW_KEY_PARAM.test("https://x/v3?key=" + "${k}")).toBe(true);
    expect(RAW_KEY_PARAM.test('"/v3/geo?address=" + amapKey')).toBe(true);
    expect(RAW_KEY_PARAM.test("`/v3/geo?address=${a}&key=${key}`")).toBe(true);
    // 反对照：正常写法不能误伤。
    expect(RAW_KEY_PARAM.test('query.set("key", validation.normalized);')).toBe(false);
  });

  it("高德链路的 console 语句不引用 key 变量", () => {
    const offenders: string[] = [];
    for (const file of KEY_TOUCHING_FILES) {
      for (const line of consoleLines(read(file))) {
        if (/\b(?:amapKey|key)\b/i.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);

    // 正对照：把变量写进日志必须被抓到。
    expect(consoleLines('console.log("k", key)').some((line) => /\bkey\b/i.test(line))).toBe(true);
    // 反对照：只在字符串里出现 "key" 的日志不误伤。
    expect(consoleLines('console.log("[Amap] key resolution")').some((line) => /\bkey\b/i.test(line))).toBe(false);
  });
});

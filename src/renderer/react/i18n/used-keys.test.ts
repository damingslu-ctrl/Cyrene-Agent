/**
 * 界面语言：用出去的 key 必须在三份表里都解析得出来。
 *
 * 起因是 Wave 4 T14 那颗全角冒号（见 `label-colon.test.ts`）：那一轮把「标签后的冒号」搬进语言文件时，
 * `label-colon.test.ts` 只钉住「JSX 里不许写死」与「三份表都得有这颗冒号」两条。但漏翻的另一半从没被量过——
 * 代码里 `t("a.b")` 引用了一枚三份表都没有的键时，界面**不会**报错：i18next 配了
 * `parseMissingKeyHandler: (key) => key`（`index.ts:29`），键名会原样画上屏。
 * 用户看到的是 `settingsPage.usage.range90` 这种字串，测试全绿。这把尺补的就是这个洞。
 * （两头的落空形状都实测过：键不存在→原样回键名；键指到子对象→画
 * `key 'a.b (zh-CN)' returned an object instead of string.`——所以「解析出来」还不够，得是**非空字符串**。）
 *
 * 三条口径：
 * - 字面量键：`t("a.b")` / `t('a.b')` / `i18next.t("a.b")` 一律要在三份表里解析出**非空字符串**。
 * - 动态键（`t(key)`）不归这里管；但模板键 `` t(`settingsPage.usage.range${x}`) `` 的静态前缀要有牙——
 *   三份表里各得**至少有一枚叶子键以它开头**，否则拼出来的键必然落空。
 * - 注释也在射程：注释里的示例键同样要求真的存在（`index.ts` 那句 `t("composer.uploadFile")` 就在名单里）。
 *   这是有意的——示例漂了也是漂，漂了就得能看见。
 *
 * 射程只收 `src/renderer/react/**`：`src/renderer/music` 与 `src/renderer/pet` 根本不 import 这套 i18n
 * （现扫各 0 处 `t("a.b")`），把它们圈进来是替别人家同名 helper 背锅。
 *
 * 一个已知且**故意不修**的洞（写在这儿，免得下一个人以为这条尺什么都看得见）：
 * 前缀那条腿判的是「有没有叶子以静态段开头」，所以它认得出段名换错（`…span${x}` 当场红，
 * 变异验过），却认得出**截断**——`…rang${x}` 仍是 `range7/range30/range90` 的前缀，屏上会画
 * `settingsPage.usage.rang7`，这条腿一声不响。要在静态扫里分辨它，就得猜「动态尾巴该长什么形状」，
 * 那是把猜测定成规范。这个洞由渲染现场那把尺堵：`../features/settings/UsageStatsPanel.key-shape.test.tsx`
 * （M5 截断变异在那边跑红过，见台账）。
 *
 * 两把尺的分工还有一处要记清，因为它决定谁能逮住哪种缺陷：`fallbackLng: UI_LOCALE_FALLBACK`（`index.ts:21`，
 * 值是 `zh-CN`，`src/shared/ui-language.ts:12`）会兜住**只缺一份表**的键——实测「en 缺、zh 有」时
 * `t()` 回的是那句中文，**不是键名**。⇒ 那种缺陷的症状是「英文界面画中文」，屏幕上没有键名形状可扫，
 * 现场尺看不见，只有这把静态尺（要求三份表都解析得出）看得见。三份表一起缺才会走到
 * `parseMissingKeyHandler` 那条路上，那时两把尺都响。
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import jaJP from "./ja-JP.json";
import zhCN from "./zh-CN.json";

/** `__dirname` = `src/renderer/react/i18n`，仓库根在四级上；多退一级 glob 会收不到任何文件。 */
const REPO = resolve(__dirname, "../../../..");
const LOCALE_TABLES = { "zh-CN": zhCN, en, "ja-JP": jaJP } as Record<string, unknown>;

/** 字面量键：至少两段（`t("a")` 这种单段在本仓不存在，收了只会替未来的手写 helper 背锅）。 */
const LITERAL_KEY = /\bt\(\s*["']([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)["']/g;

/** 模板键的静态前缀：反引号起头、`${` 之前那一段，原样留着（尾部有没有点都算前缀的一部分）。 */
const TEMPLATE_PREFIX = /\bt\(\s*`([^`$]*)\$\{/g;

const IS_TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

function sourceFiles(): string[] {
  return globSync("src/renderer/react/**/*.{ts,tsx}", { cwd: REPO })
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !IS_TEST_FILE.test(file))
    .sort();
}

function lookup(table: unknown, key: string): unknown {
  let current = table;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object" || !(part in (current as Record<string, unknown>))) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 展平成 `a.b.c` 叶子路径——模板前缀按「有没有叶子以它开头」判，不要求前缀自己指到一个对象。 */
function leafKeys(table: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      out.push(prefix);
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.push(prefix);
      return;
    }
    for (const [key, child] of entries) walk(child, prefix ? `${prefix}.${key}` : key);
  };
  walk(table, "");
  return out;
}

function isUsableString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function collect(pattern: RegExp, pick: (match: RegExpExecArray) => string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const rel of sourceFiles()) {
    const lines = readFileSync(resolve(REPO, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line))) {
        const key = pick(match);
        if (!key) continue;
        if (!found.has(key)) found.set(key, []);
        found.get(key)!.push(`${rel}:${index + 1}`);
      }
    });
  }
  return found;
}

describe("界面语言：用到的 key 解析不解析得出来", () => {
  const literalKeys = collect(LITERAL_KEY, (match) => match[1]);
  const templatePrefixes = collect(TEMPLATE_PREFIX, (match) => match[1]);

  it("扫到了源文件、也扫到了键（一把扫不到东西的尺等于没有尺）", () => {
    const files = sourceFiles();
    // 实测 188（glob 原始命中 298，扣掉测试与夹具后 188）。地板压在 150：够低到不碍正常的文件增减，
    // 又高到 glob 少退一级、`cwd` 写错、或模式打成 `*.{ts}` 收不到 tsx 时当场落空。
    expect(files.length, ".ts/.tsx 文件数").toBeGreaterThan(150);
    expect(files.some((file) => file === "src/renderer/react/i18n/index.ts"), "含 i18n 基建").toBe(true);
    expect(literalKeys.size, "字面量键数").toBeGreaterThan(1500);
    expect(templatePrefixes.size, "模板键静态前缀数").toBeGreaterThanOrEqual(20);
  });

  it("每一枚字面量键在三份表里都是非空字符串", () => {
    const misses: string[] = [];
    for (const [key, sites] of [...literalKeys].sort()) {
      for (const [locale, table] of Object.entries(LOCALE_TABLES)) {
        const value = lookup(table, key);
        if (!isUsableString(value)) {
          const reason = value === undefined ? "MISS" : typeof value === "string" ? "BLANK" : `NOT-STRING(${typeof value})`;
          misses.push(`${locale} ${key} (${reason}) @ ${sites[0]}`);
        }
      }
    }
    expect(misses, `解析不出来的键：${JSON.stringify(misses.slice(0, 40))}`).toEqual([]);
  });

  it("模板键的静态前缀在三份表里各至少领到一枚叶子", () => {
    const leaves = Object.fromEntries(Object.entries(LOCALE_TABLES).map(([locale, table]) => [locale, leafKeys(table)]));
    const misses: string[] = [];
    for (const [prefix, sites] of [...templatePrefixes].sort()) {
      for (const [locale, keys] of Object.entries(leaves)) {
        if (!keys.some((leaf) => leaf.startsWith(prefix))) {
          misses.push(`${locale} ${JSON.stringify(prefix)} @ ${sites[0]}`);
        }
      }
    }
    expect(misses, `拼不出真键的前缀：${JSON.stringify(misses)}`).toEqual([]);
  });

  it("这把尺有牙", () => {
    // 正对照：三种写法都得认成字面量键。
    expect([...'{t("network.core.modeLabel")}'.matchAll(LITERAL_KEY)].map((m) => m[1]), "双引号").toEqual(["network.core.modeLabel"]);
    expect([...'t(\'ui.labelColon\')'.matchAll(LITERAL_KEY)].map((m) => m[1]), "单引号").toEqual(["ui.labelColon"]);
    expect([...'i18next.t("composer.uploadFile")'.matchAll(LITERAL_KEY)].map((m) => m[1]), "i18next.t").toEqual(["composer.uploadFile"]);
    // 反对照：纯动态键不在射程（硬要管就只能管到「有个 helper 叫 t」这一步，那是冤枉）。
    expect([..."<li>{t(labelKey)}</li>".matchAll(LITERAL_KEY)].length, "动态键不该被当成字面量").toBe(0);
    expect([...'t("no-dot")'.matchAll(LITERAL_KEY)].length, "单段键不该被当成 i18n 键").toBe(0);
    // 模板前缀要抠得下来，且留着尾部那颗点（`network.mode.` 与 `…range` 两种形状都得能进名单）。
    expect([...'t(`settingsPage.usage.range${item.value}`)'.matchAll(TEMPLATE_PREFIX)].map((m) => m[1]), "前缀：无尾点").toEqual(["settingsPage.usage.range"]);
    expect([...'t(`network.mode.${key}`)'.matchAll(TEMPLATE_PREFIX)].map((m) => m[1]), "前缀：带尾点").toEqual(["network.mode."]);
    // 落空检测真的会落空：存在的键解析得出，不存在的键必须 undefined。
    expect(typeof lookup(zhCN, "ui.labelColon")).toBe("string");
    expect(lookup(zhCN, "ui.thisKeyDoesNotExistAnywhere"), "不存在的键").toBeUndefined();
    expect(leafKeys(zhCN).some((leaf) => leaf.startsWith("settingsPage.usage.range")), "前缀对照：正").toBe(true);
    expect(leafKeys(zhCN).some((leaf) => leaf.startsWith("settingsPage.usage.nope")), "前缀对照：反").toBe(false);
    // 空值那一支也要有牙：MISS / BLANK / 指到对象，三种都不许算「翻出来了」。
    expect(isUsableString(undefined), "MISS").toBe(false);
    expect(isUsableString("   "), "BLANK：只有空白也算没翻").toBe(false);
    expect(isUsableString({}), "指到子对象：实测屏上画的是 \"key 'a.b (zh-CN)' returned an object instead of string.\"").toBe(false);
    expect(isUsableString("："), "正常值").toBe(true);
    // 洞的形状当场写死：段名换错（nope）这条腿红得下来，截断（rang）它看不见——
    // 因为前缀匹配天生分不开这两者，硬要分开就得猜动态尾巴长什么样。见文件头。
    expect(leafKeys(zhCN).some((leaf) => leaf.startsWith("settingsPage.usage.rang")), "洞：截断仍是前缀，看不见").toBe(true);
  });
});

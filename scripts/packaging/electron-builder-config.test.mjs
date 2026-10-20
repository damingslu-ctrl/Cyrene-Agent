import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBrandFields, readBrand } from "../build/sync-brand.mjs";

const source = await readFile(new URL("../../electron-builder.yml", import.meta.url), "utf8");
const installerInclude = await readFile(new URL("../../build/installer/installer.nsh", import.meta.url), "utf8");

/**
 * 安装包名与开始菜单分类不在此处二次定义：期望值由唯一身份源 `src/shared/brand.ts`
 * 经生成器 `scripts/build/sync-brand.mjs` 推出（读的是它 `buildBrandFields().yml` 里
 * 那两行替换文本本身）。改名只需动 brand.ts，这个锁跟着走。
 * 取的是生成器写出的整行文本，因此断言用 `includes` 而不是正则——
 * `${version}.${ext}` 里的 `$`/`{}`/`.` 在正则里都得转义，手搓正则等于再维护一份写法。
 */
const brandFields = buildBrandFields(readBrand(new URL("../../src/shared/brand.ts", import.meta.url)));
const ymlLineFor = (anchor) => {
  const hit = brandFields.yml.find(([pattern]) => pattern === anchor);
  if (!hit) throw new Error(`sync-brand.mjs 不再输出锚点 ${anchor}，本锁的期望值无处可取`);
  return hit[1];
};
const artifactNameLine = ymlLineFor("^  artifactName:.*$");
const menuCategoryLine = ymlLineFor("^  menuCategory:.*$");

test("the core package excludes optional model and music components", () => {
  assert.match(source, /-\s+"!dist\/components\/\*\*\/\*"/);
  assert.match(source, /-\s+"!models\/\*\*\/\*"/);
  assert.match(source, /-\s+"!vendor\/cloud-music-mcp\/\*\*\/\*"/);
  assert.doesNotMatch(source, /-\s+models\/\*\*\/\*/);
  assert.match(source, /-\s+from: resources\/components/);
  assert.match(source, /to: components/);
  assert.ok(source.includes(artifactNameLine), `缺少生成器写出的安装器名行：${artifactNameLine}`);
});

test("the assisted installer exposes Cyrene setup choices and an uninstall entry", () => {
  assert.match(source, /createDesktopShortcut:\s+false/);
  assert.match(source, /include:\s+build\/installer\/installer\.nsh/);
  assert.ok(source.includes(menuCategoryLine), `缺少生成器写出的开始菜单分类行：${menuCategoryLine}`);
});

test("the assisted installer stores launch preferences under the application package name", () => {
  assert.match(
    installerInclude,
    /\$APPDATA\\\$\{APP_PACKAGE_NAME\}\\installer-options\.json/,
  );
  assert.doesNotMatch(
    installerInclude,
    /\$APPDATA\\\$\{PRODUCT_FILENAME\}\\installer-options\.json/,
  );
});

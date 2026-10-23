// scripts/build/inventory-brand-colors.mjs
/**
 * 普查 + 生成迁移表草案。产出的 JSON 是**给人改的**，不是给人读的日志：
 * 回写脚本按它做精确替换，锁按它逐条核对。跑它是为了重建草案，不是每次都跑。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

const outfile = resolve("node_modules/.cache/mochi-palette/color-roles.mjs");
await esbuild.build({
  entryPoints: [resolve("src/shared/color-roles.ts")],
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const { scanColorLiterals, proposeToken } = await import(new URL(`file://${outfile}`).href);

const files = globSync("src/**/*.css", { cwd: process.cwd() })
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !THEME_FILES.includes(f));

const rows = new Map();
let lines = 0;
for (const file of files) {
  const css = readFileSync(file, "utf8");
  const hits = scanColorLiterals(css);
  if (hits.length) lines += 1;
  for (const hit of hits) {
    const key = hit.text.toLowerCase();
    const cur = rows.get(key) ?? {
      spelling: hit.text, family: hit.family, property: hit.property,
      token: proposeToken(hit), count: 0, files: new Set(),
    };
    cur.count += 1;
    cur.files.add(file);
    rows.set(key, cur);
  }
}

const sorted = [...rows.values()].sort((a, b) => b.count - a.count);
const out = {};
for (const r of sorted) {
  out[r.spelling] = r.token === "needsReview"
    ? { needsReview: true, family: r.family, count: r.count, sample: [...r.files][0] }
    : r.token.startsWith("color-mix(")
      ? { expr: r.token }
      : { token: r.token };
}
const target = "scripts/build/color-migration.json";
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`写入 ${target}：${sorted.length} 个写法，覆盖 ${sorted.reduce((n, r) => n + r.count, 0)} 处，`
  + `其中 needsReview ${sorted.filter((r) => r.token === "needsReview").length} 条`);

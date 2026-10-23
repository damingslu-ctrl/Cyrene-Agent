// D 轨自检页：把 198 个 target 拼成一张带标签的联系表，写到仓库外（不进 git）。
// 用途不是看大图 —— 是按「真实显示尺寸的一半」看小尺寸下还认不认得出，
// 并且同一页切 paper/ink 两种桌面底色，验白爪猫与深墨猫都不糊在背景里。
//
//   node scripts/build/cat-contact-sheet.mjs [--out=D:/cyrene-p4-accept/sheet.html]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST = path.join(REPO, "node_modules/.cache/mochi-palette/cat-sprite-manifest.mjs");
const DEFAULT_OUT = "D:/cyrene-p4-accept/sheet.html";

/** 半尺寸：方图 64、贴纸 96、横幅 320（plan Task 28 Step 3） */
function displayWidth(target, isSticker) {
  if (isSticker) return 96;
  if (target.crop === "wide") return 320;
  return 64;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cell(target, isSticker) {
  const abs = path.join(REPO, target.out);
  const stat = fs.statSync(abs);
  const width = displayWidth(target, isSticker);
  const rel = target.out.replace(/\\/g, "/");
  return `<figure>
      <img src="${esc(pathToFileURL(abs).href)}" width="${width}" alt="${esc(rel)}" loading="lazy">
      <figcaption>${esc(path.basename(rel))} · ${(stat.size / 1024).toFixed(1)} KB</figcaption>
    </figure>`;
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? DEFAULT_OUT;
  const m = await import(pathToFileURL(MANIFEST).href);

  const groups = new Map();
  const push = (dir, html) => {
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(html);
  };

  for (const t of m.SPRITE_TARGETS) push(path.posix.dirname(t.out.replace(/\\/g, "/")), cell(t, false));
  for (const t of m.NON_CHARACTER_TARGETS) push(path.posix.dirname(t.out.replace(/\\/g, "/")), cell(t, false));
  for (const s of m.CAT_STICKERS) {
    push(
      "src/renderer/public/stickers",
      cell({ out: `src/renderer/public/stickers/${s.id}.png`, crop: "bust" }, true),
    );
  }

  const dirNames = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const total =
    m.SPRITE_TARGETS.length + m.NON_CHARACTER_TARGETS.length + m.CAT_STICKERS.length;

  const sections = dirNames
    .map((dir) => {
      const items = groups.get(dir);
      return `<section>
    <h2>${esc(dir)} <span class="count">${items.length}</span></h2>
    <div class="grid">
    ${items.join("\n    ")}
    </div>
  </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="zh-CN" data-theme="paper">
<head>
<meta charset="utf-8">
<title>Mochi · D 轨联系表（${total} 张）</title>
<style>
  :root { color-scheme: light dark; }
  html[data-theme="paper"] body { background: #f7f4ec; }
  html[data-theme="ink"] body { background: #101420; }
  body { margin: 0; padding: 24px 32px 64px; font: 13px/1.4 system-ui, "Segoe UI", sans-serif; }
  header { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 12px 0; background: inherit; }
  header button { padding: 6px 14px; border: 1px solid #8886; border-radius: 999px; background: #8881; color: inherit; cursor: pointer; font: inherit; }
  /* 标题与计数用固定底色的胶囊，页面底色切主题时文字始终可读 */
  h1, h2 { display: inline-block; margin: 0; padding: 2px 10px; border-radius: 6px; background: #000a; color: #fff; }
  h1 { font-size: 15px; }
  h2 { font-size: 12px; margin: 20px 0 10px; }
  .count { opacity: .7; font-weight: 400; }
  .grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  img { image-rendering: pixelated; height: auto; }
  figcaption { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #000a; color: #fff; white-space: nowrap; }
</style>
</head>
<body>
<header>
  <h1>Mochi · 联系表 · ${total} 张</h1>
  <button data-set="paper">paper #f7f4ec</button>
  <button data-set="ink">ink #101420</button>
</header>
${sections}
<script>
  for (const b of document.querySelectorAll("header button")) {
    b.onclick = () => document.documentElement.dataset.theme = b.dataset.set;
  }
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(outArg), { recursive: true });
  fs.writeFileSync(outArg, html, "utf8");
  console.log(`wrote ${outArg} · ${total} targets · ${dirNames.length} groups · ${(html.length / 1024).toFixed(1)} KB html`);
}

await main();

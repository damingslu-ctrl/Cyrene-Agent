// 名册与资产键的存在性对齐：CAT_ROSTER 里每只猫，五处资产/提示目录都得有同名条目。
// 用法：node scripts/build/check-roster.mjs
// 只验「键」不验「像素」——位图内容由 Task 24 的 --check 像素尺管。
// 走 esbuild 缓存（Phase C 的路子），不引入 tsx。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "mochi-palette");

async function main() {
  await fs.promises.mkdir(CACHE, { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, "src", "shared", "cat-roster.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(CACHE, "cat-roster.cjs"),
    logLevel: "silent",
  });
  const { CAT_ROSTER, ASSISTANT_NICKNAME } = await import(
    pathToFileURL(path.join(CACHE, "cat-roster.cjs")).href
  );

  const moodDir = (name) => path.join(ROOT, "src", "renderer", "react", "assets", "characters", name, "status-moods");
  const checks = (name) => [
    moodDir(name),
    path.join(ROOT, "src", "renderer", "react", "avatars", `${name}.png`),
    path.join(ROOT, "src", "renderer", "tast", `${name}.png`),
    path.join(ROOT, "prompts", "moments_personas", `${name}.md`),
    path.join(ROOT, "prompts", "task", `${name}.md`),
  ];

  const problems = [];
  const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

  for (const cat of CAT_ROSTER) {
    for (const p of checks(cat.nickname)) {
      if (!fs.existsSync(p)) {
        problems.push(`MISS ${rel(p)}`);
      } else if (p === moodDir(cat.nickname)) {
        const pngs = fs.readdirSync(p).filter((f) => f.toLowerCase().endsWith(".png"));
        if (pngs.length === 0) problems.push(`EMPTY ${rel(p)}`);
      }
    }
  }

  // 助手是第 13 只：人格卡按昵称找文件，头像走 public/assets 里的固定 path
  // （`useCyreneAvatar` → resolveAsset("avatars/cyrene-avatar.png")），不参与 <昵称>.png 命名。
  const assistantCards = [
    path.join(ROOT, "prompts", "moments_personas", `${ASSISTANT_NICKNAME}.md`),
    path.join(ROOT, "src", "renderer", "public", "avatars", "cyrene-avatar.png"),
  ];
  for (const p of assistantCards) {
    if (!fs.existsSync(p)) problems.push(`MISS ${rel(p)}`);
  }

  if (problems.length > 0) {
    for (const line of problems) console.log(line);
    process.exit(1);
  }
  console.log(`OK ${CAT_ROSTER.length} cats + ${ASSISTANT_NICKNAME}, 5 asset keys each`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

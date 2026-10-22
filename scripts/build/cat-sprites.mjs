// 生成位图资产：在 Node 里跑与桌面猫同一套 DrawOp（src/renderer/pet/art.ts）。
// 用法：node scripts/build/cat-sprites.mjs [--check] [--only=icons]
// - 默认：按 src/renderer/pet/cat-sprite-manifest.ts 的 SPRITE_TARGETS + NON_CHARACTER_TARGETS 生成全表 PNG。
//   清单即数据——别在本文件里再手抄一份目标表（手抄必漏，漏了 --check 也只看已有文件）。
// - --check：不写盘。逐条过像素尺 + 与磁盘逐字节比 + 两条跨条目判据，任一红即 exit 1。
// - --only=icons：Task 11 的装机图标支路（assets/ 与 build/installer/），与全表无关。
// 输出全部进 git（像素尺要能跨提交比较，构建期不依赖网络）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "mochi-palette");

/** 两张图至少要有这么多比例的像素不同，才算「不是同一张图」。
 *  实测量：同一只猫的 6 档最小 3.29%，25 档散点最小 1.16%（都是 256²），带留两倍余量。 */
const MIN_PIXEL_DIFF = 0.005;

async function loadManifest() {
  await fs.promises.mkdir(CACHE, { recursive: true });
  const outfile = path.join(CACHE, "cat-sprite-manifest.mjs");
  // 只打一个入口：cat-variants → art → tokens/ops/xf、cat-roster、sprite-raster、png-encode 全在
  // 这棵 import 图里。Task 11 那种「逐个 import src/shared/*.ts」的写法在 D2 全表下会漏依赖。
  await build({
    entryPoints: [path.join(ROOT, "src", "renderer", "pet", "cat-sprite-manifest.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

function render(m, t) {
  const size = { w: t.size, h: t.height ?? t.size };
  const mask = m.CAT_CROPS[t.crop].mask === "disc" ? "disc" : "none";
  const ops = m.buildSpriteOps(
    { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy },
    size,
  );
  const raster = m.renderOps(ops, size.w, size.h, { mask });
  return { raster, png: m.encodePng(raster.width, raster.height, raster.rgba) };
}

function pixelDiffRatio(a, b) {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      a.rgba[i] !== b.rgba[i] ||
      a.rgba[i + 1] !== b.rgba[i + 1] ||
      a.rgba[i + 2] !== b.rgba[i + 2] ||
      a.rgba[i + 3] !== b.rgba[i + 3]
    ) {
      n += 1;
    }
  }
  return n / (a.width * a.height);
}

function pairDistinct(bad, label, a, b) {
  const ratio = pixelDiffRatio(a.raster, b.raster);
  if (ratio < MIN_PIXEL_DIFF) {
    bad.push(`${label}: ${a.t.out} ↔ ${b.t.out} 只差 ${(ratio * 100).toFixed(3)}% 像素（下限 ${MIN_PIXEL_DIFF * 100}%）`);
  }
}

/** 角色位图与非角色位图是两张表，但只有一条生成/校验管线——分表是为了让 Task 28 能只 import 一张。 */
function allTargets(m) {
  return [...m.SPRITE_TARGETS, ...m.NON_CHARACTER_TARGETS];
}

async function generate() {
  const m = await loadManifest();
  const targets = allTargets(m);
  const total = { kb: 0 };
  for (const t of targets) {
    const { png } = render(m, t);
    const full = path.join(ROOT, t.out);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, png);
    total.kb += png.length / 1024;
  }
  console.log(`wrote ${targets.length} PNGs · ${total.kb.toFixed(1)} KB`);
}

async function check() {
  const m = await loadManifest();
  const rows = allTargets(m).map((t) => ({ t, ...render(m, t) }));
  const bad = [];

  for (const row of rows) {
    for (const line of m.checkTarget(row.raster, row.t)) bad.push(`${row.t.out}: ${line}`);
    const full = path.join(ROOT, row.t.out);
    let onDisk;
    try {
      onDisk = fs.readFileSync(full);
    } catch {
      bad.push(`${row.t.out}: 缺文件（先跑一次不带 --check 的生成）`);
      continue;
    }
    if (!onDisk.equals(row.png)) bad.push(`${row.t.out}: 与磁盘不一致（磁盘上是旧图，重新生成）`);
  }

  // ① 同一只猫的 6 档必须两两是**不同的画**。判据用逐像素比，而不是 (覆盖度, 质心)：
  //    实测「连接中/提醒」两张光是瞳孔颜色不同，(覆盖度, 质心) 差 0 却差 3.29% 像素——
  //    那把尺会把两幅不同的画判成同一张，是假红；而同一张画一定 0% 像素差，真问题跑不掉。
  const cats = new Map();
  for (const row of rows.filter((r) => /\/characters\/[^/]+\/status-moods\//.test(r.t.out))) {
    const key = row.t.out.replace(/\/status-moods\/[^/]+$/, "");
    if (!cats.has(key)) cats.set(key, []);
    cats.get(key).push(row);
  }
  for (const [key, group] of cats) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) pairDistinct(bad, key, group[i], group[j]);
    }
  }

  // ② 25 档散点情绪任意两张也不能是同一张画（防「两个情绪出同一张图」）。
  const loose = rows.filter((r) => /assets\/status-moods\//.test(r.t.out));
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) pairDistinct(bad, "status-moods", loose[i], loose[j]);
  }

  console.log(
    `checked ${rows.length} targets · ${cats.size} 只猫 × 6 档 + ${loose.length} 档散点 + ${m.NON_CHARACTER_TARGETS.length} 张非角色`,
  );
  if (bad.length) {
    for (const line of bad) console.error(`✗ ${line}`);
    throw new Error(`${bad.length} 条判据未过`);
  }
  console.log("all clear");
}

async function generateIcons() {
  const m = await loadManifest();
  const cat = (size, crop, coat, pose) => render(m, { size, crop, coat, pose });
  const write = (out, png) => {
    const full = path.join(ROOT, out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, png);
    console.log("wrote", out);
  };

  // 图标不再是第二套画法：Task 11 的五颗椭圆是占位（当时还没有花色轴 / 姿态轴），
  // Task 11 的代码注释把「花色统一」显式留给 Task 24（plan:1897）——这里换成与桌面猫
  // 同一套 buildSpriteOps。花色对应 `ui-icon.ts` 的标签：墨猫＝ink、奶猫＝paper；
  // 应用图标跟桌面猫的默认花色（INK_COAT）走，浅色任务栏上也看得见。
  write("assets/mochi-icon.png", cat(256, "square", "ink", "sit").png);
  write("assets/icon-presets/cyrene-pink.png", cat(256, "full", "ink", "sit").png);
  write("assets/icon-presets/cyrene-sun.png", cat(256, "square", "paper", "happy").png);

  // 托盘/资源管理器吃真 ICO：PNG-in-ICO 六档（R-11-2；256 在目录里记 0 是格式规定）。
  const icoSizes = [16, 32, 48, 64, 128, 256];
  write(
    "assets/tray-icon.ico",
    m.encodeIco(icoSizes.map((size) => ({ width: size, height: size, png: cat(size, "square", "ink", "sit").png }))),
  );

  write("build/installer/mochi-installer-source.png", cat(150, "full", "ink", "happy").png);
}

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  if (only === "icons") return generateIcons();
  if (only !== undefined) throw new Error(`未知的 --only=${only}（只支持 icons）`);
  if (process.argv.includes("--check")) return check();
  return generate();
}

main().catch((e) => { console.error(e); process.exit(1); });

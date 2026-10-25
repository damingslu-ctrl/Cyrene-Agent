// 生成位图资产：在 Node 里跑与桌面猫同一套 DrawOp（src/renderer/pet/art.ts）。
// 用法：node scripts/build/cat-sprites.mjs [--check] [--only=icons|stickers]
// - 默认：按清单生成全表 PNG（角色 SPRITE_TARGETS + 非角色 NON_CHARACTER_TARGETS + 表情 CAT_STICKERS）。
//   清单即数据——别在本文件里再手抄一份目标表（手抄必漏，漏了 --check 也只看已有文件）。
// - --check：不写盘。逐条过像素尺 + 与磁盘逐字节比 + 两条跨条目判据，任一红即 exit 1。
// - --only=icons：装机图标支路（assets/ 与 build/installer/），与全表无关。
// - --only=stickers：只写 52 张表情包（改表情表时不必重画全表）。
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

/**
 * 猫娘立绘的源图（`image` 图元）：30 格静帧表 + 参考图母版 + 7 格高清姿态表。
 * 由 `build-girl-anim.py` / `build-girl-poses.py` 生成，只进构建期，不进渲染器包。
 */
function loadImages(m) {
  const read = (rel) => m.decodePng(fs.readFileSync(path.join(ROOT, rel)));
  return {
    [m.GIRL_STILLS.src]: read("scripts/assets/generated/girl-stills.png"),
    [m.GIRL_MASTER.src]: read("scripts/assets/generated/girl-master.png"),
    [m.GIRL_HIRES.src]: read("scripts/assets/generated/girl-poses.png"),
  };
}

function render(m, t, images) {
  const size = { w: t.size, h: t.height ?? t.size };
  const crops = m.cropsForForm(t.form ?? "cat");
  const mask = crops[t.crop].mask === "disc" ? "disc" : "none";
  const ops = m.buildSpriteOps(
    { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy, form: t.form, frame: t.frame },
    size,
  );
  const raster = m.renderOps(ops, size.w, size.h, { mask, images });
  return { raster, png: m.encodePng(raster.width, raster.height, raster.rgba) };
}

/**
 * 阈值按形态分列（2026-10-24 实测后记）：猫四足立绘的脸占画布 1/3，0.5% 抓得住；
 * 猫娘是二头身、bust 取景里脸只占 1/6，同一个 0.5% 会把「不同的画」判成同一张。
 * girl 取 0.15%——仍是「一像素两像素」量级之上的可分辨线，不是放空。
 * 台账见 docs/verge/notes/progress.md；改它必须先跑 --measure 并记新数。
 */
const MIN_PIXEL_DIFF_BY_FORM = { cat: 0.005, girl: 0.0015 };

function pairDistinct(bad, label, m, a, b) {
  const ratio = m.pixelDiffRatio(a.raster, b.raster);
  const floor = MIN_PIXEL_DIFF_BY_FORM[(a.t.form ?? "cat")] ?? m.MIN_PIXEL_DIFF;
  if (ratio < floor) {
    bad.push(`${label}: ${a.t.out} ↔ ${b.t.out} 只差 ${(ratio * 100).toFixed(3)}% 像素（下限 ${floor * 100}%）`);
  }
}

/** 52 张表情包：512² bust，id 即文件名。表在 `src/shared/cat-sticker-set.ts`，不在这里手抄。 */
function stickerTargets(m) {
  return m.CAT_STICKERS.map((s) => ({
    out: `src/renderer/public/stickers/${s.id}.png`,
    size: m.STICKER_SIZE,
    crop: "bust",
    coat: s.coat,
    pose: s.pose,
    mood: s.mood,
    maxKb: 60,
  }));
}

/** 三张表（角色 / 非角色 / 表情包）走同一条生成与校验管线——分表是为了让下游只 import 需要的那张。 */
function allTargets(m) {
  return [...m.SPRITE_TARGETS, ...m.NON_CHARACTER_TARGETS, ...stickerTargets(m)];
}

async function writeTargets(m, targets, images) {
  let kb = 0;
  for (const t of targets) {
    const { png } = render(m, t, images);
    const full = path.join(ROOT, t.out);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, png);
    kb += png.length / 1024;
  }
  return kb;
}

async function generate() {
  const m = await loadManifest();
  const images = loadImages(m);
  const targets = allTargets(m);
  const kb = await writeTargets(m, targets, images);
  console.log(`wrote ${targets.length} PNGs · ${kb.toFixed(1)} KB`);
}

async function generateStickers() {
  const m = await loadManifest();
  const targets = stickerTargets(m);
  const kb = await writeTargets(m, targets, undefined);
  console.log(`wrote ${targets.length} stickers · ${kb.toFixed(1)} KB`);
}

/**
 * --measure：不写盘，按 form×crop 分组打印实测（覆盖度/质心/计数）。
 * 钉取景与覆盖带前必须先跑它——「量不出来不改判据」（spec §13 风险 3）。
 */
async function measure() {
  const m = await loadManifest();
  const images = loadImages(m);
  const rows = [...m.SPRITE_TARGETS, ...m.NON_CHARACTER_TARGETS].map((t) => ({ t, ...render(m, t, images) }));
  const groups = new Map();
  for (const { t, raster, png } of rows) {
    const key = `${t.form ?? "cat"}/${t.crop}`;
    const cov = m.alphaCoverage(raster);
    const c = m.inkCentroid(raster);
    const off = Math.hypot(c.x - raster.width / 2, c.y - raster.height / 2) / raster.width;
    const kb = png.length / 1024;
    const g = groups.get(key) ?? { count: 0, covMin: 1, covMax: 0, offMax: 0, kbMin: Infinity, kbMax: 0 };
    g.count += 1;
    g.covMin = Math.min(g.covMin, cov);
    g.covMax = Math.max(g.covMax, cov);
    g.offMax = Math.max(g.offMax, off);
    g.kbMin = Math.min(g.kbMin, kb);
    g.kbMax = Math.max(g.kbMax, kb);
    groups.set(key, g);
  }
  for (const [key, g] of [...groups.entries()].sort()) {
    if (g.count === 0) throw new Error(`${key} 组是空的——量不出来不许进下一步`);
    console.log(`${key}  n=${g.count}  cov ${g.covMin.toFixed(3)}..${g.covMax.toFixed(3)}  off<=${(g.offMax * 100).toFixed(1)}%  kb ${g.kbMin.toFixed(0)}..${g.kbMax.toFixed(0)}`);
  }
}

async function check() {
  const m = await loadManifest();
  const images = loadImages(m);
  const rows = allTargets(m).map((t) => ({ t, ...render(m, t, images) }));
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
      for (let j = i + 1; j < group.length; j += 1) pairDistinct(bad, key, m, group[i], group[j]);
    }
  }

  // ② 25 档散点情绪任意两张也不能是同一张画（防「两个情绪出同一张图」）。
  const loose = rows.filter((r) => /assets\/status-moods\//.test(r.t.out));
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) pairDistinct(bad, "status-moods", m, loose[i], loose[j]);
  }

  console.log(
    `checked ${rows.length} targets · ${cats.size} 只猫 × 6 档 + ${loose.length} 档散点 + ${m.NON_CHARACTER_TARGETS.length} 张非角色 + ${m.CAT_STICKERS.length} 张表情`,
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
  if (only === "stickers") return generateStickers();
  if (only !== undefined) throw new Error(`未知的 --only=${only}（只支持 icons / stickers）`);
  if (process.argv.includes("--check")) return check();
  if (process.argv.includes("--measure")) return measure();
  return generate();
}

main().catch((e) => { console.error(e); process.exit(1); });

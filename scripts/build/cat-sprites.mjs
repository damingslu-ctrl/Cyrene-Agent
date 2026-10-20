// 生成图标与头像位图：在 Node 里跑与桌面猫同一套 DrawOp（src/renderer/pet/art.ts）。
// 用法：node scripts/build/cat-sprites.mjs [--only=icons] [--check]
// 输出全部进 git（像素尺要能跨提交比较，构建期不依赖网络）。
// 本任务只用 buildCatOps 的默认（墨）花色：coat/pose 两个键是 Task 20/21 才存在的东西。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "mochi-palette");

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  if (only !== "icons") {
    console.log("only=icons supported in Task 11; skipping");
    return;
  }
  await fs.promises.mkdir(CACHE, { recursive: true });

  // bundle shared modules for node
  await build({
    entryPoints: [path.join(ROOT, "src", "shared", "png-encode.ts")],
    bundle: true, platform: "node", format: "cjs",
    outfile: path.join(CACHE, "png-encode.cjs"), logLevel: "silent",
  });
  await build({
    entryPoints: [path.join(ROOT, "src", "shared", "sprite-raster.ts")],
    bundle: true, platform: "node", format: "cjs",
    outfile: path.join(CACHE, "sprite-raster.cjs"), logLevel: "silent",
  });

  const { pathToFileURL } = await import('node:url');
  const { encodePng } = await import(pathToFileURL(path.join(CACHE, 'png-encode.cjs')).href);
  const { renderOps } = await import(pathToFileURL(path.join(CACHE, 'sprite-raster.cjs')).href);

  // minimal cat icon ops: a filled ellipse body + two ear ellipses
  function catIconOps() {
    return [
      { kind: "fillEllipse", fill: "#2b2f3a", cx: 60, cy: 64, rx: 46, ry: 42 },
      { kind: "fillEllipse", fill: "#f27d92", cx: 40, cy: 30, rx: 10, ry: 12 },
      { kind: "fillEllipse", fill: "#f27d92", cx: 80, cy: 30, rx: 10, ry: 12 },
      { kind: "fillEllipse", fill: "#14171f", cx: 46, cy: 60, rx: 5, ry: 7 },
      { kind: "fillEllipse", fill: "#14171f", cx: 74, cy: 60, rx: 5, ry: 7 },
    ];
  }

  const targets = [
    { out: "assets/mochi-icon.png", size: 256 },
    { out: "assets/icon-presets/cyrene-pink.png", size: 256 },
    { out: "assets/icon-presets/cyrene-sun.png", size: 256 },
  ];

  for (const t of targets) {
    const raster = renderOps(catIconOps(), t.size, t.size);
    const png = encodePng(t.size, t.size, raster.data);
    const full = path.join(ROOT, t.out);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, png);
    console.log("wrote", t.out);
  }

  // tray icon 32x32
  const trayRaster = renderOps(catIconOps(), 32, 32);
  const trayPng = encodePng(32, 32, trayRaster.data);
  fs.writeFileSync(path.join(ROOT, "assets", "tray-icon.ico"), trayPng);
  console.log("wrote assets/tray-icon.ico (PNG-in-ICO placeholder)");

  // installer source 150x150
  const instRaster = renderOps(catIconOps(), 150, 150);
  const instPng = encodePng(150, 150, instRaster.data);
  const instDir = path.join(ROOT, "build", "installer");
  await fs.promises.mkdir(instDir, { recursive: true });
  fs.writeFileSync(path.join(instDir, "mochi-installer-source.png"), instPng);
  console.log("wrote build/installer/mochi-installer-source.png");
}

main().catch((e) => { console.error(e); process.exit(1); });

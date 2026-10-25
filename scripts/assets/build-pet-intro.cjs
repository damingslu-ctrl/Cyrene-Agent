#!/usr/bin/env node
/**
 * 桌宠登场动画资产管线：参考视频 → 带 alpha 的帧图集（WebP）+ 帧参数（meta.js）。
 *
 * 用法（必须用 Electron 跑：HEVC 解码与 WebP 编码都靠 Chromium）：
 *   npx electron scripts/assets/build-pet-intro.cjs            # 重新生成资产
 *   npx electron scripts/assets/build-pet-intro.cjs --verify   # 额外出三底色验收图
 *
 * 产物（提交进 git）：
 *   src/renderer/public/pet-intro/atlas.webp   10 列图集，91 帧，每帧 304×248
 *   src/renderer/public/pet-intro/meta.js      帧栅格/帧率（页面 <script> 加载，file:// 下不能 fetch JSON）
 *
 * 中间产物（.cache/pet-intro/，不进 git）：抽出的原始帧、图集 PNG、验收图。
 *
 * 抠像口径（为什么不是按键抠色）：
 *  1. 白肚皮/白爪/白袜与背景只差几个色阶 —— 不能按颜色键，靠深色轮廓围出的洞补回来；
 *  2. 原画外圈有一层浅色辉光 + 很宽的软边 —— 按 |C−B| 定 alpha 会把辉光判成实心；
 *  3. 脚下有一团粉灰接触影 —— 是「把背景乘暗」，会跟鞋连成一片，必须先从核心里摘掉。
 * 做法：核心 = 差分为主、色度/亮度为辅（影子色度低、亮度高，被排除）；保留所有够大的
 * 连通域 + 填洞得到实心掩膜；外缘用覆盖率投影 a=(C−B)·(F−B)/|F−B|² 求软 alpha，
 * F 由掩膜内部颜色向最近的实心像素扩散；最后按 C=a·F+(1−a)·B 反解出去污色。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = path.join(__dirname, "source", "pet-intro.mp4");
const CACHE = path.join(ROOT, ".cache", "pet-intro");
const OUT = path.join(ROOT, "src", "renderer", "public", "pet-intro");
const FPS = 24; // 源片实测 146 帧 @24fps（mp4 stts: 145×25/600s）；按 15fps 抽会与「每 2 帧换一张画」的节拍错位
const SCALE = 0.5; // 608×496 → 304×248（桌宠原画尺寸的 1.5 倍窗刚刚好）
const WEBP_QUALITY = 0.9;
const FADE_MS = 320;
const COLS = 10;

// 影子里没有深色，85 分位取到的基本是「这一列角色不在的那几帧」。
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");

const VERIFY = process.argv.includes("--verify");
const log = (...args) => console.log("[pet-intro]", ...args);

function writeHtml(name, body) {
  const file = path.join(CACHE, name);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>${body}`);
  return file;
}

/** 抽出视频帧，返回原始 RGBA 帧数组与尺寸。 */
async function extractFrames(win, videoPath) {
  const page = writeHtml("extract.html", `<video id="v" preload="auto" muted playsinline></video>`);
  await win.loadFile(page);
  const info = await win.webContents.executeJavaScript(`(async () => {
    const v = document.getElementById("v");
    v.src = ${JSON.stringify(pathToFileURL(videoPath).href)};
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error("video load failed: " + (v.error && v.error.message)));
      setTimeout(res, 8000);
    });
    v.pause();
    window.__v = v;
    window.__c = document.createElement("canvas");
    window.__c.width = Math.round(v.videoWidth * ${SCALE});
    window.__c.height = Math.round(v.videoHeight * ${SCALE});
    window.__ctx = window.__c.getContext("2d", { willReadFrequently: true });
    window.__ctx.imageSmoothingQuality = "high";
    return { w: v.videoWidth, h: v.videoHeight, dur: v.duration };
  })()`);
  const W = Math.round(info.w * SCALE);
  const H = Math.round(info.h * SCALE);
  const count = Math.floor(info.dur * FPS) + 1;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = Math.min(i / FPS, info.dur - 0.001);
    const b64 = await win.webContents.executeJavaScript(`(async () => {
      const v = window.__v;
      v.currentTime = ${t};
      await new Promise((res) => {
        const done = () => res();
        v.onseeked = done;
        setTimeout(done, 2000);
      });
      window.__ctx.drawImage(v, 0, 0, ${W}, ${H});
      const d = window.__ctx.getImageData(0, 0, ${W}, ${H}).data;
      let s = "";
      const CH = 0x8000;
      for (let k = 0; k < d.length; k += CH) s += String.fromCharCode.apply(null, d.subarray(k, k + CH));
      return btoa(s);
    })()`);
    frames.push(new Uint8Array(Buffer.from(b64, "base64")));
  }
  return { frames, W, H };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function dilate(m, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let dy = -r; dy <= r && !v; dy++) for (let dx = -r; dx <= r && !v; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W && m[yy * W + xx]) v = 1;
    }
    out[y * W + x] = v;
  }
  return out;
}

function erode(m, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1;
    for (let dy = -r; dy <= r && v; dy++) for (let dx = -r; dx <= r && v; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W || !m[yy * W + xx]) v = 0;
    }
    out[y * W + x] = v;
  }
  return out;
}

/** 只沿竖直方向做闭运算：焊上「连体衣下摆 ↔ 白袜 ↔ 鞋」的白缝，又不填掉两腿之间的缝。 */
function vclose(m, W, H, r) {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let dy = -r; dy <= r && !v; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < H && m[yy * W + x]) v = 1;
    }
    d[y * W + x] = v;
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1;
    for (let dy = -r; dy <= r && v; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H || !d[yy * W + x]) v = 0;
    }
    out[y * W + x] = v;
  }
  return out;
}

function close(m, W, H, r) {
  return erode(dilate(m, W, H, r), W, H, r);
}

function label(m, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const stack = [];
  for (let p = 0; p < W * H; p++) {
    if (!m[p] || lab[p] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.length = 0;
    stack.push(p);
    lab[p] = id;
    while (stack.length) {
      const q = stack.pop();
      n++;
      const x = q % W, y = (q / W) | 0;
      if (x > 0 && m[q - 1] && lab[q - 1] < 0) { lab[q - 1] = id; stack.push(q - 1); }
      if (x < W - 1 && m[q + 1] && lab[q + 1] < 0) { lab[q + 1] = id; stack.push(q + 1); }
      if (y > 0 && m[q - W] && lab[q - W] < 0) { lab[q - W] = id; stack.push(q - W); }
      if (y < H - 1 && m[q + W] && lab[q + W] < 0) { lab[q + W] = id; stack.push(q + W); }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

function fillHoles(m, W, H) {
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (p) => {
    if (!m[p] && !outside[p]) { outside[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const q = stack.pop();
    const x = q % W, y = (q / W) | 0;
    if (x > 0) push(q - 1);
    if (x < W - 1) push(q + 1);
    if (y > 0) push(q - W);
    if (y < H - 1) push(q + W);
  }
  const out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) out[p] = outside[p] ? 0 : 1;
  return out;
}

/** 抠出一帧的 RGBA。 */
function keyFrame(fr, plate, W, H) {
  const N = W * H;
  const D = new Float32Array(N);
  const CH = new Float32Array(N);
  const LU = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const o = p * 4, r = fr[o], g = fr[o + 1], b = fr[o + 2];
    const dr = r - plate[p * 3], dg = g - plate[p * 3 + 1], db = b - plate[p * 3 + 2];
    D[p] = Math.sqrt(0.45 * dr * dr + 0.4 * dg * dg + 0.15 * db * db);
    CH[p] = Math.max(r, g, b) - Math.min(r, g, b);
    LU[p] = lum(r, g, b);
  }

  let core = new Uint8Array(N);
  for (let p = 0; p < N; p++) core[p] = D[p] > 10 && (CH[p] >= 40 || LU[p] <= 120) ? 1 : 0;
  for (let it = 0; it < 2; it++) core = erode(dilate(core, W, H, 1), W, H, 1);

  const { lab, sizes } = label(core, W, H);
  // 鞋和身体隔着白袜本来就不同连通：只留最大域会把腿整条丢掉，保留所有够大的域。
  let keep = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (lab[p] >= 0 && sizes[lab[p]] >= 300) keep[p] = 1;
  keep = vclose(keep, W, H, 13);
  // 袜口是下摆—袜—鞋之间的凹口；腿段（y≥185）再补一次方形闭运算封两侧，两腿之间 20+px 的缝封不住。
  const closed = close(keep, W, H, 13);
  for (let y = 185; y < H; y++) for (let x = 0; x < W; x++) keep[y * W + x] = closed[y * W + x];

  const solid = fillHoles(keep, W, H);
  const deep = erode(solid, W, H, 3);
  const support = dilate(solid, W, H, 4);

  // 内侧色场：从「确定实心」向外多源 BFS，每个支撑区像素取最近实心像素的颜色。
  // 先只用离背景足够远（D>30）的种子：白色耳毛/袜口本身贴着背景亮度，拿它当 F，
  // 投影式会把一圈粉底辉光判成 100% 覆盖（深底上的白边）。
  const Fin = new Float32Array(N * 3);
  const known = new Uint8Array(N);
  const bfs = (seedOk) => {
    const queue = [];
    for (let p = 0; p < N; p++) if (deep[p] && seedOk(p) && !known[p]) {
      known[p] = 1;
      Fin[p * 3] = fr[p * 4];
      Fin[p * 3 + 1] = fr[p * 4 + 1];
      Fin[p * 3 + 2] = fr[p * 4 + 2];
      queue.push(p);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi];
      const x = q % W, y = (q / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const r = yy * W + xx;
        if (known[r] || !support[r]) continue;
        known[r] = 1;
        Fin[r * 3] = Fin[q * 3];
        Fin[r * 3 + 1] = Fin[q * 3 + 1];
        Fin[r * 3 + 2] = Fin[q * 3 + 2];
        queue.push(r);
      }
    }
  };
  bfs((p) => D[p] > 30);
  bfs(() => true);

  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    if (!support[p]) { alpha[p] = 0; continue; }
    if (deep[p]) { alpha[p] = 1; continue; }
    if (!known[p]) { alpha[p] = smoothstep(6, 22, D[p]); continue; }
    const o = p * 4;
    const br = plate[p * 3], bg = plate[p * 3 + 1], bb = plate[p * 3 + 2];
    const fr_ = Fin[p * 3] - br, fg_ = Fin[p * 3 + 1] - bg, fb_ = Fin[p * 3 + 2] - bb;
    const den = fr_ * fr_ + fg_ * fg_ + fb_ * fb_;
    if (den < 30) { alpha[p] = 0; continue; }
    const a = ((fr[o] - br) * fr_ + (fr[o + 1] - bg) * fg_ + (fr[o + 2] - bb) * fb_) / den;
    let v = Math.max(0, Math.min(1, a));
    // 接触影是「背景整体乘暗」（C≈k·B，色度低、亮度高）：投影式会把它算成实心鞋色。
    if (v > 0.05 && CH[p] < 40 && LU[p] > 120) {
      const bn = br * br + bg * bg + bb * bb;
      const k = (fr[o] * br + fr[o + 1] * bg + fr[o + 2] * bb) / bn;
      if (k > 0.35 && k < 0.985) {
        const er = fr[o] - k * br, eg = fr[o + 1] - k * bg, eb = fr[o + 2] - k * bb;
        if (Math.sqrt(er * er + eg * eg + eb * eb) < 24) v = 0;
      }
    }
    alpha[p] = v;
  }

  // 去污：a 大时反解 F=(C−(1−a)B)/a；a 小时反解放大噪声，直接用内侧色场。
  const rgba = new Uint8Array(N * 4);
  for (let p = 0; p < N; p++) {
    const a = Math.max(0, Math.min(1, alpha[p]));
    const o = p * 4;
    if (a <= 0.004) { rgba[o + 3] = 0; continue; }
    const w = smoothstep(0.05, 0.55, a);
    for (let c = 0; c < 3; c++) {
      const bg = plate[p * 3 + c];
      const raw = (fr[o + c] - (1 - a) * bg) / a;
      const f = w * raw + (1 - w) * Fin[p * 3 + c];
      rgba[o + c] = Math.max(0, Math.min(255, Math.round(f)));
    }
    rgba[o + 3] = Math.round(a * 255);
  }
  return rgba;
}

function keyAll(frames, W, H) {
  const N = W * H;
  // 背景板：逐像素取时域 85 分位那一帧的颜色。60 分位会被角色长期压住的像素
  // （发梢、尾巴甩过的位置）污染成角色色，抠出一圈假实心。
  const plate = new Uint8Array(N * 3);
  for (let p = 0; p < N; p++) {
    const ls = new Float32Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
      const o = p * 4;
      ls[i] = lum(frames[i][o], frames[i][o + 1], frames[i][o + 2]);
    }
    const sorted = Float32Array.from(ls).sort();
    const target = sorted[Math.floor(frames.length * 0.85)];
    const bi = ls.findIndex((v) => v === target);
    const o = p * 4;
    plate[p * 3] = frames[bi][o];
    plate[p * 3 + 1] = frames[bi][o + 1];
    plate[p * 3 + 2] = frames[bi][o + 2];
  }
  return frames.map((fr, i) => {
    const out = keyFrame(fr, plate, W, H);
    if (i % 10 === 0 || i === frames.length - 1) log(`keyed ${i + 1}/${frames.length}`);
    return out;
  });
}

// —— PNG 编码（只用 node:zlib；仅供 Chromium 读回后转 WebP）——
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const source = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    source.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildAtlas(frames, W, H) {
  const rows = Math.ceil(frames.length / COLS);
  const AW = W * COLS, AH = H * rows;
  const atlas = Buffer.alloc(AW * AH * 4);
  frames.forEach((frame, i) => {
    const ox = (i % COLS) * W;
    const oy = Math.floor(i / COLS) * H;
    for (let y = 0; y < H; y++) {
      const from = y * W * 4;
      const to = ((oy + y) * AW + ox) * 4;
      Buffer.from(frame.buffer, frame.byteOffset + from, W * 4).copy(atlas, to);
    }
  });
  return { atlas, cols: COLS, rows, AW, AH };
}

function writeMeta(meta) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "meta.js"),
    "// 由 scripts/assets/build-pet-intro.cjs 生成；改帧数/帧率请改那边再重跑。\n" +
      `window.PET_INTRO = ${JSON.stringify(meta)};\n`,
  );
}

async function encodeWebp(win, pngPath, quality) {
  await win.loadFile(writeHtml("encode.html", `<canvas id="c"></canvas>`));
  const pngName = path.basename(pngPath);
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(pngName)};
    await img.decode();
    const c = document.getElementById("c");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    window.__img = img;
    return c.toDataURL("image/webp", ${quality});
  })()`);
  return Buffer.from(dataUrl.replace(/^data:image\/webp;base64,/, ""), "base64");
}

async function writeVerifySheet(win, meta, pngPath) {
  const pngName = path.basename(pngPath);
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(pngName)};
    await img.decode();
    const FW = ${meta.frameW}, FH = ${meta.frameH}, COLS = ${meta.cols};
    const PICK = [0, 30, 60, ${meta.count - 1}], BGS = [12, 96, 200];
    const c = document.createElement("canvas");
    c.width = FW * PICK.length;
    c.height = FH * BGS.length;
    const g = c.getContext("2d");
    BGS.forEach((bg, row) => {
      g.fillStyle = "rgb(" + bg + "," + bg + "," + bg + ")";
      g.fillRect(0, row * FH, c.width, FH);
      PICK.forEach((fi, col) => {
        const sx = (fi % COLS) * FW, sy = Math.floor(fi / COLS) * FH;
        g.drawImage(img, sx, sy, FW, FH, col * FW, row * FH, FW, FH);
      });
    });
    return c.toDataURL("image/png");
  })()`);
  const out = path.join(CACHE, "verify.png");
  fs.writeFileSync(out, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  return out;
}

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(SOURCE)) throw new Error(`缺少源视频：${SOURCE}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.mkdirSync(OUT, { recursive: true });

    const win = new BrowserWindow({
      show: false,
      width: 700,
      height: 600,
      webPreferences: { webSecurity: false, backgroundThrottling: false },
    });

    log("extracting", path.relative(ROOT, SOURCE));
    const { frames, W, H } = await extractFrames(win, SOURCE);
    log(`extracted ${frames.length} frames @ ${W}×${H}, ${FPS}fps`);

    log("keying…");
    const keyed = keyAll(frames, W, H);

    const { atlas, cols, rows, AW, AH } = buildAtlas(keyed, W, H);

    const pngPath = path.join(CACHE, "atlas.png");
    fs.writeFileSync(pngPath, encodePng(AW, AH, atlas));
    log(`atlas png ${AW}×${AH}`, fs.statSync(pngPath).size, "bytes");

    const webp = await encodeWebp(win, pngPath, WEBP_QUALITY);
    const webpPath = path.join(OUT, "atlas.webp");
    fs.writeFileSync(webpPath, webp);
    log("atlas webp", webp.length, "bytes");

    writeMeta({ frameW: W, frameH: H, cols, rows, count: keyed.length, fps: FPS, fadeMs: FADE_MS });
    log("meta written");

    if (VERIFY) {
      log("verify sheet", await writeVerifySheet(win, { frameW: W, frameH: H, cols, count: keyed.length }, pngPath));
    }

    win.destroy();
    app.quit();
  } catch (error) {
    console.error("[pet-intro] failed:", error);
    app.exit(1);
  }
});
setTimeout(() => {
  console.error("[pet-intro] timeout");
  app.exit(2);
}, 600_000);

#!/usr/bin/env node
/**
 * 桌宠猫娘位图管线：参考图母版（纯绿底）→ 透明整身 WebP + 锚点 meta。
 *
 * 用法（必须用 Electron 跑：PNG 解码与 WebP 编码都靠 Chromium）：
 *   npx electron scripts/assets/build-girl-sprite.cjs            # 重新生成资产
 *   npx electron scripts/assets/build-girl-sprite.cjs --verify   # 额外出三底色验收图
 *
 * 产物（提交进 git）：
 *   src/renderer/public/pet/girl.webp        桌宠立绘（整身），高 512、透明底
 *   src/renderer/pet/girl-sprite-meta.ts     墨框比例 / 脚心横向锚点（脚本生成，勿手改）
 *
 * 中间产物（.cache/girl-sprite/，不进 git）：抠好的全尺寸 PNG、验收图。
 *
 * 抠像口径：
 *  母版是「角色 + 纯绿背景」，没有接触影、没有辉光；绿在角色身上一个像素都没有
 *  （头发黑、皮肤粉白、眼球紫粉、鞋粉），所以判据就是**绿通道超出 max(r,b) 多少**。
 *  边缘抗锯齿像素是「角色色 ↔ 绿」的混合，按超出量给软 alpha；再用
 *  g = min(g, max(r,b)+8) 反解掉绿边（despill）。不用投影式：那需要内侧色场，
 *  而这批图边缘很硬、色差极大，投影式反而会在白肚皮边缘放大噪声。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = path.join(__dirname, "source", "girl-master.png");
const CACHE = path.join(ROOT, ".cache", "girl-sprite");
const PET_OUT = path.join(ROOT, "src", "renderer", "public", "pet", "girl.webp");
const META_OUT = path.join(ROOT, "src", "renderer", "pet", "girl-sprite-meta.ts");
const SPRITE_H = 512;
const VERIFY = process.argv.includes("--verify");
const log = (...args) => console.log("[girl-sprite]", ...args);

const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function writeHtml(name, body) {
  const file = path.join(CACHE, name);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>${body}`);
  return file;
}

async function decodePng(win, file) {
  await win.loadFile(writeHtml("decode.html", `<canvas id="c"></canvas>`));
  const info = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(pathToFileURL(file).href)};
    await img.decode();
    const c = document.getElementById("c");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = "";
    const CH = 0x8000;
    for (let k = 0; k < d.length; k += CH) s += String.fromCharCode.apply(null, d.subarray(k, k + CH));
    return { w: c.width, h: c.height, data: btoa(s) };
  })()`);
  return { W: info.w, H: info.h, rgba: Buffer.from(info.data, "base64") };
}

function keyMaster(rgba, W, H) {
  const N = W * H;
  const out = Buffer.alloc(N * 4);
  for (let p = 0; p < N; p++) {
    const o = p * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    const key = g - Math.max(r, b);
    const a = 1 - smoothstep(10, 80, key);
    if (a <= 0.004) continue;
    let G = g;
    if (a < 1) {
      const cap = Math.max(r, b) + 8;
      if (g > cap) G = cap;
    }
    out[o] = r;
    out[o + 1] = G;
    out[o + 2] = b;
    out[o + 3] = Math.round(a * 255);
  }
  return out;
}

/** 墨框（alpha>16）与脚心：脚底 6% 行里不透明像素的横向中点。 */
function measure(rgba, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (rgba[(y * W + x) * 4 + 3] > 16) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) throw new Error("抠像后没有任何不透明像素");
  const rows = Math.max(2, Math.round((y1 - y0 + 1) * 0.06));
  let fx0 = W, fx1 = -1;
  for (let y = y1 - rows + 1; y <= y1; y++) for (let x = 0; x < W; x++) {
    if (rgba[(y * W + x) * 4 + 3] > 128) {
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
    }
  }
  if (fx1 < fx0) { fx0 = x0; fx1 = x1; }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, feetX: (fx0 + fx1 + 1) / 2 };
}

// —— PNG 编码（只用 node:zlib；给 Chromium 读回后转 WebP/PNG）——
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 在 Chromium 里裁切 + 缩放 + 编码（drawImage 的高质量降采样比 Node 手写可靠）。 */
async function renderTargets(win, keyedPath, box, verify) {
  await win.loadFile(writeHtml("render.html", `<canvas id="c"></canvas>`));
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(path.basename(keyedPath))};
    await img.decode();
    const BOX = ${JSON.stringify(box)};
    const draw = (crop, w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.clearRect(0, 0, w, h);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
      return c;
    };
    const out = {};
    const sprite = draw(BOX, ${SPRITE_H} * BOX.w / BOX.h, ${SPRITE_H});
    out.sprite = sprite.toDataURL("image/webp", 0.92);
    if (${verify ? "true" : "false"}) {
      const PICK = [48, 96, 192];
      const HS = [48, 56, 64, 96];
      const ROW = 132;
      const c = document.createElement("canvas");
      c.width = HS.reduce((n, h) => n + Math.round(h * BOX.w / BOX.h) + 12, 0) + 6;
      c.height = ROW * 3;
      const g = c.getContext("2d");
      PICK.forEach((bg, row) => {
        g.fillStyle = "rgb(" + bg + "," + bg + "," + bg + ")";
        g.fillRect(0, row * ROW, c.width, ROW);
        let x = 6;
        for (const h of HS) {
          const w = h * BOX.w / BOX.h;
          g.drawImage(sprite, x, row * ROW + (ROW - h) / 2, w, h);
          x += w + 12;
        }
      });
      out.verify = c.toDataURL("image/png");
    }
    return out;
  })()`);
}

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(SOURCE)) throw new Error(`缺少参考图母版：${SOURCE}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.mkdirSync(path.dirname(PET_OUT), { recursive: true });

    const win = new BrowserWindow({
      show: false,
      width: 700,
      height: 600,
      webPreferences: { webSecurity: false, backgroundThrottling: false },
    });

    log("decoding", path.relative(ROOT, SOURCE));
    const { W, H, rgba } = await decodePng(win, SOURCE);
    log(`decoded ${W}×${H}`);

    log("keying…");
    const keyed = keyMaster(rgba, W, H);
    const box = measure(keyed, W, H);
    log("ink box", box, "feetX", box.feetX);
    if (box.w < W * 0.3 || box.h < H * 0.5) throw new Error(`墨框异常小：${JSON.stringify(box)}——抠像把角色吃掉了`);

    const keyedPath = path.join(CACHE, "keyed.png");
    fs.writeFileSync(keyedPath, encodePng(W, H, keyed));

    const crop = { x: box.x0, y: box.y0, w: box.w, h: box.h };
    const result = await renderTargets(win, keyedPath, crop, VERIFY);
    fs.writeFileSync(PET_OUT, Buffer.from(result.sprite.replace(/^data:image\/webp;base64,/, ""), "base64"));
    if (result.verify) fs.writeFileSync(path.join(CACHE, "verify.png"), Buffer.from(result.verify.replace(/^data:image\/png;base64,/, ""), "base64"));
    log("pet sprite", fs.statSync(PET_OUT).size, "bytes");

    const aspect = box.w / box.h;
    const anchorX = (box.feetX - box.x0) / box.w;
    fs.writeFileSync(
      META_OUT,
      "// 由 scripts/assets/build-girl-sprite.cjs 生成；改母版请重跑，不要手改本文件。\n" +
        `export const GIRL_SPRITE = {\n` +
        `  src: "./pet/girl.webp",\n` +
        `  /** 墨宽 / 墨高（立绘的原始比例）。 */\n` +
        `  aspect: ${aspect.toFixed(4)},\n` +
        `  /** 脚心在墨框里的横向位置（0..1）；画的时候脚心对准 viewBox x=60。 */\n` +
        `  anchorX: ${anchorX.toFixed(4)},\n` +
        `} as const;\n`,
    );
    log("meta written");

    win.destroy();
    app.quit();
  } catch (error) {
    console.error("[girl-sprite] failed:", error?.message ?? error, error?.stack ?? "");
    app.exit(1);
  }
});
setTimeout(() => {
  console.error("[girl-sprite] timeout");
  app.exit(2);
}, 300_000);

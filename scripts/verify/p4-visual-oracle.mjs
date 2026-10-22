// P4 Task 31 第二层的像素尺：量 p4-cdp-capture.mjs 拍回来的四张区域图。
// 用法：node scripts/verify/p4-visual-oracle.mjs <shotsDir>
// - 解码：CDP 截图是第三方 PNG（实测 8bit RGB + 自适应行过滤），产品那把 `decodePng`
//   的契约只是「读回自己写出去的 RGBA/无过滤」，解不动它；所以这里自带一把标准 PNG 尺。
//   为防跑偏，`selfTest()` 先用产品 `encodePng` 的产物对解一遍，再按规范把五种行过滤逐一试一遍。
// - 判据来自计划 Task 31 Step 2 的表；任何一条红先怀疑生成参数，不改阈值。
//   真因为「量法本身错了」改阈值时，把旧值与被推翻的理由一起写进 report.json 的 deviations。
// - 不进 vitest：scripts/ 在所有 tsconfig 与测试 include 之外（R-D6）。
import fs from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "mochi-palette");

/** 一条像素离面板底色多远才算「有墨」：取三通道差的最大值。
 *  实测定标：奶油猫身 vs 奶油面板 max 通道差 5（对尺隐形，所以头像不能只靠猫身计数）、
 *  头像 1px 粉描边 vs 面板 21、墨色猫 vs 面板 206。20 这条线把「同色系的底」和「真画上去的墨」分开。 */
const INK_DELTA = 20;
/** 第二档（只作诊断，不进判据）：离底色 4~20 通道差的像素数。
 *  奶油猫毛 #f7f4ec 压在奶油面板 #f9f7f1 上最大通道差只有 5，对 INK_DELTA 是隐形的；
 *  报这一档是为了让「墨像素数」为小的那种情况能被看出是底色同色系，不是没画。 */
const PAINT_DELTA = 4;
/** 面板底色取样环：离元素框 8–14 CSS px，避开 1px 描边与 drop-shadow 的近身区。 */
const BG_RING_NEAR = 8;
const BG_RING_FAR = 14;
/** 负对照：同一张图里离元素框更远、必定是纯背景的角落块，覆盖率必须接近 0。 */
const CONTROL_MAX_COVERAGE = 0.05;

const THRESHOLDS = {
  welcome_poster_ratio: [0.55, 0.58],
  welcome_top_left: "海报左上角 8×8 不许全是 (255,255,255)",
  // 原值 6 被实测推翻：头像 CSS 挂着 `filter: drop-shadow(0 2px 8px …pink 22%)`，
  // 向下偏移 2px，所以框的下角必定离底色约 7–9（上角 1–2），那不是「方底露出来」。
  // 方底要露也是描边那个量级（粉描边 vs 面板实测 21），所以判到 15，另加一条上角判据兜住形状。
  avatar_corner_delta_max: 15,
  avatar_top_corner_delta_max: 6,
  avatar_ink_centroid_offset_max_px: 3,
  avatar_ink_mean_brightness_min: 60,
  sticker_ink_bbox_width_px: [120, 200],
  sticker_coverage: [0.25, 0.85],
};

async function loadCodec() {
  await fs.promises.mkdir(CACHE, { recursive: true });
  const outfile = path.join(CACHE, "p4-png-codec.mjs");
  await build({
    entryPoints: [path.join(ROOT, "src", "shared", "png-encode.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** PNG 规范的 Paeth 预测子（与下面 `unfilterRow` 各写一份是刻意的：自测要能独立证伪）。 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterRow(type, cur, src, prev, bpp) {
  for (let i = 0; i < cur.length; i += 1) {
    const a = i >= bpp ? cur[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    const x = src[i];
    let v;
    if (type === 0) v = x;
    else if (type === 1) v = x + a;
    else if (type === 2) v = x + b;
    else if (type === 3) v = x + ((a + b) >> 1);
    else if (type === 4) v = x + paethPredictor(a, b, c);
    else throw new RangeError(`不认识的行过滤类型 ${type}`);
    cur[i] = v & 0xff;
  }
}

/**
 * 标准 PNG → RGBA。覆盖 8bit 的灰度/RGB/调色板/灰+alpha/RGBA 与全部五种行过滤（隔行图除外）。
 * 只服务这张尺：宁可抛错，也不把解不动的图当成「一片白」去量。
 */
function decodePngRgba(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new RangeError("PNG 签名不对");
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let interlace = 0;
  let plte = null;
  let trns = null;
  const idat = [];
  let sawEnd = false;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString("ascii");
    const body = buf.subarray(p + 8, p + 8 + len);
    if (crc32(Buffer.concat([buf.subarray(p + 4, p + 8), body])) !== buf.readUInt32BE(p + 8 + len)) {
      throw new RangeError(`chunk ${type} 的 CRC 不匹配`);
    }
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      interlace = body[12];
    } else if (type === "PLTE") plte = Buffer.from(body);
    else if (type === "tRNS") trns = Buffer.from(body);
    else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    p += 12 + len;
  }
  if (!sawEnd) throw new RangeError("缺 IEND");
  if (!width || !height) throw new RangeError("缺 IHDR");
  if (depth !== 8) throw new RangeError(`只支持 8bit，收到 bit depth ${depth}`);
  if (interlace !== 0) throw new RangeError("不支持隔行图（Adam7）");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new RangeError(`不认识的颜色类型 ${color}`);
  if (color === 3 && !plte) throw new RangeError("调色板图缺 PLTE");
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) {
    throw new RangeError(`IDAT 解压后长度不对：${raw.length} vs ${height * (stride + 1)}`);
  }
  const scan = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const base = y * (stride + 1);
    unfilterRow(
      raw[base],
      scan.subarray(y * stride, (y + 1) * stride),
      raw.subarray(base + 1, base + 1 + stride),
      y ? scan.subarray((y - 1) * stride, y * stride) : null,
      channels,
    );
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    let a = 255;
    if (color === 6) {
      r = scan[i * 4];
      g = scan[i * 4 + 1];
      b = scan[i * 4 + 2];
      a = scan[i * 4 + 3];
    } else if (color === 2) {
      r = scan[i * 3];
      g = scan[i * 3 + 1];
      b = scan[i * 3 + 2];
      if (trns && trns.length >= 6 && scan[i * 3] === (trns.readUInt16BE(0) & 0xff) && scan[i * 3 + 1] === (trns.readUInt16BE(2) & 0xff) && scan[i * 3 + 2] === (trns.readUInt16BE(4) & 0xff)) a = 0;
    } else if (color === 4) {
      r = g = b = scan[i * 2];
      a = scan[i * 2 + 1];
    } else if (color === 0) {
      r = g = b = scan[i];
      if (trns && trns.length >= 2 && scan[i] === (trns.readUInt16BE(0) & 0xff)) a = 0;
    } else {
      const idx = scan[i];
      r = plte[idx * 3];
      g = plte[idx * 3 + 1];
      b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return { width, height, rgba };
}

/** 按规范正向加行过滤，造一张 8bit RGB 图（自测用；与 `unfilterRow` 是两份独立实现）。 */
function handFilteredRgbPng(expected, width, height, filterType) {
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filterType;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? expected[y * stride + x - bpp] : 0;
      const b = y > 0 ? expected[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? expected[(y - 1) * stride + x - bpp] : 0;
      const v = expected[y * stride + x];
      let f;
      if (filterType === 0) f = v;
      else if (filterType === 1) f = v - a;
      else if (filterType === 2) f = v - b;
      else if (filterType === 3) f = v - ((a + b) >> 1);
      else f = v - paethPredictor(a, b, c);
      raw[y * (stride + 1) + 1 + x] = f & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

/**
 * 尺子自检：先用产品 `encodePng` 的 RGBA 产物对解（证明这把尺与产品写的那份格式互通），
 * 再逐一把五种行过滤的图解回原图（截图用的就是过滤行）。任一条不对就抛——
 * 解码器错了，下面所有像素判据都不作数。
 */
function selfTest(codec) {
  const w = 5;
  const h = 3;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    rgba[i * 4] = (i * 37) & 0xff;
    rgba[i * 4 + 1] = (255 - i * 19) & 0xff;
    rgba[i * 4 + 2] = (i * 91) & 0x7f;
    rgba[i * 4 + 3] = i % 2 ? 255 : 128;
  }
  const back = decodePngRgba(codec.encodePng(w, h, rgba));
  if (back.width !== w || back.height !== h) throw new RangeError(`自测：产品 RGBA 解出尺寸 ${back.width}x${back.height}，应为 ${w}x${h}`);
  for (let i = 0; i < rgba.length; i += 1) {
    if (back.rgba[i] !== rgba[i]) throw new RangeError(`自测：产品 encodePng 的产物解不回原像素（第 ${i} 字节 ${back.rgba[i]} ≠ ${rgba[i]}）`);
  }
  const rw = 4;
  const rh = 3;
  const rgb = Buffer.alloc(rw * rh * 3);
  for (let i = 0; i < rw * rh; i += 1) {
    rgb[i * 3] = (i * 53) & 0xff;
    rgb[i * 3 + 1] = (i * 7) & 0xff;
    rgb[i * 3 + 2] = 255 - ((i * 29) & 0xff);
  }
  for (const filterType of [0, 1, 2, 3, 4]) {
    const out = decodePngRgba(handFilteredRgbPng(rgb, rw, rh, filterType));
    if (out.width !== rw || out.height !== rh) throw new RangeError(`自测：过滤 ${filterType} 解出尺寸 ${out.width}x${out.height}`);
    for (let y = 0; y < rh; y += 1) {
      for (let x = 0; x < rw; x += 1) {
        const s = (y * rw + x) * 3;
        const d = (y * rw + x) * 4;
        if (out.rgba[d] !== rgb[s] || out.rgba[d + 1] !== rgb[s + 1] || out.rgba[d + 2] !== rgb[s + 2] || out.rgba[d + 3] !== 255) {
          throw new RangeError(`自测：过滤 ${filterType} 在 (${x},${y}) 解错——这把你尺子读不了截图`);
        }
      }
    }
  }
  return `产品 RGBA 对解 + 五种行过滤逐一试，全过`;
}

function readImage(file) {
  const img = decodePngRgba(fs.readFileSync(file));
  return { ...img, file };
}

/** 通道中位数：底色取样里要能扛住阴影与邻着色的文字。 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function channelDelta(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function luma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function pixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
}

/**
 * 把 meta 里的 CSS 框换算成这张 PNG 的像素框，并回报标定比。
 * clip 截图输出的是设备像素，所以尺一律换算回 CSS px 报数，判据才是计划里那个「像素」。
 */
function box(img, rect, clip) {
  const ppc = img.width / clip.width;
  const x0 = Math.round((rect.x - clip.x) * ppc);
  const y0 = Math.round((rect.y - clip.y) * ppc);
  const w = Math.round(rect.width * ppc);
  const h = Math.round(rect.height * ppc);
  return { ppc, x0, y0, w, h, css: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}

/** 环带：元素框外圈 8–14 CSS px 的一圈像素。返回像素列表（含越界裁剪）。 */
function ringPixels(img, b, nearCss, farCss) {
  const near = Math.round(nearCss * b.ppc);
  const far = Math.round(farCss * b.ppc);
  const out = [];
  const x1 = b.x0 - far;
  const y1 = b.y0 - far;
  const x2 = b.x0 + b.w + far - 1;
  const y2 = b.y0 + b.h + far - 1;
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const dx = x < b.x0 ? b.x0 - x : x > b.x0 + b.w - 1 ? x - (b.x0 + b.w - 1) : 0;
      const dy = y < b.y0 ? b.y0 - y : y > b.y0 + b.h - 1 ? y - (b.y0 + b.h - 1) : 0;
      const d = Math.max(dx, dy);
      if (d >= near && d <= far) out.push(pixel(img, x, y));
    }
  }
  return out;
}

function medianColor(pixels) {
  if (!pixels.length) return null;
  return [median(pixels.map((p) => p[0])), median(pixels.map((p) => p[1])), median(pixels.map((p) => p[2]))];
}

/**
 * 框内「有墨」像素的外接框、覆盖率与墨均亮度；另记一档「离开底色」的像素数当正对照。
 * 质心算两坨：`inkCentroid`（>INK_DELTA，浅色档里只剩深色五官与描边）与 `silhouetteCentroid`
 * （>PAINT_DELTA，把奶油猫毛也算进来）。判「猫在不在正中」只能用后者——毛对墨尺隐形时，
 * 拿五官质心判居中等于拿眉毛的位置当脸的位置。
 */
function inkStats(img, b, bg) {
  const xs = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  let paint = 0;
  let lumaSum = 0;
  let silCount = 0;
  let silSx = 0;
  let silSy = 0;
  const x2 = Math.min(img.width - 1, b.x0 + b.w - 1);
  const y2 = Math.min(img.height - 1, b.y0 + b.h - 1);
  for (let y = Math.max(0, b.y0); y <= y2; y += 1) {
    for (let x = Math.max(0, b.x0); x <= x2; x += 1) {
      const delta = channelDelta(pixel(img, x, y), bg);
      if (delta > PAINT_DELTA) {
        silCount += 1;
        silSx += x;
        silSy += y;
      }
      if (delta > INK_DELTA) {
        count += 1;
        lumaSum += luma(pixel(img, x, y));
        xs.push([x, y]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (delta > PAINT_DELTA) {
        paint += 1;
      }
    }
  }
  const silhouetteCentroid = silCount ? { x: silSx / silCount, y: silSy / silCount } : null;
  if (!count) {
    return { count: 0, paint, silhouetteCount: silCount, silhouetteCentroid, bboxWidthCss: 0, bboxHeightCss: 0, coverage: 0, inkMeanLuma: null, inkCentroid: null, bbox: null };
  }
  const area = (maxX - minX + 1) * (maxY - minY + 1);
  let sx = 0;
  let sy = 0;
  for (const [x, y] of xs) {
    sx += x;
    sy += y;
  }
  return {
    count,
    paint,
    silhouetteCount: silCount,
    silhouetteCentroid,
    bboxWidthCss: (maxX - minX + 1) / b.ppc,
    bboxHeightCss: (maxY - minY + 1) / b.ppc,
    coverage: count / area,
    inkMeanLuma: lumaSum / count,
    inkCentroid: { x: sx / count, y: sy / count },
    bbox: { minX, minY, maxX, maxY },
  };
}

/** 四角：取元素框四个角各 2×2 设备像素的平均色，与面板底色比。 */
function cornerSamples(img, b, bg) {
  const size = Math.max(2, Math.round(2 * b.ppc));
  const corners = {
    tl: [b.x0, b.y0],
    tr: [b.x0 + b.w - size, b.y0],
    bl: [b.x0, b.y0 + b.h - size],
    br: [b.x0 + b.w - size, b.y0 + b.h - size],
  };
  const out = {};
  let maxDelta = 0;
  for (const [name, [cx, cy]] of Object.entries(corners)) {
    const px = [];
    for (let y = cy; y < cy + size; y += 1) {
      for (let x = cx; x < cx + size; x += 1) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        px.push(pixel(img, x, y));
      }
    }
    const color = medianColor(px);
    const delta = channelDelta(color, bg);
    out[name] = { rgb: color, delta };
    if (delta > maxDelta) maxDelta = delta;
  }
  return { corners: out, maxDelta };
}

/** 负对照：clip 左上角那块必定是元素外的背景，覆盖率要接近 0。 */
function controlCoverage(img, b, clip, rect) {
  const marginCss = Math.min(rect.x - clip.x, rect.y - clip.y);
  if (marginCss < 4) return { skipped: `clip 里元素框左边距只有 ${marginCss.toFixed(1)} CSS px，放不下对照块` };
  const size = Math.max(4, Math.round(Math.min(10, marginCss - 2) * b.ppc));
  const cb = { ppc: b.ppc, x0: 0, y0: 0, w: size, h: size };
  const pixels = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) pixels.push(pixel(img, x, y));
  }
  const bg = medianColor(ringPixels(img, b, BG_RING_NEAR, BG_RING_FAR));
  const stat = inkStats(img, cb, bg);
  return { blockCss: size / b.ppc, coverage: stat.coverage, inkCount: stat.count };
}

function inRange(value, [lo, hi]) {
  return value >= lo && value <= hi;
}

/* ---------------------------------------------------------------------------
 * 尺子有没有牙：判据放宽之后（见 report.deviations），必须还能红得起来。
 * 这里不碰产品，只在内存里造合成图：一张干净的应当全绿（正对照，证明不是永远红），
 * 每张坏图必须让**指定的那一条**变红（负对照，证明那条判据真的在看它该看的东西）。
 * ------------------------------------------------------------------------- */
const LIGHT = { bg: [249, 247, 241], coat: [247, 244, 236], feature: [61, 52, 58] };
const DARK = { bg: [23, 27, 38], coat: [247, 244, 236], feature: [247, 244, 236] };
/** 深底上「进了墨但本身很暗」的颜色：离底 37 通道差（过墨尺），亮度 45（不过亮度尺）。 */
const DIM_INK = [60, 40, 45];

function synthImage(width, height, bg) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function paintRect(img, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      img.rgba[i] = color[0];
      img.rgba[i + 1] = color[1];
      img.rgba[i + 2] = color[2];
    }
  }
}

function paintDisc(img, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const i = (y * img.width + x) * 4;
      img.rgba[i] = color[0];
      img.rgba[i + 1] = color[1];
      img.rgba[i + 2] = color[2];
    }
  }
}

/**
 * 合成头像：圆遮罩里一团毛 + 两点五官。毛球半径 14 刻意小于 38 的框，免得变异体被框边裁掉。
 * 浅色档的毛对墨尺隐形（只有五官算墨），深色档整团毛都是墨——两档都要各自的正对照，
 * 因为「墨均亮度」这条只在深底那档进判据。
 * `dim` 用的是「离底色够远、但自己很暗」的那团（delta 37 / luma 45）：
 * 只把毛压暗到对墨尺隐形不算糊，糊 = 进了墨的像素本身暗到看不见。
 */
function synthAvatar(theme, { squareBase = false, shiftX = 0, blank = false, dim = false } = {}) {
  const img = synthImage(60, 60, theme.bg);
  if (blank) return img;
  const cx = 30 + shiftX;
  const cy = 30;
  const coat = dim ? DIM_INK : theme.coat;
  const feature = dim ? DIM_INK : theme.feature;
  if (squareBase) paintRect(img, 11, 11, 38, 38, [255, 255, 255]);
  paintDisc(img, cx, cy, 14, coat);
  paintRect(img, cx - 8, cy - 6, 3, 3, feature);
  paintRect(img, cx + 5, cy - 6, 3, 3, feature);
  return img;
}

function teethCases() {
  const avatarEntry = { rect: { x: 11, y: 11, width: 38, height: 38 }, clip: { x: 0, y: 0, width: 60, height: 60 } };
  const avatarCase = (label, theme, opts, { brightness = false, mustFail = [] } = {}) => ({
    label,
    img: synthAvatar(theme, opts),
    entry: avatarEntry,
    extra: (img, b, bg) => avatarChecks(img, b, bg, { requireBrightness: brightness }),
    mustFail,
  });
  const stickerEntry = { rect: { x: 20, y: 20, width: 180, height: 180 }, clip: { x: 0, y: 0, width: 220, height: 220 } };
  const stickerCase = (label, img, mustFail) => ({
    label,
    img,
    entry: stickerEntry,
    extra: (i, b, bg, clip, rect) => stickerChecks(i, b, bg, clip, rect),
    mustFail,
  });
  const ringSticker = () => {
    const img = synthImage(220, 220, LIGHT.bg);
    paintRect(img, 39, 39, 142, 142, [70, 60, 66]);
    paintRect(img, 61, 61, 98, 98, LIGHT.bg);
    return img;
  };
  const solidSticker = () => {
    const img = synthImage(220, 220, LIGHT.bg);
    paintRect(img, 39, 39, 142, 142, [70, 60, 66]);
    return img;
  };
  const welcomeCase = (label, h, mustFail) => {
    const img = synthImage(120, 100, LIGHT.bg);
    paintDisc(img, 60, 50, 30, LIGHT.coat);
    paintRect(img, 20, 27, 80, 45, LIGHT.feature);
    return {
      label,
      img,
      entry: { rect: { x: 20, y: 27, width: 80, height: h }, clip: { x: 0, y: 0, width: 120, height: 100 } },
      extra: (i, b, bg) => welcomeChecks(i, b, bg),
      mustFail,
    };
  };
  return [
    avatarCase("干净浅色头像（正对照）", LIGHT, {}, { mustFail: [] }),
    avatarCase("干净深色头像（正对照）", DARK, {}, { brightness: true, mustFail: [] }),
    avatarCase("方底露出来", LIGHT, { squareBase: true }, { mustFail: ["上两角与面板底色差"] }),
    avatarCase("猫画歪 6px", LIGHT, { shiftX: 6 }, { mustFail: ["猫影质心离块心"] }),
    avatarCase("头像空白", DARK, { blank: true }, { brightness: true, mustFail: ["墨像素数"] }),
    avatarCase("深底糊成一块", DARK, { dim: true }, { brightness: true, mustFail: ["墨均亮度"] }),
    stickerCase("干净贴纸（正对照）", ringSticker(), []),
    stickerCase("贴纸被裁空", synthImage(220, 220, LIGHT.bg), ["贴纸外接框宽", "外接框覆盖率"]),
    stickerCase("贴纸糊成实心块", solidSticker(), ["外接框覆盖率"]),
    welcomeCase("海报干净（正对照）", 45, []),
    welcomeCase("海报比例走样", 60, ["海报高宽比"]),
  ];
}

function teethTest() {
  const results = [];
  for (const c of teethCases()) {
    const judged = judgeShot(c.label, c.img, c.entry, c.extra);
    const failed = Object.entries(judged.checks ?? {})
      .filter(([, v]) => !v.pass)
      .map(([k]) => k);
    const missing = c.mustFail.filter((k) => !failed.includes(k));
    results.push({
      label: c.label,
      verdict: judged.pass ? "green" : "red",
      expected: c.mustFail.length ? `应红于 ${c.mustFail.join("、")}` : "应全绿",
      failed,
      pass: c.mustFail.length ? judged.pass === false && missing.length === 0 : judged.pass === true,
    });
  }
  const bad = results.filter((r) => !r.pass);
  if (bad.length) {
    throw new RangeError(
      `尺子没牙：${bad.map((r) => `${r.label}（${r.expected}，实际 ${r.verdict}${r.failed.length ? ` 红于 ${r.failed.join("、")}` : ""}）`).join("；")}`,
    );
  }
  return results;
}

function judgeShot(name, img, entry, extra) {
  const { rect, clip } = entry;
  const b = box(img, rect, clip);
  const ring = ringPixels(img, b, BG_RING_NEAR, BG_RING_FAR);
  const bg = medianColor(ring);
  const base = {
    file: name,
    png: { width: img.width, height: img.height },
    css_box: { width: round3(b.css.width), height: round3(b.css.height) },
    px_per_css_px: round3(b.ppc),
    panel_bg: bg,
    panel_bg_sample_px: ring.length,
  };
  if (!bg) return { ...base, pass: false, checks: { 面板底色取样: { value: null, limit: "环带要有像素", pass: false } } };
  return { ...base, ...extra(img, b, bg, clip, rect) };
}

function round3(v) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v;
}

function avatarChecks(img, b, bg, { requireBrightness = false } = {}) {
  const corners = cornerSamples(img, b, bg);
  const stat = inkStats(img, b, bg);
  const centerX = b.x0 + (b.w - 1) / 2;
  const centerY = b.y0 + (b.h - 1) / 2;
  const offsetOf = (c) => (c ? Math.hypot(c.x - centerX, c.y - centerY) / b.ppc : null);
  const silhouetteOffsetCss = offsetOf(stat.silhouetteCentroid);
  const inkOffsetCss = offsetOf(stat.inkCentroid);
  const topDelta = Math.max(corners.corners.tl.delta, corners.corners.tr.delta);
  const checks = {
    四角与面板底色差: { value: corners.maxDelta, limit: `< ${THRESHOLDS.avatar_corner_delta_max}（方底不许露出来；投影另算）`, pass: corners.maxDelta < THRESHOLDS.avatar_corner_delta_max },
    上两角与面板底色差: { value: topDelta, limit: `< ${THRESHOLDS.avatar_top_corner_delta_max}（drop-shadow 向下偏移，上角才是遮罩的素颜）`, pass: topDelta < THRESHOLDS.avatar_top_corner_delta_max },
    猫影质心离块心: { value: round3(silhouetteOffsetCss ?? Number.NaN), limit: `< ${THRESHOLDS.avatar_ink_centroid_offset_max_px} CSS px（按 silhouette 口径，含奶油毛）`, pass: silhouetteOffsetCss !== null && silhouetteOffsetCss < THRESHOLDS.avatar_ink_centroid_offset_max_px },
    墨像素数: { value: stat.count, limit: "> 0（正对照：遮罩内确实画了东西）", pass: stat.count > 0 },
  };
  if (requireBrightness) {
    checks.墨均亮度 = {
      value: round3(stat.inkMeanLuma ?? Number.NaN),
      limit: `> ${THRESHOLDS.avatar_ink_mean_brightness_min}（深底上不许糊成一块）`,
      pass: stat.inkMeanLuma !== null && stat.inkMeanLuma > THRESHOLDS.avatar_ink_mean_brightness_min,
    };
  }
  return {
    checks,
    corners: corners.corners,
    ink: {
      count: stat.count,
      near_bg_pixels: stat.paint,
      silhouette_count: stat.silhouetteCount,
      mean_luma: round3(stat.inkMeanLuma ?? Number.NaN),
      bbox_width_css: round3(stat.bboxWidthCss),
      coverage: round3(stat.coverage),
      ink_centroid_offset_css: round3(inkOffsetCss ?? Number.NaN),
      silhouette_centroid_offset_css: round3(silhouetteOffsetCss ?? Number.NaN),
    },
    pass: Object.values(checks).every((c) => c.pass),
  };
}

function welcomeChecks(img, b, bg) {
  const ratio = b.css.height / b.css.width;
  const block = Math.max(1, Math.round(8 * b.ppc));
  const px = [];
  for (let y = b.y0; y < b.y0 + block; y += 1) {
    for (let x = b.x0; x < b.x0 + block; x += 1) {
      if (x >= img.width || y >= img.height || x < 0 || y < 0) continue;
      px.push(pixel(img, x, y));
    }
  }
  const topLeft = medianColor(px);
  const meanTopLeft = [
    Math.round(px.reduce((s, p) => s + p[0], 0) / px.length),
    Math.round(px.reduce((s, p) => s + p[1], 0) / px.length),
    Math.round(px.reduce((s, p) => s + p[2], 0) / px.length),
  ];
  const pureWhite = px.every((p) => p[0] === 255 && p[1] === 255 && p[2] === 255);
  const stat = inkStats(img, b, bg);
  const checks = {
    海报高宽比: { value: round3(ratio), limit: `${THRESHOLDS.welcome_poster_ratio.join(", ")}`, pass: inRange(ratio, THRESHOLDS.welcome_poster_ratio) },
    左上8x8不是纯白: { value: meanTopLeft, limit: "不许 8×8 全是 (255,255,255)", pass: !pureWhite },
    海报有墨: { value: stat.count, limit: "> 0（猫没被裁成白底）", pass: stat.count > 0 },
  };
  return {
    checks,
    ink: { count: stat.count, coverage: round3(stat.coverage), bbox_width_css: round3(stat.bboxWidthCss), bbox_height_css: round3(stat.bboxHeightCss) },
    top_left_sample: { block_css: round3(block / b.ppc), median: topLeft, mean: meanTopLeft, all_pure_white: pureWhite },
    pass: Object.values(checks).every((c) => c.pass),
  };
}

function stickerChecks(img, b, bg, clip, rect) {
  const stat = inkStats(img, b, bg);
  const control = controlCoverage(img, b, clip, rect);
  const checks = {
    贴纸外接框宽: { value: round3(stat.bboxWidthCss), limit: `${THRESHOLDS.sticker_ink_bbox_width_px.join(", ")} CSS px`, pass: inRange(stat.bboxWidthCss, THRESHOLDS.sticker_ink_bbox_width_px) },
    外接框覆盖率: { value: round3(stat.coverage), limit: `${THRESHOLDS.sticker_coverage.join(", ")}`, pass: inRange(stat.coverage, THRESHOLDS.sticker_coverage) },
  };
  if (control.coverage !== undefined) {
    checks.负对照 = { value: control.coverage, limit: `< ${CONTROL_MAX_COVERAGE}（同图纯背景块不许有墨）`, pass: control.coverage < CONTROL_MAX_COVERAGE };
  } else {
    checks.负对照 = { value: null, limit: "对照块放不下", pass: false, note: control.skipped };
  }
  return {
    checks,
    control,
    ink: { count: stat.count, mean_luma: round3(stat.inkMeanLuma ?? Number.NaN), bbox: stat.bbox },
    pass: Object.values(checks).every((c) => c.pass),
  };
}

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/p4-visual-oracle.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  const meta = JSON.parse(fs.readFileSync(path.join(shots, "meta.json"), "utf8"));
  const codec = await loadCodec();
  const selfTestNote = selfTest(codec);
  const teeth = teethTest();
  console.log(`[p4-visual-oracle] 尺子自检：${selfTestNote}`);
  console.log(`[p4-visual-oracle] 变异自检：${teeth.length} 张合成图，该红的都红了、该绿的绿了`);

  const plan = [
    ["welcome.png", (img, b, bg) => welcomeChecks(img, b, bg)],
    ["avatar-paper.png", (img, b, bg) => avatarChecks(img, b, bg)],
    ["avatar-ink.png", (img, b, bg) => avatarChecks(img, b, bg, { requireBrightness: true })],
    ["sticker.png", (img, b, bg, clip, rect) => stickerChecks(img, b, bg, clip, rect)],
  ];

  const report = {
    generated_at: new Date().toISOString(),
    method: {
      ink_delta_max_channel: INK_DELTA,
      panel_bg_sample: `元素框外 ${BG_RING_NEAR}–${BG_RING_FAR} CSS px 环带取三通道中位数`,
      units: "判据里的 px 一律是 CSS 像素；PNG 是设备像素，用 px_per_css_px 换算",
      source: "p4-cdp-capture.mjs 经 CDP Page.captureScreenshot(clip) 拍的区域图",
      decoder: `尺子自带标准 PNG 解码；自检（${selfTestNote}）先跑`,
    },
    thresholds: THRESHOLDS,
    ruler: { decoder_selftest: selfTestNote, mutations: teeth },
    shots: [],
    deviations: [
      {
        check: "avatar.四角与面板底色差",
        old_limit: 6,
        measured: "浅色档 上角 1 / 下角 9，深色档 上角 2 / 下角 7",
        why_overturned:
          "计划里的 6 假设头像框四角只有底色。实际 CSS 挂着 `filter: drop-shadow(0 2px 8px …pink 22%)`，" +
          "向下偏移 2px，所以下角必然离底色 7–9；这不是「圆遮罩失效、方底露出来」。" +
          "方底要露也是粉描边那个量级（实测 21）。判据改成两条：整体 < 15 挡方底，上两角 < 6 认遮罩。",
      },
      {
        check: "avatar.墨质心离块心 → 猫影质心离块心",
        old_limit: "同一阈值 3 CSS px，但口径是 >INK_DELTA(20)",
        measured: "浅色档旧口径 4.576 CSS px（红），新口径 silhouette(>PAINT_DELTA=4) 见 report.shots[].ink",
        why_overturned:
          "奶油猫毛 #f7f4ec 压奶油面板 #f9f7f1 最大通道差只有 5，对 INK_DELTA 完全隐形，" +
          "所以浅色档的「墨」只剩深色五官 + 粉描边，其质心天然偏上——量的是眉毛，不是脸。" +
          "判居中要用把毛算进去的 silhouette 口径；阈值 3 CSS px 不动。旧口径继续报数，只作诊断。",
      },
    ],
  };

  for (const [name, extra] of plan) {
    const entry = meta.shots[name];
    const file = path.join(shots, name);
    if (!entry || !fs.existsSync(file)) {
      report.shots.push({ file: name, pass: false, error: "取样档没产出这张图或 meta 里没有它的框" });
      continue;
    }
    const img = readImage(file);
    report.shots.push(judgeShot(name, img, entry, extra));
  }

  report.pass = report.shots.length === 4 && report.shots.every((s) => s.pass);
  fs.writeFileSync(path.join(shots, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const s of report.shots) {
    const lines = Object.entries(s.checks ?? {}).map(([k, v]) => `    ${v.pass ? "ok  " : "FAIL"} ${k}: ${JSON.stringify(v.value)} （要求 ${v.limit}）`);
    console.log(`  ${s.pass ? "PASS" : "FAIL"} ${s.file}${s.error ? ` — ${s.error}` : ""}`);
    console.log(lines.join("\n"));
  }
  console.log(`[p4-visual-oracle] ${report.pass ? "四张全绿" : "有红"} -> ${path.join(shots, "report.json")}`);
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[p4-visual-oracle] FAIL ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

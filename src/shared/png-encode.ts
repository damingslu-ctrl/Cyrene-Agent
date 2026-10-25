/**
 * 最小位图容器编解码（无新依赖：`node:zlib` + 自己算 CRC32）。
 * 为什么不用 `sharp`：它在 asarUnpack 里是给 Transformers.js 用的**运行时**依赖，
 * 构建脚本引它会把打包面搅浑（Task 11 原文的裁决，仍然成立）。
 *
 * 编：逐行在 filter 0..4 里挑「残差绝对值之和」最小的那条（Painter 的经典启发式）。
 * 位图猫娘的帧图是照片式渐变，filter 0 的 deflate 比自适应高一倍以上；平色矢量图
 * 自适应也不会更差，所以不再保留「只写 0」的特例。
 * 解：五种 filter 全认——Pillow / Chromium 写出来的源图默认就是自适应。
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const SIGN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 逐行挑 filter：score 用「残差当有符号字节的绝对值之和」——PNG 的经典启发式，不用真压一遍。 */
function bestFilterRow(row: Uint8Array, prev: Uint8Array | null): { filter: number; bytes: Uint8Array } {
  const stride = row.length;
  let bestFilter = 0;
  let bestBytes = Uint8Array.from(row);
  let bestScore = Infinity;
  for (let filter = 0; filter <= 4; filter += 1) {
    const bytes = new Uint8Array(stride);
    let score = 0;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= 4 ? prev[i - 4] : 0;
      const pred =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : paeth(a, b, c);
      const v = (row[i] - pred) & 0xff;
      bytes[i] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) {
      bestScore = score;
      bestFilter = filter;
      bestBytes = bytes;
    }
  }
  return { filter: bestFilter, bytes: bestBytes };
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new RangeError(`rgba 长度不对：${rgba.length} vs ${width}×${height}`);
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    const best = bestFilterRow(row, prev);
    raw[y * (stride + 1)] = best.filter;
    raw.set(best.bytes, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIGN,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 只为本期的自产图与参考素材而写：单测 round-trip、`--check` 的像素尺都靠它。 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGN)) throw new RangeError("PNG 签名不对");
  let p = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString("ascii");
    const body = buf.subarray(p + 8, p + 8 + len);
    if (crc32(Buffer.concat([buf.subarray(p + 4, p + 8), body])) !== buf.readUInt32BE(p + 8 + len)) {
      throw new RangeError(`chunk ${type} 的 CRC 不匹配`);
    }
    if (type === "IHDR") {
      if (body[8] !== 8 || body[9] !== 6) throw new RangeError("只支持 8bit RGBA");
      if (body[12] !== 0) throw new RangeError("只支持非隔行图");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") {
      if (p + 12 + len !== buf.length) throw new RangeError("IEND 之后还有字节");
      sawEnd = true;
      break;
    }
    p += 12 + len;
  }
  if (!sawEnd) throw new RangeError("缺 IEND");
  if (!width || !height) throw new RangeError("缺 IHDR");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rawStride = stride + 1;
  if (raw.length !== height * rawStride) throw new RangeError(`IDAT 解压后长度不对：${raw.length} vs ${height * rawStride}`);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * rawStride];
    if (filter > 4) throw new RangeError(`行 ${y} 的 filter byte ${filter} 不合法（只支持 0..4）`);
    const src = y * rawStride + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? rgba[dst + i - 4] : 0;
      const b = y > 0 ? rgba[dst - stride + i] : 0;
      const c = y > 0 && i >= 4 ? rgba[dst - stride + i - 4] : 0;
      const pred =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : paeth(a, b, c);
      rgba[dst + i] = (raw[src + i] + pred) & 0xff;
    }
  }
  return { width, height, rgba };
}

/** PNG-in-ICO（Vista 之后的 Windows 认，无需 ICONINFO/BM 头那一套）。 */
export function encodeIco(entries: Array<{ width: number; height: number; png: Buffer }>): Buffer {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
  let off = 6 + entries.length * 16;
  entries.forEach((e, i) => {
    const base = 6 + i * 16;
    dir[base] = e.width >= 256 ? 0 : e.width; // 256 在目录里记 0，这是格式规定不是笔误
    dir[base + 1] = e.height >= 256 ? 0 : e.height;
    dir[base + 2] = 0; dir[base + 3] = 0; // 调色板数 / 保留
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bit count
    dir.writeUInt32LE(e.png.length, base + 8);
    dir.writeUInt32LE(off, base + 12);
    off += e.png.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.png)]);
}

/** 24bit 无压缩 BMP，底朝上——NSIS 的 `installerSidebar` 只吃 BMP。 */
export function encodeBmp24(img: { width: number; height: number; rgba: Uint8Array }): Buffer {
  const rowBytes = Math.ceil((img.width * 3) / 4) * 4;
  const size = 54 + rowBytes * img.height;
  const out = Buffer.alloc(size);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(img.width, 18);
  out.writeInt32LE(img.height, 22); // 正数＝底朝上，这是 BMP 的常规
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowBytes * img.height, 34);
  for (let y = 0; y < img.height; y += 1) {
    const src = (img.height - 1 - y) * img.width * 4; // 翻转：位图顶行写到 BMP 最后一行
    for (let x = 0; x < img.width; x += 1) {
      const a = img.rgba[src + x * 4 + 3] / 255;
      const dst = 54 + y * rowBytes + x * 3;
      // BMP 没有 alpha：按纯白底预混，侧栏是白底版式，混黑会让猫边缘发灰。
      out[dst + 2] = Math.round(img.rgba[src + x * 4] * a + 255 * (1 - a));
      out[dst + 1] = Math.round(img.rgba[src + x * 4 + 1] * a + 255 * (1 - a));
      out[dst] = Math.round(img.rgba[src + x * 4 + 2] * a + 255 * (1 - a));
    }
  }
  return out;
}

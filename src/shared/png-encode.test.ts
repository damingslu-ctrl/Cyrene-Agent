import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, encodeBmp24, encodeIco, encodePng } from "./png-encode";

const rnd = (n: number) => {
  let s = 12345;
  return Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % 256;
  });
};

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 按指定 filter 重写整张图——验 decode 的五种分支，也验选行启发式。 */
function pngWithFilter(width: number, height: number, rgba: Uint8Array, filter: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const cur = rgba[y * stride + i];
      const a = i >= 4 ? rgba[y * stride + i - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= 4 ? rgba[(y - 1) * stride + i - 4] : 0;
      const pred =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : filter === 4 ? paeth(a, b, c)
        : 0;
      raw[y * (stride + 1) + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    pngHeader(),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngHeader(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function collectIdat(png: Buffer): Buffer {
  const parts: Buffer[] = [];
  let p = 8;
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.subarray(p + 4, p + 8).toString("ascii");
    if (type === "IDAT") parts.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
    if (type === "IEND") break;
  }
  return Buffer.concat(parts);
}

describe("最小 PNG/ICO/BMP 编码", () => {
  it("2×2 全红 RGBA：签名、IHDR 尺寸与色深、IDAT 解回逐字节相等", () => {
    const rgba = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(2); // IHDR width
    expect(png.readUInt32BE(20)).toBe(2); // IHDR height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // color type = RGBA
    expect([...decodePng(png).rgba]).toEqual([...rgba]);
  });

  it("带 alpha 的噪声图 round-trip：半透与全透都不许被抹平", () => {
    const w = 37, h = 21;
    const src = rnd(w * h * 4);
    for (let i = 3; i < src.length; i += 4) src[i] = i % 5 === 3 ? 0 : (src[i] & 0x7f) + 64;
    const buf = new Uint8Array(src);
    expect([...decodePng(encodePng(w, h, buf)).rgba]).toEqual([...buf]);
  });

  it("decode 认全部五种 filter（源图来自 Pillow / Chromium，不可能只有 0）", () => {
    const w = 5, h = 4;
    const rgba = new Uint8Array(rnd(w * h * 4));
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 128 + (i % 7) * 9;
    for (let filter = 0; filter <= 4; filter += 1) {
      expect([...decodePng(pngWithFilter(w, h, rgba, filter)).rgba], `filter ${filter}`).toEqual([...rgba]);
    }
    expect(() => decodePng(pngWithFilter(w, h, rgba, 5))).toThrow(/filter byte 5/);
  });

  it("正对照：IEND 之后有字节、签名不对仍被拒；自适应编码真的不用满行 filter 0", () => {
    const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(() => decodePng(Buffer.concat([png, Buffer.from("junk")]))).toThrow(/IEND 之后/);
    expect(() => decodePng(Buffer.from([0, 1, 2, 3]))).toThrow(/签名/);

    // 横向渐变：Sub 的残差几乎全 0，启发式一定会选非 0 的 filter。
    const w = 64, h = 2;
    const grad = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        grad[i] = x * 4; grad[i + 1] = 128; grad[i + 2] = 255 - x * 4; grad[i + 3] = 255;
      }
    }
    const encoded = encodePng(w, h, grad);
    const raw = inflateSync(collectIdat(encoded));
    expect([...raw.subarray(0, 2)].some((f) => f !== 0), "两行都选了 filter 0").toBe(true);
    expect([...decodePng(encoded).rgba]).toEqual([...grad]);
  });

  it("ICO 容器带 7 档尺寸且每档 payload 就是那张 PNG；256 记 0", () => {
    const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({
      width: size, height: size, png: encodePng(size, size, new Uint8Array(size * size * 4)),
    }));
    const ico = encodeIco(entries);
    expect(ico.readUInt16LE(2)).toBe(1); // type = icon
    expect(ico.readUInt16LE(4)).toBe(7); // count
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(ico[6 + 6 * 16], "256 在目录里记 0").toBe(0);
    // 第 5 档（64）的 payload 偏移指到的那段头就是 PNG 签名
    const fifth = 6 + 4 * 16;
    const off = ico.readUInt32LE(fifth + 12);
    expect([...ico.subarray(off, off + 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(ico.readUInt32LE(fifth + 8)).toBe(entries[4].png.length);
  });

  it("24bit BMP：底朝上、BGR、行补到 4 的倍数，NSIS 侧栏吃这个", () => {
    const bmp = encodeBmp24({ width: 3, height: 2, rgba: new Uint8Array(24) });
    expect([...bmp.subarray(0, 2)]).toEqual([0x42, 0x4d]); // "BM"
    expect(bmp.readInt32LE(18)).toBe(3);
    expect(bmp.readInt32LE(22)).toBe(2);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.length).toBe(54 + 3 * 2 * 4); // 每行 12 字节，已 4 对齐
  });

  it("BMP 翻转与白底预混：顶行红、底行蓝，全透像素落成白而不是黑", () => {
    const rgba = new Uint8Array(4 * 2 * 4);
    rgba.set([255, 0, 0, 255], 0); // 图像顶行（红）
    rgba.set([0, 0, 255, 255], 16); // 图像底行（蓝）
    const bmp = encodeBmp24({ width: 4, height: 2, rgba });
    // BMP 首行是图像**最后**一行：BGR 蓝色
    expect([...bmp.subarray(54, 57)]).toEqual([255, 0, 0]);
    // BMP 末行是图像顶行：BGR 红色
    expect([...bmp.subarray(54 + 12, 54 + 15)]).toEqual([0, 0, 255]);
    const clear = encodeBmp24({ width: 1, height: 1, rgba: new Uint8Array(4) });
    expect([...clear.subarray(54, 57)]).toEqual([255, 255, 255]);
  });
});

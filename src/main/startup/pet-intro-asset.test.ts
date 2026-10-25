import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const ATLAS = resolve(ROOT, "src/renderer/public/pet-intro/atlas.webp");
const META = resolve(ROOT, "src/renderer/public/pet-intro/meta.js");
const PAGE = resolve(ROOT, "src/renderer/public/pet-intro.html");

interface IntroMeta {
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  count: number;
  fps: number;
  fadeMs: number;
}

function readMeta(): IntroMeta {
  const source = readFileSync(META, "utf8");
  const literal = source.match(/window\.PET_INTRO\s*=\s*(\{[\s\S]*?\});/)?.[1];
  if (!literal) throw new Error("meta.js 没有给 window.PET_INTRO 赋值");
  return JSON.parse(literal) as IntroMeta;
}

/** 读 WebP 的 VP8X 画布尺寸与 alpha 位；不给第三方解码器，只认容器头。 */
function readWebpHeader(buffer: Buffer): { width: number; height: number; hasAlpha: boolean } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("不是 WebP（RIFF/WEBP 头不对）");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (tag === "VP8X") {
      const flags = buffer[offset + 8];
      const width = 1 + (buffer[offset + 12] | (buffer[offset + 13] << 8) | (buffer[offset + 14] << 16));
      const height = 1 + (buffer[offset + 15] | (buffer[offset + 16] << 8) | (buffer[offset + 17] << 16));
      return { width, height, hasAlpha: (flags & 0x10) !== 0 };
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error("WebP 里没有 VP8X 块（带 alpha 的图必须有）");
}

describe("pet intro asset", () => {
  const meta = readMeta();
  const header = readWebpHeader(readFileSync(ATLAS));

  it("图集尺寸与 meta 的帧栅格严格对齐（换图不换 meta 会当场红）", () => {
    expect(meta.rows).toBe(Math.ceil(meta.count / meta.cols));
    expect(header.width).toBe(meta.frameW * meta.cols);
    expect(header.height).toBe(meta.frameH * meta.rows);
  });

  it("图集带 alpha（视频背景要透明）", () => {
    expect(header.hasAlpha).toBe(true);
  });

  it("帧数与节奏是启动动画那一版（146 帧 / 24fps，与源片 1:1）", () => {
    expect(meta.count).toBe(146);
    expect(meta.fps).toBe(24);
    expect(meta.fadeMs).toBeGreaterThan(0);
    expect(meta.fadeMs).toBeLessThan(1000);
  });

  it("体积守在 2MB 内（启动时要从磁盘读进渲染进程）", () => {
    expect(statSync(ATLAS).size).toBeLessThan(2 * 1024 * 1024);
  });

  it("页面真的加载这张图集与这份 meta，并保留主进程认的完成暗号", () => {
    const html = readFileSync(PAGE, "utf8");
    expect(html).toContain("./pet-intro/atlas.webp");
    expect(html).toContain("./pet-intro/meta.js");
    expect(html).toContain('"pet-intro-done"');
  });
});

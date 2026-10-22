import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_STICKER_IDS } from "../shared/sticker-types";
import { CAT_STICKERS, STICKER_SIZE } from "../shared/cat-sticker-set";
import { BUILT_IN_STICKER_DESCRIPTIONS, BUILT_IN_STICKER_FILES } from "./sticker-descriptions";

const dir = fileURLToPath(new URL("../renderer/public/stickers/", import.meta.url));
const PNG_MAGIC = "89504e470d0a1a0a";

describe("内置表情包目录", () => {
  it("猫表与 id 表一一对应，且 id 顺序不乱", () => {
    expect(CAT_STICKERS.map((s) => s.id)).toEqual([...BUILT_IN_STICKER_IDS]);
  });

  it("文件表一律是 <id>.png（WebP 冒充 gif 的雷一次排掉）", () => {
    expect(Object.keys(BUILT_IN_STICKER_FILES).sort()).toEqual([...BUILT_IN_STICKER_IDS].sort());
    for (const id of BUILT_IN_STICKER_IDS) expect(BUILT_IN_STICKER_FILES[id], id).toBe(`${id}.png`);
  });

  it("每个 id 都有描述（贴纸转自然语言靠它）", () => {
    expect(Object.keys(BUILT_IN_STICKER_DESCRIPTIONS).sort()).toEqual([...BUILT_IN_STICKER_IDS].sort());
  });

  it("磁盘上每张都是真 PNG，且是 512²（R-D1 贴纸档）", () => {
    for (const id of BUILT_IN_STICKER_IDS) {
      const p = `${dir}${BUILT_IN_STICKER_FILES[id]}`;
      expect(existsSync(p), p).toBe(true);
      const buf = readFileSync(p);
      expect(buf.subarray(0, 8).toString("hex"), p).toBe(PNG_MAGIC);
      expect(buf.readUInt32BE(16), p).toBe(STICKER_SIZE);
      expect(buf.readUInt32BE(20), p).toBe(STICKER_SIZE);
    }
  });

  it("52 张全不一样（同图两用等于表情包缩水）", () => {
    const hashes = BUILT_IN_STICKER_IDS.map((id) =>
      createHash("sha1").update(readFileSync(`${dir}${BUILT_IN_STICKER_FILES[id]}`)).digest("hex"));
    expect(new Set(hashes).size).toBe(BUILT_IN_STICKER_IDS.length);
  });
});

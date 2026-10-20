import { describe, expect, it } from "vitest";
import { encodePng } from "./png-encode";

describe("最小 PNG 编码器", () => {
  it("2x2 全红 RGBA 编出合法 PNG（IHDR 尺寸与色深对得上）", () => {
    const rgba = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = png.subarray(16, 29);
    expect(ihdr.readUInt32BE(0)).toBe(2);   // width
    expect(ihdr.readUInt32BE(4)).toBe(2);   // height
    expect(ihdr[8]).toBe(8);                // bit depth
    expect(ihdr[9]).toBe(6);                // color type RGBA
  });
});

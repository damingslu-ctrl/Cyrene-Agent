import { describe, expect, it } from "vitest";
import { formatGeomProbe } from "./geom-probe";

describe("formatGeomProbe", () => {
  it("按 native 的 GEOM 行口径输出，字段顺序固定", () => {
    expect(
      formatGeomProbe({
        t: 12.5, applied: { x: 1800, y: 640 }, actual: { x: 1800, y: 640, width: 82, height: 108 },
        pin: { x: 41.0, y: 39.0 }, center: { x: 24.0, y: 43.0 }, peekDx: 0, e: 0, dpr: 1.5,
      }),
    ).toBe("GEOM\t12.5\tapplied 1800,640\tactual 1800,640 82x108\tpin 41.0,39.0\tcenter 24.0,43.0\tpeek 0.0\te 0.00\tdpr 1.50");
  });

  it("applied 与 actual 不一致时两列都要打出来（这是 native 那次「整窗空白」的取证前提）", () => {
    const line = formatGeomProbe({
      t: 1, applied: { x: 100, y: 100 }, actual: { x: 104, y: 96, width: 82, height: 108 },
      pin: { x: 41, y: 39 }, center: { x: 24, y: 43 }, peekDx: 0, e: 0, dpr: 1,
    });
    expect(line).toContain("applied 100,100");
    expect(line).toContain("actual 104,96");
  });

  it("main 拿不到的模型列打 `-`，不许用常量冒充（防止尺把假数据读成 PASS）", () => {
    expect(
      formatGeomProbe({
        t: 3.2, applied: { x: 300, y: 400 }, actual: { x: 300, y: 400, width: 248, height: 482 },
        pin: null, center: null, peekDx: null, e: null, dpr: 1.25,
      }),
    ).toBe("GEOM\t3.2\tapplied 300,400\tactual 300,400 248x482\tpin -,-\tcenter -,-\tpeek -\te -\tdpr 1.25");
  });

  it("位置门被拖拽闸门关掉时 applied 打 `-`：没发出去的请求不算证据", () => {
    const line = formatGeomProbe({
      t: 4, applied: null, actual: { x: 300, y: 400, width: 248, height: 482 },
      pin: null, center: null, peekDx: null, e: null, dpr: 1,
    });
    expect(line).toContain("applied -,-\tactual 300,400 248x482");
    // 正对照：同一 actual 只要指令真发过，applied 就必须是数字
    expect(
      formatGeomProbe({
        t: 4, applied: { x: 300, y: 400 }, actual: { x: 300, y: 400, width: 248, height: 482 },
        pin: null, center: null, peekDx: null, e: null, dpr: 1,
      }),
    ).toContain("applied 300,400\tactual 300,400 248x482");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { opsBounds, paintOps, roundRectPath, toPath2D } from "./ops";
import type { DrawOp } from "./ops";

/**
 * vitest 跑在 node 环境（vitest.config.mts），这里只补够 `ops.ts` 真正调用的那几个面：
 * 记录方法名与参数，判据全落在「调用序列」上，不验证真实光栅化。
 */
const realPath2D = (globalThis as { Path2D?: unknown }).Path2D;
class FakePath2D {
  static built: FakePath2D[] = [];
  cmds: string[] = [];
  constructor() { FakePath2D.built.push(this); }
  moveTo(x: number, y: number) { this.cmds.push(`moveTo ${x} ${y}`); }
  lineTo(x: number, y: number) { this.cmds.push(`lineTo ${x} ${y}`); }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number) { this.cmds.push(`arcTo ${r}`); }
  closePath() { this.cmds.push("closePath"); }
}

function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 0,
    font: "",
    textBaseline: "",
    textAlign: "",
    globalCompositeOperation: "source-over",
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    fill: (a?: unknown) => calls.push(typeof a === "string" ? `fill:${a}` : "fill:path"),
    stroke: (a?: unknown) => calls.push(typeof a === "string" ? `stroke:${a}` : "stroke:path"),
    ellipse: (cx: number, cy: number, rx: number, ry: number, rot: number) => calls.push(`ellipse ${cx} ${cy} ${rx} ${ry} ${rot}`),
    arc: (cx: number, cy: number, r: number) => calls.push(`arc ${cx} ${cy} ${r}`),
    clip: () => calls.push("clip"),
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      calls.push(`grad ${x0} ${y0} ${x1} ${y1}`);
      return { addColorStop: (at: number, color: string) => calls.push(`stop ${at} ${color}`) };
    },
    fillText: (text: string, x: number, y: number) => calls.push(`text ${text} ${x} ${y}`),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

beforeEach(() => {
  FakePath2D.built = [];
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
});
afterEach(() => {
  (globalThis as { Path2D?: unknown }).Path2D = realPath2D;
});

const last = (calls: string[], pred: (c: string) => boolean) =>
  [...calls].reverse().find(pred);

describe("toPath2D 的闭合语义", () => {
  it("默认闭合（填充形状必须是闭合环）", () => {
    toPath2D([[0, 0], [10, 0], [10, 10]]);
    expect(FakePath2D.built[0].cmds.at(-1)).toBe("closePath");
  });

  it("显式不闭合时不得留下首尾连线（native `stroke_poly` 不闭合，任务 #56）", () => {
    toPath2D([[0, 0], [10, 0], [10, 10]], false);
    expect(FakePath2D.built[0].cmds).not.toContain("closePath");
  });

  it("空点列返回空路径，不 moveTo 到 undefined", () => {
    toPath2D([]);
    expect(FakePath2D.built[0].cmds).toEqual([]);
  });
});

describe("paintOps", () => {
  it("strokePath 默认不闭合，`close: true` 才闭合；fillPath / gradPath 始终闭合", () => {
    const { ctx, calls } = fakeCtx();
    paintOps(ctx, [
      { kind: "strokePath", stroke: "#000", width: 1, points: [[0, 0], [5, 5]] },
      { kind: "strokePath", stroke: "#000", width: 1, points: [[0, 0], [5, 5]], close: true },
      { kind: "fillPath", fill: "#000", points: [[0, 0], [5, 5]] },
      { kind: "gradPath", from: [0, 0], to: [5, 5], stops: [{ at: 0, color: "#000" }, { at: 1, color: "#fff" }], points: [[0, 0], [5, 5]] },
    ]);
    const [open, shut, filled, grad] = FakePath2D.built;
    expect(shut.cmds).toContain("closePath");
    expect(open.cmds).not.toContain("closePath");
    expect(filled.cmds).toContain("closePath");
    expect(grad.cmds).toContain("closePath");
    expect(calls.filter((c) => c === "stroke:path")).toHaveLength(2);
    expect(calls.filter((c) => c === "fill:path")).toHaveLength(2);
  });

  it("月牙是差集不是对称差：先按外圆裁剪域，再在剪域里走 evenodd；绝不 destination-out", () => {
    const { ctx, calls } = fakeCtx();
    ctx.globalCompositeOperation = "source-over";
    paintOps(ctx, [{ kind: "crescent", fill: "#000", cx: 40, cy: 10, r: 7, dx: 3, dy: -2, cut: 6.4 }]);
    expect(ctx.globalCompositeOperation).toBe("source-over");
    expect(calls.some((c) => /destination-out/.test(c))).toBe(false);
    expect(last(calls, (c) => c.startsWith("fill:"))).toBe("fill:evenodd");
    // native `ui.rs:414-447` 逐行填「外圆弦裁掉内圆弦」。本原语的实际参数
    // d=0.516r、cut=0.92r 会让内圆伸出外圆 0.436r，裸 evenodd 把伸出去那截也填上，
    // 墨就出了 `opsBounds` 宣告的外圆框（`art.test.ts` 的窗内判据以此为前提）。
    // 剪域必须是**外圆**那条弧，且必须发生在 fill 之前。
    expect(calls.filter((c) => c === "clip")).toHaveLength(1);
    const clipAt = calls.indexOf("clip");
    const fillAt = calls.lastIndexOf("fill:evenodd");
    expect(clipAt).toBeGreaterThan(-1);
    expect(clipAt).toBeLessThan(fillAt);
    expect(calls.slice(0, clipAt)).toContain("arc 40 10 7");
    expect(calls.slice(0, clipAt)).not.toContain("arc 43 8 6.4");
    // 剪域之后重走两圆：外圆 r 与内圆 cut，圆心差 (dx, dy)
    const arcs = calls.filter((c) => c.startsWith("arc "));
    expect(arcs).toEqual(["arc 40 10 7", "arc 40 10 7", "arc 43 8 6.4"]);
    // 剪域要成对收回，否则后续 op 会被这块 clip 一直裁着
    expect(calls.filter((c) => c === "save").length).toBe(calls.filter((c) => c === "restore").length);
  });

  it("文字按 align 走 textAlign，缺省是 left（胶囊左箭头与右对齐数值共用一个基线）", () => {
    const alignOf = (align?: "left" | "right" | "center") => {
      const { ctx, calls } = fakeCtx();
      paintOps(ctx, [{ kind: "text", text: "x", x: 68, y: 80, size: 8, color: "#fff", align }]);
      return { textAlign: ctx.textAlign, textBaseline: ctx.textBaseline, font: ctx.font, drawn: calls.includes("text x 68 80") };
    };
    expect(alignOf()).toMatchObject({ textAlign: "left", textBaseline: "middle", drawn: true });
    expect(alignOf("right").textAlign).toBe("right");
    expect(alignOf("center").textAlign).toBe("center");
    expect(alignOf().font).toBe("8px sans-serif");
  });

  it("整轮绘制包在 save/restore 里，指令之间不会互相残留 fillStyle", () => {
    const { ctx, calls } = fakeCtx();
    paintOps(ctx, [{ kind: "fillEllipse", fill: "#000", cx: 1, cy: 1, rx: 1, ry: 1 }]);
    expect(calls[0]).toBe("save");
    expect(calls.at(-1)).toBe("restore");
  });

  it("fillEllipse 把 rot 透传给 ctx.ellipse（缺省 0）", () => {
    const { ctx, calls } = fakeCtx();
    paintOps(ctx, [
      { kind: "fillEllipse", fill: "#000", cx: 60, cy: 106, rx: 27, ry: 5.2 },
      { kind: "fillEllipse", fill: "#000", cx: 1, cy: 2, rx: 3, ry: 4, rot: 0.5 },
    ]);
    expect(calls).toContain("ellipse 60 106 27 5.2 0");
    expect(calls).toContain("ellipse 1 2 3 4 0.5");
  });
});

describe("roundRectPath", () => {
  it("四角各一段 arcTo，末尾闭合", () => {
    roundRectPath({ x: 0, y: 0, w: 70, h: 32, r: 9 });
    const cmds = FakePath2D.built[0].cmds;
    expect(cmds.filter((c) => c.startsWith("arcTo"))).toEqual(new Array(4).fill("arcTo 9"));
    expect(cmds.at(-1)).toBe("closePath");
  });

  it("半径被夹到短边一半（越界的 r 会让 arcTo 画出蝴蝶结）", () => {
    roundRectPath({ x: 0, y: 0, w: 10, h: 6, r: 99 });
    expect(FakePath2D.built[0].cmds.filter((c) => c.startsWith("arcTo"))).toEqual(new Array(4).fill("arcTo 3"));
  });
});

describe("opsBounds", () => {
  it("空指令集返回 null（不许返回 0 尺寸框）", () => {
    expect(opsBounds([])).toBeNull();
  });

  it("按路径点求包围盒，椭圆按中心加减半径", () => {
    const ops: DrawOp[] = [
      { kind: "fillPath", fill: "#000", points: [[10, 20], [30, 5]] },
      { kind: "fillEllipse", fill: "#000", cx: 60, cy: 63.5, rx: 10, ry: 3.2 },
    ];
    // 实测 opsBounds: x[10,70]=w60, y[5,66.7]=h61.7（brief 手算值有误）
    expect(opsBounds(ops)).toEqual({ x: 10, y: 5, width: 60, height: 61.7 });
  });

  it("圆角矩形按整块外框吃进来（漏了它，胶囊会被读成不存在）", () => {
    const ops: DrawOp[] = [
      { kind: "fillRoundRect", fill: "#000", x: 6, y: 72, w: 70, h: 32, r: 9 },
      { kind: "strokeRoundRect", stroke: "#000", width: 1, x: 6, y: 72, w: 70, h: 32, r: 9 },
    ];
    expect(opsBounds(ops)).toEqual({ x: 6, y: 72, width: 70, height: 32 });
  });

  it("月牙吃外圆而不是 cut，文字只吃锚点（它是几何框不是墨框）", () => {
    const moon: DrawOp[] = [{ kind: "crescent", fill: "#000", cx: 40, cy: 10, r: 7, dx: 3, dy: -2, cut: 6.4 }];
    expect(opsBounds(moon)).toEqual({ x: 33, y: 3, width: 14, height: 14 });
    const t: DrawOp[] = [{ kind: "text", text: "1.2 MB/s", x: 68, y: 80, size: 8, color: "#fff", align: "right" }];
    expect(opsBounds(t)).toEqual({ x: 68, y: 80, width: 0, height: 0 });
  });
});

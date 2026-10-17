import { describe, expect, it } from "vitest";
import { buildCapsuleOps, buildCatOps, layerKinds } from "./art";
import { opsBounds, type DrawOp } from "./ops";
import { INK, PAPER } from "./tokens";

const base = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle" as const, t: 0, energy: 1,
  mouse: null, blink: 0, jumpY: 0, pet: 0,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 }, quiet: false, unreadCount: 0,
};

describe("buildCatOps 层序", () => {
  it("绘制顺序照抄 ui.rs::draw_cat：影子→尾→耳→身→围兜→爪→眼→鼻嘴→腮红→洗脸爪→Zzz→月牙→爱心→星→角标", () => {
    expect(layerKinds(buildCatOps(base))).toEqual([
      "ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke",
      "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush",
    ]);
  });

  it("免打扰时月牙压在 Zzz 之后且必须两层（墨 + PAPER 反咬）", () => {
    const ops = buildCatOps({ ...base, quiet: true });
    const crescents = ops.filter((op) => op.layer === "quiet_mark");
    expect(crescents).toHaveLength(2);
    expect(crescents.map((op) => op.fill)).toEqual([INK, PAPER]);
  });

  it("正对照：安静期间不许出现 Zzz（月牙与 Zzz 屏幕互斥）", () => {
    expect(buildCatOps({ ...base, quiet: true }).some((op) => op.layer === "zzz")).toBe(false);
    expect(buildCatOps({ ...base, quiet: false, mood: "sleep" }).some((op) => op.layer === "zzz")).toBe(true);
  });

  it("猫身包围盒在收起档必须落进 74×68 且不出 82 宽窗口", () => {
    const box = opsBounds(buildCatOps(base));
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(82);
  });

  it("爱心整段行程连半径都留在窗内（旧的 44+26ph 会被拦腰裁掉）", () => {
    const ops = buildCatOps({ ...base, pet: 1 });
    const hearts = ops.filter((op) => op.layer === "heart" && (op.kind === "fillEllipse"));
    expect(hearts.length).toBeGreaterThan(0);
    for (const heart of hearts) {
      expect(heart.ry).toBeLessThan(heart.cy);
      expect(heart.cy + heart.ry).toBeLessThanOrEqual(108);
    }
  });
});

describe("buildCapsuleOps", () => {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
  };
  const collapsed = (over: Partial<Parameters<typeof buildCapsuleOps>[0]>) =>
    buildCapsuleOps({ rectWidth: 82, rectHeight: 108, e: 0, growLeft: false, up: 0, down: 0, pinX: 41, ...over });

  it("默认档 70×32（rx=35/ry=16）、位于窗口底部（cy = 高 - 16 - 4）", () => {
    const body = collapsed({})[0] as Extract<DrawOp, { kind: "fillEllipse" }>;
    expect(body.rx).toBeCloseTo(35, 1);
    expect(body.ry).toBeCloseTo(16, 1);
    expect(body.cy).toBeCloseTo(108 - 32 / 2 - 4, 6);
  });

  it("growLeft 时胶囊贴右缘（cx = max.x - PIN.x）", () => {
    const right = collapsed({ rectWidth: 172, growLeft: true })[0] as Extract<DrawOp, { kind: "fillEllipse" }>;
    expect(right.cx).toBeCloseTo(172 - 41, 6);
  });

  it("无流量时降的是 RGB 亮度而不是 alpha，并且描边比填充亮一档", () => {
    const [fill, stroke] = collapsed({});
    if (fill.kind !== "fillEllipse" || stroke.kind !== "strokeEllipse") throw new Error("胶囊应为「填充 + 描边」两层");
    expect(fill.fill).toMatch(/^#[0-9a-f]{6}$/i);
    expect(stroke.stroke).toMatch(/^#[0-9a-f]{6}$/i);
    expect(lum(stroke.stroke)).toBeGreaterThan(lum(fill.fill));
  });

  it("展开动画期间随 e 淡出：e=0.5 起完全消失", () => {
    expect(collapsed({ rectWidth: 248, rectHeight: 482, e: 0.6, up: 1, down: 1 })).toEqual([]);
  });
});

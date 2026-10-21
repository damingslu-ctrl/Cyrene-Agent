/**
 * 变体库：花色 × 姿态 × 取景 → DrawOp[]。桌面猫与位图资产共用同一个 `buildCatOps`，
 * 这里只负责**喂参数**，不许再画一份几何（spec D1「与桌面猫同源」的全部含义就在这行字上）。
 *
 * 时刻固定 `t = 0`：`buildCatOps` 的呼吸、整体旋转、尾摆、耳抽全含 `sin(t·k)` 或 `t % period`，
 * t=0 时同时归零 ⇒ 静帧与调用顺序、真实时钟无关（R-D9）。
 *
 * 住在 renderer（R-D13）：它 import `art.ts`，而 `art.ts → ops.ts` 要 DOM 类型；
 * 放进 shared 会把 `CanvasRenderingContext2D` 拉进 `tsconfig.main` 的程序。
 */
import { VB, buildCatOps, type CatInput, type Mood, type Pose } from "./art";
import type { DrawOp, PetLayer } from "./ops";
import { coatOf, type CoatName } from "../../shared/cat-coats";
import type { CropName, PoseName } from "../../shared/cat-types";

export type { CropName, PoseName } from "../../shared/cat-types";

export interface SpritePose {
  mood: Mood;
  pose: Pose;
  blink: number;
  jumpY: number;
  pet: number;
  energy: number;
  quiet: boolean;
  t: number;
}

const P = (over: Partial<Pose> = {}): Pose => ({
  paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0, ...over,
});

const SP = (over: Partial<SpritePose>): SpritePose => ({
  mood: "idle", pose: P(), blink: 0, jumpY: 0, pet: 0, energy: 0.3, quiet: false, t: 0, ...over,
});

/**
 * 12 个姿态（spec §3-D D1 的中文档位依次是：坐/卧/趴/探头/伸懒腰/洗脸/打哈欠/歪头/睡/炸毛/委屈/开心）。
 * 8 个走的是 native 已有的 `paw/yawn/stretch/tilt/mood`；
 * 4 个（卧/趴/探头/炸毛）走 R-D8 新加的 `sprawl/puff`，见 `cat-variants.test.ts` 的差异锁。
 */
export const CAT_POSES: Record<PoseName, () => SpritePose> = {
  sit: () => SP({}),
  lie: () => SP({ pose: P({ sprawl: 0.45 }), blink: 0.15 }),
  prone: () => SP({ pose: P({ sprawl: 0.9 }), blink: 0.3, energy: 0.1 }),
  peek: () => SP({ pose: P({ sprawl: 0.3, tilt: -9, engagement: 1 }), blink: 0 }),
  stretch: () => SP({ pose: P({ stretch: 1 }), energy: 0.5 }),
  wash: () => SP({ pose: P({ paw: 1 }) }),
  yawn: () => SP({ pose: P({ yawn: 1 }) }),
  tilt: () => SP({ pose: P({ tilt: 13 }) }),
  sleep: () => SP({ mood: "sleep", pose: P({ sprawl: 0.6 }), blink: 1, energy: 0.05 }),
  puff: () => SP({ mood: "grumpy", pose: P({ puff: 1 }), energy: 1 }),
  pout: () => SP({ mood: "grumpy", pose: P({ tilt: -6 }), blink: 0.55 }),
  happy: () => SP({ mood: "happy", jumpY: -8, pet: 0.6, pose: P({ engagement: 1 }) }),
};

export interface CatCrop {
  /** viewBox 里要框住的那块（0..120 见 `art.ts::VB`）。 */
  window: [number, number, number, number];
  /** 落位到画布中心的那个 viewBox 点（身体的对称轴是 x=60，竖直向心按各取景自己给）。 */
  anchor: [number, number];
  /** 四周留白比例：0.06 = 每边留 6%。 */
  pad: number;
  mask: "none" | "disc";
}

/**
 * 框是初值，Task 24 的 `--check` 会按「墨覆盖度 ∈ [0.22, 0.80] 且质心离中 < 12%」一次校平。
 * 全身含尾与投影，故 y 拉到 114；半身只到胸线；方/圆头像框到耳下 6px，留得出耳朵。
 * `wide` 是本期唯一的 16:9 档，只服务 `public/cyrene-welcome.png`（R-D1 实测：`min(860px,100%)` × `aspect-ratio:16/9`）。
 * 它的 `window` 由**目标宽高比**反推而不是由 anatomy 反推：高取 `full` 的 106，宽 = 106×16/9 = 188.4，
 * 于是 x 越过 viewBox 的 0..120 边界——**多出去的是透明边，不是越界**，猫在 16:9 海报里本来就该有横向留白。
 * `placeCrop` 不许把 x 夹回 [0,120]（夹了就把 16:9 变成 4:3，`--check` 的尺寸判据当场红）。
 */
export const CAT_CROPS: Record<CropName, CatCrop> = {
  full: { window: [14, 8, 106, 114], anchor: [60, 62], pad: 0.06, mask: "none" },
  bust: { window: [26, 20, 94, 88], anchor: [60, 56], pad: 0.05, mask: "none" },
  square: { window: [34, 20, 86, 72], anchor: [60, 46], pad: 0.04, mask: "none" },
  round: { window: [34, 20, 86, 72], anchor: [60, 46], pad: 0.04, mask: "disc" },
  wide: { window: [-34.2, 6, 154.2, 112], anchor: [60, 59], pad: 0.02, mask: "none" },
};

export interface SpriteSpec {
  coat: CoatName;
  pose: PoseName;
  crop: CropName;
  /** 逐张覆盖：省略时回落 `CAT_POSES[pose]()` 的基态。 */
  mood?: Mood;
  blink?: number;
  pet?: number;
  energy?: number;
}

export const SPRITE_DROPPED_LAYERS: readonly PetLayer[] = ["zzz", "capsule", "unread"];

export function placeCrop(crop: CatCrop, size: { w: number; h: number }): { u: number; center: { x: number; y: number } } {
  const [x0, y0, x1, y1] = crop.window;
  // xf.s 是「1 个 viewBox 单位 = 几个像素」；`buildCatOps` 里 s = u*2/VB，反解即 u = s*VB/2。
  const s = (1 - crop.pad) * Math.min(size.w / (x1 - x0), size.h / (y1 - y0));
  return {
    u: (s * VB) / 2,
    // buildCatOps 把 viewBox (60,70) 落在 center 上，所以要放别的点就得自己挪 center。
    center: { x: size.w / 2 + (60 - crop.anchor[0]) * s, y: size.h / 2 + (70 - crop.anchor[1]) * s },
  };
}

/** 位图管线唯一出口：取景 + 花色 + 姿态 → DrawOp[]，并按 R-D10 丢掉文字层。 */
export function buildSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  const base = CAT_POSES[spec.pose]();
  const p: SpritePose = {
    ...base,
    mood: spec.mood ?? base.mood,
    blink: spec.blink ?? base.blink,
    pet: spec.pet ?? base.pet,
    energy: spec.energy ?? base.energy,
  };
  const input: CatInput = {
    ...placeCrop(CAT_CROPS[spec.crop], size),
    mood: p.mood, t: p.t, energy: p.energy, mouse: null,
    blink: p.blink, jumpY: p.jumpY, pet: p.pet, quiet: p.quiet, pose: p.pose,
    coat: coatOf(spec.coat),
  };
  const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
  return buildCatOps(input).filter((op) => op.layer === undefined || !dropped.has(op.layer));
}

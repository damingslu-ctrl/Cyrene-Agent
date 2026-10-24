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
import type { PetForm } from "../../shared/pet-profile";
import { buildGirlOps } from "./girl";
import { MOOD_TO_EXPRESSION } from "./face";
import { bodyClip, gestureClip, sampleClip } from "./motion";
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
 * 取景不是「裁切」，是「缩放 + 落位」：`window` 只决定每 viewBox 单位几个像素，画布边界才是真正的裁剪线。
 * 所以下面的 `window` 记的是**要装下的那块 anatomy**，`anchor` 才是构图——要挪画面就改 anchor。
 *
 * 五个框都是 Task 24 全表实测后定的（实测量见 `--check` 的覆盖度/质心/边缘接触）：
 * - 整只猫的真实墨迹是 x 16.5..137.5、y 8.6..116.1（`prone` 的尾巴最右、`happy` 的耳朵最高），
 *   **不以 x=60 对称**——尾巴把重心整个拽到右边。`full` 因此装下整条尾巴（anchor x=77），
 *   否则 240px 的欢迎页上会看到尾巴在右缘被平切。
 * - `bust` 留 10% 白：`happy` 是唯一会把头弹出画布顶的姿态（jumpY -8），9% 时耳尖正好贴边。
 * - `square` 是「脸填满画框」的那一档：耳朵本来就该顶到上缘，84px 下脸越大越好认。
 * - `round` 是 42px 的圆头像，重心落在画布中心附近（锚 50 时 `prone` 的头会掉到下半张）。
 * - `wide` 是本期唯一的 16:9 档，只服务 `public/cyrene-welcome.png`（R-D1 实测：`min(860px,100%)` × `aspect-ratio:16/9`）。
 *   它的 `window` 由**目标宽高比**反推而不是由 anatomy 反推：高取 `full` 的 106，宽 = 106×16/9 = 188.4，
 *   于是 x 越过 viewBox 的 0..120 边界——**多出去的是透明边，不是越界**，猫在 16:9 海报里本来就该有横向留白。
 *   `placeCrop` 不许把 x 夹回 [0,120]（夹了就把 16:9 变成 4:3，`--check` 的尺寸判据当场红）。
 */
export const CAT_CROPS: Record<CropName, CatCrop> = {
  full: { window: [16, 8, 138, 112], anchor: [77, 63], pad: 0.08, mask: "none" },
  bust: { window: [24, 14, 96, 94], anchor: [60, 57], pad: 0.1, mask: "none" },
  square: { window: [32, 14, 88, 78], anchor: [60, 48], pad: 0.08, mask: "none" },
  round: { window: [32, 12, 88, 80], anchor: [60, 58], pad: 0.18, mask: "disc" },
  wide: { window: [-34.2, 6, 154.2, 112], anchor: [60, 59], pad: 0.02, mask: "none" },
};


/**
 * 12 个 PoseName 在猫娘上的重写（spec §9：卧→侧卧、趴→伏案、炸毛→发蓬＋生气；
 * PoseName 联合不动）。取 clip 的「特征帧」出静帧，而不是 p=0 的 rest——
 * peek 的 rest 是「收回来」的状态，立绘要探出去那一帧。
 */
export interface GirlSpritePose {
  body: string;
  gesture?: string;
  p?: number;
  gestureP?: number;
  blink: number;
  energy: number;
}

export const GIRL_POSES: Record<PoseName, () => GirlSpritePose> = {
  sit:     () => ({ body: "sit", blink: 0, energy: 0.4 }),
  lie:     () => ({ body: "sleep", blink: 0.35, energy: 0.3 }),
  prone:   () => ({ body: "sit", gesture: "typeCode", blink: 0.2, energy: 0.5 }),
  peek:    () => ({ body: "stand", gesture: "peek", gestureP: 0.5, blink: 0, energy: 0.6 }),
  stretch: () => ({ body: "stand", gesture: "stretch", gestureP: 0.5, blink: 0, energy: 0.5 }),
  wash:    () => ({ body: "stand", gesture: "groom", gestureP: 0.5, blink: 0, energy: 0.4 }),
  yawn:    () => ({ body: "stand", gesture: "yawn", gestureP: 0.5, blink: 0.2, energy: 0.2 }),
  tilt:    () => ({ body: "stand", gesture: "tilt", gestureP: 0.5, blink: 0, energy: 0.5 }),
  sleep:   () => ({ body: "sleep", blink: 1, energy: 0.05 }),
  puff:    () => ({ body: "stand", gesture: "shiver", gestureP: 0.3, blink: 0, energy: 1 }),
  pout:    () => ({ body: "stand", blink: 0.55, energy: 0.2 }),
  happy:   () => ({ body: "stand", gesture: "hop", gestureP: 0.5, blink: 0, energy: 0.8 }),
};

/**
 * 猫娘的取景表（暂行值，Task 25 用 --measure 实测替换并写出处与日期）。
 * 与 CAT_CROPS 的结构差别：猫娘以 x=60 对称（没有尾巴把重心拽到右边），full 的 anchor.x 回 60。
 */
export const GIRL_CROPS: Record<CropName, CatCrop> = {
  // 五档必须**彼此不同**（同一套参数会让 full 与 bust 落成同一张图，
  // `cat-sprite-manifest.test` 的「拿 full 的图去量 bust 会判红」专门抓这条）：
  // 覆盖度 full 0.34 ＜ round 0.55 ＜ bust 0.58 ＜ square 0.64，逐档收紧。
  full:   { window: [17, 4, 103, 116], anchor: [60, 60], pad: 0.08, mask: "none" },
  bust:   { window: [24, 10, 96, 96], anchor: [60, 52], pad: 0.06, mask: "none" },
  square: { window: [26, 4, 94, 80], anchor: [60, 40], pad: 0.06, mask: "none" },
  round:  { window: [22, 4, 98, 86], anchor: [60, 42], pad: 0.08, mask: "disc" },
  wide:   { window: [-23.7, 4, 143.7, 116], anchor: [60, 56], pad: 0.02, mask: "none" },
};

export function cropsForForm(form: PetForm): Record<CropName, CatCrop> {
  return form === "girl" ? GIRL_CROPS : CAT_CROPS;
}

export interface SpriteSpec {
  coat: CoatName;
  pose: PoseName;
  crop: CropName;
  /** 形态轴（v1.5.0 Task 24）：缺省 cat——146 张资产在 Task 25 才翻。 */
  form?: PetForm;
  /** 逐张覆盖：省略时回落 `CAT_POSES[pose]()` 的基态。 */
  mood?: Mood;
  blink?: number;
  pet?: number;
  energy?: number;
}

/**
 * 静帧不画「活猫的记号」。前三个是 R-D10 的文本层；`badge` 是 Task 24 全表实测后补的：
 * 同一枚状态徽章画在 (103,28)、半径 11，在五个取景里分别落成「全身刚好装下 / 半身切一半 /
 * 方图整个在画布外 / 圆图在盘沿刮出一道月牙」——同一样东西四种下场，静态情绪图里它又只是
 * 情绪的重复（姿态与脸已经说了同一句话）。要改这项，先看 `--check` 的覆盖度/质心全表。
 */
export const SPRITE_DROPPED_LAYERS: readonly PetLayer[] = ["zzz", "capsule", "unread", "badge"];

export function placeCrop(
  crop: CatCrop,
  size: { w: number; h: number },
  /** 形态决定「viewBox 的哪个点会被落在 center 上」：四足是 (60,70)，猫娘是脚线 (60,100)。 */
  form: PetForm = "cat",
): { u: number; center: { x: number; y: number } } {
  const [x0, y0, x1, y1] = crop.window;
  // xf.s 是「1 个 viewBox 单位 = 几个像素」；`buildCatOps` 里 s = u*2/VB，反解即 u = s*VB/2。
  const s = (1 - crop.pad) * Math.min(size.w / (x1 - x0), size.h / (y1 - y0));
  // 锚点换算的基准点必须等于该形态 `matRoot` 的**脚支点**：
  // 四足的 `buildCatOps` 是把 (60,70) 落在 center 上（历史值，见 art.ts），
  // 猫娘的 `buildGirlOps` 用的是 (60,100)——两者差 30 单位。用错基准整幅图会整体平移，
  // `full` 取景把猫娘顶出画布上缘（cat-variants.test「五档取景都装得下」抓的就是这条）。
  const baseY = form === "girl" ? 100 : 70;
  return {
    u: (s * VB) / 2,
    center: { x: size.w / 2 + (60 - crop.anchor[0]) * s, y: size.h / 2 + (baseY - crop.anchor[1]) * s },
  };
}

/** 位图管线唯一出口：取景 + 花色 + 姿态 → DrawOp[]，并按 R-D10 丢掉文字层。 */
export function buildSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  if ((spec.form ?? "cat") === "girl") return buildGirlSpriteOps(spec, size);
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

/**
 * 猫娘静帧：clip 的特征帧 → channels → buildGirlOps。
 * 与 cat 路径共用 placeCrop/丢弃表/落点口径；脸走 MOOD_TO_EXPRESSION 级联。
 */
function buildGirlSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  const p = GIRL_POSES[spec.pose]();
  const channels: Record<string, number> = {
    ...sampleClip(bodyClip(p.body), p.p ?? 0),
    ...(p.gesture ? sampleClip(gestureClip(p.gesture), p.gestureP ?? 0) : {}),
  };
  const input = {
    ...placeCrop(GIRL_CROPS[spec.crop], size, "girl"),
    form: "girl" as const,
    coat: coatOf(spec.coat),
    mood: spec.mood ?? "idle",
    t: 0, energy: spec.energy ?? p.energy, mouse: null,
    blink: spec.blink ?? p.blink, jumpY: 0, pet: spec.pet ?? 0, quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
    channels,
    expression: MOOD_TO_EXPRESSION[spec.mood ?? "idle"],
  };
  const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
  return buildGirlOps(input).filter((op) => op.layer === undefined || !dropped.has(op.layer));
}

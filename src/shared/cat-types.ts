/**
 * 桌宠的三种「名字」联合类型：情绪、姿态、取景。
 *
 * 住 shared 而不是 `renderer/pet/art.ts`（R-D13）：位图资产生成器（shared 侧的
 * `cat-sticker-set.ts`）与外观名册（`cat-roster.ts`）都要这些字符串，而 shared 只要
 * import 一次 `art.ts`，`tsconfig.main` 就会顺着 `art.ts → ops.ts` 把
 * `CanvasRenderingContext2D` 拉进 Node 侧的类型程序。这里只放字符串，无任何 import。
 */

export type Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep";

export type PoseName =
  | "sit" | "lie" | "prone" | "peek" | "stretch" | "wash"
  | "yawn" | "tilt" | "sleep" | "puff" | "pout" | "happy";

export type CropName = "full" | "bust" | "square" | "round" | "wide";

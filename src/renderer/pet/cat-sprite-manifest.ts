export { MIN_PIXEL_DIFF, pixelDiffRatio } from "../../shared/min-pixel-diff";
/**
 * 位图资产全表：129 条「画什么、画多大、用哪个取景与姿态」。
 *
 * 清单即数据——`scripts/build/cat-sprites.mjs` 只负责执行这里的 `SPRITE_TARGETS`，
 * 不许在脚本里再手抄一份（手抄必漏，漏了 `--check` 也只看已有文件）。
 *
 * 住在 renderer（R-D13）：它 import `buildSpriteOps`，而 `cat-variants → art.ts → ops.ts`
 * 带 DOM 类型；放进 shared 会把 `CanvasRenderingContext2D` 拉进 `tsconfig.main` 的程序。
 * `checkTarget` 本身只吃 `Raster`（shared 侧纯数据），故生成器不必进主进程也能被单测量。
 *
 * `import type` 会被 esbuild 整句擦除：`character-status-moods.ts` 里的 `import.meta.glob`
 * 只有 Vite 认，esbuild 遇到会炸——所以这里只借它的类型，不借它的模块。
 */
import { ASSISTANT_NICKNAME, CAT_ROSTER } from "../../shared/cat-roster";
import type { CoatName } from "../../shared/cat-coats";
import type { CropName, Mood, PoseName } from "../../shared/cat-types";
import { alphaCoverage, inkCentroid, renderOps, type Raster } from "../../shared/sprite-raster";
import { encodeIco, encodePng } from "../../shared/png-encode";
import { CAT_CROPS, CAT_POSES, buildSpriteOps } from "./cat-variants";
import type { CharacterStatusMood } from "../react/character-status-moods";

export { CAT_CROPS, buildSpriteOps, alphaCoverage, encodeIco, encodePng, inkCentroid, renderOps };
export type { Raster };
// 52 张表情包的表住在 shared（main 侧的目录测试也要读）；这里只做出口，
// 好让 `scripts/build/cat-sprites.mjs` 仍然只 import 一个 esbuild 入口。
export { CAT_STICKERS, STICKER_SIZE } from "../../shared/cat-sticker-set";

export interface SpriteTarget {
  /** 相对仓库根的写盘路径，也是构建门的比对键。 */
  out: string;
  size: number;
  /**
   * 只为 R-D1 表里唯一的横幅档存在（`cyrene-welcome.png` 1280×720，Task 25 落）；
   * 缺省时 `height = size`。别为了「统一」把它删掉，也不要把它推广到别的 target。
   */
  height?: number;
  crop: CropName;
  nickname: string;
  coat: CoatName;
  pose: PoseName;
  mood: Mood;
  blink?: number;
  pet?: number;
  energy?: number;
  /** R-D1：单文件 ≤60 KB（横幅 120）。默认值在 `checkTarget`。 */
  maxKb?: number;
}

export type MoodVariant = { mood: Mood; pose: PoseName; blink: number; pet: number; energy: number };

/**
 * 25 档散点情绪 → 变体。键是 `react/assets/status-moods/` 的文件名（**R-D2：一个都不能改**）。
 * 6 档 `CharacterStatusMood` 也复用同名行，委托面板与散点状态机因此共用同一批姿态语义。
 */
export const MOOD_TO_VARIANT: Readonly<Record<string, MoodVariant>> = {
  元气: { mood: "happy", pose: "happy", blink: 0, pet: 0.2, energy: 0.8 },
  原生: { mood: "idle", pose: "sit", blink: 0, pet: 0, energy: 0.4 },
  学习: { mood: "thinking", pose: "sit", blink: 0.15, pet: 0, energy: 0.55 },
  害羞: { mood: "happy", pose: "tilt", blink: 0.4, pet: 1.0, energy: 0.5 },
  工作中: { mood: "thinking", pose: "wash", blink: 0.1, pet: 0, energy: 0.7 },
  已中断: { mood: "grumpy", pose: "puff", blink: 0, pet: 0, energy: 0.1 },
  已处理: { mood: "happy", pose: "sit", blink: 0.2, pet: 0.3, energy: 0.5 },
  平静: { mood: "idle", pose: "lie", blink: 0.1, pet: 0, energy: 0.3 },
  开心: { mood: "happy", pose: "happy", blink: 0, pet: 0.6, energy: 0.7 },
  思考中: { mood: "thinking", pose: "tilt", blink: 0.25, pet: 0, energy: 0.5 },
  思考强度: { mood: "thinking", pose: "stretch", blink: 0, pet: 0, energy: 0.95 },
  感动: { mood: "happy", pose: "peek", blink: 0.5, pet: 1.0, energy: 0.6 },
  担心: { mood: "grumpy", pose: "pout", blink: 0.3, pet: 0, energy: 0.4 },
  提醒: { mood: "idle", pose: "peek", blink: 0, pet: 0, energy: 0.6 },
  撒娇: { mood: "happy", pose: "pout", blink: 0.35, pet: 1.0, energy: 0.6 },
  治愈: { mood: "happy", pose: "lie", blink: 0.5, pet: 0.4, energy: 0.45 },
  温柔: { mood: "idle", pose: "lie", blink: 0.6, pet: 0.2, energy: 0.35 },
  激动: { mood: "happy", pose: "stretch", blink: 0, pet: 0.5, energy: 0.9 },
  知性: { mood: "thinking", pose: "sit", blink: 0.05, pet: 0, energy: 0.5 },
  离线: { mood: "sleep", pose: "sleep", blink: 1, pet: 0, energy: 0.05 },
  聆听中: { mood: "idle", pose: "tilt", blink: 0.2, pet: 0, energy: 0.5 },
  // 趴是 25 档里唯一没被别的情绪用到的中性姿态；原先给 `sit`，与「原生」在 t=0 逐像素相同
  // （`energy` 只调动画幅度），`--check` 的「两张图不许一样」会当场点名。
  自定义: { mood: "idle", pose: "prone", blink: 0.3, pet: 0, energy: 0.5 },
  连接中: { mood: "thinking", pose: "peek", blink: 0.1, pet: 0, energy: 0.65 },
  陪伴中: { mood: "idle", pose: "lie", blink: 0.15, pet: 0.3, energy: 0.35 },
  难过: { mood: "grumpy", pose: "pout", blink: 0.45, pet: 0, energy: 0.2 },
};

const STATUS_MOODS_6: CharacterStatusMood[] = ["连接中", "思考中", "工作中", "提醒", "已处理", "已中断"];

/**
 * 6 档状态复用 25 档散点里同名行的 variant；缺一行就在建表时当场红，别让它静默退化成 `sit`。
 * 参数不写 `CharacterStatusMood`：`status-float` 那四档里的 `离线` 不在这 6 档里，但它在 25 档散点里。
 */
function variantFor(mood: string): MoodVariant {
  const v = MOOD_TO_VARIANT[mood];
  if (!v) throw new Error(`MOOD_TO_VARIANT 缺 ${mood}`);
  return v;
}

/** 立绘/头像/欢迎页没有「情绪文件名」可对，取该姿态的基态（`t = 0` 静帧，R-D9）。 */
function poseVariant(pose: PoseName): MoodVariant {
  const p = CAT_POSES[pose]();
  return { mood: p.mood, pose, blink: p.blink, pet: p.pet, energy: p.energy };
}

/** 4 张状态浮层直接复用同名散点档——它们本来就是同一句话的两种落点。 */
const STATUS_FLOAT_FILES = ["提醒", "离线", "聆听中", "陪伴中"] as const;

/** 欢迎页是「我」，不是名册：助手 `paper` 花色；四张对应四个入口「在做什么」。 */
const WELCOME_POSES: ReadonlyArray<[string, PoseName]> = [
  ["chat", "sit"],
  ["code", "stretch"],
  ["learn", "wash"],
  ["work", "happy"],
];

export const SPRITE_TARGETS: readonly SpriteTarget[] = [
  // 72：12 只 × 6 档委托面板状态图
  ...CAT_ROSTER.flatMap((cat) =>
    STATUS_MOODS_6.map((mood): SpriteTarget => ({
      out: `src/renderer/react/assets/characters/${cat.nickname}/status-moods/${mood}.png`,
      size: 256, crop: "square", nickname: cat.nickname, coat: cat.coat,
      ...variantFor(mood),
    })),
  ),
  // 25：聊天里的散点情绪图（R-D2：文件名冻结）
  ...Object.keys(MOOD_TO_VARIANT).map((file): SpriteTarget => ({
    out: `src/renderer/react/assets/status-moods/${file}.png`,
    size: 256, crop: "bust", nickname: ASSISTANT_NICKNAME, coat: "paper" as CoatName,
    ...MOOD_TO_VARIANT[file],
  })),
  // 12：任务卡立绘（界面上只占 34px，源图不给上游那 1280² 的白烧）
  ...CAT_ROSTER.map((cat): SpriteTarget => ({
    out: `src/renderer/tast/${cat.nickname}.png`,
    size: 256, crop: "full", nickname: cat.nickname, coat: cat.coat,
    ...poseVariant(cat.pose),
  })),
  // 12：方头像（`round` 取景自带 disc 遮罩）
  ...CAT_ROSTER.map((cat): SpriteTarget => ({
    out: `src/renderer/react/avatars/${cat.nickname}.png`,
    size: 256, crop: "round", nickname: cat.nickname, coat: cat.coat,
    ...poseVariant(cat.pose),
  })),
  // 4：聊天里的状态浮层
  ...STATUS_FLOAT_FILES.map((file): SpriteTarget => ({
    out: `src/renderer/react/assets/status-float/${file}.png`,
    size: 256, crop: "square", nickname: ASSISTANT_NICKNAME, coat: "paper" as CoatName,
    ...variantFor(file),
  })),
  // 4：欢迎页四入口（唯一的 512² 档）
  ...WELCOME_POSES.map(([file, pose]): SpriteTarget => ({
    out: `src/renderer/react/assets/welcome/${file}.png`,
    size: 512, crop: "full", nickname: ASSISTANT_NICKNAME, coat: "paper" as CoatName,
    ...poseVariant(pose),
  })),
];

type NonCharacterRow = {
  out: string;
  size: number;
  height?: number;
  crop: CropName;
  coat: CoatName;
  pose: PoseName;
  mood: Mood;
  maxKb?: number;
};

/**
 * 界面上的「我」：17 处非角色位图。全部画助手本猫，花色只是每处的性格底色
 * （`rose` 朋友圈 / `azure` 音乐 / `gray` 插件），不是名册里的某只猫。
 * `nickname` 因此统一填助手本名——它只做标注，不参与绘制。
 *
 * 图标两条（`icons/cyrene-pink|sun.png`）按 `ui-icon.ts` 的标签走墨猫/奶猫，
 * 与 `assets/icon-presets/` 下真正生效的装机图标同图：预视图和被应用的结果必须是同一只猫。
 */
const NON_CHARACTER_ROWS: readonly NonCharacterRow[] = [
  // 上下文用量环（显示框 52px）：normal ↔ warm ↔ alert ↔ compact 四档
  { out: "src/renderer/public/context-usage/normal.png", size: 256, crop: "bust", coat: "paper", pose: "sit", mood: "idle" },
  { out: "src/renderer/public/context-usage/warm.png", size: 256, crop: "bust", coat: "paper", pose: "tilt", mood: "thinking" },
  // 警告档用炸毛而不是红：红是 WARN 语义，本期不动
  { out: "src/renderer/public/context-usage/alert.png", size: 256, crop: "square", coat: "paper", pose: "puff", mood: "grumpy" },
  { out: "src/renderer/public/context-usage/compact.png", size: 256, crop: "square", coat: "paper", pose: "wash", mood: "thinking" },
  // 全表唯一非方图：WelcomeGate 首屏 `min(860px,100%) × 16/9`（R-D1）
  { out: "src/renderer/public/cyrene-welcome.png", size: 1280, height: 720, crop: "wide", coat: "paper", pose: "happy", mood: "happy", maxKb: 120 },
  // splash 直接按文件名 loadFile，不走 vite：这条坏了只能靠真起一次窗口发现
  { out: "src/renderer/public/loading.png", size: 320, crop: "bust", coat: "paper", pose: "peek", mood: "idle" },
  { out: "src/renderer/public/avatars/cyrene-avatar.png", size: 256, crop: "round", coat: "paper", pose: "sit", mood: "idle" },
  { out: "src/renderer/music/assets/logo.png", size: 256, crop: "round", coat: "azure", pose: "sit", mood: "idle" },
  { out: "src/renderer/music/assets/music2.png", size: 256, crop: "bust", coat: "azure", pose: "tilt", mood: "happy" },
  { out: "src/renderer/toast/assets/toast-avatar.png", size: 256, crop: "round", coat: "paper", pose: "peek", mood: "happy" },
  { out: "src/renderer/settings/100.png", size: 256, crop: "bust", coat: "paper", pose: "wash", mood: "idle" },
  { out: "src/renderer/react/assets/moments.png", size: 256, crop: "square", coat: "rose", pose: "peek", mood: "happy" },
  { out: "src/renderer/react/assets/new.png", size: 256, crop: "square", coat: "paper", pose: "stretch", mood: "happy" },
  { out: "src/renderer/react/assets/plugin.png", size: 256, crop: "square", coat: "gray", pose: "wash", mood: "thinking" },
  { out: "src/renderer/public/icons/cyrene-pink.png", size: 256, crop: "full", coat: "ink", pose: "sit", mood: "idle" },
  { out: "src/renderer/public/icons/cyrene-sun.png", size: 256, crop: "square", coat: "paper", pose: "happy", mood: "happy" },
  { out: "src/renderer/public/icons/sticker-picker.png", size: 256, crop: "square", coat: "paper", pose: "tilt", mood: "happy" },
];

export const NON_CHARACTER_TARGETS: readonly SpriteTarget[] = NON_CHARACTER_ROWS.map((row) => ({
  ...poseVariant(row.pose),
  ...row,
  nickname: ASSISTANT_NICKNAME,
}));

interface CropCriteria {
  /** 覆盖度区间。 */
  cov: readonly [number, number];
  /** 质心离画布中心的上限，按**宽度**归一（方图宽高相等，横幅不是）。 */
  off: number;
}

/**
 * 四个方形取景的带宽不是手感，是 Step 4 全表跑出来后量出来的（2026-10-22，129 条实测：
 * square 76 / bust 25 / full 16 / round 12），带比实测两端各放宽约 0.04–0.06、质心 3pp：
 *   square 覆盖 0.548–0.811、质心 ≤21.4%
 *   bust   覆盖 0.502–0.732、质心 ≤21.4%
 *   full   覆盖 0.282–0.430、质心 ≤13.2%
 *   round  覆盖 0.457–0.684、质心 ≤17.0%
 * 质心为什么不是统一的 12%：`square` / `bust` 是「脸填满画框」的肖像取景，墨的质量本来就在
 * 脸下方，拿整只猫居中的 12% 去量它必红——那是尺错，不是图错。带宽仍抓得住真正的失位：
 * 换错取景（拿 `full` 的图去量 `square` 档）覆盖度当场出界，单测里有这条正对照。
 */
const CROP_CRITERIA: Readonly<Record<CropName, CropCriteria>> = {
  square: { cov: [0.50, 0.86], off: 0.24 },
  bust: { cov: [0.46, 0.79], off: 0.24 },
  full: { cov: [0.24, 0.48], off: 0.16 },
  round: { cov: [0.41, 0.73], off: 0.20 },
  // 横幅档（1280×720）：两侧留白是构图（`wide` 的 window 故意越过 viewBox），带宽见下方
  // `height` 分支。Task 25 生成 `cyrene-welcome.png` 后按实测复核这一行。
  wide: { cov: [0.12, 0.45], off: 0.12 },
};

/**
 * 像素尺：返回违反的判据描述，空数组即通过。三条都是**现算**，不读磁盘——
 * 磁盘上的旧图与被检对象无关，量的是「这套参数能否产出合格的图」。
 */
export function checkTarget(r: Raster, t: SpriteTarget): string[] {
  const bad: string[] = [];
  const h = t.height ?? t.size;                              // wide 档唯一：1280×720，其余方形
  if (r.width !== t.size || r.height !== h) bad.push(`尺寸 ${r.width}×${r.height} ≠ ${t.size}×${h}`);
  // wide 只服务横幅：方形却声明 wide 说明清单写错了，先点名，别让更松的横幅带宽替它兜底。
  if (t.height === undefined && t.crop === "wide") bad.push("wide 取景只服务横幅档（缺 height）");
  const kb = encodePng(r.width, r.height, r.rgba).length / 1024;   // 现算，不读磁盘
  const budget = t.maxKb ?? 60;                              // R-D1：单文件 ≤60 KB（横幅 120）
  if (kb > budget) bad.push(`${kb.toFixed(1)} KB > 预算 ${budget} KB`);
  // 分支只看 `height` 是否存在（横幅带宽不按 crop 扩散），方形档按取景查表。
  const { cov: [covMin, covMax], off: maxOff } =
    t.height === undefined ? CROP_CRITERIA[t.crop] : CROP_CRITERIA.wide;
  const cov = alphaCoverage(r);
  if (cov < covMin || cov > covMax) bad.push(`覆盖度 ${cov.toFixed(3)} 出界 [${covMin},${covMax}]`);
  const c = inkCentroid(r);
  const off = Math.hypot(c.x - r.width / 2, c.y - r.height / 2) / r.width;
  if (off > maxOff) bad.push(`质心离中心 ${(off * 100).toFixed(1)}% > ${(maxOff * 100).toFixed(0)}%`);
  return bad;
}

/**
 * 色板：直译 native `palette.rs` 与 `ui.rs:17-39`、`panel.rs::theme`。
 *
 * 台账存在理由（`palette.rs:1-10` 原文，不移植就没人知道这条规矩）：
 * 这里**只放两个以上模块在同一件事上用**的颜色。native 原先各抄一份——`ui.rs`
 * 重声明过 `ACCENT/WARN/GREEN`、`main.rs` 的尘环写死过 `247,244,236`、`panel.rs`
 * 更是把 `rgba(0x5b,0x8d,0xef,N)` 手抄了 26 处。手抄的代价不是不好看，是
 * **改一处不会跟着改另外三处**，而 248px 的面板里一个跑掉的蓝看不出来。
 * 单侧专用的色原则上留在各自模块里。本期唯一的例外是文件末尾的 `PET_PRIVATE`
 * （胶囊的 CAP_ON/CAP_OFF、HUD、徽章墨白）：它们仍**不是板内色**，不收进 `CAT_PALETTE`，
 * 搬进来的唯一理由是让派生锁能按名字排除它们——见那里的注释与 `pet-tokens.test.ts` 的成员表。
 *
 * ⚠️ alpha 的两种量纲（native 自己就是两套，混用会把半透压成实心盘）：
 * - `withAlpha(hex, 0..1)` 对 `ui.rs:145 with_alpha(c, a: f32)`；
 * - `wash(fg, 0..255, bg)` 对 `panel.rs::theme::over`（u8 alpha）。
 * 两者越界或 NaN 一律抛错——静默 clamp 会让调用方把量纲写错读成「颜色本来就这样」。
 */
export type Color = string; // "#rrggbb"

/** 品牌蓝：主按钮、选中态、上行曲线、猫「思考」时的状态点。 */
export const ACCENT = "#5b8def"; // palette.rs: from_rgb(0x5b,0x8d,0xef)
/** 成功绿：正常态、下行、猫「开心」的状态点、「已切换」徽章。 */
export const GREEN = "#4fb477"; // palette.rs: from_rgb(0x4f,0xb4,0x77)
/** 警告橙：断连、到期、超预算的读数、猫「闹脾气」的状态点。 */
export const WARN = "#d97757"; // palette.rs: from_rgb(0xd9,0x77,0x57)
/** 奶油纸色：猫身体的底色，也是起跳尘环那圈的颜色——尘环本来就是「猫自己扬起的灰」，用它自己的色才读得出是同一只猫。 */
export const PAPER = "#f7f4ec"; // palette.rs: from_rgb(0xf7,0xf4,0xec)

export const INK = "#2b2f3a"; // ui.rs:17 from_rgb(0x2b,0x2f,0x3a)
export const INK_SOFT = "#4a5162"; // ui.rs:18
/** 腮红专用亮玫瑰。⚠️ 不能沿用旧的中等粉 `BLUSH`：它要在**墨色**身体上叠出粉色，半透明的中粉压深灰只会得到脏褐色（看着像淤青，不像害羞）。 */
export const ROSE = "#f27d92"; // ui.rs:21
/** 内耳 / 鼻头（压在奶油色上，需要比腮红更沉才跳得出来）。 */
export const ROSE_DEEP = "#dd6a7f"; // ui.rs:23
/** 奶油色的阴影端：围兜与前爪的下缘，给团子一点厚度。 */
export const PAPER_SHADE = "#d8d1c2"; // ui.rs:25
/** 瞳孔色（比身体更黑，小尺寸下眼睛是第一视觉焦点，必须压得住）。 */
export const EYE = "#14171f"; // ui.rs:27
/**
 * 断连态身体色。⚠️ 只能「比墨色浅一档」，不能浅到发白：
 * 旧版 0x9a9aad 下奶油围兜和白手套全被同化，脸部轮廓整块糊掉，
 * 看着像换了只猫而不是「没精神」。
 */
export const BREAK_FILL = "#5c6472"; // ui.rs:32
export const BREAK_SOFT = "#777f8d"; // ui.rs:33
/** 断连态内耳（褪色的玫瑰灰，保住耳朵的形状不糊成一片）。 */
export const BREAK_EAR = "#9c8a92"; // ui.rs:35
/** 投影色——只准按差分量叠（美术契约「投影只能差分量」），见 `wash`/`withAlpha` 的用量。 */
export const SHADOW = "#000000"; // ui.rs:36

/**
 * ⚠️ 面板表面三色 = native `panel.rs::theme` 的预混结果，**不是 fork 侧的契约**。
 * `palette.rs:8-10` 明写：「它们过了本机 GL/DWM 管线的预混（见 `theme::over`），
 * 搬到面板外面就没有意义」。spec §6.2 点这条名要求按 fork 实际管线（Chromium 合成）
 * 重推导，§9-6 要求 P1（猫身 + 透明 canvas）与 P2（面板）各实测一次并把结论落进
 * token 单测——**P1 这一半还没做**（P1 不画面板，也没有真上屏的解释器），
 * 现在钉的数值只证明「与 native 逐字节相等」，不证明「在 Chromium 上就长这样」。
 * 所以下面三个派生值仅供 P2 起点参考，重测前不得当验收判据。
 */
export const BG_SOLID = "#101420"; // panel.rs::theme BG_SOLID = rgb(16,20,32)
export const FG = "#e8e6df";
export const DIM = "#9a9daa";
export const ACCENT_DEEP = "#4a7fe0";
export const ACCENT_FG = "#8ab4ff";
export const ACCENT_HOVER = "#6f9bff";
export const TODAY_BAR = "#b2caff";
export const GREEN_FG = "#7fd6a2";
export const WARN_FG = "#f0c4b4";

/** `panel.rs:69-71`：CARD = wash(WHITE,13,BG_SOLID)、CARD_STROKE = wash(WHITE,18,CARD)、SEP = wash(WHITE,11,BG_SOLID)。 */
export const PANEL_CARD = () => wash("#ffffff", 13, BG_SOLID);
export const PANEL_CARD_STROKE = () => wash("#ffffff", 18, PANEL_CARD());
export const PANEL_SEP = () => wash("#ffffff", 11, BG_SOLID);

export function hex(color: Color | { r: number; g: number; b: number }): string {
  const c = typeof color === "string" ? parse(color) : color;
  for (const v of [c.r, c.g, c.b]) {
    if (!Number.isFinite(v) || v < 0 || v > 255) throw new RangeError(`hex 通道越界：${v}`);
  }
  const p = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

const HEX6 = /^#?[0-9a-fA-F]{6}$/;

export function parse(color: Color): { r: number; g: number; b: number } {
  if (!HEX6.test(color)) throw new RangeError(`色值必须是 #rrggbb，收到：${color}`);
  const body = color.replace("#", "");
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** sRGB 空间把 `fg` 按 **0..255** alpha 叠到 `bg` 上，返回不透明色（等价 native `theme::over`）。 */
export function wash(fg: Color, alpha: number, bg: Color): Color {
  const f = parse(fg);
  const b = parse(bg);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 255) {
    throw new RangeError(`wash 的 alpha 是 0..255（panel.rs 口径），收到：${alpha}`);
  }
  const t = alpha / 255;
  const m = (a: number, c: number) => Math.round(a * t + c * (1 - t));
  return hex({ r: m(f.r, b.r), g: m(f.g, b.g), b: m(f.b, b.b) });
}

/** 半透明叠加（对 native `ui.rs:145 with_alpha`，alpha 是 **0..1**）。 */
export function withAlpha(color: Color, alpha: number): string {
  const { r, g, b } = parse(color);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError(`withAlpha 的 alpha 是 0..1（ui.rs 口径）；要 0..255 请用 wash。收到：${alpha}`);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 板内色名单：全客户端配色（`palette-from-cat.ts`）唯一的合法输入域。
 * `PANEL_*` 三个是**函数**（要在具体底上预混才成形），名单里按函数放进去，
 * 由派生器显式调用；成员表断言用 `typeof` 跳过它们，不让函数被当颜色拼进 CSS。
 */
export const CAT_PALETTE: Record<string, Color | (() => Color)> = {
  ACCENT, ACCENT_DEEP, ACCENT_FG, ACCENT_HOVER,
  GREEN, GREEN_FG, WARN, WARN_FG,
  PAPER, PAPER_SHADE, INK, INK_SOFT, EYE,
  ROSE, ROSE_DEEP,
  BREAK_FILL, BREAK_SOFT, BREAK_EAR,
  BG_SOLID, FG, DIM, TODAY_BAR, SHADOW,
  PANEL_CARD: PANEL_CARD as () => Color,
  PANEL_SEP: PANEL_SEP as () => Color,
  PANEL_STROKE: PANEL_CARD_STROKE as () => Color,
};

/**
 * 单侧专用色（本期从 `art.ts` 收编，仍**不进板**）。
 * 台账原文的理由成立：它们只在流量胶囊/徽章这一件事上出现。收进来的唯一理由是
 * 派生锁需要能按名字排除它们——否则「没抄进板」与「不该进板」在测试里不可区分。
 * 新增者请一并更新 `pet-tokens.test.ts` 的字面量断言。
 */
export const PET_PRIVATE = {
  HUD_BOX: "#1a1d26", // main.rs:2988 气泡盒与胶囊共用的墨底
  HUD_INK: "#e8eaf0", // rgb(232,234,240) 读数墨白
  HUD_UP: "#7dcda0", // rgb(125,205,160) 上行绿
  CAP_BORDER_ON: "#3a404e",
  CAP_DOWN_ON: "#87afeb",
  CAP_BOX_OFF: "#14161d",
  CAP_BORDER_OFF: "#2c303c",
  CAP_INK_OFF: "#969caa",
  CAP_UP_OFF: "#5c9474",
  CAP_DOWN_OFF: "#6480a8",
  BADGE_INK: "#ffffff", // ui.rs:1205 Color32::WHITE
} as const;

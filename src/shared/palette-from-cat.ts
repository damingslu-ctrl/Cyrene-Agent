/**
 * 全客户端配色的派生器：从猫色板（`pet-tokens.ts`）算出 104 个带颜色的
 * `--rb-*` / `--md-*` 声明值。CSS 文件只是这份表的**落盘形式**，不是第二份真相。
 *
 * 三条规矩都是从 native 那边学来的：
 * 1. **不发明新色**。每个输出值要么是板上一个色，要么是 `wash(板A, α, 板B)` 的预混结果，
 *    要么是由这两者拼出的 rgba / gradient。
 * 2. **透明度只有 `withAlpha` 一条路**。native 美术契约「投影只能差分量」「面板底必须不透明」
 *    靠的就是「半透明只能由 wash/withAlpha 产生」；手写 rgba 会绕过它。
 * 3. **变量名不动**（spec §1 M3）。这里的键是**现有 CSS 里已经存在**的令牌名，一个不多一个不少。
 *    `--rb-pink-*` 仍然叫 pink，值却是猫蓝——这条命名债写在 `tokens.css` 文件头注释里：
 *    改名要打爆上千处引用与 25-token 契约，本期明确不做。
 */
import {
  ACCENT, ACCENT_DEEP, ACCENT_FG, ACCENT_HOVER, BG_SOLID, DIM, FG, GREEN, GREEN_FG,
  INK, INK_SOFT, PAPER, PAPER_SHADE, PANEL_CARD, PANEL_CARD_STROKE, PANEL_SEP,
  ROSE, ROSE_DEEP, SHADOW, WARN, WARN_FG, wash, withAlpha, type Color,
} from "./pet-tokens";

export type ThemeScheme = "light" | "dark";
export type TokenMap = Record<string, string>;

/**
 * 与 `pet-tokens.ts:69` 的 `wash("#ffffff", 13, BG_SOLID)` 同一原料：native 把 WHITE 当
 * **预混的原料**而不是**屏幕上的成品色**（`palette.rs` 台账明写 WHITE 不入板）。
 * 这里沿用同一口径，所以它不出现在 `CAT_PALETTE` 里，只出现在 wash 的 fg 位。
 */
const WHITE = "#ffffff";

/** 浅色：往奶油纸上压一层板内色。α 用 native `theme::over` 的 0..255 量纲。 */
const onPaper = (fg: Color, a: number, base: Color = WHITE): string => wash(fg, a, base);
/** 深色：往墨底上抬一层板内色。 */
const onInk = (fg: Color, a: number, base: Color = BG_SOLID): string => wash(fg, a, base);

function build(scheme: ThemeScheme): TokenMap {
  const light = scheme === "light";
  // —— 表面 ——
  const page = light ? onPaper(PAPER_SHADE, 72, PAPER) : BG_SOLID;
  const workspace = light ? onPaper(PAPER, 190, WHITE) : BG_SOLID;
  const elevated = light ? WHITE : PANEL_CARD();
  const hover = light ? onPaper(ACCENT, 20, WHITE) : onInk(FG, 16);
  const active = light ? onPaper(ACCENT, 38, WHITE) : onInk(FG, 26);
  // —— 强调标度（名字仍叫 pink）——
  const accent = light ? ACCENT : ACCENT_FG;
  const accentHover = light ? ACCENT_DEEP : ACCENT_HOVER;
  // —— 文字 ——
  const strong = light ? INK : FG;
  const secondary = light ? onPaper(INK_SOFT, 190, WHITE) : DIM;
  const disabled = light ? onPaper(INK_SOFT, 132, WHITE) : onInk(DIM, 150);
  const onAccent = light ? WHITE : BG_SOLID;
  // —— 描边 ——
  const bStrong = light ? PAPER_SHADE : onInk(FG, 60);
  const bSoft = light ? onPaper(PAPER_SHADE, 150, WHITE) : PANEL_CARD_STROKE();
  const bFaint = light ? onPaper(PAPER_SHADE, 80, WHITE) : PANEL_SEP();
  return {
    // 表面：bg-* 是历史标度，surface-* 才是消费面（实测 --rb-surface-elevated 被引用 157 次）。
    "--rb-bg-0": page,
    "--rb-bg-1": workspace,
    "--rb-bg-2": hover,
    "--rb-bg-3": active,
    "--rb-bg-elevated": elevated,
    "--rb-surface-page": page,
    "--rb-surface-workspace": workspace,
    "--rb-surface-elevated": elevated,
    "--rb-surface-hover": hover,
    "--rb-surface-active": active,
    // soft 在两档里指向不同的既有底：浅色档它是 hover 的别名（现状就是 var），
    // 深色档 `charcoal-pink.css:9` 把它写成 #252525 = 浮起底。同源赋值，不新增发明。
    "--rb-surface-soft": light ? hover : elevated,
    // 文字：strong/default/primary 同墨，muted/secondary 同值，faint/disabled 同值，
    // on-pink/on-accent 同值。这是现状里就存在的重复角色，M3 不许合并，只能**同源赋值**。
    "--rb-text-strong": strong,
    "--rb-text-default": strong,
    "--rb-text-primary": strong,
    "--rb-text-muted": secondary,
    "--rb-text-secondary": secondary,
    "--rb-text-faint": disabled,
    "--rb-text-disabled": disabled,
    "--rb-text-on-pink": onAccent,
    "--rb-text-on-accent": onAccent,
    // 强调标度
    "--rb-pink-50": light ? onPaper(ACCENT, 16, WHITE) : onInk(ACCENT_FG, 34),
    "--rb-pink-100": light ? onPaper(ACCENT, 40, WHITE) : onInk(ACCENT_FG, 52),
    "--rb-pink-200": light ? onPaper(ACCENT, 82, WHITE) : onInk(ACCENT_FG, 82),
    "--rb-pink-300": light ? onPaper(ACCENT, 130, WHITE) : onInk(ACCENT_FG, 122),
    "--rb-pink-400": light ? onPaper(ACCENT, 190, WHITE) : ACCENT_FG,
    "--rb-pink-500": accent,
    "--rb-pink-600": accentHover,
    "--rb-pink-700": light ? wash(ACCENT_DEEP, 205, INK) : onInk(ACCENT_FG, 190),
    "--rb-pink-glow": ACCENT_FG,
    "--rb-accent": accent,
    "--rb-accent-hover": accentHover,
    // 副强调：旧紫族是从上游品牌渐变的端点抄来的，板上没有紫，换成猫的腮红族。
    "--rb-violet-400": ROSE,
    "--rb-violet-500": ROSE_DEEP,
    "--rb-violet-600": light ? wash(ROSE_DEEP, 205, INK) : onInk(ROSE, 190),
    // 青族：板上没有青，整族并入猫蓝（实测 --rb-cyan-400 全仓只剩 1 处消费者，--rb-cyan-500 为 0）。
    "--rb-cyan-400": ACCENT_FG,
    "--rb-cyan-500": ACCENT,
    // 语义四色：板上 GREEN=成功、WARN=警告、ROSE_DEEP=危险（猫的红是胭脂红，不是警报红）、
    // ACCENT=信息。深色档一律抬到板上的 *_FG 亮端，压不住深底就等于没画。
    "--rb-danger": light ? ROSE_DEEP : ROSE,
    "--rb-success": light ? GREEN : GREEN_FG,
    "--rb-warning": light ? WARN : WARN_FG,
    "--rb-info": accent,
    // 描边
    "--rb-border-faint": bFaint,
    "--rb-border-soft": bSoft,
    "--rb-border-strong": bStrong,
    "--rb-border-grid": light ? onPaper(ACCENT, 22, WHITE) : onInk(ACCENT_FG, 24),
    "--rb-border-default": bSoft,
    "--rb-border-subtle": bFaint,
    "--rb-border-elevated": bStrong,
    "--rb-border-focus": accent,
    // 组件原语（名字里带 light 的是历史命名，深色档同样要有值）
    "--rb-card-bg": elevated,
    "--rb-divider-light": light ? withAlpha(INK, 0.08) : withAlpha(FG, 0.10),
    "--rb-hover-light": light ? withAlpha(INK, 0.04) : withAlpha(FG, 0.06),
    "--rb-active-light": light ? withAlpha(INK, 0.08) : withAlpha(FG, 0.12),
    "--rb-input-bg": light ? WHITE : withAlpha(FG, 0.06),
    "--rb-input-border": light ? PAPER_SHADE : bStrong,
    "--rb-input-text": strong,
    "--rb-input-placeholder": light ? onPaper(INK_SOFT, 140, WHITE) : onInk(DIM, 180),
    "--rb-slider-track": light ? withAlpha(INK, 0.18) : withAlpha(FG, 0.18),
    "--rb-slider-fill": accent,
    "--rb-slider-thumb": light ? WHITE : FG,
    "--rb-toggle-off": light ? bSoft : withAlpha(FG, 0.18),
    "--rb-toggle-on": accent,
    "--rb-scroll-thumb": light ? withAlpha(INK_SOFT, 0.28) : withAlpha(FG, 0.20),
    "--rb-scroll-thumb-hover": light ? withAlpha(INK_SOFT, 0.44) : withAlpha(FG, 0.32),
    // 光晕 / 阴影：只能差分量（美术契约），所以一律 withAlpha(SHADOW/INK/FG)，不用彩色阴影。
    "--rb-glow-pink": `0 0 20px ${withAlpha(accent, light ? 0.26 : 0.34)}`,
    "--rb-glow-soft": `0 0 12px ${light ? withAlpha(INK, 0.10) : withAlpha(FG, 0.08)}`,
    "--rb-glow-violet": `0 0 24px ${withAlpha(ROSE, light ? 0.16 : 0.24)}`,
    "--rb-glow-secondary": `0 0 18px ${withAlpha(ROSE_DEEP, light ? 0.14 : 0.22)}`,
    "--rb-shadow-card": light
      ? `0 4px 16px ${withAlpha(INK, 0.10)}, 0 1px 2px ${withAlpha(INK, 0.06)}`
      : `0 4px 16px ${withAlpha(SHADOW, 0.35)}, 0 1px 2px ${withAlpha(SHADOW, 0.25)}`,
    "--rb-shadow-elevated": light
      ? `0 12px 40px ${withAlpha(INK, 0.14)}, 0 0 0 1px ${withAlpha(ACCENT, 0.10)}`
      : `0 12px 40px ${withAlpha(SHADOW, 0.55)}, 0 0 0 1px ${withAlpha(ACCENT_FG, 0.10)}`,
    "--rb-shadow-pink": `0 8px 32px ${withAlpha(accent, light ? 0.22 : 0.34)}`,
    "--rb-shadow-workspace": light
      ? `inset 0 2px 8px ${withAlpha(INK, 0.04)}, inset 0 0 2px ${withAlpha(INK, 0.03)}`
      : `0 4px 16px ${withAlpha(SHADOW, 0.35)}, 0 1px 2px ${withAlpha(SHADOW, 0.25)}`,
    "--rb-shadow-bubble-neutral": light
      ? `2px 2px 3px ${withAlpha(INK, 0.06)}, 3px 5px 16px ${withAlpha(INK, 0.06)}`
      : `0 2px 10px ${withAlpha(SHADOW, 0.45)}, 0 0 0 1px ${withAlpha(FG, 0.06)}`,
    "--rb-shadow-bubble-accent":
      `2px 2px 4px ${withAlpha(accent, light ? 0.12 : 0.20)}, ` +
      `3px 7px 16px ${withAlpha(accent, light ? 0.16 : 0.24)}`,
    "--rb-shadow-control-hover": light
      ? `2px 2px 5px ${withAlpha(INK, 0.08)}, 3px 8px 18px ${withAlpha(INK, 0.06)}`
      : `0 12px 40px ${withAlpha(SHADOW, 0.55)}, 0 0 0 1px ${withAlpha(ACCENT_FG, 0.10)}`,
    "--rb-shadow-control-focus":
      `0 0 0 3px ${withAlpha(accent, light ? 0.12 : 0.20)}, ` +
      `2px 6px 16px ${withAlpha(light ? INK : SHADOW, 0.08)}`,
    "--rb-task-card-accent-ring": withAlpha(accent, 0.10),
    // 渐变：端点全在板内，色相不越过「蓝」与「胭脂红」这两族
    "--rb-grad-pink": `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DEEP} 100%)`,
    "--rb-grad-pink-hot": `linear-gradient(135deg, ${ACCENT_FG} 0%, ${ACCENT} 50%, ${ACCENT_DEEP} 100%)`,
    "--rb-grad-bg": light
      ? `radial-gradient(ellipse at top, ${onPaper(ACCENT, 26, PAPER)} 0%, ${PAPER} 60%)`
      : `radial-gradient(ellipse at top, ${onInk(ACCENT_FG, 20)} 0%, ${BG_SOLID} 60%)`,
    // 代码块 / diff：三色从 success/danger/info 推，不抄 GitHub 的现成绿红
    "--rb-code-bg": light ? onPaper(INK, 8, WHITE) : elevated,
    "--rb-diff-bg": light ? onPaper(INK, 4, WHITE) : BG_SOLID,
    "--rb-diff-add-bg": light ? onPaper(GREEN, 30, WHITE) : onInk(GREEN, 44),
    "--rb-diff-add-text": light ? wash(GREEN, 215, INK) : GREEN_FG,
    "--rb-diff-remove-bg": light ? onPaper(ROSE_DEEP, 30, WHITE) : onInk(ROSE_DEEP, 48),
    "--rb-diff-remove-text": light ? wash(ROSE_DEEP, 215, INK) : ROSE,
    "--rb-diff-info-bg": light ? onPaper(ACCENT, 30, WHITE) : onInk(ACCENT, 48),
    "--rb-diff-info-text": light ? wash(ACCENT, 215, INK) : ACCENT_FG,
    // Markdown 渲染变量：只列现在带字面量的；`var()` 形式的跟随上面的角色令牌。
    "--md-code-bg": light ? onPaper(INK, 8, WHITE) : withAlpha(FG, 0.05),
    "--md-code-border": bSoft,
    "--md-inline-code-bg": light ? onPaper(INK, 14, WHITE) : withAlpha(FG, 0.08),
    "--md-inline-code-text": strong,
    "--md-quote-bg": light ? onPaper(ACCENT, 12, WHITE) : withAlpha(ACCENT_FG, 0.06),
    "--md-table-border": bSoft,
    "--md-copy-bg": light ? onPaper(INK, 10, WHITE) : withAlpha(FG, 0.06),
    // 浮层反馈（toast / 弹窗）：两档都是墨底浮层，浅色档用 INK、深色档用抬一格的墨。
    "--rb-feedback-surface": light ? INK : onInk(FG, 14),
    "--rb-feedback-fg": light ? PAPER : FG,
    "--rb-feedback-muted": light ? wash(DIM, 210, INK) : DIM,
    "--rb-feedback-border": light ? withAlpha(ACCENT_FG, 0.28) : withAlpha(FG, 0.14),
    "--rb-feedback-details-bg": withAlpha(FG, 0.06),
    "--rb-feedback-shadow": `0 28px 70px ${withAlpha(SHADOW, light ? 0.28 : 0.38)}`,
    "--rb-feedback-danger": ROSE,
    "--rb-feedback-success": GREEN_FG,
    "--rb-feedback-warning": WARN_FG,
    "--rb-feedback-info": ACCENT_FG,
  };
}

export const LIGHT_TOKENS: TokenMap = build("light");
export const DARK_TOKENS: TokenMap = build("dark");
export const TOKENS_BY_SCHEME: Record<ThemeScheme, TokenMap> = { light: LIGHT_TOKENS, dark: DARK_TOKENS };

/**
 * 主进程给原生窗用的底色。CSS 变量在 `new BrowserWindow()` 那一刻还不存在（渲染进程还没起来），
 * 只能传字符串——这就是色板必须住在 `src/shared/` 的理由（见 Task 17）。
 */
export const WINDOW_BACKGROUNDS: Record<"pearl-white" | "charcoal-pink", string> = {
  "pearl-white": LIGHT_TOKENS["--rb-surface-page"],
  "charcoal-pink": DARK_TOKENS["--rb-surface-page"],
};

/** 按令牌名取值；不在表里就抛——静默返回 undefined 会把「忘了派生」读成「这令牌没颜色」。 */
export function derivedValue(scheme: ThemeScheme, token: string): string {
  const value = TOKENS_BY_SCHEME[scheme][token];
  if (value === undefined) throw new Error(`令牌 ${token} 未派生（scheme=${scheme}）`);
  return value;
}

function channels(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new RangeError(`contrastRatio 只接受 #rrggbb，收到 ${color}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** WCAG 2.1 相对亮度比。派生器用它自检「文字压在这块底上还剩不剩可读性」。 */
export function contrastRatio(fg: string, bg: string): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(channels(fg)), lum(channels(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

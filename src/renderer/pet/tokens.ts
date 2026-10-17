/**
 * 色板：直译 native `palette.rs` 与 `ui.rs:17-39`、`panel.rs::theme`。
 *
 * ⚠️ 关于预混：native 侧 `wash/over` 存在的理由是「本机 GL/DWM 管线会把 alpha 再过一遍
 * sRGB，半透填充实测亮 4-7 倍」。Chromium 的合成路径不是那条管线，所以这里的
 * `wash` 结果必须在 fork 侧重新实测一次再钉进单测（spec §9-6）：
 * 若 Chromium 的半透叠加与设计一致，正文可以直接用 rgba 而不必预混——
 * 但 token 单测必须锁定「面板底不透明」这一条（native 的 #19/#20 教训与桌布漂移）。
 * 在此之前，一律走 `wash` 预混，行为与 native 对齐。
 */
export type Color = string; // "#rrggbb"

export const ACCENT = "#5b8def";
export const GREEN = "#4fb477";
export const WARN = "#d97757";
export const PAPER = "#f7f4ec";

export const INK = "#2b2f3a";
export const INK_SOFT = "#4a5162";
export const ROSE = "#f27d92";
export const ROSE_DEEP = "#dd6a7f";
export const PAPER_SHADE = "#d8d1c2";
export const EYE = "#14171f";
export const BREAK_FILL = "#5c6472";
export const BREAK_SOFT = "#777f8d";
export const BREAK_EAR = "#9c8a92";
export const SHADOW = "#000000";

export const BG_SOLID = "#101420";
export const FG = "#e8e6df";
export const DIM = "#9a9daa";
export const ACCENT_DEEP = "#4a7fe0";
export const ACCENT_FG = "#8ab4ff";
export const ACCENT_HOVER = "#6f9bff";
export const TODAY_BAR = "#b2caff";
export const GREEN_FG = "#7fd6a2";
export const WARN_FG = "#f0c4b4";

export function hex(color: Color | { r: number; g: number; b: number }): string {
  const c = typeof color === "string" ? parse(color) : color;
  const p = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

export function parse(color: Color): { r: number; g: number; b: number } {
  const body = color.replace("#", "");
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** sRGB 空间把 `fg` 按 alpha 叠到 `bg` 上，返回不透明色（等价 native `theme::over`）。 */
export function wash(fg: Color, alpha: number, bg: Color): Color {
  const f = parse(fg);
  const b = parse(bg);
  const t = Math.max(0, Math.min(255, alpha)) / 255;
  const m = (a: number, c: number) => Math.round(a * t + c * (1 - t));
  return hex({ r: m(f.r, b.r), g: m(f.g, b.g), b: m(f.b, b.b) });
}

export function withAlpha(color: Color, alpha: number): string {
  const { r, g, b } = parse(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(255, alpha)) / 255})`;
}

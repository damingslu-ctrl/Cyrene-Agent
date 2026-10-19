/**
 * The three fixed lines shown inside the banner frame.
 * The title/tagline are brand-driven (src/shared/brand.ts); the quote stays
 * a fixed line, not the version.
 */
import { PRODUCT_NAME, PRODUCT_NAME_ZH } from "../../shared/brand";

export const BANNER_TITLE = `${PRODUCT_NAME}（${PRODUCT_NAME_ZH}）`;
export const BANNER_TAGLINE = "本机构建 · 不联网检查升级";

export const BANNER_LINES = [
  `♡ ${BANNER_TITLE} ♡`,
  BANNER_TAGLINE,
  '"Every memory has a place."',
] as const;

export const ABOUT_LINES = [
  "Build:    local · no online update checks",
  "License:  MIT (see MODEL_LICENSE.md for model terms)",
] as const;

/** Default framed-box width when the terminal width is unknown or too narrow. */
export const DEFAULT_BANNER_WIDTH = 64;
/** Minimum framed-box width. Below this, the box would not fit the quote. */
export const MIN_BANNER_WIDTH = 60;

export interface RenderOptions {
  /**
   * Reserved for v1.x. v0.9 always uses BANNER_LINES[2].
   * Not read; kept on the type so callers do not need to change later.
   */
  quote?: string;
  /** Override the auto-detected width (mainly for tests). */
  width?: number;
}

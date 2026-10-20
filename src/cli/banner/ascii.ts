/**
 * ANSI Shadow rendering of "MOCHI". Six lines, monospace-only.
 * Committed verbatim so the banner is byte-for-byte deterministic across releases.
 *
 * 每行 39 个字符（M=11、O=9、C=8、H=8、I=3），列宽必须一致，否则终端里会错位。
 * `src/shared/banner.ts` 里另有一份同形 logo（历史重复，改名前先存在），本次只同步
 * 字形与符号名，不合并两处实现。
 */
export const MOCHI_LOGO = [
  "███╗   ███╗ ██████╗ ██████╗ ██╗  ██╗██╗",
  "████╗ ████║██╔═══██╗██╔════╝██║  ██║██║",
  "██╔████╔██║██║   ██║██║     ███████║██║",
  "██║╚██╔╝██║██║   ██║██║     ██╔══██║██║",
  "██║ ╚═╝ ██║╚██████╔╝╚██████╗██║  ██║██║",
  "╚═╝     ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝",
] as const;

export const MOCHI_LOGO_TEXT = MOCHI_LOGO.join("\n");

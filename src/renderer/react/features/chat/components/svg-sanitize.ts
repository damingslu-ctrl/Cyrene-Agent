/**
 * SVG 消毒与熔断 —— 模型输出的 SVG（Mermaid 引擎产物 / 手写 svg 围栏）注入前的统一安全层。
 *
 * 四层防护：
 * 1. 长度熔断：源码超过上限直接降级，不进同步渲染（防 UI 线程卡死）
 * 2. 样式外呼剥离：删掉 `<style>` 里所有 `@import`，并清掉指向上游站点的 `url()`
 * 3. DOMPurify 消毒：剥 script / 事件属性 / javascript: 协议 / foreignObject 逃逸
 * 4. 调用方兜底：消毒后仍为空则按渲染失败降级
 *
 * 第 2 层必须剥「全部 @import」而不是只剥字体域名：DOMPurify 不解析 CSS，
 * 一条 `@import url(https://任意宿主/x.css)` 能原样穿过消毒，然后在渲染进程里发网络请求。
 * CSS 注释与转义都不能当护身符：`@import` 中间夹注释、或把字母写成十六进制转义，
 * 在浏览器里都是合法的；所以匹配前先把注释换成空格、把转义解回本字。
 */

import DOMPurify from "dompurify";
import { isUpstreamUrl } from "../../../../../shared/upstream-hosts";

/** 源码长度熔断阈值（字符数）：千节点级流程图源码约 23KB / 渲染 265ms，再大就该降级 */
export const SVG_SOURCE_LIMIT = 20000;

/** 手写 SVG 围栏的熔断阈值：每个节点都是显式标签，比 Mermaid 源码更冗长，放宽到 3 倍 */
export const HANDWRITTEN_SVG_SOURCE_LIMIT = 60000;

const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const STYLE_ATTR_RE = /((?<![\w-])style\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CSS_ESCAPE_RE = /\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*(?:"[^"<]*"|'[^'<]*'|[^)<]*)\s*\)|"[^"<]*"|'[^'<]*')[^;<}]*;?/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/** 判断源码是否超过熔断阈值 */
export function isOverSourceLimit(source: string): boolean {
  return source.length > SVG_SOURCE_LIMIT;
}

/** 判断手写 SVG 是否超过熔断阈值 */
export function isOverHandwrittenSvgLimit(source: string): boolean {
  return source.length > HANDWRITTEN_SVG_SOURCE_LIMIT;
}

/** CSS 转义解回本字（`\68 ttps` → `https`）；解不出来的按替换字符处理。 */
function decodeCssEscapes(css: string): string {
  return css.replace(CSS_ESCAPE_RE, (_match, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      if (code === 0 || code > 0x10ffff) return "\uFFFD";
      return String.fromCodePoint(code);
    }
    if (ch === "\n") return "";
    return ch ?? "";
  });
}

/** 注释在 CSS 里是分隔符（换成空格）；转义先解开，后面的规则才看得见真身。 */
function normalizeCss(css: string): string {
  return decodeCssEscapes(css.replace(CSS_COMMENT_RE, " "));
}

/** 只改 style 块与 style 属性里的文本，不碰 SVG 正文/文本节点。 */
function mapCssText(svg: string, transform: (css: string) => string): string {
  return svg
    .replace(
      STYLE_BLOCK_RE,
      (_match, open: string, css: string, close: string) => open + transform(css) + close,
    )
    .replace(
      STYLE_ATTR_RE,
      (
        _match,
        prefix: string,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
      ) => {
        const quote = doubleQuoted !== undefined ? '"' : "'";
        const raw = doubleQuoted ?? singleQuoted ?? "";
        return prefix + quote + transform(raw) + quote;
      },
    );
}

function stripImportsFromCss(css: string): string {
  return css.replace(CSS_IMPORT_RE, "");
}

/** 上游 URL 换成无害 data URL；`#fragment` 与 `data:` 原样保留。 */
function stripUpstreamUrlsFromCss(css: string): string {
  return css.replace(CSS_URL_RE, (match, doubleQuoted, singleQuoted, bare) => {
    const raw = String(doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("data:")) return match;
    return isUpstreamUrl(raw) ? 'url("data:,")' : match;
  });
}

function scrubCss(css: string): string {
  return stripUpstreamUrlsFromCss(stripImportsFromCss(normalizeCss(css)));
}

/**
 * 剥离样式里所有 `@import` 规则（`url(...)` 带不带引号、裸字符串、带媒体查询尾巴都算；
 * 注释与 CSS 转义先归一化）。只删到本条规则结束（`;` / `<` / `}`），不碰
 * `@media`、`@keyframes` 等其余 @ 规则。
 */
export function stripStyleImports(svg: string): string {
  return mapCssText(svg, (css) => stripImportsFromCss(normalizeCss(css)));
}

let upstreamAttrHookInstalled = false;

/**
 * 表现属性（`fill` / `filter` / `mask` / `cursor` …）里的 `url()` 走 DOMPurify 钩子拦：
 * 它们不是 style，普通字符串替换抓不到；先解注释/转义，再按上游域名判。
 */
function ensureUpstreamAttrHook(): void {
  if (upstreamAttrHookInstalled) return;
  upstreamAttrHookInstalled = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const value = data.attrValue;
    if (!value || !/url\s*\(/i.test(value)) return;
    const decoded = normalizeCss(value);
    for (const match of decoded.matchAll(CSS_URL_RE)) {
      const raw = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("data:")) continue;
      if (isUpstreamUrl(raw)) {
        data.keepAttr = false;
        return;
      }
    }
  });
}

/**
 * DOMPurify 消毒 SVG 字符串。
 * 返回空字符串说明内容被清空，调用方按渲染失败处理。
 */
export function sanitizeSvg(svg: string): string {
  ensureUpstreamAttrHook();
  const cleaned = DOMPurify.sanitize(stripStyleImports(svg), {
    // 模型产出的图可能用到 foreignObject 内容，但那正是逃逸向量，直接整体禁掉
    FORBID_TAGS: ["script", "foreignObject", "iframe", "embed", "object", "link"],
    FORBID_ATTR: ["src", "href", "xlink:href"],
  });
  // 消毒后 DOMPurify 会重新序列化 style，出口必须自己再归一化、剥 import、清上游 url()。
  return typeof cleaned === "string" ? mapCssText(cleaned, scrubCss) : "";
}

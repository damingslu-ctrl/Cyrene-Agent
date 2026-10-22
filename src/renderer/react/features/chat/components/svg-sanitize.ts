/**
 * SVG 消毒与熔断 —— 模型输出的 SVG（Mermaid 引擎产物 / 手写 svg 围栏）注入前的统一安全层。
 *
 * 四层防护：
 * 1. 长度熔断：源码超过上限直接降级，不进同步渲染（防 UI 线程卡死）
 * 2. 样式外呼剥离：删掉 `<style>` 里所有 `@import`（引擎注入的 Google Fonts，以及模型能写的任意宿主）
 * 3. DOMPurify 消毒：剥 script / 事件属性 / javascript: 协议 / foreignObject 逃逸
 * 4. 调用方兜底：消毒后仍为空则按渲染失败降级
 *
 * 第 2 层必须剥「全部 @import」而不是只剥字体域名：DOMPurify 不解析 CSS，
 * 一条 `@import url(https://任意宿主/x.css)` 能原样穿过消毒，然后在渲染进程里发网络请求。
 */

import DOMPurify from "dompurify";

/** 源码长度熔断阈值（字符数）：千节点级流程图源码约 23KB / 渲染 265ms，再大就该降级 */
export const SVG_SOURCE_LIMIT = 20000;

/** 手写 SVG 围栏的熔断阈值：每个节点都是显式标签，比 Mermaid 源码更冗长，放宽到 3 倍 */
export const HANDWRITTEN_SVG_SOURCE_LIMIT = 60000;

/** 判断源码是否超过熔断阈值 */
export function isOverSourceLimit(source: string): boolean {
  return source.length > SVG_SOURCE_LIMIT;
}

/** 判断手写 SVG 是否超过熔断阈值 */
export function isOverHandwrittenSvgLimit(source: string): boolean {
  return source.length > HANDWRITTEN_SVG_SOURCE_LIMIT;
}

/**
 * 剥离样式里所有 `@import` 规则（`url(...)` 带不带引号、裸字符串、带媒体查询尾巴都算）。
 * beautiful-mermaid 会无条件注入 Google Fonts 导入；模型手写的 SVG 同样能用这条规则外呼任意宿主。
 * 只删到本条规则结束（`;` / `<` / `}`），不碰 `@media`、`@keyframes` 等其余 @ 规则。
 */
export function stripStyleImports(svg: string): string {
  return svg.replace(/@import\s+(?:url\(\s*(?:"[^"<]*"|'[^'<]*'|[^)<]*)\s*\)|"[^"<]*"|'[^'<]*')[^;<}]*;?/gi, "");
}

/**
 * DOMPurify 消毒 SVG 字符串。
 * 返回空字符串说明内容被清空，调用方按渲染失败处理。
 */
export function sanitizeSvg(svg: string): string {
  const cleaned = DOMPurify.sanitize(stripStyleImports(svg), {
    // 模型产出的图可能用到 foreignObject 内容，但那正是逃逸向量，直接整体禁掉
    FORBID_TAGS: ["script", "foreignObject", "iframe", "embed", "object", "link"],
    FORBID_ATTR: ["src", "href", "xlink:href"],
  });
  // 消毒后再剥一次：DOMPurify 会把 style 内容重新序列化，出口必须自己保证没有 @import。
  return typeof cleaned === "string" ? stripStyleImports(cleaned) : "";
}

// @vitest-environment jsdom
/**
 * SVG 消毒安全层测试：模型输出是不可信输入，注入前必须剥掉全部逃逸向量。
 */

import { describe, expect, it } from "vitest";
import { isOverSourceLimit, sanitizeSvg, stripStyleImports, SVG_SOURCE_LIMIT } from "./svg-sanitize";

describe("sanitizeSvg", () => {
  it("剥掉 <script> 注入", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const out = sanitizeSvg(svg);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("rect");
  });

  it("剥掉 onload 等事件属性", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(2)"><rect width="10" height="10" onclick="alert(3)"/></svg>';
    const out = sanitizeSvg(svg);
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("剥掉 javascript: 协议链接", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(4)"><text>x</text></a></svg>';
    const out = sanitizeSvg(svg);
    expect(out).not.toMatch(/javascript\s*:/i);
  });

  it("剥掉 foreignObject 逃逸向量", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(5)</script></div></foreignObject></svg>';
    const out = sanitizeSvg(svg);
    expect(out.toLowerCase()).not.toContain("foreignobject");
  });

  it("保留正常图形内容与主题 CSS 变量", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" style="--bg:#fffafc"><style>.node { fill: var(--surface, #fdf0f3); }</style><g class="node"><rect width="10" height="10" data-id="A" data-label="开始"/><text>开始</text></g></svg>';
    const out = sanitizeSvg(svg);
    expect(out).toContain("rect");
    expect(out).toContain("开始");
    expect(out).toContain("data-id");
    expect(out).toContain("--bg");
  });
});

describe("stripStyleImports", () => {
  it("剥掉 Google Fonts @import，保留其余样式", () => {
    const svg = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\">",
      "<style>",
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap');",
      "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&amp;display=swap');",
      "text { font-family: 'Inter', system-ui, sans-serif; }",
      "</style>",
      "<text>x</text>",
      "</svg>",
    ].join("\n");
    const out = stripStyleImports(svg);
    expect(out).not.toContain("fonts.googleapis.com");
    expect(out).toContain("font-family");
    expect(out).toContain("<text>x</text>");
  });

  it("任意宿主、任意写法的 @import 都剥掉（url/引号/裸 url/媒体查询尾巴）", () => {
    const svg = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\"><style>",
      "@import url(https://evil.example/x.css);",
      "@import url( 'https://evil.example/2.css' ) screen and (min-width: 100px);",
      "@import \"https://evil.example/3.css\";",
      "@import 'https://evil.example/4.css';",
      ".a { fill: red; }",
      "</style></svg>",
    ].join("\n");
    const out = stripStyleImports(svg);
    expect(out).not.toContain("evil.example");
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain(".a { fill: red; }");
  });

  it("注释与 CSS 转义拆开的 @import 也剥掉", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg"><style>',
      "@import/**/url(https://github.com/x.css);",
      "@im\\70 ort url(https://gitee.com/x.css);",
      ".a { fill: red; }",
      "</style></svg>",
    ].join("\n");
    const out = stripStyleImports(svg);
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toContain("github.com");
    expect(out).not.toContain("gitee.com");
    expect(out).toContain(".a { fill: red; }");
  });

  it("不误伤 @media / @keyframes 等其余 @ 规则", () => {
    const svg = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\"><style>",
      "@media (max-width: 600px) { text { font-size: 12px; } }",
      "@keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }",
      "</style></svg>",
    ].join("\n");
    const out = stripStyleImports(svg);
    expect(out).toContain("@media");
    expect(out).toContain("@keyframes");
  });
});

describe("sanitizeSvg 的出口闭合", () => {
  it("消毒后的结果里不留任何 @import（DOMPurify 不负责 CSS 外呼）", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css); .a { fill: red; }</style><rect width="10" height="10"/></svg>';
    const out = sanitizeSvg(svg);
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toContain("evil.example");
    expect(out).toContain("rect");
  });

  it("剥掉 @font-face / background / cursor 里的上游 url()，保留 # 与 data:", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg"><style>',
      '@font-face { src: url("https://github.com./f.woff2"); }',
      ".a { background-image: url(https://raw.githubusercontent.com/a.png); cursor: url('https://gitee.com/c.cur'), auto; }",
      ".b { fill: url(#ok); background: url(data:image/png;base64,AAAA); }",
      "</style><rect class=\"a\"/></svg>",
    ].join("\n");
    const out = sanitizeSvg(svg);
    expect(out).not.toMatch(/github\.com|raw\.githubusercontent\.com|gitee\.com/);
    expect(out).toContain("url(#ok)");
    expect(out).toContain("data:image/png");
  });

  it("style 属性与表现属性里的上游 url() 也清掉（# 片段保留）", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<rect style="fill:url(https://github.com/p.svg#g)" fill="url(https://gitee.com/p.svg#g)" width="10"/>',
      '<rect fill="url(#ok)" width="10"/>',
      "</svg>",
    ].join("\n");
    const out = sanitizeSvg(svg);
    expect(out).not.toContain("github.com");
    expect(out).not.toContain("gitee.com");
    expect(out).toContain("url(#ok)");
  });

  it("非上游外链不强杀（本期只封上游站点）", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>.a { background-image: url(https://example.com/a.png); }</style><rect class="a"/></svg>';
    expect(sanitizeSvg(svg)).toContain("example.com");
  });

  it("不碰正文里的 /* */ 文本", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>/* 不是注释 */</text></svg>';
    expect(sanitizeSvg(svg)).toContain("/* 不是注释 */");
  });
});

describe("isOverSourceLimit", () => {
  it("阈值内放行，超限熔断", () => {
    expect(isOverSourceLimit("a".repeat(SVG_SOURCE_LIMIT))).toBe(false);
    expect(isOverSourceLimit("a".repeat(SVG_SOURCE_LIMIT + 1))).toBe(true);
  });
});

/**
 * 模块 CSS 与 TS/TSX 里「哪些字面量带着上游品牌身份」的唯一判据。
 *
 * 为什么是值枚举而不是色相窗口：猫自己的色板里有 ROSE #f27d92（耳廓与腮红），
 * 任何「粉一律禁止」的规则会把自家色板判成违规；而 `#e81123` 是 Windows 关闭按钮、
 * `#ff5f57` 是 macOS 交通灯，它们必须留下。所以这里只做**分类**，裁决住在
 * `scripts/build/color-migration.json` 里，人写、提交、由锁逐条核对。
 *
 * 三种写法、三套语境规则（**不能共用**）：
 * - CSS 的 hex / rgb()：颜色的前置字符永远是 `:` 或 `,`，`[\s(:,]` 就是值语境；
 *   `url(#fade)` 要单独排掉。
 * - CSS 的 hsl() 与**裸 HSL 三元组**（Tailwind v4 惯例 `--primary: 343 76% 60%;`）：
 *   上游粉最爱藏在这两处，只认 hex/rgb 的锁看不见它们。
 * - TS/TSX：颜色几乎都写在字符串里（`"#ff5b8a"`），前置字符是**引号**，
 *   所以走 `scanColorLiteralsInTs`——它先切出字符串/代码/注释三类区间，
 *   只认「字符串内容整体就是颜色」与「代码里的 rgb()/hsl() 调用」。
 */
export type BrandFamily = "pink" | "violet" | "red";

/** 颜色写法来自哪个色彩空间——锁的报错要能说清「在哪儿抓到的」。 */
export type ColorSpace = "hex" | "rgb" | "hsl";

/**
 * 从写法本身推色彩空间。
 *
 * 为什么不在 `LiteralHit` 里多存一个字段：那是接口改动，会波及写死 `LiteralHit`
 * 字面量的调用方与测试；而色彩空间完全由写法决定，推出来就行。
 */
export function colorSpaceOf(text: string): ColorSpace {
  if (text.startsWith("#")) return "hex";
  if (/\brgba?\(/i.test(text)) return "rgb";
  return "hsl";
}

export interface LiteralHit {
  /** 文件里原样的写法，保留大小写与空白（回写按它做精确替换）。 */
  text: string;
  family: BrandFamily;
  line: number;
  /** 命中起点在该行内的列（0 基）。回写脚本靠它定位，不靠 `indexOf(text)` 猜第一处。 */
  index: number;
  property: string;
  /** 带 alpha 的写法记 0..1；`#rrggbb`/`#rgb`/不带 alpha 的 `rgb()` 记 null。 */
  alpha: number | null;
  /**
   * 同一个声明里排在它前面的那个 `var(--token`；没有就 null。
   * 只记句法，**不判语义**：前置令牌能否解析取决于该档主题文件，那是回写脚本的逐处分支。
   */
  fallbackOf: string | null;
}

const HEX = /#([0-9a-fA-F]{3,8})\b(?![-0-9a-zA-Z])/g;

/** 两种 CSS 颜色语法都要认：`rgb(255, 91, 138)` 与 `rgb(255 91 138 / 10%)`。 */
const FUNC_COMMA = /\brgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)/g;
const FUNC_SPACE = /\brgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)/g;

/**
 * `hsl()` / `hsla()` 的字面 hue：`hsl(343 76% 60%)`、`hsl(343, 76%, 60%)`。
 *
 * 只认 s/l 带 `%` 的写法：现代 CSS 的 `hsl(343 .76 .6)` 小数形式本仓没在用，
 * 放过它只会多一套语法而不多一分真实覆盖。`hsl(var(--x))` 匹配不上（没有数字），
 * 所以 var() 间接层不归这里管。
 */
const FUNC_HSL = /\bhsla?\(\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%(?:\s*[,\/]\s*(\d{1,3}(?:\.\d+)?%?))?\s*\)/g;

/**
 * 裸 HSL 三元组（Tailwind v4 的自定义属性惯例）：`--primary: 343 76% 60%;`。
 *
 * 为什么只认自定义属性：`color: 343 76% 60%` 根本不是合法 CSS，
 * 只有 `--x: <三元组>` 才是真语法——限定住这一种，误报面就小到可以忽略。
 * 第 2 组是原样写法（回写与查表都按它逐字比对），第 3/4/5 组是 h/s/l。
 */
const CUSTOM_PROP_HSL =
  /(--[a-zA-Z0-9-]+)\s*:\s*((\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%(?:\s*\/\s*(\d{1,3}(?:\.\d+)?%?))?)\s*(?=;|$)/g;

/** `url(#fade)` 里的 `#fade` 四个字符全是合法 hex，会被 HEX 命中——所以要先排掉 url()。 */
function isCssValueContext(line: string, index: number): boolean {
  if (line.slice(Math.max(0, index - 4), index + 1).includes("url(")) return false;
  const before = line[index - 1];
  return before === undefined || /[\s(:,]/.test(before);
}

/** 命中点之前最近的一个 `name:` —— 同时服务块内声明与 `.x { color: #fff; }` 单行规则。 */
function propertyAt(line: string, index: number, carried: string): string {
  const ms = [...line.slice(0, index).matchAll(/([a-zA-Z-]+)\s*:/g)];
  return ms.length ? ms[ms.length - 1][1].toLowerCase() : carried;
}

/** 同一个声明里、命中点之前最近的 `var(--x,` 的 `--x`；只记句法。 */
function fallbackOfAt(line: string, index: number): string | null {
  const ms = [...line.slice(0, index).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*,/g)];
  return ms.length ? ms[ms.length - 1][1] : null;
}

function parseAlpha(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (raw === "1" || raw === "100%") return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return raw.endsWith("%") ? n / 100 : n;
}

function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * 窗口按上游品牌定：
 * - pink：h ∈ [300, 345)（洋红到品牌粉；`#ff5b8a` h=340）
 * - violet：h ∈ [250, 300)（`#c9a7f5`、紫调近黑 `#19161f`）
 * - red：h ∈ [345, 360) ∪ [0, 12)（danger 与 OS 灯都在这一带，交给表去裁决）
 * s ≥ 0.15 才认：低于它的 `#fff1f6` 这类极淡洗色在屏幕上已经不读作品牌粉，
 * 而且深色/浅色两侧都会踩线，判进锁只会逼出无意义的白名单。
 */
export function classifyRgb(r: number, g: number, b: number): BrandFamily | null {
  const { h, s } = hsv(r, g, b);
  if (s < 0.15) return null;
  if (h >= 300 && h < 345) return "pink";
  if (h >= 250 && h < 300) return "violet";
  if (h >= 345 || h < 12) return "red";
  return null;
}

/** HSL → RGB。品牌窗口是在 HSV 上定的，所以 HSL 必须先落到 RGB 再判。 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

/**
 * HSL 写法的品牌身份：先转 RGB 再走同一套窗口。
 *
 * 为什么值得单独开一条：上游粉的两种最爱写法都在 HSL 里——
 * `hsl(343 100% 68%)` 正好等于 `#ff5c8a`（上游品牌粉本身），
 * `--primary: 343 76% 60%` 是 Tailwind rose。只认 hex/rgb 的锁对这两处全瞎。
 */
export function classifyHsl(h: number, s: number, l: number): BrandFamily | null {
  const [r, g, b] = hslToRgb(h, s, l);
  return classifyRgb(r, g, b);
}

function expandHex(x: string): { rgb: string; alpha: number | null } {
  if (x.length === 3 || x.length === 4) {
    const rgb = x.slice(0, 3).split("").map((c) => c + c).join("");
    const alpha = x.length === 4 ? parseInt(x[3] + x[3], 16) / 255 : null;
    return { rgb, alpha };
  }
  if (x.length === 8) return { rgb: x.slice(0, 6), alpha: parseInt(x.slice(6, 8), 16) / 255 };
  return { rgb: x, alpha: null };
}

export function scanColorLiterals(css: string): LiteralHit[] {
  const out: LiteralHit[] = [];
  const lines = css.split("\n");
  let property = "";
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].replace(/\r$/, "");
    for (const m of raw.matchAll(HEX)) {
      if (!isCssValueContext(raw, m.index!)) continue;
      if (m[1].length !== 3 && m[1].length !== 4 && m[1].length !== 6 && m[1].length !== 8) continue;
      const { rgb, alpha } = expandHex(m[1]);
      const fam = classifyRgb(
        parseInt(rgb.slice(0, 2), 16),
        parseInt(rgb.slice(2, 4), 16),
        parseInt(rgb.slice(4, 6), 16),
      );
      if (!fam) continue;
      property = propertyAt(raw, m.index!, property);
      out.push({
        text: m[0], family: fam, line: i + 1, index: m.index!,
        property, alpha, fallbackOf: fallbackOfAt(raw, m.index!),
      });
    }
    for (const re of [FUNC_COMMA, FUNC_SPACE]) {
      for (const m of raw.matchAll(re)) {
        if (!isCssValueContext(raw, m.index!)) continue;
        const fam = classifyRgb(+m[1], +m[2], +m[3]);
        if (!fam) continue;
        property = propertyAt(raw, m.index!, property);
        out.push({
          text: m[0],
          family: fam,
          line: i + 1,
          index: m.index!,
          property,
          alpha: parseAlpha(m[4]),
          fallbackOf: fallbackOfAt(raw, m.index!),
        });
      }
    }
    // `hsl(343 76% 60%)` —— 上游粉的第三种写法。
    for (const m of raw.matchAll(FUNC_HSL)) {
      if (!isCssValueContext(raw, m.index!)) continue;
      const fam = classifyHsl(+m[1], +m[2], +m[3]);
      if (!fam) continue;
      property = propertyAt(raw, m.index!, property);
      out.push({
        text: m[0],
        family: fam,
        line: i + 1,
        index: m.index!,
        property,
        alpha: parseAlpha(m[4]),
        fallbackOf: fallbackOfAt(raw, m.index!),
      });
    }
    // 裸三元组 `--primary: 343 76% 60%;` —— Tailwind v4 惯例，也是上游粉的第四种写法。
    for (const m of raw.matchAll(CUSTOM_PROP_HSL)) {
      const fam = classifyHsl(+m[3], +m[4], +m[5]);
      if (!fam) continue;
      // 值语境看的是**值**前面那个字符（`: ` 之后），不是属性名之前那个。
      const at = m.index! + m[0].indexOf(m[2]);
      if (!isCssValueContext(raw, at)) continue;
      property = propertyAt(raw, at, property);
      out.push({
        text: m[2],
        family: fam,
        line: i + 1,
        index: at,
        property,
        alpha: parseAlpha(m[6]),
        fallbackOf: fallbackOfAt(raw, at),
      });
    }
  }
  return out;
}

/**
 * TS/TSX 里的颜色字面量。
 *
 * 为什么不能复用 CSS 那条规则：CSS 里颜色的前置字符永远是 `:` 或 `,`，
 * 而 TS 里颜色几乎都写在字符串里（`"#ff5b8a"`），前置字符是**引号**——
 * CSS 的 `[\s(:,]` 会把整类 TS 颜色放过去。
 *
 * 这里先切出三类区间（字符串 / 代码 / 注释），再按两种形态收口：
 * 1. **字符串内容整体就是颜色**：`"#ff5b8a"`、`'#ff5b8a'`、`` `#ff5b8a` ``、
 *    `"hsl(343 76% 60%)"`。「整体」这条限制是故意的：`"#added"`、`"#fade"`
 *    这类英文词刚好全是合法 hex，放宽就会把普通字符串判成品牌色。
 * 2. **代码里的 rgb()/hsl() 调用**：`rgb(255, 91, 138)`、`hsl(343 76% 60%)`。
 *
 * 已知不认的形态（**是范围，不是漏扫**）：夹在长串里的颜色
 * （`"linear-gradient(#ff5b8a, #fff)"`）、模板串的插值片段、多行三元组的第二段。
 */
export function scanColorLiteralsInTs(source: string): LiteralHit[] {
  const out: LiteralHit[] = [];
  const starts = lineStartsOf(source);
  for (const region of lexTs(source)) {
    if (region.kind === "comment") continue;
    const chunk = source.slice(region.start, region.end);
    if (region.kind === "string") {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const at = region.start + chunk.indexOf(trimmed);
      const hex = TS_HEX_FULL.exec(trimmed);
      if (hex) {
        const { rgb, alpha } = expandHex(hex[1]);
        const fam = classifyRgb(
          parseInt(rgb.slice(0, 2), 16),
          parseInt(rgb.slice(2, 4), 16),
          parseInt(rgb.slice(4, 6), 16),
        );
        if (fam) out.push(tsHit(source, starts, at, trimmed, fam, alpha));
        continue;
      }
      const hsl = FUNC_HSL_ONE.exec(trimmed);
      if (hsl) {
        const fam = classifyHsl(+hsl[1], +hsl[2], +hsl[3]);
        if (fam) out.push(tsHit(source, starts, at, trimmed, fam, parseAlpha(hsl[4])));
        continue;
      }
      const rgb = FUNC_COMMA_ONE.exec(trimmed) ?? FUNC_SPACE_ONE.exec(trimmed);
      if (rgb) {
        const fam = classifyRgb(+rgb[1], +rgb[2], +rgb[3]);
        if (fam) out.push(tsHit(source, starts, at, trimmed, fam, parseAlpha(rgb[4])));
      }
      continue;
    }
    for (const m of chunk.matchAll(FUNC_COMMA)) {
      const fam = classifyRgb(+m[1], +m[2], +m[3]);
      if (fam) out.push(tsHit(source, starts, region.start + m.index!, m[0], fam, parseAlpha(m[4])));
    }
    for (const m of chunk.matchAll(FUNC_SPACE)) {
      const fam = classifyRgb(+m[1], +m[2], +m[3]);
      if (fam) out.push(tsHit(source, starts, region.start + m.index!, m[0], fam, parseAlpha(m[4])));
    }
    for (const m of chunk.matchAll(FUNC_HSL)) {
      const fam = classifyHsl(+m[1], +m[2], +m[3]);
      if (fam) out.push(tsHit(source, starts, region.start + m.index!, m[0], fam, parseAlpha(m[4])));
    }
  }
  return out;
}

/**
 * 字符串**整体**就是颜色时才认。
 *
 * 刻意不放 4 位：`fade`/`dead`/`beef`/`face` 全是合法 4 位 hex，
 * 而 `"#fade"` 这种字符串在 TS 里并不罕见——放进锁只会逼出无意义的白名单。
 */
const TS_HEX_FULL = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 单次匹配用的副本：`exec` 会推进全局正则的 lastIndex，复用同一个实例会漏匹配。 */
const FUNC_COMMA_ONE = /\brgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)/;
const FUNC_SPACE_ONE = /\brgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)/;
const FUNC_HSL_ONE = /\bhsla?\(\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%(?:\s*[,\/]\s*(\d{1,3}(?:\.\d+)?%?))?\s*\)/;

interface TsRegion {
  kind: "code" | "string" | "comment";
  start: number;
  end: number;
}

/** 引号字符串的闭合位置；跨行或没闭合返回 -1（多半是正则里的引号，不当字符串看）。 */
function findQuoteClose(source: string, from: number, quote: string): number {
  for (let i = from + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") { i += 1; continue; }
    if (ch === "\n") return -1;
    if (ch === quote) return i;
  }
  return -1;
}

/** 模板串的闭合反引号；没闭合返回 -1（宁可漏这一处，也不要把整个文件当字符串）。 */
function findTemplateClose(source: string, from: number): number {
  for (let i = from + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") { i += 1; continue; }
    if (ch === "`") return i;
  }
  return -1;
}

/**
 * 把源码切成 code / string / comment 三类区间。
 *
 * 为什么不用正则一把扫：TS 里 `#ff5b8a` 只可能出现在字符串里，
 * 而正则分不清「字符串里的颜色」与「注释里提到的颜色」——后者不该进锁。
 */
function lexTs(source: string): TsRegion[] {
  const regions: TsRegion[] = [];
  const n = source.length;
  let codeStart = 0;
  let i = 0;
  const flushCode = (end: number) => {
    if (end > codeStart) regions.push({ kind: "code", start: codeStart, end });
  };
  while (i < n) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      flushCode(i);
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      regions.push({ kind: "comment", start: i, end });
      codeStart = end;
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      flushCode(i);
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      regions.push({ kind: "comment", start: i, end });
      codeStart = end;
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const close = findQuoteClose(source, i, ch);
      if (close === -1) { i += 1; continue; }
      flushCode(i);
      regions.push({ kind: "string", start: i + 1, end: close });
      codeStart = close + 1;
      i = close + 1;
      continue;
    }
    if (ch === "`") {
      const close = findTemplateClose(source, i);
      if (close === -1) { i += 1; continue; }
      flushCode(i);
      regions.push({ kind: "string", start: i + 1, end: close });
      codeStart = close + 1;
      i = close + 1;
      continue;
    }
    i += 1;
  }
  flushCode(n);
  return regions;
}

/** 每行的起始偏移，用来把绝对偏移换算成「第几行、第几列」。 */
function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function locateInSource(source: string, starts: number[], offset: number): { line: number; index: number; lineText: string } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  const lineStart = starts[lo];
  const nl = source.indexOf("\n", lineStart);
  const lineEnd = nl === -1 ? source.length : nl;
  return {
    line: lo + 1,
    index: offset - lineStart,
    lineText: source.slice(lineStart, lineEnd).replace(/\r$/, ""),
  };
}

/** TS 里的「属性名」= 命中点之前最近的那个键（对象的 `key:` 或 JSX 的 `attr=`）。 */
function propertyAtTs(line: string, index: number): string {
  const ms = [...line.slice(0, index).matchAll(/([a-zA-Z_$][\w$-]*)\s*[:=]/g)];
  return ms.length ? ms[ms.length - 1][1].toLowerCase() : "";
}

function tsHit(
  source: string,
  starts: number[],
  offset: number,
  text: string,
  family: BrandFamily,
  alpha: number | null,
): LiteralHit {
  const loc = locateInSource(source, starts, offset);
  return {
    text,
    family,
    line: loc.line,
    index: loc.index,
    property: propertyAtTs(loc.lineText, loc.index),
    alpha,
    fallbackOf: fallbackOfAt(loc.lineText, loc.index),
  };
}

const SURFACE_PROPS = /^(background|background-color|border|border-.*-color|box-shadow|fill|outline)/;

const SOLID_BY_LIGHTNESS = (s: number, v: number): string => {
  if (v >= 0.9 && s < 0.25) return "--rb-pink-50";
  if (v >= 0.78 && s < 0.45) return "--rb-pink-100";
  if (v >= 0.55) return "--rb-accent";
  return "--rb-pink-700";
};

/**
 * 建议值。**只是建议**：红族一律返回 `needsReview`，因为「这个红是 danger 还是窗口关闭键」
 * 必须看上下文，机器判错的成本是屏幕上一个小方块变成猫蓝。
 * 粉/紫按明度 + 饱和度分档：淡的当洗色、中的当强调、深的当按下态/文字。
 * 紫调近黑（v < 0.25）是**面**不是**强调**，按属性分给面/墨——但它若带 alpha 就是阴影墨，只能人裁。
 */
export function proposeToken(hit: LiteralHit): string {
  if (hit.family === "red") return "needsReview";
  const rgb = toRgb(hit.text);
  const { s, v } = hsv(rgb[0], rgb[1], rgb[2]);
  // 近黑：不透明的是**面**（按属性分流），带 alpha 的是**阴影墨**——色板里没有「阴影墨」这个概念，
  // 换 --rb-text-primary / --rb-surface-elevated 都会在深色档反相（阴影被画成发光），只能人裁。
  if (v < 0.25) {
    if (hit.alpha !== null && hit.alpha < 1) return "needsReview";
    return SURFACE_PROPS.test(hit.property) ? "--rb-surface-elevated" : "--rb-text-primary";
  }
  const solid = SOLID_BY_LIGHTNESS(s, v);
  if (hit.alpha === null || hit.alpha >= 1) return solid;
  // 洗色必须保住 alpha：color-mix(in srgb, X N%, transparent) 与 rgba(X, N%) 在 srgb 预乘插值下等值。
  return `color-mix(in srgb, var(${solid}) ${Math.round(hit.alpha * 100)}%, transparent)`;
}

/**
 * 任意颜色写法 → RGB。
 *
 * 认四种：hex、`rgb()/rgba()`、`hsl()/hsla()`、裸 HSL 三元组。
 * HSL 那两条是 C-2 补上的——上游粉的两种最爱写法都在 HSL 里，
 * `proposeToken` 要能给它们提令牌，就得先能把它们变成 RGB。
 */
export function toRgb(text: string): [number, number, number] {
  if (text.startsWith("#")) {
    const { rgb } = expandHex(text.slice(1));
    if (rgb.length !== 6) throw new RangeError(`不是可用的 hex：${text}`);
    return [parseInt(rgb.slice(0, 2), 16), parseInt(rgb.slice(2, 4), 16), parseInt(rgb.slice(4, 6), 16)];
  }
  const m = /\brgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (m) return [+m[1], +m[2], +m[3]];
  const hsl = /\bhsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(text);
  if (hsl) return hslToRgb(+hsl[1], +hsl[2], +hsl[3]);
  const triple = /^\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)%/.exec(text);
  if (triple) return hslToRgb(+triple[1], +triple[2], +triple[3]);
  throw new RangeError(`不是可用的颜色：${text}`);
}

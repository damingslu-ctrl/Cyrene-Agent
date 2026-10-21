/**
 * 模块 CSS 里「哪些字面量带着上游品牌身份」的唯一判据。
 *
 * 为什么是值枚举而不是色相窗口：猫自己的色板里有 ROSE #f27d92（耳廓与腮红），
 * 任何「粉一律禁止」的规则会把自家色板判成违规；而 `#e81123` 是 Windows 关闭按钮、
 * `#ff5f57` 是 macOS 交通灯，它们必须留下。所以这里只做**分类**，裁决住在
 * `scripts/build/color-migration.json` 里，人写、提交、由锁逐条核对。
 */
export type BrandFamily = "pink" | "violet" | "red";

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
  }
  return out;
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

export function toRgb(text: string): [number, number, number] {
  if (text.startsWith("#")) {
    const { rgb } = expandHex(text.slice(1));
    if (rgb.length !== 6) throw new RangeError(`不是可用的 hex：${text}`);
    return [parseInt(rgb.slice(0, 2), 16), parseInt(rgb.slice(2, 4), 16), parseInt(rgb.slice(4, 6), 16)];
  }
  const m = /\brgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (!m) throw new RangeError(`不是可用的 rgb()：${text}`);
  return [+m[1], +m[2], +m[3]];
}

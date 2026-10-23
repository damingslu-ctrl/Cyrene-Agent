/**
 * 字面量棘轮：模块里的带色行数只准降不准升。
 *
 * 为什么不是「零字面量」：C5 的裁决是不动中性灰白（理由见计划阶段 C5 开头第 1 条），
 * 所以这一期之后仍然会有 ~700 行合法的中性/第三方色。零字面量的断言要么被放松成摆设，
 * 要么逼出一次没有尺护航的大规模改动。棘轮是这里唯一诚实的形状：**当前值抄自实测，
 * 之后任何人加一行新字面量都会红，而往下调要顺手把常量一起改小。**
 *
 * 两条腿（C-2）：CSS 与 TS/TSX 各有各的上限。分腿的理由是两份数独不同源——
 * CSS 是模块自己的皮肤（709 行，多数是中性灰白），TS/TSX 是内联样式与绘图参数
 * （22 行，多数是透明底与中性墨），合成一个总数会让「往 TS 里塞色」被「CSS 里删了两行」
 * 抵消掉。
 *
 * 口径：
 * - CSS 文件集 = `src` 下所有 `.css` 减去四份主题文件（它们的值是色板本身，不是模块用法）。
 * - TS 文件集 = `src` 下所有 `.ts/.tsx` 减去测试文件（取样夹具）与五份色板文件
 *   （`pet-tokens` / `palette-from-cat` / `color-roles` / `cat-coats` / `cat-roster`，
 *   它们的字面量就是颜色的定义处）。
 * - 「带色行」= 该行出现 `#rgb/#rrggbb…`、`rgb(`/`rgba(`、或**参数以数字开头**的 `hsl(`/`hsla(`
 *   （`hsl(var(--x))` 是引用不是字面量，不计）。一行出现多次只计一行。
 * - `url(#fade)` 这类 SVG 片段也会被 `#` 分支数进去，TS 里 `// rgb(26,29,38)` 这类注释同理
 *   ——口径偏保守（只会让上限偏高），换来的是一行正则、没有第二套解析器。
 *
 * 已知局限：本棘轮只数**行**，不数处；一行里多塞一个色不会触发。Task 18 的分类器锁
 * （`brand-color-migration.test.ts`）管品牌色，本锁管「总数不再增长」，两者互补。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 实测值（2026-10-23，C-2 回写之后；含 LoadingScreen 两行字面 hue）；下降 10 行以上时控制台会提醒把它一起调小。 */
const CEILING_CSS = 711;
/** 实测值（2026-10-23，C-2）；下降 10 行以上时控制台会提醒把它一起调小。 */
const CEILING_TS = 22;

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

const BOARD_TS = [
  "src/shared/pet-tokens.ts",
  "src/shared/palette-from-cat.ts",
  "src/shared/color-roles.ts",
  "src/shared/cat-coats.ts",
  "src/shared/cat-roster.ts",
];

const IS_TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

/** `__dirname` = `src/renderer/ui`，仓库根在三级之上（R-18-6）。 */
const REPO = resolve(__dirname, "../../..");

/** `hsl(` 后面必须是数字才是字面 hue；`hsl(var(--primary))` 是令牌引用，不该被棘轮惩罚。 */
const COLOR = /#[0-9a-fA-F]{3,8}\b(?![-0-9a-zA-Z])|\brgba?\(|\bhsla?\(\s*\d/;

function countColorLines(files: string[]): { total: number; per: Array<[string, number]> } {
  let total = 0;
  const per: Array<[string, number]> = [];
  for (const file of files) {
    const n = readFileSync(resolve(REPO, file), "utf8")
      .split("\n")
      .filter((l) => COLOR.test(l)).length;
    if (n) per.push([file, n]);
    total += n;
  }
  return { total, per };
}

describe("模块 CSS 的字面量棘轮", () => {
  it("带色行的总数不超过棘轮上限，且统计口径本身没有塌", () => {
    const files = globSync("src/**/*.css", { cwd: REPO })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !THEME_FILES.includes(f));
    const { total, per } = countColorLines(files);
    // 正对照：glob 跑空或正则失效都会让 total=0 直接读成绿。
    expect(files.length, "glob 一个文件都没收到").toBeGreaterThan(60);
    expect(per.length, "一个带色文件都没收到").toBeGreaterThan(30);
    expect(COLOR.test(".x { color: hsl(11, 83%, 72%); }"), "hsl 字面 hue 没被算进带色行").toBe(true);
    expect(COLOR.test(".x { color: hsl(var(--primary)); }"), "hsl(var(--x)) 是引用，不该算字面量").toBe(false);
    expect(total, "带色行数超过了棘轮上限").toBeLessThanOrEqual(CEILING_CSS);
    if (total < CEILING_CSS - 10) {
      // 不是失败，是提醒：降了 10 行以上就该把上限一起调小，否则棘轮白松了 10 行。
      console.warn(`[ratchet:css] 实测 ${total} < 上限 ${CEILING_CSS}，把 CEILING_CSS 改成 ${total}`);
    }
  });

  it("模块 TS/TSX 的带色行总数不超过棘轮上限", () => {
    const files = globSync("src/**/*.{ts,tsx}", { cwd: REPO })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !IS_TEST_FILE.test(f) && !BOARD_TS.includes(f));
    const { total, per } = countColorLines(files);
    expect(files.length, "glob 一个文件都没收到").toBeGreaterThan(800);
    expect(per.length, "一个带色文件都没收到").toBeGreaterThan(8);
    expect(COLOR.test(`const c = "#ff5b8a";`), "TS 里的 hex 没被算进带色行").toBe(true);
    expect(total, "TS/TSX 带色行数超过了棘轮上限").toBeLessThanOrEqual(CEILING_TS);
    if (total < CEILING_TS - 10) {
      console.warn(`[ratchet:ts] 实测 ${total} < 上限 ${CEILING_TS}，把 CEILING_TS 改成 ${total}`);
    }
  });
});

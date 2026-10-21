/**
 * 字面量棘轮：模块 CSS 里带颜色的行数只准降不准升。
 *
 * 为什么不是「零字面量」：C5 的裁决是不动中性灰白（理由见计划阶段 C5 开头第 1 条），
 * 所以这一期之后仍然会有 ~700 行合法的中性/第三方色。零字面量的断言要么被放松成摆设，
 * 要么逼出一次没有尺护航的大规模改动。棘轮是这里唯一诚实的形状：**当前值抄自实测，
 * 之后任何人加一行新字面量都会红，而往下调要顺手把常量一起改小。**
 *
 * 口径（与 Task 19 的实测一致）：
 * - 文件集 = `src` 下所有 `.css` 减去四份主题文件（它们的值是色板本身，不是模块用法）。
 * - 「带色行」= 该行出现 `#rgb/#rrggbb…` 或 `rgb(`/`rgba(`。一行出现多次只计一行。
 * - `url(#fade)` 这类 SVG 片段也会被 `#` 分支数进去——口径偏保守（只会让上限偏高），
 *   换来的是一行正则、没有第二套解析器。
 *
 * 已知局限：本棘轮只数**行**，不数处；一行里多塞一个色不会触发。Task 18 的分类器锁
 * （`brand-color-migration.test.ts`）管品牌色，本锁管「总数不再增长」，两者互补。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 实测值（2026-10-21，Task 19 回写之后）；下降 10 行以上时控制台会提醒把它一起调小。 */
const CEILING = 709;

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

/** `__dirname` = `src/renderer/ui`，仓库根在三级之上（R-18-6）。 */
const REPO = resolve(__dirname, "../../..");

const COLOR = /#[0-9a-fA-F]{3,8}\b(?![-0-9a-zA-Z])|\brgba?\(/;

describe("模块 CSS 的字面量棘轮", () => {
  it("带色行的总数不超过棘轮上限，且统计口径本身没有塌", () => {
    const files = globSync("src/**/*.css", { cwd: REPO })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !THEME_FILES.includes(f));
    let total = 0;
    const per: Array<[string, number]> = [];
    for (const file of files) {
      const n = readFileSync(resolve(REPO, file), "utf8")
        .split("\n")
        .filter((l) => COLOR.test(l)).length;
      if (n) per.push([file, n]);
      total += n;
    }
    // 正对照：glob 跑空或正则失效都会让 total=0 直接读成绿。
    expect(files.length, "glob 一个文件都没收到").toBeGreaterThan(60);
    expect(per.length, "一个带色文件都没收到").toBeGreaterThan(30);
    expect(total, "带色行数超过了棘轮上限").toBeLessThanOrEqual(CEILING);
    if (total < CEILING - 10) {
      // 不是失败，是提醒：降了 10 行以上就该把上限一起调小，否则棘轮白松了 10 行。
      console.warn(`[ratchet] 实测 ${total} < 上限 ${CEILING}，把 CEILING 改成 ${total}`);
    }
  });
});

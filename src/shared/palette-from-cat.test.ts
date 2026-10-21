import { describe, expect, it } from "vitest";
import {
  DARK_TOKENS, LIGHT_TOKENS, TOKENS_BY_SCHEME, WINDOW_BACKGROUNDS, contrastRatio, derivedValue,
} from "./palette-from-cat";
import { CAT_PALETTE, wash } from "./pet-tokens";

const HEX = /#[0-9a-f]{6}/g;
// 上游品牌时代的色：粉主色、紫端点、材料粉。改名不改值、或漏改某档，就会留下这些。
const BANNED = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
  /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i];

describe("配色派生器", () => {
  it("两把令牌表键集完全相同（换档不许增减令牌）", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
  });

  it("derivedValue 对未派生的令牌抛错，而不是返回 undefined", () => {
    expect(() => derivedValue("light", "--rb-没有这个令牌")).toThrow(/未派生/);
    // Task 16 的派生锁按名字取值，两档都得抛——只钉 light 则 `scheme==="dark"?{}:…` 这类滑疏读绿。
    expect(() => derivedValue("dark", "--rb-没有这个令牌")).toThrow(/未派生/);
    expect(derivedValue("light", "--rb-accent")).toBe(LIGHT_TOKENS["--rb-accent"]);
  });

  it("每一个 hex 都是合法 6 位小写（`hex()` 的往返结果，不是手抄的大写或 3 位缩写）", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const h of value.match(HEX) ?? []) expect(h, name).toBe(h.toLowerCase());
        // 正对照：这张表里确实有裸 hex；若某次改动把全表变成 var()，上面的循环会空过。
      }
      expect(Object.values(map).join(" ").match(HEX)!.length).toBeGreaterThan(40);
    }
  });

  it("没有一处残留上游品牌粉/紫", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const re of BANNED) expect(re.test(value), `${name} = ${value}`).toBe(false);
      }
    }
  });

  it("正文压在页底/工作区/浮起底上的对比度都不低于 4.5", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      for (const base of ["--rb-surface-page", "--rb-surface-workspace", "--rb-surface-elevated"]) {
        expect(contrastRatio(t["--rb-text-primary"], t[base]), `${scheme} ${base}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("次级文字在浮起底上不低于 3:1（图形/次级信息门槛）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(contrastRatio(t["--rb-text-secondary"], t["--rb-surface-elevated"]))
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("令牌表里凡是写成裸 hex 的成品色，都必须能在猫色板上找到（预混结果除外由 Task 16 复算）", () => {
    const board = new Set(
      Object.values(CAT_PALETTE).filter((v): v is string => typeof v === "string"),
    );
    // 这一条只查「裸值」档（值里只有一个 hex 的令牌）：它们必须是板内色。
    // 注意 `PANEL_CARD()` 等三个「洗的是洗过的」嵌套预混：它们能过是因为巧有单步三元组
    // 落在同一个 RGB，不是枚举真盖住了它们。真正的锁是 Task 16 的按算式复算。
    // 多 hex 的值（gradient/shadow）与 rgba 由 Task 16 的完整锁按算式复算。
    // ⚠️ 与 brief 文本唯一的偏差（理由与实测数字见 task-14-report.md）：`wash()` 的返回值
    // 本身就是一个裸 hex，所以「值里只有一个 hex」并不能推出「它是板内色」——实测 104 个令牌里
    // light 49 + dark 32 = 81 个是板外裸 hex，逐个复算后**全部**是 wash 的预混结果，发明色 0 个。
    // 本条的「除外」口径由它自己的括号写明（预混结果除外），按值形状区分不开板内色与预混色，
    // 所以这里把「除外」实现为**可复算**：合法集 = 板内色 ∪ wash(板内色|WHITE, 0..255, 板内色|WHITE)。
    // 拼不出来的裸 hex 照样红，锁住的仍是规矩 1「不发明新色」；没有放松任何阈值。
    const legal = new Set(board);
    const inputs = [...board, "#ffffff"];
    for (const fg of inputs) for (const bg of inputs) for (let a = 0; a <= 255; a++) legal.add(wash(fg, a, bg));
    for (const scheme of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(TOKENS_BY_SCHEME[scheme])) {
        const bare = /^#[0-9a-f]{6}$/.exec(value);
        if (!bare) continue;
        expect(legal.has(value), `${scheme} ${name} = ${value}`).toBe(true);
      }
    }
  });

  it("文字色不许等于它要压的底色（防止 on-accent 被推成 accent 本身）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(t["--rb-text-on-accent"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-accent-hover"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-border-focus"]).toBe(t["--rb-accent"]);
    }
  });

  it("表面五档与 pink 阶梯不许出现平阶（档位存在就必须看得见）", () => {
    // 这条锁的是「层级」本身，不是某个具体 α。两条都是本期实测踩出来的：
    // 深色档原先 page==workspace、hover(α16)≈elevated(ΔRGB≤2)，鼠标悬停等于没反馈；
    // pink-400 原先直接写 ACCENT_FG，与 500 同值——现有 charcoal-pink.css:53-54 是分开的一对。
    // 阈值按「用户能不能认出这是另一个状态」定，不按当前数值凑：
    // 交互相邻档要求任一通道差 ≥8；page→workspace 是面与面的差别，≥5 即可。
    const chan = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const maxDelta = (a: string, b: string) =>
      Math.max(...chan(a).map((v, i) => Math.abs(v - chan(b)[i])));
    // contrastRatio 对 #000000 是亮度的严格单调函数（(L+0.05)/0.05），借它当尺，不再实现一遍亮度。
    const lum = (h: string) => contrastRatio(h, "#000000");

    const surfaces = [
      "--rb-surface-page", "--rb-surface-workspace", "--rb-surface-elevated",
      "--rb-surface-hover", "--rb-surface-active",
    ];
    const pink = ["--rb-pink-50", "--rb-pink-100", "--rb-pink-200", "--rb-pink-300",
      "--rb-pink-400", "--rb-pink-500", "--rb-pink-600", "--rb-pink-700"];

    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      const s = surfaces.map((n) => t[n]);
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) {
          expect(s[i], `${scheme} ${surfaces[i]} == ${surfaces[j]}`).not.toBe(s[j]);
        }
      }
      expect(maxDelta(s[0], s[1]), `${scheme} page→workspace`).toBeGreaterThanOrEqual(5);
      expect(maxDelta(s[2], s[3]), `${scheme} elevated→hover`).toBeGreaterThanOrEqual(8);
      expect(maxDelta(s[3], s[4]), `${scheme} hover→active`).toBeGreaterThanOrEqual(8);

      const p = pink.map((n) => t[n]);
      const lower = p.slice(0, 6).map(lum); // 50→500：从表面一侧抬到基准
      const upper = p.slice(5).map(lum); // 500→700：从基准压到按压态
      const strict = (xs: number[], label: string, dir: "up" | "down") => {
        for (let i = 1; i < xs.length; i++) {
          const moved = dir === "up" ? xs[i] > xs[i - 1] : xs[i] < xs[i - 1];
          expect(moved, `${scheme} ${label} ${pink[0]}… 第 ${i} 步不单调`).toBe(true);
        }
      };
      // 方向逐档不同是设计使然：浅色的 50 是「往纸上压一层」，深色的 50 是「往墨底抬一层」，
      // 两档的 50 都意味着「离表面最近的淡 tint」，所以相对亮度一支升、一支降。
      strict(lower, "pink-50→500", scheme === "dark" ? "up" : "down");
      strict(upper, "pink-500→700", "down");
      for (let i = 1; i < p.length; i++) {
        expect(maxDelta(p[i - 1], p[i]), `${scheme} ${pink[i - 1]}→${pink[i]}`)
          .toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("原生窗底色取的是页底令牌而不是工作区，且是合法 #rrggbb", () => {
    expect(WINDOW_BACKGROUNDS["pearl-white"]).toBe(LIGHT_TOKENS["--rb-surface-page"]);
    expect(WINDOW_BACKGROUNDS["charcoal-pink"]).toBe(DARK_TOKENS["--rb-surface-page"]);
    // 上面两条是同一个表达式自行对自行，令牌改名时两边同时变 undefined 仍然绿；
    // 真正的钳铮是下面的类型守卫，但它报 TypeError 而不报消息。技术上够用，意图不明确。
    expect("--rb-surface-page" in LIGHT_TOKENS).toBe(true);
    expect("--rb-surface-page" in DARK_TOKENS).toBe(true);
    // 标题里那句「而不是工作区」得自己钉住：深色档原先 page==workspace，那时这句是空话。
    expect(WINDOW_BACKGROUNDS["pearl-white"]).not.toBe(LIGHT_TOKENS["--rb-surface-workspace"]);
    expect(WINDOW_BACKGROUNDS["charcoal-pink"]).not.toBe(DARK_TOKENS["--rb-surface-workspace"]);
    for (const v of Object.values(WINDOW_BACKGROUNDS)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
